/*
 * Распознавание еды по фото: провайдеры ИИ, текст запроса, разбор ответа, подготовка фото,
 * память исправлений. Без интерфейса (интерфейс — в photo.js).
 *
 * Провайдеры:
 *   - ondevice — нейросеть в самом браузере (js/ondevice.js), по умолчанию: бесплатно, без ключа, офлайн после загрузки модели;
 *   - gemini  — Google Gemini API (бесплатный уровень, ключ пользователя из Google AI Studio;
 *               из России и ряда других стран недоступен — ошибка «User location is not supported»);
 *   - manual  — «через любой чат-ИИ»: запрос копируется, ответ вставляется вручную (запасной вариант).
 * Абстракция AI.providers позволяет позже добавить платный провайдер без переделки интерфейса:
 * провайдер — объект { id, label, needsKey, recognize(opts) → Promise<результат> }.
 *
 * Ключ API хранится в отдельном ключе localStorage (ft_v1_ai_key) и никогда не попадает
 * в резервную копию, файл синхронизации, CSV или отчёт для врача.
 */
var AI = (function () {
  'use strict';

  var KEY_STORAGE = 'ft_v1_ai_key';
  var MODEL_STORAGE = 'ft_v1_ai_model';
  var PROVIDER_STORAGE = 'ft_v1_ai_provider2';
  var PROVIDER_STORAGE_OLD = 'ft_v1_ai_provider';   // выбор из версий до «На устройстве» — игнорируем и удаляем вместе с остальным
  var REGION_STORAGE = 'ft_v1_ai_region';   // последний запрос к Gemini: «недоступен в вашей стране» (время)

  var config = {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    timeoutMs: 60000,        // предельное время ответа на распознавание (жёсткий срок, не зависит от сети)
    probeTimeoutMs: 15000    // за это время должен ответить лёгкий запрос «есть ли связь с Google»
  };

  // Бесплатные модели (по странице цен Gemini API, октябрь 2026). Список с сервера имеет приоритет.
  var DEFAULT_MODEL = 'gemini-3.8-flash';
  var FALLBACK_MODELS = [
    'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash',
    'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'
  ];

  var CONFIDENCE = ['низкая', 'средняя', 'высокая'];

  // ---------- localStorage (с защитой) ----------
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null || v === '') window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  function getKey() { return (lsGet(KEY_STORAGE) || '').trim(); }
  function setKey(k) { return lsSet(KEY_STORAGE, (k || '').trim()); }
  function getModel() { return lsGet(MODEL_STORAGE) || DEFAULT_MODEL; }
  function setModel(m) { return lsSet(MODEL_STORAGE, m); }
  // По умолчанию — «На устройстве» (без ключа и интернета, работает и из России), если модуль подключён;
  // Gemini и ручной режим — в интерфейсе в разделе «Другие способы»
  // (ключ хранения новый: выбор, сделанный в старой версии, не должен навсегда оставлять «Через любой чат-ИИ» вместо нового способа)
  function getProvider() {
    var p = lsGet(PROVIDER_STORAGE);
    if (p === 'manual' || p === 'gemini' || (p === 'ondevice' && typeof OnDevice !== 'undefined')) return p;
    if (typeof OnDevice !== 'undefined' && OnDevice.supported().ok) return 'ondevice';
    return getKey() ? 'gemini' : 'manual';
  }
  function setProvider(p) { return lsSet(PROVIDER_STORAGE, p); }
  /** Отметка «Gemini недоступен отсюда» (регион или сервер Google не отвечает): {code, ts} или null */
  function getRegionBlock() { try { var o = JSON.parse(lsGet(REGION_STORAGE) || 'null'); return o && o.ts ? o : null; } catch (e) { return null; } }
  function setRegionBlock(code) { return lsSet(REGION_STORAGE, code ? JSON.stringify({ code: code, ts: Date.now() }) : null); }

  /** Удалить всё, что связано с ИИ на этом устройстве (ключ, модель, выбор способа, отметки) */
  function forgetDeviceSettings() {
    [KEY_STORAGE, MODEL_STORAGE, PROVIDER_STORAGE, PROVIDER_STORAGE_OLD, REGION_STORAGE].forEach(function (k) { lsSet(k, null); });
  }

  // ---------- ошибки ----------
  function AIError(code, message, detail) {
    this.name = 'AIError';
    this.code = code;
    this.message = message;
    this.detail = detail || '';
  }
  AIError.prototype = Object.create(Error.prototype);

  var MSG = {
    nokey: 'Не указан ключ Gemini. Добавьте его в «Настройки → Распознавание по фото» или используйте режим «Через любой чат-ИИ».',
    key: 'Ключ Gemini не подходит (неверный, отозван или заблокирован). Проверьте ключ в «Настройках» — скопируйте его из Google AI Studio заново.',
    denied: 'У ключа нет доступа к Gemini API. Создайте новый ключ в Google AI Studio (aistudio.google.com/apikey).',
    quota: 'Исчерпан бесплатный лимит запросов Gemini. Подождите минуту (или до завтра, если исчерпан дневной лимит), выберите в настройках другую модель или воспользуйтесь режимом «Через любой чат-ИИ».',
    region: 'Gemini API недоступен из вашей страны: Google не обслуживает запросы из России и ряда других стран. Пока можно воспользоваться режимом «Через любой чат-ИИ».',
    unreachable: 'Сервер Google Gemini не отвечает. Из России Gemini API недоступен: соединение с Google блокируется или замедляется, а сам Google не обслуживает запросы из России. Пока можно воспользоваться режимом «Через любой чат-ИИ».',
    model: 'Выбранная модель недоступна. Выберите другую модель в «Настройках → Распознавание по фото».',
    billing: 'Google требует оплату для этой модели или проекта. Выберите бесплатную модель (Flash) или режим «Через любой чат-ИИ».',
    safety: 'ИИ отказался обрабатывать это фото (сработал фильтр безопасности). Попробуйте другое фото или режим «Через любой чат-ИИ».',
    offline: 'Нет подключения к интернету. Распознавание через Gemini работает только онлайн — можно воспользоваться режимом «Через любой чат-ИИ» позже.',
    network: 'Не удалось связаться с сервером Gemini. Проверьте интернет и попробуйте ещё раз. Если интернет работает, а ошибка повторяется, — скорее всего, Gemini недоступен из вашей сети или страны.',
    timeout: 'Gemini не ответил за минуту. Попробуйте ещё раз (можно с одним фото). Если так каждый раз — скорее всего, Gemini недоступен из вашей сети или страны.',
    server: 'Сервер Gemini временно перегружен. Попробуйте через минуту.',
    json: 'ИИ вернул ответ в неожиданном формате. Попробуйте ещё раз или воспользуйтесь режимом «Через любой чат-ИИ».',
    empty: 'ИИ не нашёл на фото еду. Попробуйте снять ближе и при хорошем освещении.',
    image: 'Не удалось открыть фото. Если это HEIC с iPhone, а вы на компьютере, — отправьте фото в формате JPEG (или откройте приложение на iPhone).',
    toobig: 'Фото слишком большое для отправки. Попробуйте одно-два фото.',
    paste: 'Не удалось найти в тексте ответ в формате JSON. Скопируйте ответ ИИ целиком (включая фигурные скобки) и вставьте снова.',
    unknown: 'Не удалось распознать фото: '
  };

  /** Ответ сервера с ошибкой → AIError с понятным русским сообщением */
  function mapHttpError(status, body) {
    var err = body && body.error ? body.error : {};
    var msg = String(err.message || '');
    var st = String(err.status || err.code || '').toUpperCase();
    var reasons = (err.details || []).map(function (d) { return (d && d.reason) || ''; }).join(' ');
    if (/location is not supported|not (available|supported) in your (country|region|location)|unsupported.*(region|country|location)/i.test(msg)) return new AIError('region', MSG.region, msg);
    if (/API_KEY_INVALID|API_KEY_EXPIRED|API key not valid|api key expired|leaked/i.test(reasons + ' ' + msg) || status === 401) return new AIError('key', MSG.key, msg);
    // 429 проверяем раньше «billing»: текст Google о лимите упоминает «plan and billing details»
    if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(st + ' ' + msg)) return new AIError('quota', MSG.quota, msg);
    if (status === 402 || /billing|prepay|payment/i.test(msg)) return new AIError('billing', MSG.billing, msg);
    if (status === 403) return new AIError('denied', MSG.denied, msg);
    if (status === 404) return new AIError('model', MSG.model, msg);
    if (status === 400 && /FAILED_PRECONDITION/.test(st)) return new AIError('region', MSG.region, msg);
    if (status === 413) return new AIError('toobig', MSG.toobig, msg);
    if (status >= 500) return new AIError('server', MSG.server, msg);
    return new AIError('unknown', MSG.unknown + (msg || ('ошибка ' + status)), msg);
  }

  // ---------- схема ответа (подмножество OpenAPI для responseSchema) ----------
  var ITEM_PROPS = ['name', 'grams', 'kcal', 'p', 'f', 'c', 'gi', 'hidden', 'cooking'];
  var RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
      dish: { type: 'STRING', description: 'Название блюда по-русски' },
      standardDish: { type: 'BOOLEAN', description: 'Это известное стандартное блюдо' },
      dishGi: { type: 'NUMBER', nullable: true, description: 'Табличный ГИ блюда целиком, если известен' },
      totalGrams: { type: 'NUMBER', description: 'Общий вес порции, г' },
      cooking: { type: 'STRING', description: 'Способ приготовления' },
      confidence: { type: 'STRING', enum: CONFIDENCE },
      reference: { type: 'STRING', description: 'Какой эталон размера использован' },
      note: { type: 'STRING' },
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            grams: { type: 'NUMBER' },
            kcal: { type: 'NUMBER', description: 'ккал на 100 г' },
            p: { type: 'NUMBER', description: 'белки, г на 100 г' },
            f: { type: 'NUMBER', description: 'жиры, г на 100 г' },
            c: { type: 'NUMBER', description: 'углеводы, г на 100 г' },
            gi: { type: 'NUMBER', nullable: true, description: 'гликемический индекс (оценка)' },
            hidden: { type: 'BOOLEAN', description: 'скрытый компонент: масло, соус, сахар, заправка' },
            cooking: { type: 'STRING' }
          },
          required: ['name', 'grams', 'kcal', 'p', 'f', 'c'],
          propertyOrdering: ITEM_PROPS
        }
      }
    },
    required: ['dish', 'items', 'confidence'],
    propertyOrdering: ['dish', 'standardDish', 'dishGi', 'totalGrams', 'cooking', 'confidence', 'reference', 'note', 'items']
  };

  // ---------- текст запроса ----------
  /**
   * opts: {refs:[{name, cm}], hint, totalWeight, photos (число фото), learned:[{name, grams}]}
   * forChat = true — версия для ручного режима (добавлены указания по формату ответа в тексте).
   */
  function buildPrompt(opts, forChat) {
    opts = opts || {};
    var refs = (opts.refs || []).filter(function (r) { return r && r.name && r.cm > 0; });
    var lines = [];
    lines.push('Ты — диетолог. На ' + (opts.photos > 1 ? opts.photos + ' фото (разные ракурсы одной и той же еды)' : 'фото') +
      ' — приём пищи. Определи блюдо, его состав и вес каждого компонента в граммах.');
    lines.push('');
    lines.push('Как оценить размер:');
    if (refs.length) {
      lines.push('- Если в кадре есть рука или пальцы — используй их как эталон. Мои размеры: ' +
        refs.map(function (r) { return r.name + ' = ' + String(r.cm).replace('.', ',') + ' см'; }).join('; ') + '.');
    }
    lines.push('- Если эталона нет — опирайся на типичные размеры: обеденная тарелка 24–27 см, глубокая тарелка (суповая) 20–23 см, ' +
      'вилка 19–20 см, столовая ложка ~18 см, чайная ложка ~14 см, кружка ~8 см в диаметре, стандартный ломтик хлеба ~1 см толщиной (25–35 г).');
    lines.push('- Укажи в поле reference, какой эталон ты использовал.');
    lines.push('');
    lines.push('Требования:');
    lines.push('- Перечисли ВСЕ видимые компоненты и вероятные скрытые: масло для жарки, соус, заправку, сахар, сметану, майонез (hidden = true).');
    lines.push('- Названия компонентов — по-русски, в стиле справочника: «Курица, грудка, запечённая», «Гречка варёная», «Масло подсолнечное», «Сметана 15%».');
    lines.push('- Для каждого компонента: вес в граммах (grams), а также ккал, белки, жиры, углеводы НА 100 г (kcal, p, f, c) и оценку гликемического индекса (gi; null, если углеводов почти нет).');
    lines.push('- Если это известное стандартное блюдо (борщ, плов, оливье, карбонара…) — standardDish = true и dishGi = табличный ГИ блюда, если он известен, иначе null.');
    lines.push('- totalGrams — общий вес порции; cooking — способ приготовления; confidence — уверенность: «низкая», «средняя» или «высокая»; note — короткое примечание (что могло быть не видно).');
    if (opts.hint) lines.push('- Пояснение от меня: «' + String(opts.hint).slice(0, 300) + '». Учти это.');
    if (opts.totalWeight > 0) lines.push('- Общий вес порции по кухонным весам: ' + Math.round(opts.totalWeight) + ' г. Распредели вес компонентов так, чтобы сумма была равна этому весу.');
    var learned = (opts.learned || []).filter(function (x) { return x && x.name && x.grams > 0; }).slice(0, 8);
    if (learned.length) {
      lines.push('- Мои обычные порции (используй, если это похоже на то же самое): ' +
        learned.map(function (x) { return x.name + ' ~' + Math.round(x.grams) + ' г'; }).join('; ') + '.');
    }
    lines.push('');
    if (forChat) {
      lines.push('Ответь ТОЛЬКО одним JSON-объектом без пояснений и без markdown, строго в таком формате (числа — с точкой):');
    } else {
      lines.push('Ответ — только JSON по заданной схеме. Формат:');
    }
    lines.push('{"dish": "Гречка с котлетой", "standardDish": false, "dishGi": null, "totalGrams": 330, "cooking": "варка, жарка", ' +
      '"confidence": "средняя", "reference": "ладонь, 4 пальца = 7,5 см", "note": "…", "items": [' +
      '{"name": "Гречка варёная", "grams": 200, "kcal": 110, "p": 4.2, "f": 1.1, "c": 21.3, "gi": 50, "hidden": false, "cooking": "варка"}, ' +
      '{"name": "Масло сливочное 82,5%", "grams": 5, "kcal": 748, "p": 0.5, "f": 82.5, "c": 0.8, "gi": null, "hidden": true, "cooking": ""}]}');
    return lines.join('\n');
  }

  /** Тело запроса generateContent (REST, v1beta) */
  function buildRequest(images, opts) {
    var parts = [{ text: buildPrompt(Object.assign({}, opts, { photos: images.length }), false) }];
    images.forEach(function (im) { parts.push({ inline_data: { mime_type: im.mime || 'image/jpeg', data: im.data } }); });
    return {
      contents: [{ role: 'user', parts: parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.2
      }
    };
  }

  // ---------- разбор ответа ----------
  function toNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (typeof v === 'string') {
      var s = v.replace(/[\s ]/g, '').replace(',', '.').replace(/[^0-9.+-]/g, '');
      if (!s) return NaN;
      var n = parseFloat(s);
      return isFinite(n) ? n : NaN;
    }
    return NaN;
  }

  /**
   * Терпимый разбор JSON из произвольного текста (ответ чат-бота): markdown-блоки, текст вокруг,
   * «умные» кавычки, висячие запятые, десятичные запятые, True/False/None.
   */
  function parseLoose(text) {
    if (text && typeof text === 'object') return text;
    var s = String(text || '').replace(/^﻿/, '');
    var fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(s);
    if (fence && fence[1].indexOf('{') >= 0) s = fence[1];
    s = s.replace(/[“”„«»]/g, function (ch) { return ch === '«' || ch === '»' ? ch : '"'; })
      .replace(/[‘’]/g, "'");
    var start = s.indexOf('{');
    if (start < 0) return null;
    // ищем парную закрывающую скобку с учётом строк
    var depth = 0, inStr = false, esc = false, end = -1;
    for (var i = start; i < s.length; i++) {
      var ch = s[i];
      if (inStr) {
        if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    var body = end > 0 ? s.slice(start, end + 1) : s.slice(start);
    var attempts = [body];
    var fixed = body
      .replace(/\/\/[^\n"]*$/gm, '')                       // комментарии // в конце строк
      .replace(/:\s*(-?\d+),(\d+)(?=\s*[,}\]\n\r])/g, ':$1.$2') // десятичная запятая: "p": 4,2,
      .replace(/,\s*([}\]])/g, '$1')                        // висячие запятые
      .replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null');
    attempts.push(fixed);
    if (end < 0) { // ответ обрезан — пробуем закрыть скобки
      var opens = (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;
      var braces = (fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length;
      var tail = fixed.replace(/,\s*$/, '');
      for (var k = 0; k < opens; k++) tail += ']';
      for (var j = 0; j < braces; j++) tail += '}';
      attempts.push(tail);
    }
    for (var a = 0; a < attempts.length; a++) {
      try { return JSON.parse(attempts[a]); } catch (e) { /* следующий вариант */ }
    }
    return null;
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function r1(n) { return Math.round(n * 10) / 10; }

  /** Проверка и нормализация результата ИИ. Возвращает объект или null. */
  function normalizeResult(o) {
    if (!o || typeof o !== 'object') return null;
    var rawItems = Array.isArray(o.items) ? o.items : Array.isArray(o.ingredients) ? o.ingredients : Array.isArray(o.components) ? o.components : [];
    var items = [];
    rawItems.forEach(function (x) {
      // больше 40 компонентов в одном блюде не бывает — защита от «мусорного» ответа на сотни строк
      if (!x || typeof x !== 'object' || items.length >= 40) return;
      var name = String(x.name || x.title || '').trim().slice(0, 100);
      var grams = toNum(x.grams != null ? x.grams : x.weight);
      if (!name || !(grams > 0)) return;
      var kcal = toNum(x.kcal != null ? x.kcal : x.calories), p = toNum(x.p != null ? x.p : x.protein),
        f = toNum(x.f != null ? x.f : x.fat), c = toNum(x.c != null ? x.c : x.carbs);
      // защита от явных ошибок ИИ (пустые/отрицательные значения, значения не на 100 г и т.п.)
      kcal = clamp(kcal >= 0 ? kcal : 0, 0, 900); p = clamp(p >= 0 ? p : 0, 0, 100);
      f = clamp(f >= 0 ? f : 0, 0, 100); c = clamp(c >= 0 ? c : 0, 0, 100);
      var sum = p + f + c;
      if (sum > 100) { p = p * 100 / sum; f = f * 100 / sum; c = c * 100 / sum; }
      var gi = toNum(x.gi);
      items.push({
        name: name,
        grams: r1(clamp(grams, 1, 3000)),
        kcal: Math.round(kcal), p: r1(p), f: r1(f), c: r1(c),
        gi: gi >= 0 && gi <= 150 ? Math.round(gi) : null,
        hidden: x.hidden === true || x.hidden === 'true',
        cooking: String(x.cooking || '').slice(0, 60)
      });
    });
    if (!items.length) return null;
    var conf = String(o.confidence || '').toLowerCase();
    conf = /высок|high/.test(conf) ? 'высокая' : /низк|low/.test(conf) ? 'низкая' : 'средняя';
    var dishGi = toNum(o.dishGi);
    var total = toNum(o.totalGrams);
    return {
      dish: String(o.dish || o.name || items[0].name).trim().slice(0, 100),
      standardDish: o.standardDish === true || o.standardDish === 'true',
      dishGi: dishGi >= 0 && dishGi <= 150 ? Math.round(dishGi) : null,
      totalGrams: total > 0 ? Math.round(Math.min(total, 10000)) : Math.round(items.reduce(function (s, x) { return s + x.grams; }, 0)),
      cooking: String(o.cooking || '').slice(0, 100),
      confidence: conf,
      reference: String(o.reference || '').slice(0, 200),
      note: String(o.note || '').slice(0, 300),
      items: items
    };
  }

  /** Текст ответа generateContent → результат или исключение */
  function readGeminiResponse(body) {
    if (body && body.promptFeedback && body.promptFeedback.blockReason) throw new AIError('safety', MSG.safety, body.promptFeedback.blockReason);
    var cand = body && body.candidates && body.candidates[0];
    if (!cand) throw new AIError('json', MSG.json, 'no candidates');
    if (/SAFETY|PROHIBITED|BLOCKLIST|IMAGE_SAFETY|RECITATION/.test(cand.finishReason || '') && !(cand.content && cand.content.parts)) {
      throw new AIError('safety', MSG.safety, cand.finishReason);
    }
    var text = ((cand.content && cand.content.parts) || []).map(function (p) { return p.text || ''; }).join('');
    var obj = parseLoose(text);
    var res = normalizeResult(obj);
    if (!res) throw new AIError(obj ? 'empty' : 'json', obj ? MSG.empty : MSG.json, text.slice(0, 200));
    return res;
  }

  // ---------- сеть ----------
  /**
   * fetch + JSON с ЖЁСТКИМ сроком: промис завершается по таймеру сам, даже если отмена запроса
   * не дошла до сети (зависшее TLS-соединение и т.п.) — интерфейс не «висит» минутами.
   * init.cancelSignal — внешняя отмена (кнопка «Отменить»). timeoutMs — срок (по умолчанию config.timeoutMs).
   */
  function fetchJson(url, init, timeoutMs) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.reject(new AIError('offline', MSG.offline));
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    if (ctl) init.signal = ctl.signal;
    var outer = init.cancelSignal;
    delete init.cancelSignal;
    return new Promise(function (resolve, reject) {
      var done = false, timer = null;
      function finish(ok, v) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (outer) outer.removeEventListener('abort', onCancel);
        (ok ? resolve : reject)(v);
      }
      function onCancel() { if (ctl) ctl.abort(); finish(false, new AIError('cancel', 'Отменено')); }
      if (outer) {
        if (outer.aborted) { onCancel(); return; }
        outer.addEventListener('abort', onCancel);
      }
      timer = setTimeout(function () { if (ctl) ctl.abort(); finish(false, new AIError('timeout', MSG.timeout)); }, timeoutMs || config.timeoutMs);
      fetch(url, init).then(function (resp) {
        return resp.text().then(function (t) {
          var body = null;
          try { body = t ? JSON.parse(t) : null; } catch (e) { body = null; }
          if (!resp.ok) throw mapHttpError(resp.status, body);
          finish(true, body);
        });
      }).catch(function (e) {
        if (e instanceof AIError) { finish(false, e); return; }
        var off = typeof navigator !== 'undefined' && navigator.onLine === false;
        finish(false, new AIError(off ? 'offline' : 'network', off ? MSG.offline : MSG.network, String(e && e.message)));
      });
    });
  }

  /** Запрос к Gemini; ответ «недоступен в вашей стране» запоминается (показываем предупреждение заранее) */
  function gemFetch(url, init, timeoutMs) {
    return fetchJson(url, init, timeoutMs).then(function (body) { return body; }, function (e) {
      if (e && (e.code === 'region' || e.code === 'unreachable')) setRegionBlock(e.code);
      throw e;
    });
  }

  /**
   * Лёгкая проверка связи с Google (список из одной модели — не расходует лимит генерации).
   * Возвращает Promise<'ok' | AIError>: 'ok' — сервер ответил (даже ошибкой ключа — связь есть).
   */
  function probeConnection(key, signal) {
    return fetchJson(config.baseUrl + '/models?pageSize=1', { method: 'GET', headers: { 'x-goog-api-key': key }, cancelSignal: signal }, config.probeTimeoutMs)
      .then(function () { return 'ok'; }, function (e) {
        if (e.code === 'timeout' || e.code === 'network') return new AIError('unreachable', MSG.unreachable, e.code);
        if (e.code === 'region' || e.code === 'cancel' || e.code === 'offline') return e;
        return 'ok'; // сервер ответил ошибкой (ключ, лимит…) — связь есть, подробности даст основной запрос
      });
  }

  function headers(key) { return { 'Content-Type': 'application/json', 'x-goog-api-key': key }; }

  /** Список подходящих моделей: генерация контента, Flash/Flash-Lite, без TTS/Live/изображений */
  function listModels(key) {
    if (!key) return Promise.reject(new AIError('nokey', MSG.nokey));
    return gemFetch(config.baseUrl + '/models?pageSize=1000', { method: 'GET', headers: { 'x-goog-api-key': key } }, 20000).catch(function (e) {
      if (e && (e.code === 'timeout' || e.code === 'network')) { setRegionBlock('unreachable'); throw new AIError('unreachable', MSG.unreachable, e.code); }
      throw e;
    }).then(function (body) {
      var ids = ((body && body.models) || []).filter(function (m) {
        var id = String(m.name || '').replace(/^models\//, '');
        return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0 &&
          /^gemini-.*flash/.test(id) && !/(tts|live|image|audio|embedding|robotics|native|exp)/.test(id);
      }).map(function (m) { return String(m.name).replace(/^models\//, ''); });
      return sortModels(ids);
    });
  }

  /** Сортировка: новее — выше, Flash раньше Flash-Lite, без «-preview»/«-latest» дублей вперёд */
  function sortModels(ids) {
    var ver = function (id) { var m = /gemini-(\d+)(?:\.(\d+))?/.exec(id); return m ? (+m[1]) * 100 + (+(m[2] || 0)) : 0; };
    var uniq = [];
    ids.forEach(function (x) { if (uniq.indexOf(x) < 0) uniq.push(x); });
    return uniq.sort(function (a, b) {
      var la = /lite/.test(a) ? 1 : 0, lb = /lite/.test(b) ? 1 : 0;
      var pa = /preview|latest|\d{3,}/.test(a) ? 1 : 0, pb = /preview|latest|\d{3,}/.test(b) ? 1 : 0;
      return la - lb || ver(b) - ver(a) || pa - pb || a.localeCompare(b);
    });
  }

  /**
   * Проверка ключа: список моделей + крошечный запрос генерации. Список моделей может отвечать
   * и там, где генерация запрещена («User location is not supported»), — поэтому проверяем и её.
   * Результат: {ok, models, warning?: 'quota'}; ошибки — AIError (region, unreachable, key…).
   */
  function checkKey(key) {
    return listModels(key).then(function (ids) {
      var cur = getModel();
      var model = ids.indexOf(cur) >= 0 ? cur : ids.indexOf(DEFAULT_MODEL) >= 0 ? DEFAULT_MODEL : (ids[0] || cur);
      var body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Ответь одним словом: да' }] }], generationConfig: { maxOutputTokens: 16, temperature: 0 } });
      return gemFetch(config.baseUrl + '/models/' + encodeURIComponent(model) + ':generateContent', { method: 'POST', headers: headers(key), body: body }, 25000)
        .then(function () { setRegionBlock(null); return { ok: true, models: ids }; }, function (e) {
          if (e && e.code === 'quota') return { ok: true, models: ids, warning: 'quota' }; // ключ рабочий, лимит на сегодня исчерпан
          if (e && (e.code === 'timeout' || e.code === 'network')) { setRegionBlock('unreachable'); throw new AIError('unreachable', MSG.unreachable, e.code); }
          throw e;
        });
    });
  }

  /**
   * Gemini: распознать. opts: {key, model, images:[{mime,data}], refs, hint, totalWeight, learned, signal,
   * onStatus(state)} — state: 'connecting' (проверяем связь с Google), 'waiting' (связь есть, ИИ думает).
   *
   * Быстрый отказ: параллельно с распознаванием идёт лёгкий запрос «есть ли связь с Google».
   * Если он не ответил за config.probeTimeoutMs (типично для России: соединение с Google блокируется
   * или «замирает»), распознавание прерывается сразу с понятным сообщением, а не через минуты.
   * При неверном JSON или перегрузке сервера — одна автоматическая повторная попытка.
   */
  function recognizeGemini(opts) {
    var key = opts.key || getKey();
    if (!key) return Promise.reject(new AIError('nokey', MSG.nokey));
    var model = opts.model || getModel();
    var body = JSON.stringify(buildRequest(opts.images, opts));
    if (body.length > 19 * 1024 * 1024) return Promise.reject(new AIError('toobig', MSG.toobig));
    var url = config.baseUrl + '/models/' + encodeURIComponent(model) + ':generateContent';
    var status = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    // внутренняя отмена: кнопка «Отменить» или вывод проверки связи «Google недоступен»
    var inner = typeof AbortController === 'function' ? new AbortController() : null;
    var outer = opts.signal;
    return new Promise(function (resolve, reject) {
      var done = false;
      function finish(ok, v) {
        if (done) return;
        done = true;
        if (outer) outer.removeEventListener('abort', onCancel);
        if (inner && !ok) inner.abort();
        (ok ? resolve : reject)(v);
      }
      function onCancel() { finish(false, new AIError('cancel', 'Отменено')); }
      if (outer) {
        if (outer.aborted) { onCancel(); return; }
        outer.addEventListener('abort', onCancel);
      }
      status('connecting');
      probeConnection(key, inner && inner.signal).then(function (r) {
        if (done) return;
        if (r === 'ok') { status('waiting'); return; }
        if (r.code === 'cancel') return;
        if (r.code === 'region' || r.code === 'unreachable') setRegionBlock(r.code);
        finish(false, r);
      });
      var attempt = function (n) {
        return gemFetch(url, { method: 'POST', headers: headers(key), body: body, cancelSignal: inner && inner.signal })
          .then(readGeminiResponse)
          .catch(function (e) {
            if (!done && n === 0 && e && (e.code === 'json' || e.code === 'server')) return attempt(1);
            throw e;
          });
      };
      attempt(0).then(function (res) {
        setRegionBlock(null);
        res.provider = 'gemini'; res.model = model;
        finish(true, res);
      }, function (e) { finish(false, e); });
    });
  }

  /** Ручной режим: разбор вставленного ответа */
  function parseManual(text) {
    var obj = parseLoose(text);
    var res = normalizeResult(obj);
    if (!res) throw new AIError(obj ? 'empty' : 'paste', obj ? MSG.empty : MSG.paste);
    res.provider = 'manual';
    return res;
  }

  var providers = {
    // нейросеть в самом браузере (js/ondevice.js): после разовой загрузки модели без интернета и ключа
    ondevice: {
      id: 'ondevice', label: 'На устройстве', needsKey: false, local: true,
      recognize: function (opts) {
        if (typeof OnDevice === 'undefined') return Promise.reject(new AIError('unknown', MSG.unknown + 'модуль «На устройстве» не загружен'));
        return OnDevice.recognize(opts).catch(function (e) {
          if (e instanceof AIError) throw e;
          throw new AIError((e && e.code) || 'unknown', e && e.message ? e.message : MSG.unknown + String(e), e && e.detail);
        });
      }
    },
    gemini: { id: 'gemini', label: 'Gemini (бесплатный ключ)', needsKey: true, recognize: recognizeGemini },
    manual: { id: 'manual', label: 'Через любой чат-ИИ', needsKey: false, parse: parseManual }
  };

  // ---------- подготовка фото ----------
  /**
   * Файл → уменьшенный JPEG (макс. сторона 1280 px, качество 0,8). Перекодирование через canvas
   * убирает EXIF (в т.ч. геолокацию). HEIC с iPhone Safari открывает сам.
   * Возвращает Promise<{mime, data (base64), width, height, preview (dataURL)}>.
   */
  function prepareImage(file, maxSide, quality) {
    maxSide = maxSide || 1280; quality = quality || 0.8;
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new AIError('image', MSG.image)); return; }
      var url = URL.createObjectURL(file);
      var img = new Image();
      // на всякий случай: если браузер так и не открыл фото (ни onload, ни onerror) — не ждём вечно
      var guard = setTimeout(function () { img.onload = img.onerror = null; URL.revokeObjectURL(url); reject(new AIError('image', MSG.image, 'decode timeout')); }, 30000);
      img.onload = function () {
        clearTimeout(guard);
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) throw new Error('size');
          var k = Math.min(1, maxSide / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          var dataUrl = canvas.toDataURL('image/jpeg', quality);
          URL.revokeObjectURL(url);
          resolve({ mime: 'image/jpeg', data: dataUrl.split(',')[1], width: cw, height: ch, preview: dataUrl });
        } catch (e) { URL.revokeObjectURL(url); reject(new AIError('image', MSG.image, String(e))); }
      };
      img.onerror = function () { clearTimeout(guard); URL.revokeObjectURL(url); reject(new AIError('image', MSG.image, file.type)); };
      img.src = url;
    });
  }

  // ---------- память исправлений (чистые функции; хранение — в Store, коллекция aiMemory) ----------
  function memKey(name) {
    return String(name || '').toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я%]+/g, ' ').trim().slice(0, 100);
  }
  /** Детерминированный id по ключу — одинаковые названия на разных устройствах сливаются в одну запись */
  function memId(key) {
    var h = 2166136261;
    for (var i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return 'm' + h.toString(36) + key.length.toString(36);
  }
  /** Обновить запись памяти после подтверждения: продукт и средняя порция (скользящее среднее) */
  function memUpdate(rec, aiName, productId, productName, grams, now) {
    var key = memKey(aiName);
    var r = rec ? Object.assign({}, rec) : { id: memId(key), key: key, aiName: String(aiName).slice(0, 100), grams: grams, count: 0 };
    if (r.productId !== productId) { r.count = 0; r.grams = grams; } // выбрали другой продукт — учимся заново
    var n = Math.min(r.count, 4); // среднее примерно по последним 5 порциям
    r.grams = Math.round(((r.grams * n) + grams) / (n + 1) * 10) / 10;
    r.count = (r.count || 0) + 1;
    r.productId = productId || null;
    r.productName = productName ? String(productName).slice(0, 100) : null;
    r.lastUsed = now || Date.now();
    r.updatedAt = now || Date.now();
    return r;
  }
  function sanitizeMemory(o) {
    // в приложении проверка общая с синхронизацией — в хранилище (Store.sanitizeAiMemory)
    if (typeof Store !== 'undefined' && Store.sanitizeAiMemory) return Store.sanitizeAiMemory(o);
    if (!o || typeof o !== 'object') return null;
    var key = memKey(o.key || o.aiName);
    if (!key) return null;
    var grams = toNum(o.grams), count = toNum(o.count), u = toNum(o.updatedAt), last = toNum(o.lastUsed);
    if (!(grams > 0 && grams <= 5000)) return null;
    return {
      id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : memId(key),
      key: key,
      aiName: String(o.aiName || key).slice(0, 100),
      productId: typeof o.productId === 'string' && o.productId ? o.productId.slice(0, 40) : null,
      productName: typeof o.productName === 'string' ? o.productName.slice(0, 100) : null,
      grams: Math.round(grams * 10) / 10,
      count: count >= 1 ? Math.min(Math.round(count), 100000) : 1,
      lastUsed: last > 0 ? Math.round(last) : 0,
      updatedAt: u >= 0 ? Math.round(u) : 0
    };
  }

  return {
    config: config,
    providers: providers,
    DEFAULT_MODEL: DEFAULT_MODEL,
    FALLBACK_MODELS: FALLBACK_MODELS.slice(),
    RESPONSE_SCHEMA: RESPONSE_SCHEMA,
    AIError: AIError,
    MSG: MSG,
    getKey: getKey, setKey: setKey, getModel: getModel, setModel: setModel,
    getProvider: getProvider, setProvider: setProvider, forgetDeviceSettings: forgetDeviceSettings,
    getRegionBlock: getRegionBlock, setRegionBlock: setRegionBlock, probeConnection: probeConnection,
    buildPrompt: buildPrompt, buildRequest: buildRequest,
    parseLoose: parseLoose, normalizeResult: normalizeResult, readGeminiResponse: readGeminiResponse, mapHttpError: mapHttpError,
    listModels: listModels, sortModels: sortModels, checkKey: checkKey,
    recognize: recognizeGemini, parseManual: parseManual,
    prepareImage: prepareImage,
    memKey: memKey, memId: memId, memUpdate: memUpdate, sanitizeMemory: sanitizeMemory
  };
})();
