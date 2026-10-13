/*
 * «📷 По фото»: интерфейс распознавания еды.
 * Фото (до 3) или ответ любого чат-ИИ → черновик (ингредиенты, граммы) → сопоставление с НАШЕЙ базой
 * продуктов (ккал/БЖУ/ГИ берутся из базы, а не от ИИ) → правка → «Записать в дневник».
 * Без подтверждения пользователя ничего не сохраняется. Фото не сохраняются.
 *
 * Модуль не знает о внутренностях app.js: всё нужное приходит в объекте ctx (PhotoUI.init).
 */
var PhotoUI = (function () {
  'use strict';

  var MAX_PHOTOS = 3;
  var DISH_CATS = ['Супы', 'Вторые блюда', 'Салаты и закуски', 'Выпечка, блины, пироги', 'Фастфуд и снеки', 'Крупы, каши, хлопья'];
  var DEFAULT_REFS = [
    { name: 'Длина среднего пальца', cm: 8 },
    { name: 'Ширина 4 прижатых пальцев (ладонь)', cm: 7.5 }
  ];
  var MODELS_CACHE = 'ft_v1_ai_models';

  var ctx = null;
  var S = null; // текущая сессия распознавания

  function init(c) {
    ctx = c;
    if (odOn()) OnDevice.setResolver(c.findFood); // продукты (в т. ч. свои) по id — для личной памяти
  }

  // ---------- утилиты ----------
  function esc(s) { return ctx.esc(s); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
  function sizeRefs() {
    var r = ctx.sizeRefs ? ctx.sizeRefs() : null;
    return Array.isArray(r) && r.length ? r : DEFAULT_REFS;
  }
  function memoryMap() {
    var m = {};
    (ctx.memoryList ? ctx.memoryList() : []).forEach(function (r) { m[r.key] = r; });
    return m;
  }
  function learnedForPrompt() {
    return (ctx.memoryList ? ctx.memoryList() : []).slice()
      .sort(function (a, b) { return b.count - a.count || b.lastUsed - a.lastUsed; })
      .filter(function (r) { return r.count >= 2; })
      .slice(0, 8)
      .map(function (r) { return { name: r.productName || r.aiName, grams: r.grams }; });
  }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function cachedModels() {
    try { var a = JSON.parse(lsGet(MODELS_CACHE) || 'null'); if (Array.isArray(a) && a.length) return a; } catch (e) { /* ignore */ }
    return AI.FALLBACK_MODELS;
  }

  // ---------- «На устройстве» (js/ondevice.js, js/portions.js) ----------
  function odOn() { return typeof OnDevice !== 'undefined'; }
  // мегабайты — десятичные (как в iOS и на GitHub): иначе в карточке «≈ 38 МБ», а в прогрессе «из 36 МБ»
  function mb(bytes) { return (bytes / 1e6).toFixed(bytes >= 1e7 ? 0 : 1).replace('.', ','); }

  /**
   * Порция по умолчанию для продукта: ваша обычная (память по названию продукта) → типичная из таблицы (portions.js).
   * Возвращает {grams, src: 'mem' | 'item' | 'cat' | 'generic'}.
   */
  function defaultGramsFor(snap) {
    var rec = memoryMap()[AI.memKey(snap.name)];
    if (rec && rec.productId === (snap.productId || null) && rec.grams > 0) return { grams: rec.grams, src: 'mem' };
    if (typeof Portions !== 'undefined') return Portions.defaultFor(ctx.findFood(snap.productId) || snap);
    return { grams: 150, src: 'generic' };
  }

  // =====================================================================
  // Сопоставление с базой продуктов
  // =====================================================================
  /** Насколько пищевая ценность продукта базы отличается от оценки ИИ (0 — совпадает) */
  function nutrDistance(f, it) {
    return Math.abs(f.kcal - it.kcal) / Math.max(it.kcal, 50) +
      (Math.abs(f.p - it.p) + Math.abs(f.f - it.f) + Math.abs(f.c - it.c)) / 100;
  }

  /**
   * Лучший продукт базы для названия от ИИ; null, если совпадение слабое.
   * Среди одинаково хороших совпадений по названию выбираем продукт, чья пищевая ценность
   * ближе к оценке ИИ («Гренки» 335 ккал → «Гренки из белого хлеба», а не сладкие французские).
   */
  function matchProduct(name, it) {
    var res = ctx.searchFoods(name, 12);
    if (!res.length) return null;
    var best = res[0];
    // уровень 0–3: точное название, начало названия, начала слов, основа/синоним; 4 — с опечаткой (не берём)
    if (best.level > 3) return null;
    if (it && best.level > 0) {
      var same = res.filter(function (r) { return r.level === best.level; }).slice(0, 8);
      var d0 = nutrDistance(best.f, it);
      same.forEach(function (r) {
        var d = nutrDistance(r.f, it);
        if (d < d0 - 0.15) { best = r; d0 = d; } // заметно ближе по составу
      });
    }
    return { product: best.f, level: best.level };
  }

  /** Совпадает ли блюдо целиком с готовым блюдом базы (борщ, плов…) */
  function matchDish(name) {
    var res = ctx.searchFoods(name, 8).filter(function (r) { return DISH_CATS.indexOf(r.f.cat) >= 0 && r.level <= 2; });
    return res.length ? res[0].f : null;
  }

  function aiValues(it) {
    return { name: it.name, kcal: it.kcal, p: it.p, f: it.f, c: it.c, gi: it.gi, giSrc: it.gi != null ? 'e' : (it.c < 2 ? 'n' : null) };
  }

  /** Строки черновика из результата ИИ (с учётом памяти исправлений) */
  /** Строка черновика для результата «На устройстве»: продукт уже из нашей базы (productId), порция — типичная или ваша */
  function buildDeviceRow(it, row, rec) {
    row.engine = 'ondevice';
    row.candidates = (it.candidates || []).slice();
    var food = ctx.findFood(it.productId);
    if (!food) return row; // например, свой продукт уже удалён — остаются значения модели
    // исправление из памяти: модель предлагала X, а вы раньше выбирали Y — подставляем Y (X остаётся в вариантах)
    if (!it.fromKnn && rec && rec.productId && rec.productId !== it.productId) {
      var f2 = ctx.findFood(rec.productId);
      if (f2) {
        row.candidates = [{ id: it.productId, name: it.name }].concat(row.candidates.filter(function (c) { return c.id !== f2.id; }));
        food = f2; row.fromMemory = true;
      }
    }
    row.product = ctx.snapshotOf(food);
    if (it.fromKnn) { row.fromKnn = true; row.portionSrc = 'knn'; }
    else { var g = defaultGramsFor(row.product); row.grams = g.grams; row.aiGrams = g.grams; row.portionSrc = g.src; }
    return row;
  }

  function buildRows(result) {
    var mem = memoryMap();
    return result.items.map(function (it) {
      var key = AI.memKey(it.name), rec = mem[key];
      var row = { aiName: it.name, ai: aiValues(it), aiGrams: it.grams, grams: it.grams, hidden: it.hidden, product: null, matchLevel: null, note: '' };
      if (it.productId) return buildDeviceRow(it, row, rec);
      var fromMem = rec && rec.productId ? ctx.findFood(rec.productId) : null;
      if (fromMem) {
        row.product = ctx.snapshotOf(fromMem);
        row.fromMemory = true;
      } else if (!(rec && rec.count >= 1 && !rec.productId)) { // пользователь раньше оставлял значения ИИ
        var m = matchProduct(it.name, it);
        if (m) { row.product = ctx.snapshotOf(m.product); row.matchLevel = m.level; }
      }
      if (rec) {
        var diff = Math.abs(rec.grams - it.grams) / Math.max(it.grams, 1);
        if (rec.count >= 3 && diff > 0.05) { row.adjustedFrom = it.grams; row.grams = rec.grams; }
        else if (diff > 0.15) row.suggest = rec.grams;
      }
      return row;
    });
  }

  function rowValues(row) { return row.product || row.ai; }

  function totals(rows) {
    var t = { grams: 0, kcal: 0, p: 0, f: 0, c: 0, giCarbs: 0, carbsKnown: 0, gl: 0, unknownGi: 0 };
    rows.forEach(function (r) {
      if (r.removed || !(r.grams > 0)) return;
      var v = rowValues(r), k = r.grams / 100, carbs = v.c * k;
      t.grams += r.grams; t.kcal += v.kcal * k; t.p += v.p * k; t.f += v.f * k; t.c += carbs;
      if (v.gi != null) { t.giCarbs += v.gi * carbs; t.carbsKnown += carbs; t.gl += v.gi * carbs / 100; }
      else if (v.c >= 2 && v.giSrc !== 'n') t.unknownGi++;
    });
    t.gi = t.carbsKnown > 0 ? t.giCarbs / t.carbsKnown : null;
    return t;
  }

  // =====================================================================
  // Окно: шаг 1 — фото или ручной режим
  // =====================================================================
  function open(opts) {
    opts = opts || {};
    S = {
      provider: AI.getProvider(),
      photos: [],
      hint: '',
      totalWeight: '',
      meal: opts.meal || ctx.guessMeal(),
      date: opts.date || ctx.state().date,
      time: ctx.nowTime(),
      pasted: '',
      busy: null
    };
    renderStart();
  }

  var PROVIDER_LABELS = { ondevice: 'На устройстве', gemini: 'Gemini (ключ)', manual: 'Через любой чат-ИИ' };
  function providerButtons(list) {
    return '<div class="segmented ph-provider" role="group" aria-label="Способ распознавания">' + list.map(function (p) {
      return '<button type="button" data-ph="provider" data-p="' + p + '" class="' + (S.provider === p ? 'active' : '') + '" aria-pressed="' + (S.provider === p) + '">' + PROVIDER_LABELS[p] + '</button>';
    }).join('') + '</div>';
  }
  function providerSwitchHtml() {
    if (!odOn()) return providerButtons(['gemini', 'manual']);
    // «На устройстве» — основной способ; Gemini и ручной режим спрятаны в «Другие способы»
    if (S.provider === 'ondevice') {
      return '<details class="help ph-others"><summary>Другие способы</summary>' + providerButtons(['gemini', 'manual']) +
        '<p class="hint">Gemini из России не работает; «Через любой чат-ИИ» — вручную: запрос копируется, ответ вставляется.</p></details>';
    }
    return providerButtons(['ondevice', 'gemini', 'manual']);
  }

  function totalFieldHtml() {
    return '<div class="field"><label for="ph-total">Общий вес по весам, г (если знаете)</label>' +
      '<input id="ph-total" type="text" inputmode="decimal" placeholder="например, 350" value="' + esc(S.totalWeight) + '"></div>';
  }

  // ---------- загрузка модели «На устройстве» (общая для окна фото и настроек) ----------
  var DL = { ctl: null, active: false, pct: 0, text: '', err: '' };
  function dlBoxHtml() {
    return '<div class="ph-dl js-dl" hidden><progress class="js-dl-bar" max="100" value="0" aria-label="Загрузка модели"></progress>' +
      '<span class="js-dl-text small" aria-live="polite"></span>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-ph="od-dl-cancel" data-ai="od-dl-cancel">Отменить</button></div>' +
      '<div class="form-error js-dl-err" role="alert"></div>';
  }
  function paintDl() {
    $$('.js-dl').forEach(function (box) { box.hidden = !DL.active; });
    $$('.js-dl-bar').forEach(function (b) { b.value = DL.pct; });
    $$('.js-dl-text').forEach(function (t) { t.textContent = DL.text; });
    $$('.js-dl-err').forEach(function (e) { e.textContent = DL.err; });
    $$('[data-ph="od-download"], [data-ai="od-download"], [data-ai="od-redownload"]').forEach(function (b) { b.disabled = DL.active; });
  }
  /** Скачать пакет модели; onDone() — после успеха. Идёт в фоне, даже если окно закрыли. */
  function startDownload(onDone, pack) {
    if (DL.active || !odOn()) return;
    DL.active = true; DL.err = ''; DL.pct = 0; DL.text = 'Начинаю загрузку…';
    DL.ctl = typeof AbortController === 'function' ? new AbortController() : { abort: function () {}, signal: null };
    paintDl();
    OnDevice.download({
      pack: pack, signal: DL.ctl.signal,
      onProgress: function (p) {
        DL.pct = Math.round(100 * p.loaded / p.total);
        DL.text = p.retry ? 'Связь прервалась — пробую ещё раз (' + p.retry + ')…' : 'Скачано ' + mb(p.loaded) + ' из ' + mb(p.total) + ' МБ (' + DL.pct + '%)';
        paintDl();
      }
    }).then(function () {
      DL.active = false; DL.text = ''; paintDl();
      if (onDone) onDone(true);
    }, function (e) {
      DL.active = false; DL.err = e && e.message ? e.message : String(e); paintDl();
      if (onDone) onDone(false, e);
    });
  }

  function extraFieldsHtml() {
    return '<div class="field"><label for="ph-hint">Пояснение (необязательно)</label>' +
        '<input id="ph-hint" type="text" maxlength="300" placeholder="порция ~300 г, без сахара, жарено на сливочном масле" value="' + esc(S.hint) + '"></div>' +
      '<div class="field"><label for="ph-total">Общий вес по весам, г (если знаете)</label>' +
        '<input id="ph-total" type="text" inputmode="decimal" placeholder="например, 350" value="' + esc(S.totalWeight) + '"></div>';
  }

  function photosHtml(device) {
    return '<div class="ph-photos">' + S.photos.map(function (p, i) {
      return '<div class="ph-thumb"><img src="' + p.preview + '" alt="Фото ' + (i + 1) + '">' +
        '<button type="button" class="icon-btn" data-ph="del-photo" data-i="' + i + '" aria-label="Убрать фото ' + (i + 1) + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>';
    }).join('') + '</div>' +
      (S.photos.length < MAX_PHOTOS
        ? '<div class="btn-row ph-pick">' +
            '<label class="btn btn-primary"><input type="file" accept="image/*" capture="environment" data-ph-file hidden>📷 Снять фото</label>' +
            '<label class="btn"><input type="file" accept="image/*" multiple data-ph-file hidden>Выбрать из галереи</label>' +
          '</div>'
        : '') +
      (device
        ? '<p class="hint">Снимайте сверху или под углом ~45°, чтобы блюдо было крупно и в центре кадра (края фото обрезаются до квадрата). Можно до ' + MAX_PHOTOS + ' фото одного блюда с разных ракурсов. Вес порции по фото не определяется — подставляется типичный, вы его поправите.</p>'
        : '<p class="hint">Можно до ' + MAX_PHOTOS + ' фото с разных ракурсов. Для точности положите рядом с тарелкой ладонь (4 пальца) или палец; снимайте сверху или под углом ~45°.</p>');
  }

  function renderStart(errorMsg) {
    var key = AI.getKey();
    var html = '<div class="ph" id="ph-wrap">' + providerSwitchHtml();
    if (S.provider === 'ondevice') {
      html += onDeviceStartHtml() + photosHtml(true) + totalFieldHtml();
    } else if (S.provider === 'gemini') {
      if (!online()) html += '<p class="note-box ph-warn">Нет подключения к интернету — распознавание через Gemini недоступно. Попробуйте позже или выберите «Через любой чат-ИИ».</p>';
      var blk = AI.getRegionBlock();
      if (blk && !errorMsg) html += '<p class="note-box ph-warn">' + (blk.code === 'region'
        ? 'Последний запрос к Gemini: сервис недоступен из вашей страны (Google не обслуживает запросы из России). Скорее всего, распознавание не сработает.'
        : 'Последний раз сервер Google Gemini не ответил — из России он недоступен. Если вы в России, распознавание через Gemini, скорее всего, не сработает.') + '</p>';
      if (!key) html += '<p class="note-box ph-warn">Ключ Gemini не указан. Его можно бесплатно получить за пару минут — см. «Настройки → Распознавание по фото», или выберите «Через любой чат-ИИ» (без ключа).</p>';
      html += photosHtml() + extraFieldsHtml();
    } else {
      html += '<ol class="ph-steps">' +
        '<li><button type="button" class="btn btn-primary btn-sm" data-ph="copy-prompt">Скопировать запрос</button> — в нём ваши эталоны размера и формат ответа.</li>' +
        '<li>Откройте любой чат-ИИ (Claude, ChatGPT, Gemini…), прикрепите фото еды и вставьте запрос.</li>' +
        '<li>Скопируйте ответ целиком и вставьте сюда:</li></ol>' +
        '<div class="field"><label for="ph-paste" class="visually-hidden">Ответ ИИ</label>' +
          '<textarea id="ph-paste" rows="6" placeholder="Вставьте ответ ИИ (JSON)…">' + esc(S.pasted) + '</textarea></div>' +
        '<details class="help"><summary>Показать запрос</summary><pre class="ph-prompt" id="ph-prompt">' + esc(currentPrompt(true)) + '</pre></details>' +
        extraFieldsHtml() +
        '<p class="hint">Пояснение и вес стоит указать до копирования запроса — они войдут в него.</p>';
    }
    html += '<div id="form-error" class="form-error" role="alert">' + (errorMsg ? esc(errorMsg) : '') + '</div>' +
      '<div class="ph-busy" id="ph-busy"' + (S.busy ? '' : ' hidden') + '><span class="spinner" aria-hidden="true"></span><span id="ph-busy-text" aria-live="polite">Распознаю…</span>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-ph="cancel">Отменить</button></div>' +
      '</div>';
    ctx.Modal.open({
      title: 'Еда по фото',
      html: html,
      submitLabel: S.provider === 'manual' ? 'Разобрать ответ' : 'Распознать',
      onOpen: function (body) { bindStart(body); paintDl(); },
      onSubmit: function () { submitStart(); return false; }
    });
  }

  /** Верх окна для «На устройстве»: поддержка, прошлый сбой, загрузка модели */
  function onDeviceStartHtml() {
    var st = OnDevice.status(), h = '';
    if (!st.supported) {
      return '<p class="note-box ph-warn">На этом устройстве нейросеть запустить нельзя: ' + esc(st.reason || '') +
        '. Откройте приложение по ссылке https (или значком на экране «Домой») либо выберите «Другие способы» выше.</p>';
    }
    if (st.crashed) {
      h += '<p class="note-box ph-warn">Прошлое распознавание на устройстве не завершилось — возможно, не хватило памяти. Закройте лишние вкладки и приложения и попробуйте ещё раз; ' +
        'если повторится — выберите «Другие способы». <button type="button" class="linklike" data-ph="od-dismiss">Понятно</button></p>';
    }
    if (!st.installed) {
      h += '<div class="note-box ph-od-card"><b>Нужно один раз скачать модель (≈ ' + st.approxMB + ' МБ)</b>' +
        '<p class="small">Распознавание работает прямо на этом устройстве: бесплатно, без ключей, фото никуда не отправляются, а после загрузки — и без интернета. ' +
        'Лучше скачивать по Wi-Fi. Удалить модель можно в «Настройках → На устройстве».</p>' +
        '<div class="btn-row"><button type="button" class="btn btn-primary btn-sm" data-ph="od-download">Скачать модель</button></div>' + dlBoxHtml() + '</div>';
    }
    return h;
  }

  function currentPrompt(forChat) {
    return AI.buildPrompt({
      refs: sizeRefs(), hint: S.hint, totalWeight: ctx.parseNum(S.totalWeight),
      learned: learnedForPrompt(), photos: 1
    }, forChat);
  }

  function readStartFields(body) {
    var h = $('#ph-hint', body), t = $('#ph-total', body), p = $('#ph-paste', body);
    if (h) S.hint = h.value.trim();
    if (t) S.totalWeight = t.value.trim();
    if (p) S.pasted = p.value;
  }

  function bindStart(body) {
    var wrap = $('#ph-wrap', body);
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ph]');
      if (!b) return;
      var a = b.getAttribute('data-ph');
      readStartFields(body);
      if (a === 'provider') { S.provider = b.getAttribute('data-p'); AI.setProvider(S.provider); renderStart(); }
      else if (a === 'del-photo') { S.photos.splice(+b.getAttribute('data-i'), 1); renderStart(); }
      else if (a === 'copy-prompt') copyText(currentPrompt(true));
      else if (a === 'cancel' && S.busy) { S.busy.abort(); }
      else if (a === 'od-download') {
        startDownload(function (ok) { if (ok && S && ctx.Modal.isOpen() && !S.draft) { readStartFields($('#modal-body')); renderStart(); } });
      }
      else if (a === 'od-dl-cancel') { if (DL.ctl) DL.ctl.abort(); }
      else if (a === 'od-dismiss') { OnDevice.dismissCrash(); renderStart(); }
    });
    wrap.addEventListener('input', function (e) {
      if (e.target.id === 'ph-hint' || e.target.id === 'ph-total') {
        readStartFields(body);
        var pre = $('#ph-prompt', body);
        if (pre) pre.textContent = currentPrompt(true);
      }
    });
    wrap.addEventListener('change', function (e) {
      if (!e.target.hasAttribute('data-ph-file')) return;
      readStartFields(body);
      var files = Array.prototype.slice.call(e.target.files || []).slice(0, MAX_PHOTOS - S.photos.length);
      if (!files.length) return;
      var session = S;
      ctx.toast('Готовлю фото…');
      // по одному: три 12-Мп фото, раскодированные одновременно, — это сотни МБ памяти на iPhone
      var list = [];
      files.reduce(function (p, f) {
        return p.then(function () {
          return AI.prepareImage(f).then(function (x) { list.push(x); }, function (err) { list.push(err); });
        });
      }, Promise.resolve()).then(function () {
        if (ctx.hideToast) ctx.hideToast(); // иначе «Готовлю фото…» висит ещё пару секунд после готовности
        if (S !== session || !ctx.Modal.isOpen()) return; // окно уже закрыли — не открываем его снова
        var bad = list.filter(function (x) { return x instanceof AI.AIError; });
        list.forEach(function (x) { if (!(x instanceof AI.AIError) && S.photos.length < MAX_PHOTOS) S.photos.push(x); });
        renderStart(bad.length ? bad[0].message : '');
      }).catch(function (err) { // непредвиденная ошибка — не молчим
        ctx.toast(AI.MSG.image + ' (' + String(err && err.message || err) + ')', true);
      });
    });
  }

  function copyText(text) {
    var ok = function () { ctx.toast('Запрос скопирован. Вставьте его в чат вместе с фото.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { fallbackCopy(text) ? ok() : ctx.toast('Не удалось скопировать — раскройте «Показать запрос» и скопируйте текст вручную.', true); });
    } else if (fallbackCopy(text)) ok();
    else ctx.toast('Не удалось скопировать — раскройте «Показать запрос» и скопируйте текст вручную.', true);
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      var ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }

  /** Индикатор ожидания: этап («проверяю связь» / «ИИ думает»), секунды и «ещё жду…» */
  var busyTimer = null, busyStart = 0, busyState = 'connecting';
  function busyText() {
    var sec = Math.floor((Date.now() - busyStart) / 1000);
    if (S && S.provider === 'ondevice') {
      return (busyState === 'thinking' ? 'Распознаю фото на устройстве… ' : 'Запускаю нейросеть (при первом запуске пару секунд)… ') + sec + ' с';
    }
    var limit = Math.round(AI.config.timeoutMs / 1000);
    if (busyState === 'connecting') return 'Связываюсь с Google… ' + sec + ' с (если сервер не ответит за ' + Math.round(AI.config.probeTimeoutMs / 1000) + ' с — прекращу)';
    return (sec < 20 ? 'Связь есть, ИИ распознаёт фото… ' : 'Ещё жду ответа ИИ… ') + sec + ' с из ' + limit;
  }
  function setBusy(on) {
    var el = $('#ph-busy');
    if (el) el.hidden = !on;
    $$('#modal-foot button').forEach(function (b) { b.disabled = !!on; });
    clearInterval(busyTimer); busyTimer = null;
    if (on) {
      busyStart = Date.now(); busyState = 'connecting';
      var tick = function () { var t = $('#ph-busy-text'); if (t) t.textContent = busyText(); else { clearInterval(busyTimer); busyTimer = null; } };
      tick();
      busyTimer = setInterval(tick, 1000);
    }
  }
  function setBusyState(st) { busyState = st; var t = $('#ph-busy-text'); if (t) t.textContent = busyText(); }

  function submitStart() {
    var body = $('#modal-body');
    readStartFields(body);
    var err = $('#form-error');
    if (S.provider === 'manual') {
      if (!S.pasted.trim()) { err.textContent = 'Вставьте ответ ИИ в поле выше.'; return; }
      try { showDraft(AI.parseManual(S.pasted)); }
      catch (e) { err.textContent = e.message || String(e); }
      return;
    }
    if (!S.photos.length) { err.textContent = 'Добавьте хотя бы одно фото.'; return; }
    if (S.provider === 'ondevice') {
      var st = OnDevice.status();
      if (!st.supported) { err.textContent = OnDevice.MSG.unsupported; return; }
      if (!st.installed) { // сначала скачиваем модель, затем сразу распознаём
        var sess0 = S;
        startDownload(function (ok) { if (ok && S === sess0 && ctx.Modal.isOpen()) { renderStart(); submitStart(); } });
        return;
      }
      OnDevice.dismissCrash();
    } else {
      if (!AI.getKey()) { err.textContent = AI.MSG.nokey; return; }
      if (!online()) { err.textContent = AI.MSG.offline; return; }
    }
    var ctl = typeof AbortController === 'function' ? new AbortController() : { abort: function () {}, signal: null };
    S.busy = ctl;
    err.textContent = '';
    setBusy(true);
    var session = S;
    var fail = function (e) {
      if (S !== session) return;
      S.busy = null;
      setBusy(false);
      if (!ctx.Modal.isOpen()) return; // окно закрыли во время ожидания
      if (e && e.code === 'cancel') { renderStart(); return; }
      renderStart(e && e.message ? e.message : AI.MSG.unknown + String(e));
    };
    var p;
    try {
      p = AI.providers[S.provider === 'ondevice' ? 'ondevice' : 'gemini'].recognize({
        images: S.photos.map(function (ph) { return { mime: ph.mime, data: ph.data, preview: ph.preview }; }),
        refs: sizeRefs(), hint: S.hint, totalWeight: ctx.parseNum(S.totalWeight), learned: learnedForPrompt(),
        signal: ctl.signal,
        onStatus: function (st) { if (S === session && S.busy === ctl) setBusyState(st); }
      });
    } catch (e0) { p = Promise.reject(e0); }
    p.then(function (res) {
      if (S !== session) return;
      S.busy = null;
      setBusy(false);
      if (!ctx.Modal.isOpen()) return;
      try { showDraft(res); } // ошибка при построении черновика не должна оставить вечный «Распознаю…»
      catch (e1) { fail(new AI.AIError('unknown', AI.MSG.unknown + String(e1 && e1.message || e1))); }
    }, fail);
  }

  // =====================================================================
  // Шаг 2 — черновик
  // =====================================================================
  function showDraft(result) {
    var rows = buildRows(result);
    var tw = ctx.parseNum(S.totalWeight);
    if (tw > 0) scaleRows(rows, tw);
    S.draft = {
      result: result,
      dishName: result.dish,
      rows: rows,
      itemRows: rows,
      // у результата «На устройстве» название блюда = продукт из базы: отдельный режим «как одно блюдо» не нужен
      dish: result.provider === 'ondevice' ? null : matchDish(result.dish),
      mode: 'items',
      picker: null, // {row: index | 'new', query}
      vec: result._vec || null,                   // вектор фото для личной памяти (только «На устройстве»)
      extra: (result.extra || []).slice()         // кандидаты «добавить ещё» (другая категория)
    };
    renderDraft();
  }

  function scaleRows(rows, total) {
    var sum = rows.reduce(function (s, r) { return s + (r.removed ? 0 : r.grams); }, 0);
    if (!(sum > 0)) return;
    var k = total / sum, live = rows.filter(function (r) { return !r.removed; });
    live.forEach(function (r) { r.grams = Math.max(1, Math.round(r.grams * k)); });
    // остаток округления — самому крупному компоненту, чтобы сумма точно равнялась весу с весов
    var diff = Math.round(total) - live.reduce(function (s, r) { return s + r.grams; }, 0);
    var big = live.reduce(function (a, r) { return !a || r.grams > a.grams ? r : a; }, null);
    if (big && diff && big.grams + diff >= 1) big.grams += diff;
  }

  function confClass(c) { return c === 'высокая' ? 'ph-conf-high' : c === 'низкая' ? 'ph-conf-low' : 'ph-conf-mid'; }

  function chipsHtml(r, i) {
    if (!r.candidates || !r.candidates.length) return '';
    return '<div class="ph-chips" role="group" aria-label="Другие варианты продукта"><span class="ph-chips-label">Может быть:</span>' +
      r.candidates.map(function (c) {
        return '<button type="button" class="chip" data-ph="chip" data-i="' + i + '" data-id="' + esc(c.id) + '" title="Заменить продукт">' + esc(c.name) + '</button>';
      }).join('') + '</div>';
  }
  function portionNote(r) {
    if (r.portionSrc === 'knn') return 'Порция — как в вашем прошлом таком же блюде';
    if (r.portionSrc === 'mem') return 'Порция — ваша обычная для этого продукта';
    if (r.portionSrc) return 'Порция типичная (вес по фото не определить) — поправьте под свою тарелку';
    return '';
  }

  function rowHtml(r, i) {
    if (r.removed) return '';
    var v = rowValues(r), k = r.grams / 100, dev = r.engine === 'ondevice';
    var title = r.product
      ? '<span class="ph-prod">' + esc(r.product.name) + '</span>' +
        (r.fromKnn ? ' <span class="badge badge-custom" title="Состав взят из вашего прошлого похожего блюда">как в прошлый раз</span>' : '') +
        (r.fromMemory ? ' <span class="badge badge-custom" title="Вы выбирали этот продукт раньше">ваш выбор</span>' : '')
      : '<span class="ph-prod">' + esc(r.ai.name) + '</span> <span class="badge ph-ai" title="Продукт не найден в базе — значения от ИИ, оценка">≈ ИИ</span>';
    var aiLine = r.product && r.aiName && ctx.normName(r.product.name) !== ctx.normName(r.aiName) ? '<div class="ph-ai-name">' + (dev ? 'Модель предложила' : 'ИИ') + ': «' + esc(r.aiName) + '»</div>' : '';
    var extra = '';
    var pn = dev && !r.gramsEdited ? portionNote(r) : '';
    if (pn) extra += '<div class="ph-mem">' + esc(pn) + '</div>';
    if (r.adjustedFrom != null) extra += '<div class="ph-mem">Скорректировано по вашим прошлым порциям (ИИ: ' + ctx.fmtInt(r.adjustedFrom) + ' г)</div>';
    if (r.suggest != null) extra += '<div class="ph-mem">Обычно у вас ~' + ctx.fmtInt(r.suggest) + ' г — <button type="button" class="linklike" data-ph="use-suggest" data-i="' + i + '">подставить</button></div>';
    if (r.hidden) extra += '<div class="ph-mem">скрытый компонент (масло, соус, сахар) — проверьте количество</div>';
    var picker = S.draft.picker && S.draft.picker.row === i ? pickerHtml() : '';
    return '<li class="ph-row" data-i="' + i + '">' +
      '<div class="ph-row-main">' +
        '<div class="ph-row-name">' + title + aiLine + '</div>' +
        '<div class="ph-row-meta">' + ctx.fmtInt(v.kcal * k) + ' ккал · Б ' + ctx.fmt1(v.p * k) + ' · Ж ' + ctx.fmt1(v.f * k) + ' · У ' + ctx.fmt1(v.c * k) +
          (ctx.giText(v) ? ' · ' + ctx.giText(v) : '') + '</div>' + extra +
      '</div>' +
      '<div class="ph-row-side">' +
        '<label class="ph-grams"><input type="text" inputmode="decimal" data-ph-grams="' + i + '" value="' + ctx.inputNum(r.grams) + '" aria-label="Граммы: ' + esc(rowValues(r).name) + '"><span>г</span></label>' +
        '<div class="ph-row-btns">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-ph="replace" data-i="' + i + '">заменить</button>' +
          '<button type="button" class="icon-btn danger" data-ph="remove" data-i="' + i + '" aria-label="Убрать ' + esc(rowValues(r).name) + '">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        '</div>' +
      '</div>' + chipsHtml(r, i) + picker +
      '</li>';
  }

  /** «Ещё в кадре?» — кандидаты из других категорий: нажатие добавляет строку */
  function addChipsHtml() {
    var d = S.draft;
    if (!d.extra || !d.extra.length) return '';
    return '<div class="ph-chips ph-chips-add" role="group" aria-label="Добавить ещё продукт"><span class="ph-chips-label">Ещё в кадре?</span>' +
      d.extra.map(function (c) {
        return '<button type="button" class="chip chip-add" data-ph="chip-add" data-id="' + esc(c.id) + '" title="Добавить отдельной строкой">+ ' + esc(c.name) + '</button>';
      }).join('') + '</div>';
  }

  function pickerHtml() {
    var q = S.draft.picker.query || '';
    var res = q.trim() ? ctx.searchFoods(q, 12) : [];
    return '<div class="ph-picker">' +
      '<input type="text" id="ph-pick-q" autocomplete="off" spellcheck="false" placeholder="Найти продукт в базе…" value="' + esc(q) + '">' +
      '<ul class="search-results">' + res.map(function (r, j) {
        return '<li data-ph-choose="' + j + '"><span class="sr-name">' + ctx.highlight(r) + (r.f.custom ? ' <span class="badge badge-custom">мой</span>' : '') +
          '</span><span class="sr-meta">' + ctx.fmtInt(r.f.kcal) + ' ккал</span></li>';
      }).join('') + '</ul>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-ph="picker-close">Закрыть поиск</button></div>';
  }

  function renderDraft() {
    var d = S.draft, r = d.result;
    var t = totals(d.rows);
    var meals = ctx.MEALS.map(function (m) { return '<option value="' + m.key + '"' + (m.key === S.meal ? ' selected' : '') + '>' + m.label + '</option>'; }).join('');
    var html = '<div class="ph" id="ph-wrap">' +
      '<div class="field"><label for="ph-dish">Блюдо</label><input id="ph-dish" type="text" maxlength="100" value="' + esc(d.dishName) + '"></div>' +
      '<p class="small ph-meta"><span class="badge ' + confClass(r.confidence) + '">уверенность: ' + esc(r.confidence) + '</span>' +
        (r.reference ? ' <span class="muted">эталон: ' + esc(r.reference) + '</span>' : '') +
        (r.cooking ? ' <span class="muted">· ' + esc(r.cooking) + '</span>' : '') + '</p>' +
      (r.note ? '<p class="small muted">' + esc(r.note) + '</p>' : '') +
      (d.dish ? '<div class="segmented ph-mode" role="group" aria-label="Как записать">' +
        '<button type="button" data-ph="mode" data-m="items" class="' + (d.mode === 'items' ? 'active' : '') + '">по ингредиентам</button>' +
        '<button type="button" data-ph="mode" data-m="dish" class="' + (d.mode === 'dish' ? 'active' : '') + '">как одно блюдо: ' + esc(d.dish.name) + '</button></div>' : '') +
      '<ul class="list ph-rows">' + d.rows.map(rowHtml).join('') + '</ul>' +
      addChipsHtml() +
      (d.picker && d.picker.row === 'new' ? pickerHtml() : '<button type="button" class="btn btn-ghost btn-sm" data-ph="add">+ Добавить ингредиент</button>') +
      '<div class="ph-totals">' +
        '<div><b>' + ctx.fmtInt(t.kcal) + '</b> ккал · ' + ctx.fmtInt(t.grams) + ' г</div>' +
        '<div class="small">Б ' + ctx.fmt1(t.p) + ' · Ж ' + ctx.fmt1(t.f) + ' · У ' + ctx.fmt1(t.c) + ' г</div>' +
        '<div class="small">' + (t.gi != null ? 'ГИ ≈' + ctx.fmtInt(t.gi) + ' (средний по углеводам) · ГН ' + ctx.fmt1(t.gl) : 'ГИ: нет данных') +
          (t.unknownGi ? ' <span class="muted">(без ГИ: ' + t.unknownGi + ')</span>' : '') + '</div>' +
        '<div class="ph-scale"><label for="ph-total2" class="small">Общий вес, г</label>' +
          '<input id="ph-total2" type="text" inputmode="decimal" value="' + ctx.inputNum(t.grams) + '">' +
          '<button type="button" class="btn btn-sm" data-ph="scale">Пересчитать пропорционально</button></div>' +
      '</div>' +
      '<div class="row-3 ph-when">' +
        '<div class="field"><label for="ph-meal">Приём пищи</label><select id="ph-meal">' + meals + '</select></div>' +
        '<div class="field"><label for="ph-date">Дата</label><input id="ph-date" type="date" value="' + esc(S.date) + '"></div>' +
        '<div class="field"><label for="ph-time">Время</label><input id="ph-time" type="time" value="' + esc(S.time) + '"></div>' +
      '</div>' +
      (r.provider === 'ondevice'
        ? '<p class="hint">Проверьте продукт (варианты под названием — одним нажатием) и граммы: нейросеть узнаёт блюдо по виду, но размер порции и масло/соусы по фото не видит. Ккал, БЖУ и ГИ берутся из базы приложения. Когда вы запишете блюдо, приложение запомнит его на этом устройстве, и в следующий раз подскажет точнее.</p>'
        : '<p class="hint">Проверьте названия и граммы — ИИ часто ошибается в размере порции и не видит масло и соусы. Ккал, БЖУ и ГИ берутся из базы приложения; «≈ ИИ» — оценка ИИ.</p>') +
      '<div id="form-error" class="form-error" role="alert"></div>' +
      '</div>';
    ctx.Modal.open({
      title: 'Проверьте и запишите',
      html: html,
      submitLabel: 'Записать в дневник',
      buttons: [{ label: '← К фото', cls: 'btn-ghost', onClick: function () { renderStart(); } }],
      onOpen: function (body) { bindDraft(body); },
      onSubmit: function () { return saveDraft(); }
    });
  }

  function readDraftFields() {
    var body = $('#modal-body');
    var dn = $('#ph-dish', body); if (dn) S.draft.dishName = dn.value.trim();
    var m = $('#ph-meal', body); if (m) S.meal = m.value;
    var dt = $('#ph-date', body); if (dt) S.date = dt.value;
    var tm = $('#ph-time', body); if (tm) S.time = (tm.value || '').slice(0, 5);
  }

  function rerenderDraft(focusPicker) {
    readDraftFields();
    var scroll = $('#modal-body') ? $('#modal-body').scrollTop : 0;
    renderDraft();
    var mb = $('#modal-body');
    if (mb) mb.scrollTop = scroll;
    if (focusPicker) { var q = $('#ph-pick-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  }

  function setMode(mode) {
    var d = S.draft;
    if (mode === d.mode) return;
    if (mode === 'dish') {
      var total = d.itemRows.reduce(function (s, r) { return s + (r.removed ? 0 : r.grams); }, 0);
      var mem = memoryMap()[AI.memKey(d.result.dish)];
      d.rows = [{ aiName: d.result.dish, ai: aiValues({ name: d.result.dish, kcal: d.dish.kcal, p: d.dish.p, f: d.dish.f, c: d.dish.c, gi: d.dish.gi }),
        aiGrams: total, grams: mem && mem.count >= 3 ? mem.grams : total, product: ctx.snapshotOf(d.dish), isDish: true,
        suggest: mem && mem.count < 3 && Math.abs(mem.grams - total) / total > 0.15 ? mem.grams : null }];
    } else {
      d.rows = d.itemRows;
    }
    d.mode = mode;
    d.picker = null;
  }

  function bindDraft(body) {
    var wrap = $('#ph-wrap', body);
    wrap.addEventListener('click', function (e) {
      var li = e.target.closest('[data-ph-choose]');
      if (li) { choosePicked(+li.getAttribute('data-ph-choose')); return; }
      var b = e.target.closest('[data-ph]');
      if (!b) return;
      var a = b.getAttribute('data-ph'), i = +b.getAttribute('data-i'), d = S.draft;
      if (a === 'chip') { applyChip(d.rows[i], b.getAttribute('data-id')); rerenderDraft(); }
      else if (a === 'chip-add') { addChipRow(b.getAttribute('data-id')); rerenderDraft(); }
      else if (a === 'remove') { d.rows[i].removed = true; rerenderDraft(); }
      else if (a === 'replace') { d.picker = { row: i, query: rowValues(d.rows[i]).name }; rerenderDraft(true); }
      else if (a === 'add') { d.picker = { row: 'new', query: '' }; rerenderDraft(true); }
      else if (a === 'picker-close') { d.picker = null; rerenderDraft(); }
      else if (a === 'use-suggest') { d.rows[i].grams = d.rows[i].suggest; d.rows[i].suggest = null; rerenderDraft(); }
      else if (a === 'mode') { setMode(b.getAttribute('data-m')); rerenderDraft(); }
      else if (a === 'scale') {
        var v = ctx.parseNum($('#ph-total2', body).value);
        if (v > 0 && v <= 10000) { scaleRows(d.rows, v); rerenderDraft(); }
        else ctx.toast('Введите общий вес от 1 до 10 000 г', true);
      }
    });
    var timer = null;
    wrap.addEventListener('input', function (e) {
      var gi = e.target.getAttribute('data-ph-grams');
      if (gi != null) {
        var v = ctx.parseNum(e.target.value);
        if (v > 0 && v <= 5000) {
          S.draft.rows[+gi].grams = ctx.round1(v);
          S.draft.rows[+gi].gramsEdited = true;
          // обновляем только итоги и строку — без перерисовки поля ввода
          clearTimeout(timer);
          timer = setTimeout(function () { refreshTotals(body); }, 150);
        }
      } else if (e.target.id === 'ph-pick-q') {
        S.draft.picker.query = e.target.value;
        clearTimeout(timer);
        timer = setTimeout(function () { rerenderDraft(true); }, 120);
      }
    });
    wrap.addEventListener('keydown', function (e) {
      if (e.target.id === 'ph-pick-q' && e.key === 'Enter') { e.preventDefault(); choosePicked(0); }
      if (e.target.id === 'ph-pick-q' && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); S.draft.picker = null; rerenderDraft(); }
    });
  }

  /** Чип «может быть»: заменить продукт строки; прежний остаётся в вариантах (можно вернуть) */
  /** Если название блюда не правили и оно совпадало с заменяемым продуктом — меняем и его (иначе «Пицца Маргарита» над записью «Пицца с морепродуктами») */
  function syncDishName(oldName, newName) {
    var inp = $('#ph-dish');
    if (!inp || !oldName || inp.value.trim() !== String(oldName).trim()) return;
    inp.value = newName;
    S.draft.dishName = newName;
  }

  function applyChip(row, id) {
    var f = ctx.findFood(id);
    if (!f || !row) return;
    var old = row.product;
    if (old && old.name) syncDishName(old.name, f.name);
    row.candidates = (old && old.productId ? [{ id: old.productId, name: old.name }] : []).concat((row.candidates || []).filter(function (c) { return c.id !== id; }));
    row.product = ctx.snapshotOf(f); row.replaced = true; row.fromMemory = false; row.fromKnn = false;
    if (!row.gramsEdited && row.engine === 'ondevice') { // порцию пересчитываем под новый продукт, если вес не правили руками
      var g = defaultGramsFor(row.product); row.grams = g.grams; row.portionSrc = g.src;
    }
  }
  /** Чип «ещё в кадре»: добавить продукт отдельной строкой с типичной порцией */
  function addChipRow(id) {
    var d = S.draft, f = ctx.findFood(id);
    if (!f) return;
    var snap = ctx.snapshotOf(f), g = defaultGramsFor(snap);
    d.rows.push({ aiName: f.name, ai: aiValues({ name: f.name, kcal: f.kcal, p: f.p, f: f.f, c: f.c, gi: f.gi }), aiGrams: g.grams, grams: g.grams, product: snap, added: true, engine: 'ondevice', portionSrc: g.src, candidates: [] });
    d.extra = (d.extra || []).filter(function (c) { return c.id !== id; });
  }

  function refreshTotals(body) {
    var t = totals(S.draft.rows), box = $('.ph-totals', body);
    if (!box) return;
    box.children[0].innerHTML = '<b>' + ctx.fmtInt(t.kcal) + '</b> ккал · ' + ctx.fmtInt(t.grams) + ' г';
    box.children[1].textContent = 'Б ' + ctx.fmt1(t.p) + ' · Ж ' + ctx.fmt1(t.f) + ' · У ' + ctx.fmt1(t.c) + ' г';
    box.children[2].innerHTML = (t.gi != null ? 'ГИ ≈' + ctx.fmtInt(t.gi) + ' (средний по углеводам) · ГН ' + ctx.fmt1(t.gl) : 'ГИ: нет данных') +
      (t.unknownGi ? ' <span class="muted">(без ГИ: ' + t.unknownGi + ')</span>' : '');
    $$('.ph-row', body).forEach(function (li) {
      var r = S.draft.rows[+li.getAttribute('data-i')], v = rowValues(r), k = r.grams / 100;
      var meta = $('.ph-row-meta', li);
      if (meta) meta.textContent = ctx.fmtInt(v.kcal * k) + ' ккал · Б ' + ctx.fmt1(v.p * k) + ' · Ж ' + ctx.fmt1(v.f * k) + ' · У ' + ctx.fmt1(v.c * k) + (ctx.giText(v) ? ' · ' + ctx.giText(v) : '');
    });
    var tw = $('#ph-total2', body); if (tw && document.activeElement !== tw) tw.value = ctx.inputNum(t.grams);
  }

  function choosePicked(j) {
    var d = S.draft, q = d.picker && d.picker.query;
    var res = q && q.trim() ? ctx.searchFoods(q, 12) : [];
    var f = res[j] && res[j].f;
    if (!f) return;
    var snap = ctx.snapshotOf(f);
    if (d.picker.row === 'new') {
      d.rows.push({ aiName: null, ai: aiValues({ name: f.name, kcal: f.kcal, p: f.p, f: f.f, c: f.c, gi: f.gi }), aiGrams: 100, grams: 100, product: snap, added: true });
    } else {
      var r = d.rows[d.picker.row];
      if (r.product && r.product.name) syncDishName(r.product.name, snap.name);
      r.product = snap; r.fromMemory = false; r.fromKnn = false; r.replaced = true;
      if (r.engine === 'ondevice' && !r.gramsEdited) { var g = defaultGramsFor(snap); r.grams = g.grams; r.portionSrc = g.src; }
    }
    d.picker = null;
    rerenderDraft();
  }

  function saveDraft() {
    readDraftFields();
    var d = S.draft;
    var rows = d.rows.filter(function (r) { return !r.removed && r.grams > 0; });
    var err = $('#form-error');
    if (!rows.length) { err.textContent = 'Нет ни одного ингредиента для записи.'; return false; }
    if (!ctx.isDateStr(S.date)) { err.textContent = 'Укажите корректную дату.'; return false; }
    if (!ctx.isTimeStr(S.time)) { err.textContent = 'Укажите время в формате ЧЧ:ММ.'; return false; }
    var dishName = (d.dishName || d.result.dish || 'Блюдо по фото').slice(0, 100);
    var single = rows.length === 1;
    var dishId = single ? null : ctx.genId('d');
    var entries = rows.map(function (r) {
      var v = rowValues(r);
      var e = {
        date: S.date, time: S.time, meal: S.meal,
        productId: r.product ? (r.product.productId || null) : null,
        name: single && !r.product ? dishName : v.name,
        grams: ctx.round1(r.grams),
        kcal: v.kcal, p: v.p, f: v.f, c: v.c, gi: v.gi, giSrc: v.giSrc || (v.gi != null ? 'e' : null)
      };
      if (!r.product) e.src = 'ai';
      if (dishId) { e.dishId = dishId; e.dishName = dishName; }
      return e;
    });
    var ok = ctx.saveEntries(entries);
    if (!ok) { err.textContent = 'Не удалось сохранить записи: в хранилище браузера не хватает места (или данные некорректны). Сделайте резервную копию и освободите место.'; return false; }
    learn(rows);
    learnDevice(rows, dishName);
    ctx.Modal.close();
    ctx.afterSave(S.date, entries.length, dishName);
    S = null;
    return true;
  }

  /** Запоминаем выбор пользователя: название от ИИ → продукт и порция */
  function learn(rows) {
    if (!ctx.memorySave) return;
    var mem = memoryMap(), now = Date.now(), out = [];
    rows.forEach(function (r) {
      if (!r.aiName) return;
      var key = AI.memKey(r.aiName);
      if (!key) return;
      var pid = r.product ? (r.product.productId || null) : null;
      var pname = r.product ? r.product.name : null;
      var rec = AI.memUpdate(mem[key], r.aiName, pid, pname, r.grams, now);
      mem[key] = rec;
      out.push(rec);
      // «На устройстве»: порцию помним и по самому продукту (модель могла предложить другое название), чтобы в следующий раз подставить её
      if (r.engine === 'ondevice' && r.product && pid) {
        var pkey = AI.memKey(r.product.name);
        if (pkey && pkey !== key) { var rec2 = AI.memUpdate(mem[pkey], r.product.name, pid, pname, r.grams, now); mem[pkey] = rec2; out.push(rec2); }
      }
    });
    if (out.length) ctx.memorySave(out);
  }

  /** Личная память «На устройстве»: вектор фото + подтверждённый состав (только на этом устройстве, не синхронизируется) */
  function learnDevice(rows, dishName) {
    var d = S && S.draft;
    if (!odOn() || !d || !d.vec) return;
    var items = rows.filter(function (r) { return r.product && r.product.productId && r.grams > 0; })
      .map(function (r) { return { id: r.product.productId, g: r.grams }; });
    if (items.length) OnDevice.learn(d.vec, items, dishName);
  }

  // =====================================================================
  // Настройки: ключ, модель, эталоны размера, память
  // =====================================================================
  function settingsHtml() {
    var p = settingsParts();
    return p.od + p.ai + p.refs + p.mem;
  }

  /** Блок настроек «На устройстве»: модель, личная память, WebGPU */
  function odSettingsHtml() {
    var st = OnDevice.status();
    var btns = !st.supported ? ''
      : st.installed
        ? '<button type="button" class="btn btn-sm" data-ai="od-redownload">Скачать заново</button>' +
          '<button type="button" class="btn btn-danger btn-sm" data-ai="od-remove">Удалить модель…</button>'
        : '<button type="button" class="btn btn-primary btn-sm" data-ai="od-download">Скачать модель (≈ ' + st.approxMB + ' МБ)</button>';
    return '<section class="card settings-section" id="od-card"><h3>На устройстве</h3>' +
      '<p class="small muted">Основной способ распознавания еды по фото: нейросеть работает прямо в браузере — бесплатно, без ключей, фото никуда не отправляются, после разовой загрузки модели работает и без интернета.</p>' +
      '<ul class="info-list">' +
        '<li>Модель: <span id="od-status">' + (!st.supported ? '<b>недоступна</b> — ' + esc(st.reason || '') : st.installed ? 'установлена (' + mb(st.bytes) + ' МБ, версия ' + esc(st.version) + ')' : 'не скачана (нужно ≈ ' + st.approxMB + ' МБ, лучше по Wi-Fi)') + '</span></li>' +
        '<li>Личная память: <span id="od-mem">считаю…</span></li>' +
      '</ul>' +
      '<div class="btn-row" id="od-btns">' + btns + '</div>' + dlBoxHtml() +
      '<div class="field" style="margin-top:10px"><label class="check"><input id="od-gpu" type="checkbox"' + (st.webgpu ? ' checked' : '') + (st.webgpuAvailable ? '' : ' disabled') + '> Ускорение WebGPU (экспериментально)</label>' +
        '<span class="hint">' + (st.webgpuAvailable ? 'Быстрее (в десятки миллисекунд вместо долей секунды), но нужна дополнительная загрузка ≈ 29 МБ, и на части устройств (в т. ч. iPhone) может работать нестабильно. По умолчанию выключено.' : 'Этот браузер не поддерживает WebGPU.') + '</span></div>' +
      '<p class="hint">Личная память — это «отпечатки» ваших подтверждённых блюд (512 чисел на фото, сами фото не хранятся) и их состав. Она лежит только на этом устройстве, не попадает в синхронизацию, резервную копию и отчёты и нужна, чтобы похожее блюдо в следующий раз подставлялось само. ' +
        'Запомненные выборы продуктов и порции (блок «Что приложение запомнило») синхронизируются как раньше.</p>' +
      '<div class="btn-row"><button type="button" class="btn btn-danger btn-sm" data-ai="od-mem-reset" id="od-mem-reset" disabled>Сбросить личную память…</button></div>' +
      '</section>';
  }
  /** Вызывается приложением после отрисовки настроек: подгружает асинхронные данные блока «На устройстве» */
  function settingsRendered() {
    if (!odOn() || !$('#od-card')) return;
    paintDl();
    OnDevice.memory.count().then(function (n) {
      var el = $('#od-mem'), b = $('#od-mem-reset');
      var tmp = OnDevice.memory.persistent && !OnDevice.memory.persistent();
      if (el) el.textContent = (n ? n + ' ' + plural(n, 'блюдо', 'блюда', 'блюд') + ' (≈ ' + Math.max(1, Math.round(n * 0.8)) + ' КБ)' : 'пока пусто') +
        (tmp ? ' — только до закрытия приложения: браузер не даёт хранилище IndexedDB (приватный режим?)' : '');
      if (b) b.disabled = !n;
    }, function () { var el = $('#od-mem'); if (el) el.textContent = 'недоступна'; });
    if (OnDevice.status().installed) {
      OnDevice.verify().then(function (ok) { // кэш могли очистить (iOS): честно сообщаем
        if (ok) return;
        var s = $('#od-status'); if (s) s.textContent = 'файлы модели пропали из кэша браузера — скачайте заново';
        var bt = $('#od-btns'); if (bt) bt.innerHTML = '<button type="button" class="btn btn-primary btn-sm" data-ai="od-redownload">Скачать заново</button>';
      });
    }
  }
  function plural(n, a, b, c) { var m = n % 100, d = n % 10; return m >= 11 && m <= 14 ? c : d === 1 ? a : d >= 2 && d <= 4 ? b : c; }

  /** Три блока настроек: {ai, refs, mem} — чтобы приложение могло разложить их по колонкам */
  function settingsParts() {
    var key = AI.getKey(), model = AI.getModel(), models = cachedModels();
    if (models.indexOf(model) < 0) models = [model].concat(models);
    var refs = sizeRefs(), mem = ctx.memoryList ? ctx.memoryList() : [];
    var out = {};
    out.od = odOn() ? odSettingsHtml() : '';
    out.ai = '<section class="card settings-section" id="ai-card"><h3>' + (odOn() ? 'Другие способы: Gemini и чат-ИИ' : 'Распознавание по фото') + '</h3>' +
      '<p class="small muted">Кнопка «По фото» в дневнике. ' + (odOn() ? 'Основной способ — «На устройстве» (блок выше). Запасные: ' : 'Можно использовать ') + 'бесплатный ключ Google Gemini (из России не работает) или режим «Через любой чат-ИИ» (без ключа: запрос копируется, ответ вставляется).</p>' +
      '<div class="field"><label for="ai-key">Ключ Gemini API</label>' +
        '<div class="ph-keyrow"><input id="ai-key" type="password" autocomplete="off" spellcheck="false" placeholder="вставьте ключ из Google AI Studio" value="' + esc(key) + '">' +
        '<button type="button" class="btn btn-sm" data-ai="toggle-key" aria-label="Показать или скрыть ключ">Показать</button></div></div>' +
      '<div class="btn-row"><button type="button" class="btn btn-primary btn-sm" data-ai="save-key">Сохранить ключ</button>' +
        '<button type="button" class="btn btn-sm" data-ai="check-key">Проверить ключ</button>' +
        (key ? '<button type="button" class="btn btn-ghost btn-sm" data-ai="clear-key">Удалить ключ</button>' : '') + '</div>' +
      '<p class="hint" id="ai-key-status">' + (key ? 'Ключ сохранён только на этом устройстве.' : 'Ключ не указан.') + '</p>' +
      '<div class="field"><label for="ai-model">Модель</label><select id="ai-model">' +
        models.map(function (m) { return '<option value="' + esc(m) + '"' + (m === model ? ' selected' : '') + '>' + esc(m) + (m === AI.DEFAULT_MODEL ? ' (по умолчанию)' : '') + '</option>'; }).join('') +
      '</select><span class="hint">Список обновляется при проверке ключа. Если закончился лимит одной модели, можно выбрать другую.</span></div>' +
      '<p class="hint">Ключ хранится только на этом устройстве и не попадает в резервную копию, файл синхронизации и отчёты. ' +
        'В Google отправляются только фото еды и текст запроса; фото в приложении не сохраняются. ' +
        'На бесплатном тарифе Google может использовать отправленные данные для улучшения своих продуктов.</p>' +
      helpHtml() +
      '</section>';
    out.refs = '<section class="card settings-section" id="refs-card"><h3>Эталоны размера</h3>' +
      '<p class="small muted">Входят в запрос к ИИ: если на фото видна рука или предмет известного размера, ИИ точнее оценит порцию.</p>' +
      '<ul class="list ph-refs">' + refs.map(function (r, i) {
        return '<li class="ph-ref"><input type="text" maxlength="60" data-ref-name="' + i + '" value="' + esc(r.name) + '" aria-label="Название эталона">' +
          '<input type="text" inputmode="decimal" data-ref-cm="' + i + '" value="' + ctx.inputNum(r.cm) + '" aria-label="Размер, см"><span>см</span>' +
          '<button type="button" class="icon-btn danger" data-ai="ref-del" data-i="' + i + '" aria-label="Удалить эталон">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>';
      }).join('') + '</ul>' +
      '<div class="btn-row"><button type="button" class="btn btn-sm" data-ai="ref-add">+ Добавить эталон</button>' +
        '<button type="button" class="btn btn-primary btn-sm" data-ai="ref-save">Сохранить эталоны</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-ai="ref-reset">По умолчанию</button></div>' +
      '<p class="hint">Например: «Моя тарелка — 26 см», «Кружка — 9 см».</p>' +
      '</section>';
    out.mem = '<section class="card settings-section" id="mem-card"><h3>Что приложение запомнило</h3>' +
      (mem.length
        ? '<p class="small muted">Когда вы исправляете распознанный продукт или вес, приложение запоминает выбор и в следующий раз подставит его само (после 3 одинаковых подтверждений — автоматически).</p>' +
          '<table class="data"><thead><tr><th>ИИ назвал</th><th>Ваш продукт</th><th class="r">Порция</th><th class="r">Раз</th></tr></thead><tbody>' +
          mem.slice().sort(function (a, b) { return b.count - a.count || b.lastUsed - a.lastUsed; }).slice(0, 30).map(function (r) {
            return '<tr><td>' + esc(r.aiName) + '</td><td>' + (r.productName ? esc(r.productName) : '<span class="muted">значения ИИ</span>') + '</td>' +
              '<td class="r">' + ctx.fmtInt(r.grams) + ' г</td><td class="r">' + r.count + '</td></tr>';
          }).join('') + '</tbody></table>' +
          (mem.length > 30 ? '<p class="hint">Показаны 30 из ' + mem.length + '.</p>' : '') +
          '<div style="margin-top:10px"><button type="button" class="btn btn-danger btn-sm" data-ai="mem-reset">Сбросить запомненное…</button></div>'
        : '<p class="small muted">Пока пусто. После записи блюд по фото здесь появятся ваши исправления и обычные порции.</p>') +
      '</section>';
    return out;
  }

  function helpHtml() {
    return '<details class="help"><summary>Как получить бесплатный ключ Gemini</summary><ol>' +
      '<li>Откройте <b>aistudio.google.com/apikey</b> (Google AI Studio) и войдите через аккаунт Google.</li>' +
      '<li>Примите условия использования. Новым пользователям ключ создаётся автоматически; если его нет — нажмите <b>«Create API key»</b> (Создать ключ API) и выберите проект по умолчанию.</li>' +
      '<li>Скопируйте ключ (значок копирования рядом с ним).</li>' +
      '<li>Вставьте его сюда, нажмите «Сохранить ключ», затем «Проверить ключ».</li>' +
      '<li><b>Не подключайте платёжный аккаунт (billing)</b> — тогда ключ остаётся бесплатным: при исчерпании лимита запросы просто временно не выполняются, денег не списывается.</li>' +
      '</ol><p><b>Из России Gemini API не работает</b> (Google не обслуживает запросы из России, соединение с ним блокируется). Если появится сообщение, что сервис недоступен в вашей стране или сервер не отвечает, используйте режим «Через любой чат-ИИ».</p>' +
      '<p>Никому не передавайте ключ. Если он попал в чужие руки — удалите его в AI Studio и создайте новый.</p></details>';
  }

  function readRefs(root) {
    var out = [];
    $$('[data-ref-name]', root).forEach(function (inp) {
      var i = inp.getAttribute('data-ref-name');
      var cm = ctx.parseNum(($('[data-ref-cm="' + i + '"]', root) || {}).value);
      var name = inp.value.trim();
      if (name && cm > 0 && cm <= 100) out.push({ name: name.slice(0, 60), cm: ctx.round1(cm) });
    });
    return out;
  }

  /** Действия в настройках (data-ai). Возвращает true, если действие обработано. */
  function onSettingsAction(btn) {
    var a = btn.getAttribute('data-ai');
    if (!a) return false;
    if (a.indexOf('od-') === 0) return onDeviceAction(a);
    var root = btn.closest('section') || document;
    var keyInp = $('#ai-key');
    if (a === 'toggle-key') {
      keyInp.type = keyInp.type === 'password' ? 'text' : 'password';
      btn.textContent = keyInp.type === 'password' ? 'Показать' : 'Скрыть';
    } else if (a === 'save-key') {
      AI.setKey(keyInp.value);
      if (keyInp.value.trim()) AI.setProvider('gemini');
      ctx.toast(keyInp.value.trim() ? 'Ключ сохранён на этом устройстве' : 'Ключ удалён');
      ctx.rerender();
    } else if (a === 'clear-key') {
      if (!window.confirm('Удалить ключ Gemini с этого устройства?')) return true;
      AI.setKey('');
      ctx.toast('Ключ удалён');
      ctx.rerender();
    } else if (a === 'check-key') {
      var k = keyInp.value.trim(), st = $('#ai-key-status');
      if (!k) { st.textContent = 'Сначала вставьте ключ.'; return true; }
      st.textContent = 'Проверяю… (до 45 с; из России сервер Google может не ответить)';
      btn.disabled = true;
      AI.checkKey(k).then(function (res) {
        btn.disabled = false;
        if (res.models.length) lsSet(MODELS_CACHE, JSON.stringify(res.models));
        AI.setKey(k);
        AI.setProvider('gemini');
        if (res.models.length && res.models.indexOf(AI.getModel()) < 0) {
          AI.setModel(res.models.indexOf(AI.DEFAULT_MODEL) >= 0 ? AI.DEFAULT_MODEL : res.models[0]);
        }
        ctx.rerender();
        var s2 = $('#ai-key-status');
        if (s2) s2.textContent = 'Ключ работает ✓ Доступно моделей: ' + res.models.length + '. Ключ сохранён.' +
          (res.warning === 'quota' ? ' Но бесплатный лимит запросов сейчас исчерпан — попробуйте позже.' : '');
        ctx.toast('Ключ работает');
      }, function (e) {
        btn.disabled = false;
        st.textContent = e && e.message ? e.message : 'Не удалось проверить ключ.';
      });
    } else if (a === 'ref-add' || a === 'ref-del' || a === 'ref-save' || a === 'ref-reset') {
      var refs = readRefs(root);
      if (a === 'ref-add') { refs.push({ name: '', cm: 0 }); renderRefsDraft(root, refs); return true; }
      if (a === 'ref-del') { var cur = readRefsRaw(root); cur.splice(+btn.getAttribute('data-i'), 1); renderRefsDraft(root, cur); return true; }
      if (a === 'ref-reset') refs = DEFAULT_REFS.slice();
      ctx.setSizeRefs(refs);
      ctx.toast(a === 'ref-reset' ? 'Эталоны сброшены' : 'Эталоны сохранены');
      ctx.rerender();
    } else if (a === 'mem-reset') {
      if (!window.confirm('Забыть все исправления и обычные порции, которые приложение запомнило?\nПри синхронизации они удалятся и на других устройствах.')) return true;
      ctx.memoryClear();
      ctx.toast('Запомненное сброшено');
      ctx.rerender();
    } else return false;
    return true;
  }

  /** Действия блока «На устройстве» (data-ai="od-…") */
  function onDeviceAction(a) {
    if (!odOn()) return false;
    if (a === 'od-download' || a === 'od-redownload') {
      if (a === 'od-redownload') {
        // старая модель удаляется до загрузки новой — без сети этого делать нельзя, иначе останемся совсем без модели
        if (!online()) { ctx.toast('Нет подключения к интернету — модель не тронута. Скачать заново можно будет при наличии сети.', true); return true; }
        if (!window.confirm('Скачать модель заново (≈ ' + OnDevice.status().approxMB + ' МБ)? Нужен интернет.')) return true;
      }
      var go = function () { startDownload(function (ok) { if (ok) { ctx.toast('Модель скачана'); ctx.rerender(); } }); };
      if (a === 'od-redownload') OnDevice.remove().then(function () { ctx.rerender(); go(); }); else go();
    } else if (a === 'od-dl-cancel') {
      if (DL.ctl) DL.ctl.abort();
    } else if (a === 'od-remove') {
      if (!window.confirm('Удалить модель с этого устройства? Распознавание «На устройстве» перестанет работать, пока вы не скачаете её снова. Личная память блюд останется.')) return true;
      OnDevice.remove().then(function () { ctx.toast('Модель удалена'); ctx.rerender(); });
    } else if (a === 'od-mem-reset') {
      if (!window.confirm('Удалить личную память на этом устройстве (отпечатки ваших фото и составы блюд)? Подсказки «как в прошлый раз» начнутся с нуля. Запомненные выборы продуктов не затрагиваются.')) return true;
      OnDevice.memory.clear().then(function () { ctx.toast('Личная память сброшена'); ctx.rerender(); });
    } else return false;
    return true;
  }

  function readRefsRaw(root) {
    return $$('[data-ref-name]', root).map(function (inp) {
      var i = inp.getAttribute('data-ref-name');
      return { name: inp.value, cm: ctx.parseNum(($('[data-ref-cm="' + i + '"]', root) || {}).value) || 0 };
    });
  }
  function renderRefsDraft(root, refs) {
    var ul = $('.ph-refs', root);
    ul.innerHTML = refs.map(function (r, i) {
      return '<li class="ph-ref"><input type="text" maxlength="60" data-ref-name="' + i + '" value="' + esc(r.name) + '" placeholder="Название" aria-label="Название эталона">' +
        '<input type="text" inputmode="decimal" data-ref-cm="' + i + '" value="' + (r.cm ? ctx.inputNum(r.cm) : '') + '" placeholder="см" aria-label="Размер, см"><span>см</span>' +
        '<button type="button" class="icon-btn danger" data-ai="ref-del" data-i="' + i + '" aria-label="Удалить эталон">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>';
    }).join('');
    var last = $$('[data-ref-name]', ul).pop();
    if (last && !last.value) last.focus();
  }

  function onSettingsChange(el) {
    if (el.id === 'ai-model') { AI.setModel(el.value); ctx.toast('Модель: ' + el.value); return true; }
    if (el.id === 'od-gpu' && odOn()) {
      if (!el.checked) { OnDevice.setWebGPU(false); ctx.toast('WebGPU выключен'); return true; }
      OnDevice.verify('webgpu').then(function (ok) {
        if (ok) { OnDevice.setWebGPU(true); ctx.toast('WebGPU включён'); return; }
        if (!OnDevice.status().installed) { el.checked = false; ctx.toast('Сначала скачайте основную модель', true); return; }
        if (!window.confirm('Для ускорения WebGPU нужно дополнительно скачать ≈ 29 МБ. Скачать?')) { el.checked = false; return; }
        startDownload(function (done) { if (done) { OnDevice.setWebGPU(true); ctx.toast('WebGPU включён'); } else { el.checked = false; } }, 'webgpu');
      });
      return true;
    }
    return false;
  }

  return {
    init: init, open: open,
    settingsHtml: settingsHtml, settingsParts: settingsParts, onSettingsAction: onSettingsAction, onSettingsChange: onSettingsChange,
    settingsRendered: settingsRendered,
    DEFAULT_REFS: DEFAULT_REFS,
    // для тестов
    _buildRows: buildRows, _totals: totals, _matchProduct: matchProduct, _matchDish: matchDish, _state: function () { return S; }
  };
})();
