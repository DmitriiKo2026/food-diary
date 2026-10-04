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

  function init(c) { ctx = c; }

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
  function buildRows(result) {
    var mem = memoryMap();
    return result.items.map(function (it) {
      var key = AI.memKey(it.name), rec = mem[key];
      var row = { aiName: it.name, ai: aiValues(it), aiGrams: it.grams, grams: it.grams, hidden: it.hidden, product: null, matchLevel: null, note: '' };
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

  function providerSwitchHtml() {
    return '<div class="segmented ph-provider" role="group" aria-label="Способ распознавания">' +
      ['gemini', 'manual'].map(function (p) {
        return '<button type="button" data-ph="provider" data-p="' + p + '" class="' + (S.provider === p ? 'active' : '') + '" aria-pressed="' + (S.provider === p) + '">' +
          (p === 'gemini' ? 'Gemini (ключ)' : 'Через любой чат-ИИ') + '</button>';
      }).join('') + '</div>';
  }

  function extraFieldsHtml() {
    return '<div class="field"><label for="ph-hint">Пояснение (необязательно)</label>' +
        '<input id="ph-hint" type="text" maxlength="300" placeholder="порция ~300 г, без сахара, жарено на сливочном масле" value="' + esc(S.hint) + '"></div>' +
      '<div class="field"><label for="ph-total">Общий вес по весам, г (если знаете)</label>' +
        '<input id="ph-total" type="text" inputmode="decimal" placeholder="например, 350" value="' + esc(S.totalWeight) + '"></div>';
  }

  function photosHtml() {
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
      '<p class="hint">Можно до ' + MAX_PHOTOS + ' фото с разных ракурсов. Для точности положите рядом с тарелкой ладонь (4 пальца) или палец; снимайте сверху или под углом ~45°.</p>';
  }

  function renderStart(errorMsg) {
    var key = AI.getKey();
    var html = '<div class="ph" id="ph-wrap">' + providerSwitchHtml();
    if (S.provider === 'gemini') {
      if (!online()) html += '<p class="note-box ph-warn">Нет подключения к интернету — распознавание через Gemini недоступно. Попробуйте позже или выберите «Через любой чат-ИИ».</p>';
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
      '<div class="ph-busy" id="ph-busy"' + (S.busy ? '' : ' hidden') + '><span class="spinner" aria-hidden="true"></span><span>Распознаю… это может занять до минуты</span>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-ph="cancel">Отменить</button></div>' +
      '</div>';
    ctx.Modal.open({
      title: 'Еда по фото',
      html: html,
      submitLabel: S.provider === 'gemini' ? 'Распознать' : 'Разобрать ответ',
      onOpen: function (body) { bindStart(body); },
      onSubmit: function () { submitStart(); return false; }
    });
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

  function setBusy(on) {
    var el = $('#ph-busy');
    if (el) el.hidden = !on;
    $$('#modal-foot button').forEach(function (b) { b.disabled = !!on; });
  }

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
    if (!AI.getKey()) { err.textContent = AI.MSG.nokey; return; }
    if (!online()) { err.textContent = AI.MSG.offline; return; }
    var ctl = typeof AbortController === 'function' ? new AbortController() : { abort: function () {}, signal: null };
    S.busy = ctl;
    err.textContent = '';
    setBusy(true);
    AI.recognize({
      images: S.photos.map(function (p) { return { mime: p.mime, data: p.data }; }),
      refs: sizeRefs(), hint: S.hint, totalWeight: ctx.parseNum(S.totalWeight), learned: learnedForPrompt(),
      signal: ctl.signal
    }).then(function (res) {
      S.busy = null;
      if (!ctx.Modal.isOpen()) return; // окно закрыли во время ожидания
      showDraft(res);
    }, function (e) {
      S.busy = null;
      if (!ctx.Modal.isOpen()) return;
      setBusy(false);
      if (e && e.code === 'cancel') { renderStart(); return; }
      renderStart(e && e.message ? e.message : AI.MSG.unknown + e);
    });
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
      dish: matchDish(result.dish),
      mode: 'items',
      picker: null // {row: index | 'new', query}
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

  function rowHtml(r, i) {
    if (r.removed) return '';
    var v = rowValues(r), k = r.grams / 100;
    var title = r.product
      ? '<span class="ph-prod">' + esc(r.product.name) + '</span>' + (r.fromMemory ? ' <span class="badge badge-custom" title="Вы выбирали этот продукт раньше">ваш выбор</span>' : '')
      : '<span class="ph-prod">' + esc(r.ai.name) + '</span> <span class="badge ph-ai" title="Продукт не найден в базе — значения от ИИ, оценка">≈ ИИ</span>';
    var aiLine = r.product && ctx.normName(r.product.name) !== ctx.normName(r.aiName) ? '<div class="ph-ai-name">ИИ: «' + esc(r.aiName) + '»</div>' : '';
    var extra = '';
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
      '</div>' + picker +
      '</li>';
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
      '<p class="hint">Проверьте названия и граммы — ИИ часто ошибается в размере порции и не видит масло и соусы. Ккал, БЖУ и ГИ берутся из базы приложения; «≈ ИИ» — оценка ИИ.</p>' +
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
      if (a === 'remove') { d.rows[i].removed = true; rerenderDraft(); }
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
      r.product = snap; r.fromMemory = false; r.replaced = true;
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
    });
    if (out.length) ctx.memorySave(out);
  }

  // =====================================================================
  // Настройки: ключ, модель, эталоны размера, память
  // =====================================================================
  function settingsHtml() {
    var p = settingsParts();
    return p.ai + p.refs + p.mem;
  }

  /** Три блока настроек: {ai, refs, mem} — чтобы приложение могло разложить их по колонкам */
  function settingsParts() {
    var key = AI.getKey(), model = AI.getModel(), models = cachedModels();
    if (models.indexOf(model) < 0) models = [model].concat(models);
    var refs = sizeRefs(), mem = ctx.memoryList ? ctx.memoryList() : [];
    var out = {};
    out.ai = '<section class="card settings-section" id="ai-card"><h3>Распознавание по фото</h3>' +
      '<p class="small muted">Кнопка «По фото» в дневнике. Можно использовать бесплатный ключ Google Gemini или режим «Через любой чат-ИИ» (без ключа: запрос копируется, ответ вставляется).</p>' +
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
      '</ol><p>Если появится сообщение, что сервис недоступен в вашем регионе, используйте режим «Через любой чат-ИИ».</p>' +
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
      st.textContent = 'Проверяю…';
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
        if (s2) s2.textContent = 'Ключ работает ✓ Доступно моделей: ' + res.models.length + '. Ключ сохранён.';
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
    return false;
  }

  return {
    init: init, open: open,
    settingsHtml: settingsHtml, settingsParts: settingsParts, onSettingsAction: onSettingsAction, onSettingsChange: onSettingsChange,
    DEFAULT_REFS: DEFAULT_REFS,
    // для тестов
    _buildRows: buildRows, _totals: totals, _matchProduct: matchProduct, _matchDish: matchDish, _state: function () { return S; }
  };
})();
