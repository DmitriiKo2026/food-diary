/*
 * Распознавание еды «На устройстве»: нейросеть работает прямо в браузере, без интернета и ключей.
 *
 * Как это устроено:
 *   1. Модель MobileCLIP-S0 (картиночная часть, ONNX fp16, ~22 МБ) превращает фото в вектор из 512 чисел.
 *   2. Для каждого продукта нашей базы заранее посчитан такой же вектор по его названию (матрица 1 МБ).
 *      Чем ближе вектор фото к вектору продукта, тем вероятнее, что на фото он. Так получается список
 *      кандидатов из НАШЕЙ базы (ккал, БЖУ и ГИ берутся из неё же).
 *   3. «Личная память»: когда вы подтверждаете блюдо, вектор фото и состав (продукты + граммы) сохраняются
 *      на этом устройстве (IndexedDB). Похожее фото в следующий раз получит тот же состав, а продукты из ваших
 *      прошлых блюд поднимаются в списке кандидатов. Память НЕ синхронизируется и не покидает устройство.
 *   4. Вес порции модель по фото не знает: берётся ваша прошлая порция или типичная (portions.js).
 *
 * Файлы модели скачиваются один раз (по запросу пользователя) в отдельный кэш `fd-model-v1` и дальше
 * работают офлайн. Эти файлы НЕ входят в кэш версии приложения (sw.js) и не удаляются при его обновлении.
 * Запуск — onnxruntime-web (WASM, один поток): совместим с iPhone; WebGPU — только по желанию (экспериментально).
 *
 * Все пороги и параметры — в OnDevice.CFG (один раздел ниже): их легко перенастроить без правки логики.
 */
var OnDevice = (function () {
  'use strict';

  // ===================================================================
  // Настройки и пороги (всё, что стоит подстраивать, — здесь)
  // ===================================================================
  var CFG = {
    VERSION: 'mcs0-v1',                       // каталог models/<VERSION>/ — имена версионные, файлы не меняются
    MODEL_DIR: 'models/mcs0-v1/',
    ORT_DIR: 'js/vendor/ort/',
    CACHE: 'fd-model-v1',                     // отдельный кэш (префикс НЕ food-diary-: sw.js его не трогает)
    APPROX_MB: 38,                            // для текста до загрузки meta.json
    INPUT: 256,                               // сторона квадрата для модели
    SMOOTHING: 'low',                        // качество уменьшения canvas: 'low' ближе всего к эталонной обработке transformers.js
    CAND_N: 4,                                // чипов «может быть»
    ADD_N: 3,                                 // чипов «добавить ещё» (другая категория)
    POOL_N: 14,                               // сколько лучших смотрим при подборе чипов
    LOW_SCORE: 0.285,                         // оценка лучшего кандидата ниже — уверенность «низкая»
    KNN_USE: 0.80,                            // сходство ≥ — берём состав прошлого блюда целиком
    KNN_HIGH: 0.88,                           // сходство ≥ — уверенность «высокая»
    KNN_TAU: 0.70, KNN_LAMBDA: 2,             // бонус кандидату из прошлых блюд: λ·(сходство − τ), если сходство > τ (τ выше — меньше ложных подсказок от непохожих блюд)
    KNN_DEDUP: 0.97,                          // ≥ — это то же блюдо: запись обновляется, а не дублируется
    KNN_MAX: 1500,                            // не больше записей личной памяти (старые вытесняются)
    IDLE_RELEASE_MS: 60000,                   // через сколько без использования освобождать модель из памяти
    RUN_TIMEOUT_MS: 120000,                   // предельное время запуска сети + распознавания (дальше — понятная ошибка, а не вечный спиннер)
    IDB_TIMEOUT_MS: 4000,                     // IndexedDB иногда «зависает» (баг Safari) — не ждём дольше, работаем без личной памяти
    DL_RETRIES: 2,                            // повторов файла при обрыве связи (с нуля: докачка внутри файла не поддерживается)
    MAX_PHOTOS: 3
  };

  var LS = { installed: 'ft_v1_od_installed', run: 'ft_v1_od_run', webgpu: 'ft_v1_od_webgpu' };
  var DB_NAME = 'ft_vision', STORE = 'meals';

  // ---------- localStorage (с защитой) ----------
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  function ODError(code, message, detail) { this.name = 'ODError'; this.code = code; this.message = message; this.detail = detail || ''; }
  ODError.prototype = Object.create(Error.prototype);
  var MSG = {
    unsupported: 'Этот браузер не умеет запускать модель на устройстве (нужны WebAssembly и хранилище кэша). Воспользуйтесь «Другими способами».',
    notinstalled: 'Модель ещё не скачана.',
    offline: 'Нет интернета — не удалось скачать модель. Подключитесь к сети (лучше Wi-Fi) и повторите.',
    http: 'Сервер не отдал файл модели. Повторите позже.',
    size: 'Файл модели скачался не полностью. Повторите загрузку.',
    hash: 'Файл модели повреждён при загрузке. Повторите загрузку.',
    quota: 'Не хватает места на устройстве для модели (нужно ~40 МБ). Освободите место и повторите.',
    cancel: 'Загрузка отменена.',
    load: 'Не удалось запустить нейросеть на этом устройстве (возможно, не хватает памяти или браузер слишком старый). Закройте лишние вкладки и приложения и повторите; можно «Скачать заново» в «Настройки → На устройстве» или воспользоваться «Другими способами» (вверху этого окна). Подробности: ',
    matrix: 'Список продуктов в приложении не совпадает с моделью (приложение обновилось). Нажмите «Настройки → На устройстве → Скачать заново»; если ошибка осталась — воспользуйтесь «Другими способами» (вверху окна): модель нужно пересобрать под новую базу продуктов.',
    timeout: 'Нейросеть не ответила за 2 минуты. Закройте лишние вкладки и приложения и повторите; если так каждый раз — воспользуйтесь «Другими способами» (вверху окна).',
    image: 'Не удалось подготовить фото для распознавания.'
  };

  // ===================================================================
  // Поддержка, состояние
  // ===================================================================
  function supported() {
    var why = null;
    if (typeof WebAssembly !== 'object') why = 'нет WebAssembly';
    else if (typeof caches === 'undefined') why = 'нет Cache Storage (приватный режим или file://)';
    else if (!/^https?:$/.test(location.protocol)) why = 'страница открыта не по https (файл с диска не подходит)';
    else if (typeof fetch !== 'function' || typeof Promise !== 'function') why = 'старый браузер';
    return { ok: !why, reason: why };
  }

  var crashed = lsGet(LS.run) != null;      // прошлый запуск не завершился (вкладку убила нехватка памяти?)
  if (crashed) lsSet(LS.run, null);
  var state = { meta: null, matrix: null, session: null, sessionP: null, ort: null, idleTimer: null, urls: [], gen: 0 };

  function installedInfo() { try { var o = JSON.parse(lsGet(LS.installed) || 'null'); return o && o.version === CFG.VERSION ? o : null; } catch (e) { return null; } }
  function useWebGPU() { return lsGet(LS.webgpu) === '1'; }
  function setWebGPU(on) { lsSet(LS.webgpu, on ? '1' : null); release(true); }
  function url(path) { return new URL(path, document.baseURI).href; }

  /** Список файлов обязательной части и (опционально) WebGPU-пакета по meta.json */
  function filesOf(meta, pack) { return (meta.files || []).filter(function (f) { return (f.pack || 'core') === (pack || 'core'); }); }

  // ===================================================================
  // Загрузка и кэш модели
  // ===================================================================
  function hex(buf) { var a = new Uint8Array(buf), s = ''; for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16); return s; }
  function sha256(blob) {
    if (!(window.crypto && crypto.subtle && blob.arrayBuffer)) return Promise.resolve(null);
    return blob.arrayBuffer().then(function (b) { return crypto.subtle.digest('SHA-256', b); }).then(hex, function () { return null; });
  }
  function mimeOf(path) {
    return /\.wasm/.test(path) ? 'application/wasm' : /\.mjs$|\.js$/.test(path) ? 'text/javascript' : /\.json$/.test(path) ? 'application/json' : 'application/octet-stream';
  }

  function fetchMeta(signal) {
    return fetch(url(CFG.MODEL_DIR + 'meta.json'), { cache: 'no-cache', signal: signal }).then(function (r) {
      if (!r.ok) throw new ODError('http', MSG.http, 'meta ' + r.status);
      return r.json();
    }).then(function (m) { state.meta = m; return m; }, function (e) {
      if (e && e.name === 'AbortError') throw new ODError('cancel', MSG.cancel);
      if (e instanceof ODError) throw e;
      throw new ODError(navigator.onLine === false ? 'offline' : 'http', navigator.onLine === false ? MSG.offline : MSG.http, String(e));
    });
  }

  /** Размер файла в кэше (или -1). Берём из заголовка Content-Length, который записали сами после проверки; blob() — запасной путь. */
  function cachedSize(cache, f) {
    return cache.match(url(f.path)).then(function (r) {
      if (!r) return -1;
      var n = parseInt(r.headers.get('Content-Length'), 10);
      return n >= 0 ? n : r.blob().then(function (b) { return b.size; });
    }).catch(function () { return -1; });
  }

  /** Проверка наличия всех файлов пакета в кэше (по размерам из meta.json) */
  function verify(pack) {
    if (!supported().ok) return Promise.resolve(false);
    return caches.open(CFG.CACHE).then(function (cache) {
      return (state.meta ? Promise.resolve(state.meta) : cache.match(url(CFG.MODEL_DIR + 'meta.json')).then(function (r) { return r ? r.json() : null; })).then(function (meta) {
        if (!meta) return false;
        state.meta = meta;
        return Promise.all(filesOf(meta, pack).map(function (f) { return cachedSize(cache, f); })).then(function (sizes) {
          return filesOf(meta, pack).every(function (f, i) { return sizes[i] === f.bytes; });
        });
      });
    }).catch(function () { return false; });
  }

  /**
   * Скачать пакет модели в кэш `fd-model-v1`. onProgress({loaded, total, file, index, count}).
   * Уже скачанные и проверенные файлы пропускаются (повтор после обрыва продолжает с недостающих).
   * Возвращает {cancel()} и promise: opts.signal — AbortSignal.
   */
  function download(opts) {
    opts = opts || {};
    var pack = opts.pack || 'core', signal = opts.signal, onProgress = opts.onProgress || function () {};
    var sup = supported();
    if (!sup.ok) return Promise.reject(new ODError('unsupported', MSG.unsupported, sup.reason));
    var cache, meta, files, total = 0, loaded = 0;
    return fetchMeta(signal).then(function (m) {
      meta = m; files = filesOf(meta, pack);
      files.forEach(function (f) { total += f.bytes; });
      return caches.open(CFG.CACHE);
    }).then(function (c) {
      cache = c;
      var chain = Promise.resolve();
      files.forEach(function (f, idx) {
        chain = chain.then(function () {
          return cachedSize(cache, f).then(function (sz) {
            if (sz === f.bytes) { loaded += f.bytes; onProgress({ loaded: loaded, total: total, file: f.path, index: idx, count: files.length }); return; }
            return downloadRetry(cache, f, signal, function (n) { loaded += n; onProgress({ loaded: loaded, total: total, file: f.path, index: idx, count: files.length }); }, function (undo) { loaded -= undo; },
              function (n) { onProgress({ loaded: loaded, total: total, file: f.path, index: idx, count: files.length, retry: n }); });
          });
        });
      });
      return chain;
    }).then(function () {
      // сам meta.json кладём в кэш — по нему офлайн понимаем, что установлено
      return cache.put(url(CFG.MODEL_DIR + 'meta.json'), new Response(JSON.stringify(meta), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }).then(function () {
      if (pack === 'core') {
        lsSet(LS.installed, JSON.stringify({ version: CFG.VERSION, bytes: total, at: Date.now() }));
        cleanOld(cache, meta);
      }
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) { /* ignore */ }
      return { bytes: total };
    }).catch(function (e) {
      if (e instanceof ODError) throw e;
      if (e && e.name === 'AbortError') throw new ODError('cancel', MSG.cancel);
      if (e && /quota/i.test(e.name + ' ' + e.message)) throw new ODError('quota', MSG.quota, String(e));
      // браузер не даёт открыть хранилище кэша (запрет сайтовых данных, режим конфиденциальности) — это не «сервер не отдал файл»
      if (e && /Security|NotAllowed|InvalidState|NotSupported/i.test(e.name)) throw new ODError('unsupported', MSG.unsupported + ' (хранилище кэша браузера недоступно)', String(e));
      throw new ODError(navigator.onLine === false ? 'offline' : 'http', navigator.onLine === false ? MSG.offline : MSG.http, String(e));
    });
  }

  /** Файл с повторами при обрыве связи (мобильная сеть): отмена, повреждённый файл и «нет сети» не повторяются */
  function downloadRetry(cache, f, signal, onBytes, onUndo, onRetry) {
    var attempt = function (n) {
      return downloadOne(cache, f, signal, onBytes, onUndo).catch(function (e) {
        var net = !(e instanceof ODError) && !(e && (e.name === 'AbortError' || /quota|Security|NotAllowed|InvalidState|NotSupported/i.test(e.name + ' ' + e.message)));
        var httpErr = e instanceof ODError && (e.code === 'http' || e.code === 'size');
        if (n >= CFG.DL_RETRIES || !(net || httpErr) || (signal && signal.aborted) || navigator.onLine === false) throw e;
        if (onRetry) onRetry(n + 1);
        return new Promise(function (res) { setTimeout(res, 1500 * (n + 1)); }).then(function () {
          if (signal && signal.aborted) throw new ODError('cancel', MSG.cancel);
          return attempt(n + 1);
        });
      });
    };
    return attempt(0);
  }

  function downloadOne(cache, f, signal, onBytes, onUndo) {
    var got = 0;
    return fetch(url(f.path), { cache: 'no-store', signal: signal }).then(function (res) {
      if (!res.ok) throw new ODError('http', MSG.http, f.path + ' ' + res.status);
      var chunks = [];
      if (!(res.body && res.body.getReader)) return res.blob();
      var reader = res.body.getReader();
      return (function pump() {
        return reader.read().then(function (r) {
          if (r.done) return new Blob(chunks);
          chunks.push(r.value); got += r.value.length; onBytes(r.value.length);
          return pump();
        });
      })();
    }).then(function (blob) {
      if (blob.size !== f.bytes) throw new ODError('size', MSG.size, f.path + ' ' + blob.size + '/' + f.bytes);
      return sha256(blob).then(function (h) {
        if (h && f.sha256 && h !== f.sha256) throw new ODError('hash', MSG.hash, f.path);
        return cache.put(url(f.path), new Response(blob, { status: 200, headers: { 'Content-Type': mimeOf(f.path), 'Content-Length': String(blob.size) } }));
      });
    }).catch(function (e) { onUndo(got); throw e; });
  }

  /** Удалить из кэша файлы других версий модели */
  function cleanOld(cache, meta) {
    var keep = {}; (meta.files || []).forEach(function (f) { keep[url(f.path)] = true; }); keep[url(CFG.MODEL_DIR + 'meta.json')] = true;
    return cache.keys().then(function (reqs) {
      return Promise.all(reqs.filter(function (r) { return !keep[r.url]; }).map(function (r) { return cache.delete(r); }));
    }).catch(function () {});
  }

  /** Удалить модель с устройства (личная память остаётся — её сбрасывают отдельно) */
  function remove() {
    state.gen++;                                // сессия, которая как раз загружалась, после удаления модели не должна «воскреснуть»
    release(true);
    state.meta = null; state.matrix = null; state.ort = null;
    lsSet(LS.installed, null);
    return (typeof caches !== 'undefined' ? caches.delete(CFG.CACHE) : Promise.resolve()).catch(function () {});
  }

  /** Сколько места занимает модель на устройстве (по meta.json), в байтах; 0 — не установлена */
  function installedBytes() { var i = installedInfo(); return i ? i.bytes : 0; }

  function getBytes(path) {
    return caches.open(CFG.CACHE).then(function (c) { return c.match(url(path)); }).then(function (r) {
      if (!r) throw new ODError('notinstalled', MSG.notinstalled, path);
      return r.arrayBuffer();
    });
  }
  function blobUrl(buf, type) { var u = URL.createObjectURL(new Blob([buf], { type: type })); state.urls.push(u); return u; }

  // ===================================================================
  // Модель: ORT-сессия
  // ===================================================================
  function dynImport(u) { return (new Function('u', 'return import(u)'))(u); }

  function loadOrt(gpu) {
    if (state.ort && state.ort.gpu === gpu) return Promise.resolve(state.ort.ort);
    var core = !gpu;
    var entry = core ? CFG.ORT_DIR + 'ort.wasm.min.mjs' : CFG.ORT_DIR + 'ort.min.mjs';
    var glue = core ? CFG.ORT_DIR + 'ort-wasm-simd-threaded.mjs' : CFG.ORT_DIR + 'ort-wasm-simd-threaded.jsep.mjs';
    var wasmPath = core ? CFG.ORT_DIR + 'ort-wasm-simd-threaded.wasm' : CFG.ORT_DIR + 'ort-wasm-simd-threaded.jsep.wasm';
    var wasmP = core ? getBytes(wasmPath) : Promise.all([getBytes(wasmPath + '.part1'), getBytes(wasmPath + '.part2')]).then(function (p) {
      var out = new Uint8Array(p[0].byteLength + p[1].byteLength); out.set(new Uint8Array(p[0]), 0); out.set(new Uint8Array(p[1]), p[0].byteLength); return out.buffer;
    });
    return Promise.all([getBytes(entry), getBytes(glue), wasmP]).then(function (r) {
      return dynImport(blobUrl(r[0], 'text/javascript')).then(function (ort) {
        ort.env.wasm.numThreads = 1;            // без cross-origin isolation (GitHub Pages) многопоточность недоступна
        ort.env.wasm.proxy = false;
        ort.env.logLevel = 'error';
        ort.env.wasm.wasmPaths = { mjs: blobUrl(r[1], 'text/javascript'), wasm: blobUrl(r[2], 'application/wasm') };
        state.ort = { ort: ort, gpu: gpu };
        return ort;
      });
    });
  }

  function fnv(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16);
  }
  /** Хэш названий первых n продуктов базы — защита от рассинхрона матрицы и foods.js */
  function namesHash(n) {
    var parts = []; for (var i = 0; i < n; i++) parts.push(FOODS[i].name);
    return fnv(parts.join('\n'));
  }

  function loadMatrix() {
    if (state.matrix) return Promise.resolve(state.matrix);
    var meta = state.meta;
    return (meta ? Promise.resolve(meta) : getBytes(CFG.MODEL_DIR + 'meta.json').then(function (b) { return JSON.parse(new TextDecoder().decode(b)); })).then(function (m) {
      state.meta = m;
      return getBytes(CFG.MODEL_DIR + m.matrix.file).then(function (buf) {
        var n = m.n, d = m.dim;
        if (buf.byteLength !== n * d + n * 8) throw new ODError('matrix', MSG.matrix, 'size');
        if (n > FOODS.length || (m.namesHash && m.namesHash !== namesHash(n))) throw new ODError('matrix', MSG.matrix, 'names');
        state.matrix = makeMatrix(buf, n, d);
        return state.matrix;
      });
    });
  }
  /** Матрица: int8 n×d, масштабы и смещения float32 (формат foods_text_512.bin) */
  function makeMatrix(buf, n, d) {
    return { n: n, dim: d, q: new Int8Array(buf, 0, n * d), scale: new Float32Array(buf.slice(n * d, n * d + n * 4)), bias: new Float32Array(buf.slice(n * d + n * 4, n * d + n * 8)) };
  }

  /** Собрать сессию (gpu — WebGPU-пакет или обычный WASM). Проверяет, что файлы действительно лежат в кэше. */
  function buildSession(gpu) {
    return verify('core').then(function (ok) {
      if (!ok) { lsSet(LS.installed, null); throw new ODError('notinstalled', MSG.notinstalled); }
      return Promise.all([loadOrt(gpu), getBytes(CFG.MODEL_DIR + 'vision_fp16.onnx'), loadMatrix()]);
    }).then(function (r) {
      var ort = r[0];
      return ort.InferenceSession.create(new Uint8Array(r[1]), { executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'], graphOptimizationLevel: 'all' }).then(function (s) { return { ort: ort, s: s, gpu: gpu }; });
    });
  }

  function getSession(onStatus) {
    if (state.session) { touch(); return Promise.resolve(state.session); }
    if (state.sessionP) return state.sessionP;
    if (onStatus) onStatus('loading');
    var gen = state.gen, wantGpu = useWebGPU() && !!navigator.gpu;
    state.sessionP = (wantGpu ? verify('webgpu') : Promise.resolve(false)).then(function (gpuOk) {
      if (wantGpu && !gpuOk) lsSet(LS.webgpu, null);          // пакет WebGPU пропал из кэша — тихо возвращаемся на обычный режим
      var gpu = wantGpu && gpuOk;
      return buildSession(gpu).catch(function (e) {
        if (!gpu) throw e;
        lsSet(LS.webgpu, null); state.ort = null;               // WebGPU не завёлся (бывает на iPhone) — выключаем и пробуем обычный режим
        return buildSession(false);
      });
    }).then(function (x) {
      if (gen !== state.gen) { try { x.s.release(); } catch (e) { /* ignore */ } throw new ODError('notinstalled', MSG.notinstalled); } // модель удалили, пока грузилась
      state.session = x; state.sessionP = null; touch(); return x;
    }, function (e) {
      state.sessionP = null;
      if (e instanceof ODError) throw e;
      throw new ODError('load', MSG.load + (e && e.message ? e.message : e), String(e));
    });
    return state.sessionP;
  }  function touch() { clearTimeout(state.idleTimer); state.idleTimer = setTimeout(function () { release(false); }, CFG.IDLE_RELEASE_MS); }
  /** Освободить модель из памяти (после простоя, при удалении, при смене режима) */
  function release(withUrls) {
    clearTimeout(state.idleTimer);
    var x = state.session; state.session = null;
    if (x && x.s && x.s.release) { try { x.s.release(); } catch (e) { /* ignore */ } }
    if (withUrls) { state.ort = null; state.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } }); state.urls = []; }
  }

  // ===================================================================
  // Подготовка фото → вектор
  // ===================================================================
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new ODError('image', MSG.image)); };
      img.src = src;
    });
  }
  /**
   * Фото → Float32Array [1,3,256,256] (RGB, 0..1). Повторяет эталонную обработку (CLIP/transformers.js):
   * уменьшение так, чтобы меньшая сторона стала 256 (большая — с округлением вниз), затем вырезание центрального квадрата.
   * Лишние части длинной стороны отбрасываются — поэтому блюдо должно быть в центре кадра.
   */
  function toTensorData(img) {
    var S = CFG.INPUT, w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) throw new ODError('image', MSG.image);
    var k = Math.max(S / w, S / h), dw = Math.floor(w * k + 1e-6), dh = Math.floor(h * k + 1e-6);
    var big = document.createElement('canvas'); big.width = dw; big.height = dh;
    var bx = big.getContext('2d');
    bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = CFG.SMOOTHING;
    bx.drawImage(img, 0, 0, dw, dh);
    var cv = document.createElement('canvas'); cv.width = cv.height = S;
    var cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = CFG.SMOOTHING;
    cx.drawImage(big, (dw - S) / 2, (dh - S) / 2, S, S, 0, 0, S, S);
    big.width = big.height = 0;               // сразу отдаём память (на iPhone canvas — дорогой ресурс)
    var px = cx.getImageData(0, 0, S, S).data, n = S * S, f = new Float32Array(3 * n);
    for (var i = 0; i < n; i++) { f[i] = px[i * 4] / 255; f[n + i] = px[i * 4 + 1] / 255; f[2 * n + i] = px[i * 4 + 2] / 255; }
    cv.width = cv.height = 0;
    return f;
  }  function l2(v) { var s = 0, i; for (i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; var o = new Float32Array(v.length); for (i = 0; i < v.length; i++) o[i] = v[i] / s; return o; }

  function embedOne(sess, src) {
    return loadImage(src).then(function (img) {
      var S = CFG.INPUT, t = new sess.ort.Tensor('float32', toTensorData(img), [1, 3, S, S]);
      var feeds = {}; feeds[sess.s.inputNames[0]] = t;
      return sess.s.run(feeds);
    }).then(function (out) { return l2(out[sess.s.outputNames[0]].data); });
  }
  /** Вектор по одному или нескольким фото (разные ракурсы одного блюда усредняются) */
  function embedPhotos(sess, srcs) {
    var vs = [];
    return srcs.reduce(function (p, s) { return p.then(function () { return embedOne(sess, s).then(function (v) { vs.push(v); }); }); }, Promise.resolve()).then(function () {
      if (vs.length === 1) return vs[0];
      var m = new Float32Array(vs[0].length); vs.forEach(function (v) { for (var i = 0; i < m.length; i++) m[i] += v[i]; }); return l2(m);
    });
  }

  // ===================================================================
  // Ранжирование (чистые функции — проверяются тестами)
  // ===================================================================
  function scoreAll(v, M) {
    var n = M.n, d = M.dim, q = M.q, out = new Float32Array(n);
    for (var i = 0, off = 0; i < n; i++, off += d) {
      var s = 0;
      for (var j = 0; j < d; j++) s += v[j] * q[off + j];
      out[i] = s * M.scale[i] + M.bias[i];
    }
    return out;
  }
  /** индекс строки матрицы по id продукта базы ('b12' → 11); для своих продуктов и новых позиций — -1 */
  function rowOfId(id, n) {
    var m = /^b(\d+)$/.exec(String(id || ''));
    if (!m) return -1;
    var i = +m[1] - 1;
    return i >= 0 && i < n ? i : -1;
  }
  function dotQ(v, rec) { var s = 0, q = rec.v; for (var j = 0; j < q.length; j++) s += v[j] * q[j]; return s * rec.s; }
  /** Ближайшие прошлые блюда: [{rec, sim}] по убыванию сходства */
  function neighbors(v, recs, k) {
    var out = recs.map(function (r) { return { rec: r, sim: dotQ(v, r) }; });
    out.sort(function (a, b) { return b.sim - a.sim; });
    return out.slice(0, k || 3);
  }
  /** Бонус продуктам из похожих прошлых блюд (на месте изменяет scores) */
  function applyBonus(scores, v, recs, n, cfg) {
    cfg = cfg || CFG;
    var best = {};
    recs.forEach(function (r) {
      var sim = dotQ(v, r);
      if (sim <= cfg.KNN_TAU) return;
      r.items.forEach(function (it) { var i = rowOfId(it.id, n); if (i >= 0 && sim > (best[i] || -1)) best[i] = sim; });
    });
    Object.keys(best).forEach(function (i) { scores[i] += cfg.KNN_LAMBDA * (best[i] - cfg.KNN_TAU); });
    return scores;
  }
  function topIdx(scores, k) {
    var idx = []; for (var i = 0; i < scores.length; i++) idx.push(i);
    idx.sort(function (a, b) { return scores[b] - scores[a]; });
    return idx.slice(0, k);
  }

  // ===================================================================
  // Личная память (IndexedDB; без синхронизации)
  // ===================================================================
  var Mem = (function () {
    var dbP = null, cache = null, fallback = false;
    function open() {
      if (dbP) return dbP;
      dbP = new Promise(function (resolve, reject) {
        var timedOut = false;
        // в Safari open() бывает «зависает» без единого события — тогда без личной памяти, но не вечное ожидание
        var timer = setTimeout(function () { timedOut = true; reject(new Error('timeout')); }, CFG.IDB_TIMEOUT_MS);
        try {
          if (typeof indexedDB === 'undefined') throw new Error('no idb');
          var r = indexedDB.open(DB_NAME, 1);
          r.onupgradeneeded = function () { var db = r.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('ts', 'ts'); };
          r.onsuccess = function () { clearTimeout(timer); if (timedOut) { try { r.result.close(); } catch (e) { /* ignore */ } return; } resolve(r.result); };
          r.onerror = function () { clearTimeout(timer); reject(r.error); };
          r.onblocked = function () { clearTimeout(timer); reject(new Error('blocked')); };
        } catch (e) { clearTimeout(timer); reject(e); }
      });
      dbP.catch(function () { fallback = true; });
      return dbP;
    }
    function tx(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(STORE, mode), s = t.objectStore(STORE), res = fn(s);
          t.oncomplete = function () { resolve(res && res.result !== undefined ? res.result : undefined); };
          t.onerror = t.onabort = function () { reject(t.error); };
        });
      });
    }
    function toRec(o) { return { id: o.id, ts: o.ts, v: new Int8Array(o.v), s: o.s, items: o.items, dish: o.dish }; }
    function load() {
      if (cache) return Promise.resolve(cache);
      return tx('readonly', function (s) { return s.getAll(); }).then(function (list) {
        cache = (list || []).map(toRec).filter(function (r) { return r.v.length === 512 && r.items && r.items.length; });
        return cache;
      }, function () { cache = cache || []; return cache; });
    }
    /** int8-запись из вектора фото */
    function pack(v) {
      var m = 0, i; for (i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i]));
      var s = m / 127 || 1, q = new Int8Array(v.length);
      for (i = 0; i < v.length; i++) q[i] = Math.round(v[i] / s);
      return { v: q, s: s };
    }
    function trim(recs) {
      if (recs.length <= CFG.KNN_MAX) return Promise.resolve();
      recs.sort(function (a, b) { return a.ts - b.ts; });
      var gone = recs.splice(0, recs.length - CFG.KNN_MAX);
      if (fallback) return Promise.resolve();
      return tx('readwrite', function (s) { gone.forEach(function (g) { s.delete(g.id); }); }).catch(function () {});
    }
    /**
     * Запомнить подтверждённое блюдо: вектор, состав [{id, g}], название. Если уже есть почти такое же фото —
     * запись обновляется (а не дублируется). Возвращает promise.
     */
    function add(vec, items, dish, now) {
      return load().then(function (recs) {
        var p = pack(vec), ts = now || Date.now(), id = 'v' + ts.toString(36) + Math.random().toString(36).slice(2, 6);
        var near = neighbors(vec, recs, 1)[0];
        if (near && near.sim >= CFG.KNN_DEDUP) { id = near.rec.id; recs.splice(recs.indexOf(near.rec), 1); }
        var rec = { id: id, ts: ts, v: p.v, s: p.s, items: items.map(function (x) { return { id: x.id, g: x.g }; }), dish: String(dish || '').slice(0, 100) };
        recs.push(rec);
        var done = fallback ? Promise.resolve() : tx('readwrite', function (s) { s.put({ id: rec.id, ts: rec.ts, v: rec.v.buffer.slice(0), s: rec.s, items: rec.items, dish: rec.dish }); }).catch(function () {});
        return done.then(function () { return trim(recs); }).then(function () { return rec; });
      });
    }
    function clear() {
      cache = [];
      if (fallback) return Promise.resolve();
      return tx('readwrite', function (s) { s.clear(); }).catch(function () {});
    }
    function count() { return load().then(function (r) { return r.length; }); }
    /** false — IndexedDB недоступна (приватный режим, блокировка): память работает только до закрытия приложения */
    function persistent() { return !fallback; }
    return { load: load, add: add, clear: clear, count: count, persistent: persistent, _pack: pack, _reset: function () { cache = null; } };
  })();

  // ===================================================================
  // Распознавание
  // ===================================================================
  var resolver = function (id) { for (var i = 0; i < FOODS.length; i++) if (FOODS[i].id === id) return FOODS[i]; return null; };
  /** Приложение сообщает, как найти продукт (в т. ч. свой) по id */
  function setResolver(fn) { if (typeof fn === 'function') resolver = fn; }

  function itemOf(f, grams, extra) {
    var it = {
      name: f.name, grams: grams, kcal: Math.round(f.kcal), p: Math.round(f.p * 10) / 10, f: Math.round(f.f * 10) / 10, c: Math.round(f.c * 10) / 10,
      gi: f.gi == null ? null : f.gi, hidden: false, cooking: '', productId: f.id
    };
    for (var k in extra) it[k] = extra[k];
    return it;
  }
  function ruDate(ts) { try { return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }); } catch (e) { return ''; } }

  /** Из вектора фото и (загруженной) личной памяти — результат для интерфейса. Чистая функция: проверяется тестами. */
  function buildResult(v, M, recs, cfg) {
    cfg = cfg || CFG;
    var scores = applyBonus(scoreAll(v, M), v, recs, M.n, cfg);
    var top = topIdx(scores, cfg.POOL_N);
    var best = FOODS[top[0]], seen = {};
    seen[best.id] = true;
    var alts = top.slice(1, 1 + cfg.CAND_N).map(function (i) { return { id: FOODS[i].id, name: FOODS[i].name }; });
    alts.forEach(function (a) { seen[a.id] = true; });
    var adds = [];
    top.slice(1).forEach(function (i) {
      var f = FOODS[i];
      if (adds.length < cfg.ADD_N && !seen[f.id] && f.cat !== best.cat) { adds.push({ id: f.id, name: f.name }); seen[f.id] = true; }
    });
    var low = scores[top[0]] < cfg.LOW_SCORE;
    var nn = neighbors(v, recs, 1)[0];
    var res = { provider: 'ondevice', confidence: low ? 'низкая' : 'средняя', reference: '', cooking: '', standardDish: false, dishGi: null, note: '', extra: adds, source: 'model' };
    if (nn && nn.sim >= cfg.KNN_USE) {
      var items = [];
      nn.rec.items.forEach(function (x) { var f = resolver(x.id); if (f && x.g > 0) items.push(itemOf(f, x.g, { fromKnn: true })); });
      if (items.length) {
        items[0].candidates = alts.filter(function (a) { return a.id !== items[0].productId; });
        res.items = items; res.dish = nn.rec.dish || items[0].name; res.source = 'memory'; res.memSim = nn.sim;
        res.confidence = nn.sim >= cfg.KNN_HIGH ? 'высокая' : 'средняя';
        res.note = 'Похоже на ваше блюдо от ' + ruDate(nn.rec.ts) + ': подставлены тот же состав и порции. Если сегодня иначе — поправьте.';
      }
    }
    if (!res.items) {
      var d = (typeof Portions !== 'undefined' ? Portions.defaultFor(best) : { grams: 150, src: 'generic' });
      res.items = [itemOf(best, d.grams, { candidates: alts, portionSrc: d.src })];
      res.dish = best.name;
      res.note = low ? 'Не уверен: фото на похожие блюда базы не очень похоже. Проверьте продукт (варианты ниже) и порцию.'
        : 'Продукт подобран по фото из вашей базы; порция — типичная, не измеренная. Проверьте продукт (варианты ниже) и граммы.';
    }
    res.totalGrams = res.items.reduce(function (s, x) { return s + x.grams; }, 0);
    return res;
  }

  /**
   * Провайдер «На устройстве»: opts.images — [{preview (dataURL)}], opts.signal, opts.onStatus('loading'|'thinking').
   * Возвращает результат того же вида, что и Gemini (+ productId у позиций, кандидаты для чипов, _vec для обучения).
   */
  function recognize(opts) {
    opts = opts || {};
    var status = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    var imgs = (opts.images || []).slice(0, CFG.MAX_PHOTOS).map(function (im) { return im.preview || ('data:' + (im.mime || 'image/jpeg') + ';base64,' + im.data); });
    if (!imgs.length) return Promise.reject(new ODError('image', MSG.image));
    var sup = supported();
    if (!sup.ok) return Promise.reject(new ODError('unsupported', MSG.unsupported, sup.reason));
    var cancelled = function () { return opts.signal && opts.signal.aborted; };
    lsSet(LS.run, String(Date.now()));        // если вкладку убьёт нехватка памяти, при следующем запуске увидим флаг
    var done = function () { lsSet(LS.run, null); crashed = false; };
    var work = getSession(status).then(function (sess) {
      if (cancelled()) throw new ODError('cancel', 'Отменено');
      status('thinking');
      return Promise.all([embedPhotos(sess, imgs), Mem.load()]);
    }).then(function (r) {
      if (cancelled()) throw new ODError('cancel', 'Отменено');
      var res = buildResult(r[0], state.matrix, r[1], CFG);
      res._vec = Array.prototype.slice.call(r[0]);
      touch();
      return res;
    });
    // «Отменить» и предельное время должны срабатывать сразу, даже если запуск сети завис (а не только после его завершения)
    var timer = null, onAbort = null;
    var guard = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        state.gen++; state.sessionP = null; release(true);   // зависшую загрузку сессии больше не ждём
        reject(new ODError('timeout', MSG.timeout));
      }, CFG.RUN_TIMEOUT_MS);
      if (opts.signal) {
        onAbort = function () { reject(new ODError('cancel', 'Отменено')); };
        if (opts.signal.aborted) onAbort(); else opts.signal.addEventListener('abort', onAbort);
      }
    });
    var cleanup = function () { clearTimeout(timer); if (onAbort && opts.signal) opts.signal.removeEventListener('abort', onAbort); done(); };
    return Promise.race([work, guard]).then(function (res) { cleanup(); return res; }, function (e) {
      cleanup();
      throw (e instanceof ODError ? e : new ODError('load', MSG.load + (e && e.message ? e.message : e), String(e)));
    });
  }

  /** Запомнить подтверждённое блюдо (вызывается при записи в дневник). items: [{id, g}] */
  function learn(vec, items, dish) {
    if (!vec || !items || !items.length) return Promise.resolve(null);
    var clean = items.filter(function (x) { return x && x.id && x.g > 0; });
    if (!clean.length) return Promise.resolve(null);
    return Mem.add(Float32Array.from(vec), clean, dish).catch(function () { return null; });
  }

  function status() {
    var info = installedInfo(), sup = supported();
    return {
      supported: sup.ok, reason: sup.reason, installed: !!info, version: info ? info.version : null, bytes: info ? info.bytes : 0, at: info ? info.at : 0,
      crashed: crashed, webgpu: useWebGPU(), webgpuAvailable: typeof navigator !== 'undefined' && !!navigator.gpu,
      beyond: state.meta ? Math.max(0, FOODS.length - state.meta.n) : 0, approxMB: CFG.APPROX_MB
    };
  }
  function dismissCrash() { crashed = false; }

  return {
    CFG: CFG, MSG: MSG, ODError: ODError,
    supported: supported, status: status, verify: verify, download: download, remove: remove, fetchMeta: fetchMeta, release: release,
    recognize: recognize, learn: learn, setResolver: setResolver, setWebGPU: setWebGPU, dismissCrash: dismissCrash,
    memory: { count: Mem.count, clear: Mem.clear, load: Mem.load, persistent: Mem.persistent },
    // для тестов
    _scoreAll: scoreAll, _applyBonus: applyBonus, _topIdx: topIdx, _neighbors: neighbors, _buildResult: buildResult, _makeMatrix: makeMatrix, _rowOfId: rowOfId,
    _Mem: Mem, _embedPhotos: embedPhotos, _getSession: getSession, _loadMatrix: loadMatrix, _state: state, _toTensorData: toTensorData, _loadImage: loadImage, _installedBytes: installedBytes
  };
})();
