/*
 * Дневник питания и сахара — основная логика интерфейса.
 * Зависит от: FOODS / FOOD_CATEGORIES (foods.js), Store (storage.js), Charts (charts.js).
 */
(function () {
  'use strict';

  // =====================================================================
  // Константы
  // =====================================================================
  var MEALS = [
    { key: 'breakfast', label: 'Завтрак', color: '--series-1' },
    { key: 'lunch', label: 'Обед', color: '--series-2' },
    { key: 'dinner', label: 'Ужин', color: '--series-3' },
    { key: 'snack', label: 'Перекус', color: '--series-4' }
  ];
  var MEAL_LABEL = {};
  MEALS.forEach(function (m) { MEAL_LABEL[m.key] = m.label; });

  var CONTEXTS = [
    { key: 'fasting', label: 'Натощак' },
    { key: 'before', label: 'До еды' },
    { key: 'after1', label: 'Через 1 ч после еды' },
    { key: 'after2', label: 'Через 2 ч после еды' },
    { key: 'bedtime', label: 'Перед сном' },
    { key: 'night', label: 'Ночью' },
    { key: 'other', label: 'Другое' }
  ];
  var CTX_LABEL = {};
  CONTEXTS.forEach(function (c) { CTX_LABEL[c.key] = c.label; });

  var MGDL = 18.016; // 1 ммоль/л = 18,016 мг/дл

  var STATUS = {
    low: { label: 'Низкий', cls: 'st-low', color: '--g-low' },
    ok: { label: 'В целевом диапазоне', cls: 'st-ok', color: '--g-ok' },
    high: { label: 'Высокий', cls: 'st-high', color: '--g-high' },
    vhigh: { label: 'Очень высокий', cls: 'st-vhigh', color: '--g-vhigh' }
  };

  var MACRO_COLORS = { p: '--series-1', f: '--series-2', c: '--series-3' };

  /*
   * Виды физической активности и их MET (метаболический эквивалент) для низкой / средней / высокой
   * интенсивности — по Compendium of Physical Activities (Ainsworth et al., 2011).
   * Расход энергии: ккал = MET × вес (кг) × длительность (ч).
   */
  var ACTIVITY_GROUPS = [
    ['Ходьба и бег', [
      ['walk_slow', 'Ходьба медленная (3–4 км/ч)', 2.8, 3.0, 3.5],
      ['walk_brisk', 'Ходьба быстрая (5–6 км/ч)', 3.5, 4.3, 5.0],
      ['nordic', 'Скандинавская ходьба', 4.0, 4.8, 6.0],
      ['hiking', 'Поход, прогулка по пересечённой местности', 5.3, 6.0, 7.8],
      ['dog', 'Прогулка с собакой', 3.0, 3.5, 4.0],
      ['stairs', 'Подъём по лестнице', 4.0, 6.0, 8.8],
      ['run_jog', 'Бег трусцой (до 8 км/ч)', 6.0, 7.0, 8.3],
      ['run_mid', 'Бег 9–10 км/ч', 8.8, 9.8, 10.5],
      ['run_fast', 'Бег 11–12 км/ч и быстрее', 10.5, 11.0, 11.8]
    ]],
    ['Велосипед и тренажёры', [
      ['bike_leisure', 'Велосипед прогулочный (до 16 км/ч)', 3.5, 4.0, 5.8],
      ['bike_mid', 'Велосипед 16–22 км/ч', 6.8, 8.0, 10.0],
      ['ex_bike', 'Велотренажёр', 3.5, 6.8, 8.8],
      ['elliptical', 'Эллиптический тренажёр', 4.0, 5.0, 6.0],
      ['rowing', 'Гребной тренажёр', 4.8, 7.0, 8.5],
      ['treadmill', 'Беговая дорожка (ходьба в горку)', 4.5, 5.3, 6.5]
    ]],
    ['Вода', [
      ['swim_leisure', 'Плавание спокойное', 4.8, 6.0, 8.3],
      ['swim_sport', 'Плавание спортивное (кроль)', 5.8, 8.3, 9.8],
      ['aqua', 'Аквааэробика', 3.5, 5.3, 6.0],
      ['kayak', 'Гребля, байдарка', 3.5, 5.8, 8.0]
    ]],
    ['Фитнес', [
      ['strength', 'Силовая тренировка (тренажёры, гантели)', 3.5, 5.0, 6.0],
      ['bodyweight', 'Упражнения с собственным весом', 3.8, 5.0, 8.0],
      ['aerobics', 'Аэробика, фитнес-класс', 5.0, 6.5, 7.3],
      ['zumba', 'Зумба, танцевальный фитнес', 5.5, 6.5, 7.5],
      ['dance', 'Танцы', 3.0, 5.0, 7.8],
      ['yoga', 'Йога', 2.3, 2.5, 4.0],
      ['pilates', 'Пилатес', 2.8, 3.0, 3.8],
      ['stretching', 'Растяжка', 2.0, 2.3, 2.8],
      ['morning', 'Утренняя зарядка, гимнастика', 2.8, 3.5, 4.5],
      ['lfk', 'ЛФК (лечебная физкультура)', 2.0, 2.5, 3.5]
    ]],
    ['Спортивные игры', [
      ['football', 'Футбол', 5.0, 7.0, 10.0],
      ['volleyball', 'Волейбол', 3.0, 4.0, 6.0],
      ['basketball', 'Баскетбол', 4.5, 6.5, 8.0],
      ['tennis', 'Теннис', 5.0, 7.3, 8.0],
      ['table_tennis', 'Настольный теннис', 3.0, 4.0, 5.0],
      ['badminton', 'Бадминтон', 4.5, 5.5, 7.0],
      ['martial', 'Единоборства, бокс', 5.3, 7.8, 10.3],
      ['climbing', 'Скалолазание', 5.8, 7.5, 8.0]
    ]],
    ['Зимние виды', [
      ['ski_xc', 'Лыжи беговые', 6.8, 9.0, 12.5],
      ['ski_alpine', 'Горные лыжи, сноуборд', 4.3, 5.3, 8.0],
      ['skating', 'Коньки', 5.5, 7.0, 9.0],
      ['rollers', 'Ролики', 6.0, 7.5, 9.8]
    ]],
    ['Дом и сад', [
      ['garden', 'Работа в саду и огороде', 3.5, 3.8, 5.0],
      ['snow', 'Уборка снега лопатой', 5.3, 5.3, 7.5],
      ['cleaning', 'Уборка дома', 2.3, 3.3, 3.8],
      ['housework', 'Лёгкие домашние дела, готовка', 2.0, 2.5, 3.0],
      ['carrying', 'Переноска тяжестей, покупок', 3.0, 4.5, 6.0]
    ]]
  ];
  var ACTIVITY = {};
  ACTIVITY_GROUPS.forEach(function (g) {
    g[1].forEach(function (a) { ACTIVITY[a[0]] = { key: a[0], name: a[1], met: { low: a[2], mid: a[3], high: a[4] } }; });
  });
  var INTENSITY = [
    { key: 'low', label: 'Низкая' },
    { key: 'mid', label: 'Средняя' },
    { key: 'high', label: 'Высокая' }
  ];
  var INTENSITY_LABEL = { low: 'низкая', mid: 'средняя', high: 'высокая' };
  var DEFAULT_WEIGHT = 70;
  var ACTIVE_DAY_MIN = 30; // «активный день» — не меньше 30 минут активности

  var ICON = {
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    del: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    run: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="14" cy="4.5" r="2"/><path d="M8 21l3-6 3 2v5M6 12l3-4 4 1 3 4h3M11 15l-1-4"/></svg>',
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    drop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c4.5 5.5 7 9.3 7 12a7 7 0 0 1-14 0c0-2.7 2.5-6.5 7-12z"/></svg>'
  };

  // =====================================================================
  // Утилиты
  // =====================================================================
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** Экранирование текста для вставки в HTML (и в атрибуты) */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Число из строки: принимает запятую как десятичный разделитель («5,6») */
  function parseNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v == null) return NaN;
    var s = String(v).trim().replace(/[\s  ]/g, '').replace(',', '.');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return parseFloat(s);
  }

  /** Форматирование числа по-русски (запятая, пробел в тысячах) */
  function fmt(n, digits, fixed) {
    if (n == null || !isFinite(n)) return '—';
    var d = digits || 0;
    var v = Number(n);
    if (Math.abs(v) < 0.5 * Math.pow(10, -d)) v = 0; // без «-0»
    return v.toLocaleString('ru-RU', { minimumFractionDigits: fixed ? d : 0, maximumFractionDigits: d });
  }
  function fmtInt(n) { return fmt(Math.round(n), 0); }
  function fmt1(n) { return fmt(n, 1); }
  function round1(n) { return Math.round(n * 10) / 10; }

  /** Значение для поля ввода (без разделителя тысяч, с запятой) */
  function inputNum(n) {
    if (n == null || !isFinite(n)) return '';
    return String(round1(n)).replace('.', ',');
  }

  // ---------- Даты (локальное время, строки YYYY-MM-DD) ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateToStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return dateToStr(new Date()); }
  function strToDate(s, h, m) {
    var p = s.split('-');
    // полдень по умолчанию — защита от сдвигов при переходе на летнее время
    return new Date(+p[0], +p[1] - 1, +p[2], h == null ? 12 : h, m || 0);
  }
  function addDays(s, n) { var d = strToDate(s); d.setDate(d.getDate() + n); return dateToStr(d); }
  function isDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(strToDate(s).getTime()); }
  function isTimeStr(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function nowTime() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtDDMM(s) { var p = s.split('-'); return p[2] + '.' + p[1]; }
  function fmtDDMMYYYY(s) { var p = s.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function weekday(s) { return strToDate(s).toLocaleDateString('ru-RU', { weekday: 'long' }); }
  function fmtDateLong(s) { return strToDate(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function dateCaption(s) {
    var t = todayStr();
    var rel = s === t ? 'Сегодня' : s === addDays(t, -1) ? 'Вчера' : s === addDays(t, 1) ? 'Завтра' : '';
    var wd = weekday(s);
    return rel ? rel + ', ' + wd : wd.charAt(0).toUpperCase() + wd.slice(1);
  }

  // ---------- Сахар: единицы и статусы ----------
  function S() { return Store.settings(); }
  function isMgdl() { return S().unit === 'mgdl'; }
  function unitLabel(unit) { return (unit || S().unit) === 'mgdl' ? 'мг/дл' : 'ммоль/л'; }
  /** ммоль/л → строка в текущих единицах */
  function gFmt(mmol, unit) {
    if (mmol == null || !isFinite(mmol)) return '—';
    // округляем так же, как в gStatus, чтобы показанное число и статус всегда совпадали
    return (unit || S().unit) === 'mgdl' ? fmtInt(mmol * MGDL) : fmt(Math.round(mmol * 10) / 10, 1, true);
  }
  function gInput(mmol, unit) {
    return (unit || S().unit) === 'mgdl' ? String(Math.round(mmol * MGDL)) : inputNum(mmol);
  }
  function toMmol(v, unit) { return (unit || S().unit) === 'mgdl' ? v / MGDL : v; }
  /**
   * Статус измерения. Сравниваем с порогами с той же точностью, с какой значения
   * показываются пользователю (мг/дл — целые, ммоль/л — десятые). Иначе, например,
   * 70 мг/дл (= 3,885 ммоль/л) оказывалось «низким», хотя в легенде написано «Низкий: < 70».
   */
  function gStatus(mmol) {
    var s = S();
    var q = isMgdl()
      ? function (x) { return Math.round(x * MGDL); }
      : function (x) { return Math.round(x * 10) / 10; };
    var v = q(mmol);
    if (v < q(s.low)) return 'low';
    if (v > q(s.veryHigh)) return 'vhigh';
    if (v > q(s.high)) return 'high';
    return 'ok';
  }

  // ---------- Питание: расчёты ----------
  /** Значения для порции записи (на grams г) */
  function calc(e) {
    var k = e.grams / 100;
    // ГН = ГИ × углеводы в порции / 100. Если ГИ неприменим (углеводов < 2 г на 100 г) — ГН считаем нулевой,
    // если ГИ просто неизвестен — null («нет данных ГИ»).
    var gl = e.gi != null ? e.gi * e.c * k / 100 : (giNA(e) ? 0 : null);
    return { kcal: e.kcal * k, p: e.p * k, f: e.f * k, c: e.c * k, gl: gl };
  }
  /** ГИ неприменим: почти нет углеводов */
  function giNA(o) { return o.gi == null && (o.giSrc === 'n' || o.c < 2); }
  /** Подпись ГИ: «ГИ 50», «ГИ ≈55» (оценка), «ГИ —» (неприменимо) или '' (нет данных) */
  function giText(o) {
    if (o.gi != null) return 'ГИ ' + (o.giSrc === 'e' ? '≈' : '') + fmtInt(o.gi);
    return giNA(o) ? 'ГИ —' : '';
  }
  function giTitle(o) {
    if (o.gi != null) {
      return o.giSrc === 'e' ? 'Гликемический индекс: оценка по составу'
        : o.giSrc === 'u' ? 'Гликемический индекс: своё значение'
        : o.custom && !o.giSrc ? 'Гликемический индекс: своё значение'
        : 'Гликемический индекс по опубликованным таблицам';
    }
    return giNA(o) ? 'Углеводов почти нет — гликемическая нагрузка близка к нулю' : 'Нет данных ГИ';
  }
  /** Бейдж ГИ для списков (пустая строка, если данных нет) */
  function giBadge(o) {
    var t = giText(o);
    return t ? '<span class="badge" title="' + esc(giTitle(o)) + '">' + t + '</span>' : '';
  }
  function sumEntries(list) {
    return list.reduce(function (t, e) {
      var c = calc(e);
      t.kcal += c.kcal; t.p += c.p; t.f += c.f; t.c += c.c;
      if (c.gl != null) t.gl += c.gl;
      return t;
    }, { kcal: 0, p: 0, f: 0, c: 0, gl: 0 });
  }
  function glClass(gl) {
    if (gl <= 10) return { cls: 'badge-gl-low', label: 'низкая' };
    if (gl < 20) return { cls: 'badge-gl-mid', label: 'средняя' };
    return { cls: 'badge-gl-high', label: 'высокая' };
  }
  function guessMeal() {
    var h = new Date().getHours();
    if (h < 11) return 'breakfast';
    if (h < 16) return 'lunch';
    if (h >= 17 && h < 21) return 'dinner';
    return 'snack';
  }
  function guessContext() {
    var h = new Date().getHours();
    if (h >= 5 && h < 9) return 'fasting';
    if (h >= 22) return 'bedtime';
    if (h < 5) return 'night';
    return 'other';
  }

  // ---------- Продукты ----------
  function norm(s) { return String(s).toLowerCase().replace(/ё/g, 'е'); }

  // Индекс встроенной базы по id — для быстрого findFood при ~2000 продуктах
  var FOOD_BY_ID = {};
  FOODS.forEach(function (f) { FOOD_BY_ID[f.id] = f; });

  /** Свой продукт в формате списка продуктов (с пометкой custom и источником ГИ) */
  function customView(f) {
    return { id: f.id, name: f.name, cat: f.cat, kcal: f.kcal, p: f.p, f: f.f, c: f.c, gi: f.gi, giSrc: f.giSrc || (f.gi != null ? 'u' : null), custom: true };
  }

  function allFoods() {
    return Store.list('customFoods').map(customView).concat(FOODS);
  }

  function findFood(id) {
    if (!id) return null;
    if (FOOD_BY_ID[id]) return FOOD_BY_ID[id];
    var list = Store.list('customFoods');
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return customView(list[i]);
    }
    return null;
  }

  /** Сколько раз продукт встречался в дневнике за 60 дней (для поднятия частых в поиске) */
  function usageCounts() {
    var from = addDays(todayStr(), -60), cnt = {};
    Store.list('entries').forEach(function (e) {
      if (e.date >= from) { var k = norm(e.name); cnt[k] = (cnt[k] || 0) + 1; }
    });
    return cnt;
  }

  /**
   * Умный поиск (см. search.js). Возвращает [{f, level, hl}] — продукт и диапазоны для подсветки.
   * Свои продукты и часто используемые поднимаются выше внутри одного уровня совпадения.
   */
  function searchFoods(q, limit, source) {
    var cnt = usageCounts();
    return FoodSearch.search(q, source || allFoods(), {
      limit: limit || 0,
      boost: function (f) { return (f.custom ? 3 : 0) + Math.min(cnt[norm(f.name)] || 0, 10) / 5; }
    });
  }
  function hlName(r) { return FoodSearch.highlight(r.f.name, r.hl, esc); }

  /** Актуальная версия продукта для записи (если продукт ещё существует), иначе снимок из записи */
  function foodOfEntry(e) {
    var cur = findFood(e.productId);
    return cur && cur.name === e.name ? cur : snapshotOf(e);
  }

  /**
   * Недавно добавленные продукты (из дневника). Порядок — по порядку добавления записей,
   * а не по дате записи: иначе запись «задним числом» не попадала бы в недавние,
   * а запись на завтра навсегда оставалась бы первой.
   */
  function recentFoods(n) {
    var seen = {}, out = [];
    var list = Store.list('entries');
    for (var i = list.length - 1; i >= 0 && out.length < n; i--) {
      var e = list[i], key = norm(e.name);
      if (seen[key]) continue;
      seen[key] = true;
      out.push(foodOfEntry(e));
    }
    return out;
  }

  /** Часто используемые продукты за последние 60 дней (кроме exclude) */
  function frequentFoods(n, exclude) {
    var skip = {}, cnt = {}, last = {};
    (exclude || []).forEach(function (f) { skip[norm(f.name)] = true; });
    var from = addDays(todayStr(), -60);
    Store.list('entries').forEach(function (e) {
      if (e.date < from) return;
      var key = norm(e.name);
      if (skip[key]) return;
      cnt[key] = (cnt[key] || 0) + 1;
      last[key] = e;
    });
    return Object.keys(cnt).filter(function (k) { return cnt[k] >= 2; })
      .sort(function (a, b) { return cnt[b] - cnt[a] || a.localeCompare(b, 'ru'); })
      .slice(0, n).map(function (k) { return foodOfEntry(last[k]); });
  }

  /** Снимок продукта для записи дневника */
  function snapshotOf(o) {
    return {
      productId: o.productId !== undefined ? o.productId : (o.id || null),
      name: o.name, kcal: o.kcal, p: o.p, f: o.f, c: o.c, gi: o.gi == null ? null : o.gi,
      giSrc: o.giSrc || null,
      custom: !!o.custom
    };
  }

  // =====================================================================
  // Состояние
  // =====================================================================
  var state = {
    view: 'diary',
    date: todayStr(),
    period: 7,
    foodQuery: '',
    foodCat: '',
    onlyCustom: false,
    foodShown: 100, // сколько продуктов показано в списке (кнопка «Показать ещё»)
    stats: null // последние рассчитанные данные для графиков
  };
  var FOOD_PAGE = 100, PICK_PAGE = 30;

  // =====================================================================
  // Уведомления
  // =====================================================================
  var toastTimer = null;
  function toast(msg, isError) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, isError ? 4500 : 2600);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    $('#toast').hidden = true;
  }
  /** Сообщить об ошибке записи в localStorage (если хранилище в принципе доступно) */
  function checkSaved(ok) {
    if (!ok && Store.available) toast('Не удалось сохранить данные в браузере (возможно, хранилище переполнено).', true);
  }

  // =====================================================================
  // Модальное окно
  // =====================================================================
  var Modal = (function () {
    var overlay = $('#modal'), titleEl = $('#modal-title'), body = $('#modal-body'),
      foot = $('#modal-foot'), form = $('#modal-form'), dialog = $('#modal .modal');
    var submitFn = null, lastFocus = null, openId = 0;

    function open(opts) {
      openId++;
      if (overlay.hidden) lastFocus = document.activeElement;
      titleEl.textContent = opts.title || '';
      body.innerHTML = opts.html || '';
      foot.innerHTML = '';
      (opts.buttons || []).forEach(function (b) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn ' + (b.cls || '');
        btn.textContent = b.label;
        btn.addEventListener('click', function () { b.onClick(); });
        foot.appendChild(btn);
      });
      if (opts.cancelLabel !== null) {
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn';
        cancel.textContent = opts.cancelLabel || 'Отмена';
        cancel.addEventListener('click', close);
        foot.appendChild(cancel);
      }
      if (opts.submitLabel) {
        var sb = document.createElement('button');
        sb.type = 'submit';
        sb.className = 'btn ' + (opts.submitCls || 'btn-primary');
        sb.textContent = opts.submitLabel;
        foot.appendChild(sb);
      }
      submitFn = opts.onSubmit || null;
      overlay.hidden = false;
      document.body.style.overflow = 'hidden';
      Charts.hideTip();
      if (opts.onOpen) opts.onOpen(body);
      // на сенсорных экранах не открываем клавиатуру автоматически
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      var first = body.querySelector('[data-autofocus]') || body.querySelector('input, select, textarea');
      if (first && !coarse) first.focus();
      else { dialog.setAttribute('tabindex', '-1'); dialog.focus(); }
    }

    function close() {
      if (overlay.hidden) return;
      overlay.hidden = true;
      body.innerHTML = '';
      foot.innerHTML = '';
      submitFn = null;
      document.body.style.overflow = '';
      var target = lastFocus;
      // кнопка, открывшая окно, могла быть перерисована — ищем такую же по data-атрибутам
      if (target && !document.body.contains(target) && target.getAttribute && target.getAttribute('data-action')) {
        var sel = '[data-action="' + target.getAttribute('data-action') + '"]';
        ['data-id', 'data-meal'].forEach(function (a) {
          var v = target.getAttribute(a);
          if (v) sel += '[' + a + '="' + v.replace(/["\\]/g, '\\$&') + '"]';
        });
        try { target = document.querySelector(sel); } catch (e) { target = null; }
      }
      if (target && target.focus && document.body.contains(target)) {
        try { target.focus(); } catch (e) { /* ignore */ }
      }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!submitFn) return;
      var id = openId;
      var res = submitFn(body);
      // если обработчик открыл другое окно — не закрываем его
      if (res !== false && id === openId) close();
    });

    // закрытие по клику на фон (только если и нажатие, и отпускание — на фоне)
    var downOnOverlay = false;
    overlay.addEventListener('mousedown', function (e) { downOnOverlay = e.target === overlay; });
    overlay.addEventListener('click', function (e) { if (e.target === overlay && downOnOverlay) close(); });
    overlay.addEventListener('click', function (e) { if (e.target.closest('[data-modal-close]')) close(); });

    document.addEventListener('keydown', function (e) {
      if (overlay.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Tab') { // простая «ловушка фокуса»
        var f = $$('button, input, select, textarea, [tabindex]:not([tabindex="-1"])', dialog)
          .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
        if (!f.length) return;
        var firstEl = f[0], lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    });

    return { open: open, close: close, isOpen: function () { return !overlay.hidden; } };
  })();

  /** Показать ошибку формы в модальном окне. Возвращает false (окно остаётся открытым). */
  function formError(msg, fieldId) {
    var el = $('#form-error');
    if (el) el.textContent = msg || '';
    $$('#modal-body .invalid').forEach(function (x) { x.classList.remove('invalid'); });
    if (fieldId) {
      var f = document.getElementById(fieldId);
      if (f) { f.classList.add('invalid'); f.focus(); }
    }
    return false;
  }

  // =====================================================================
  // Навигация
  // =====================================================================
  var VIEWS = ['diary', 'glucose', 'stats', 'foods', 'settings'];

  function viewFromHash() {
    var h = (location.hash || '').replace('#', '');
    return VIEWS.indexOf(h) >= 0 ? h : 'diary';
  }

  function showView(v) {
    if (VIEWS.indexOf(v) < 0) v = 'diary';
    var changed = state.view !== v;
    state.view = v;
    VIEWS.forEach(function (x) { $('#view-' + x).hidden = x !== v; });
    $$('.tab').forEach(function (t) {
      var a = t.getAttribute('data-view') === v;
      t.classList.toggle('active', a);
      if (a) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    Charts.hideTip();
    renderView(v);
    if (changed) window.scrollTo(0, 0);
  }

  function renderView(v) {
    switch (v || state.view) {
      case 'diary': renderDiary(); break;
      case 'glucose': renderGlucose(); break;
      case 'stats': renderStats(); break;
      case 'foods': renderFoods(); break;
      case 'settings': renderSettings(); break;
    }
  }

  function setDate(s) {
    if (!isDateStr(s)) return;
    state.date = s;
    renderView();
  }

  function renderDatebars() {
    $$('.date-input').forEach(function (inp) { inp.value = state.date; });
    $$('.date-caption').forEach(function (el) { el.textContent = dateCaption(state.date); });
    var isToday = state.date === todayStr();
    $$('.today-btn').forEach(function (b) { b.disabled = isToday; });
  }

  function emptyState(icon, text, actionsHtml) {
    return '<div class="empty-state">' + icon + '<p>' + text + '</p>' + (actionsHtml || '') + '</div>';
  }

  function actionBtns(kind, id, extraTitle) {
    return '<div class="entry-actions">' +
      '<button type="button" class="icon-btn" data-action="edit-' + kind + '" data-id="' + esc(id) + '" aria-label="Изменить' + esc(extraTitle ? ' «' + extraTitle + '»' : '') + '" title="Изменить">' + ICON.edit + '</button>' +
      '<button type="button" class="icon-btn danger" data-action="del-' + kind + '" data-id="' + esc(id) + '" aria-label="Удалить' + esc(extraTitle ? ' «' + extraTitle + '»' : '') + '" title="Удалить">' + ICON.del + '</button>' +
      '</div>';
  }

  // =====================================================================
  // ДНЕВНИК ПИТАНИЯ
  // =====================================================================
  function dayEntries(date) {
    return Store.list('entries').filter(function (e) { return e.date === date; })
      .sort(function (a, b) { return a.time.localeCompare(b.time); });
  }

  function macroBlock(label, val, goal, color) {
    var pct = goal ? Math.min(100, val / goal * 100) : 0;
    return '<div class="macro">' +
      '<div class="macro-label"><span class="dot" style="background:var(' + color + ')"></span>' + label + '</div>' +
      '<div class="macro-val">' + fmt1(val) + ' г' + (goal ? ' <span class="muted small">/ ' + fmt1(goal) + '</span>' : '') + '</div>' +
      (goal ? '<div class="progress thin' + (val > goal ? ' over' : '') + '"><div style="width:' + pct.toFixed(1) + '%;background:var(' + (val > goal ? '--g-vhigh' : color) + ')"></div></div>' : '') +
      '</div>';
  }

  function entryHtml(e) {
    var c = calc(e);
    var badges = (e.src === 'ai' ? '<span class="badge ph-ai" title="Продукт не найден в базе — ккал и БЖУ оценены ИИ по фото">≈ ИИ</span>' : '') + giBadge(e);
    if (e.gi != null) {
      var g = glClass(c.gl);
      badges += '<span class="badge ' + g.cls + '" title="Гликемическая нагрузка порции: ' + g.label + '">ГН ' + fmt1(c.gl) + '</span>';
    }
    return '<li class="entry">' +
      '<div class="entry-main">' +
        '<div class="entry-name">' + esc(e.name) + '</div>' +
        '<div class="entry-meta">' + esc(e.time) + ' · ' + fmt1(e.grams) + ' г · Б ' + fmt1(c.p) + ' · Ж ' + fmt1(c.f) + ' · У ' + fmt1(c.c) + '</div>' +
      '</div>' +
      '<div class="entry-side">' +
        '<div class="entry-kcal">' + fmtInt(c.kcal) + ' <small>ккал</small></div>' +
        (badges ? '<div class="badges">' + badges + '</div>' : '') +
      '</div>' +
      actionBtns('entry', e.id, e.name) +
      '</li>';
  }

  /**
   * Записи приёма пищи: ингредиенты блюда, распознанного по фото (общий dishId), показываются
   * свёрнутой строкой «блюдо — итог»; раскрывается по нажатию. Остальные записи — как обычно.
   */
  function mealItemsHtml(items) {
    var groups = {}, html = '';
    items.forEach(function (e) { if (e.dishId) (groups[e.dishId] = groups[e.dishId] || []).push(e); });
    var done = {};
    items.forEach(function (e) {
      var g = e.dishId && groups[e.dishId];
      if (!g || g.length < 2) { html += entryHtml(e); return; }
      if (done[e.dishId]) return;
      done[e.dishId] = true;
      var t = sumEntries(g), grams = g.reduce(function (s0, x) { return s0 + x.grams; }, 0);
      html += '<li class="dish-row"><details class="dish-group">' +
        '<summary><span class="dish-title">' + esc(e.dishName || e.name) + '</span>' +
        '<span class="dish-sum">' + esc(g[0].time) + ' · ' + fmtInt(grams) + ' г · <b>' + fmtInt(t.kcal) + '</b> ккал</span></summary>' +
        '<p class="small muted" style="margin:0 0 4px 18px">Б ' + fmt1(t.p) + ' · Ж ' + fmt1(t.f) + ' · У ' + fmt1(t.c) + ' г' +
          (t.gl > 0 ? ' · ГН ' + fmt1(t.gl) : '') + ' · ингредиентов: ' + g.length + '</p>' +
        '<ul class="list">' + g.map(entryHtml).join('') + '</ul>' +
        '<div class="dish-actions"><button type="button" class="btn btn-ghost btn-sm danger-text" data-action="del-dish" data-id="' + esc(e.dishId) + '">' +
          ICON.del + ' Удалить блюдо целиком</button></div></details></li>';
    });
    return html;
  }

  function renderDiary() {
    renderDatebars();
    var s = S();
    var list = dayEntries(state.date);
    var tot = sumEntries(list);
    var pct = s.kcalGoal ? tot.kcal / s.kcalGoal * 100 : 0;
    var diff = s.kcalGoal - tot.kcal;
    var hasGl = list.some(function (e) { return e.gi != null; });
    var acts = dayActivity(state.date);
    var burned = acts.reduce(function (a, x) { return a + x.kcal; }, 0);
    var actMin = acts.reduce(function (a, x) { return a + x.minutes; }, 0);

    var html = '<div class="card">' +
      '<div class="summary-top">' +
        '<div><div class="muted small">Калории за день</div>' +
        '<div class="big">' + fmtInt(tot.kcal) + ' <small>/ ' + fmtInt(s.kcalGoal) + ' ккал</small></div></div>' +
        '<div class="small ' + (diff < 0 ? '' : 'muted') + '">' +
          (diff >= 0 ? 'Осталось ' + fmtInt(diff) + ' ккал' : 'Превышение на ' + fmtInt(-diff) + ' ккал') +
          ' · ' + fmtInt(pct) + '%</div>' +
      '</div>' +
      '<div class="progress' + (pct > 100 ? ' over' : '') + '" role="progressbar" aria-label="Калории от дневной цели" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.min(100, Math.round(pct)) + '">' +
        '<div style="width:' + Math.min(100, pct).toFixed(1) + '%"></div></div>' +
      '<div class="balance" title="Цель по калориям считается по съеденному; сожжённое активностью показано отдельно">' +
        '<span>Съедено <b>' + fmtInt(tot.kcal) + '</b></span>' +
        '<span>Сожжено активностью <b>' + fmtInt(burned) + '</b>' + (actMin ? ' <span class="muted">(' + actMin + ' мин)</span>' : '') + '</span>' +
        '<span>Баланс <b>' + (tot.kcal - burned > 0 ? '' : tot.kcal - burned < 0 ? '−' : '') + fmtInt(Math.abs(tot.kcal - burned)) + '</b> ккал</span>' +
      '</div>' +
      '<div class="macros">' +
        macroBlock('Белки', tot.p, s.pGoal, MACRO_COLORS.p) +
        macroBlock('Жиры', tot.f, s.fGoal, MACRO_COLORS.f) +
        macroBlock('Углеводы', tot.c, s.cGoal, MACRO_COLORS.c) +
      '</div>' +
      (hasGl ? '<p class="small muted" style="margin:12px 0 0">Гликемическая нагрузка за день: <b>' + fmtInt(tot.gl) + '</b> ' +
        '<span title="Ориентиры: до 80 — низкая, 80–120 — средняя, более 120 — высокая">(' +
        (tot.gl < 80 ? 'низкая' : tot.gl <= 120 ? 'средняя' : 'высокая') + ')</span></p>' : '') +
      '<div class="btn-row diary-actions">' +
        '<button type="button" class="btn btn-primary" data-action="add-entry">' + ICON.plus + ' Добавить запись</button>' +
        '<button type="button" class="btn btn-photo" data-action="photo" title="Распознать блюдо по фото и записать его состав">' +
          '<span class="ph-cam" aria-hidden="true">📷</span> По фото</button>' +
        '<button type="button" class="btn" data-action="copy-meals" title="Скопировать приёмы пищи из другого дня на этот">' + ICON.copy + ' Копировать из другого дня</button>' +
      '</div>' +
      '<p class="hint photo-tip">По фото: для точности положите рядом с тарелкой ладонь (4 пальца) или палец; снимайте сверху или под углом ~45°.</p>' +
      '</div>';
    $('#diary-summary').innerHTML = html;

    var meals = MEALS.map(function (m) {
      var items = list.filter(function (e) { return e.meal === m.key; });
      var t = sumEntries(items);
      return '<section class="card">' +
        '<div class="card-head"><h3><span class="dot" style="background:var(' + m.color + ')"></span>' + m.label + '</h3>' +
        (items.length ? '<div class="meal-sub">' + fmtInt(t.kcal) + ' ккал · Б ' + fmt1(t.p) + ' · Ж ' + fmt1(t.f) + ' · У ' + fmt1(t.c) + '</div>' : '') +
        '</div>' +
        (items.length ? '<ul class="list">' + mealItemsHtml(items) + '</ul>' : '<div class="empty-line">Нет записей</div>') +
        '<div class="meal-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-action="add-entry" data-meal="' + m.key + '">' + ICON.plus + ' Добавить</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-action="copy-meals" data-meal="' + m.key + '" aria-label="Повторить ' + m.label.toLowerCase() + ' из другого дня">' + ICON.copy + ' Повторить</button>' +
        '</div>' +
        '</section>';
    }).join('');
    $('#diary-meals').innerHTML = '<div class="grid-2">' + meals + '</div>' + activityCardHtml(acts, burned, actMin);
  }

  // =====================================================================
  // ФИЗИЧЕСКАЯ АКТИВНОСТЬ
  // =====================================================================
  function dayActivity(date) {
    return Store.list('activity').filter(function (a) { return a.date === date; })
      .sort(function (a, b) { return a.time.localeCompare(b.time); });
  }
  function userWeight() { return S().weight || DEFAULT_WEIGHT; }
  function actMet(type, intensity) {
    var t = ACTIVITY[type];
    return t ? t.met[intensity] || t.met.mid : null;
  }
  /** ккал = MET × вес (кг) × часы */
  function actKcal(met, weight, minutes) { return Math.round(met * weight * minutes / 60); }

  function activityItemHtml(a) {
    var meta = esc(a.time) + ' · ' + a.minutes + ' мин' +
      (a.type !== 'custom' ? ' · интенсивность ' + INTENSITY_LABEL[a.intensity] : '') +
      (a.steps ? ' · ' + fmtInt(a.steps) + ' шагов' : '');
    return '<li class="entry">' +
      '<div class="entry-main">' +
        '<div class="entry-name">' + esc(a.name) + '</div>' +
        '<div class="entry-meta">' + meta + '</div>' +
        (a.note ? '<div class="g-note">' + esc(a.note) + '</div>' : '') +
      '</div>' +
      '<div class="entry-side"><div class="entry-kcal">' + fmtInt(a.kcal) + ' <small>ккал</small></div>' +
        (a.met ? '<div class="badges"><span class="badge" title="Метаболический эквивалент">MET ' + fmt1(a.met) + '</span></div>' : '') +
      '</div>' +
      actionBtns('activity', a.id, a.name) +
      '</li>';
  }

  function activityCardHtml(acts, burned, actMin) {
    return '<section class="card activity-card">' +
      '<div class="card-head"><h3><span class="act-icon">' + ICON.run + '</span>Активность</h3>' +
        (acts.length ? '<div class="meal-sub">' + actMin + ' мин · ' + fmtInt(burned) + ' ккал</div>' : '') + '</div>' +
      (acts.length ? '<ul class="list">' + acts.map(activityItemHtml).join('') + '</ul>'
        : '<div class="empty-line">Нет записей. Ходьба, зарядка, работа в саду — всё считается.</div>') +
      '<div class="meal-actions"><button type="button" class="btn btn-ghost btn-sm" data-action="add-activity">' + ICON.plus + ' Добавить активность</button></div>' +
      '</section>';
  }

  function activityOptionsHtml(selected) {
    return ACTIVITY_GROUPS.map(function (g) {
      return '<optgroup label="' + esc(g[0]) + '">' + g[1].map(function (a) {
        return '<option value="' + a[0] + '"' + (a[0] === selected ? ' selected' : '') + '>' + esc(a[1]) + '</option>';
      }).join('') + '</optgroup>';
    }).join('') +
      '<optgroup label="Другое"><option value="custom"' + (selected === 'custom' ? ' selected' : '') + '>Своя активность (ккал вручную)</option></optgroup>';
  }

  function openActivityModal(item) {
    var isEdit = !!item;
    var s = S();
    var type = item ? (ACTIVITY[item.type] ? item.type : 'custom') : 'walk_brisk';
    var intensity = item ? item.intensity : 'mid';
    var needWeight = !s.weight;
    var html = '<div id="a-wrap">' +
      (needWeight ? '<div class="note-box">Для расчёта расхода энергии нужен ваш вес. Укажите его один раз — он сохранится в «Настройках».' +
        '<div class="field" style="margin:8px 0 0"><label for="a-weight">Вес, кг</label><input id="a-weight" type="text" inputmode="decimal" value="' + DEFAULT_WEIGHT + '"></div></div>' : '') +
      '<div class="field"><label for="a-type">Вид активности</label><select id="a-type">' + activityOptionsHtml(type) + '</select></div>' +
      '<div class="field" id="a-name-field"' + (type === 'custom' ? '' : ' hidden') + '><label for="a-name">Название</label>' +
        '<input id="a-name" type="text" maxlength="100" placeholder="Например, катание на сапборде" value="' + esc(item && type === 'custom' ? item.name : '') + '"></div>' +
      '<div class="row">' +
        '<div class="field"><label for="a-date">Дата</label><input id="a-date" type="date" value="' + esc(item ? item.date : state.date) + '"></div>' +
        '<div class="field"><label for="a-time">Начало</label><input id="a-time" type="time" value="' + esc(item ? item.time : nowTime()) + '"></div>' +
      '</div>' +
      '<div class="row">' +
        '<div class="field"><label for="a-min">Длительность, мин</label><input id="a-min" type="text" inputmode="numeric" data-autofocus value="' + (item ? item.minutes : 30) + '"></div>' +
        '<div class="field" id="a-kcal-field"' + (type === 'custom' ? '' : ' hidden') + '><label for="a-kcal">Сожжено, ккал</label>' +
          '<input id="a-kcal" type="text" inputmode="numeric" value="' + (item && type === 'custom' ? item.kcal : '') + '"></div>' +
        '<div class="field" id="a-steps-field"><label for="a-steps">Шаги (необязательно)</label><input id="a-steps" type="text" inputmode="numeric" value="' + (item && item.steps ? item.steps : '') + '"></div>' +
      '</div>' +
      '<div class="quick" role="group" aria-label="Быстрый выбор длительности">' +
        [15, 30, 45, 60, 90].map(function (m) { return '<button type="button" class="chip" data-min="' + m + '">' + m + ' мин</button>'; }).join('') +
      '</div>' +
      '<fieldset class="field intensity" id="a-int-field"' + (type === 'custom' ? ' hidden' : '') + '><legend class="field-label">Интенсивность</legend><div class="segmented">' +
        INTENSITY.map(function (x) {
          return '<label><input type="radio" name="a-int" value="' + x.key + '"' + (x.key === intensity ? ' checked' : '') + '><span>' + x.label + '</span></label>';
        }).join('') + '</div></fieldset>' +
      '<div id="a-preview" class="preview" aria-live="polite"></div>' +
      '<div class="field"><label for="a-note">Заметка (необязательно)</label><input id="a-note" type="text" maxlength="500" value="' + esc(item ? item.note : '') + '"></div>' +
      '<div id="form-error" class="form-error" role="alert"></div></div>';

    function weightOf(body) {
      var w = needWeight ? parseNum($('#a-weight', body).value) : s.weight;
      return w >= 20 && w <= 300 ? w : null;
    }
    function curInt(body) { var r = $('input[name="a-int"]:checked', body); return r ? r.value : 'mid'; }

    Modal.open({
      title: isEdit ? 'Изменить активность' : 'Новая активность',
      html: html,
      submitLabel: isEdit ? 'Сохранить' : 'Добавить',
      onOpen: function (body) {
        var typeSel = $('#a-type', body);
        function update() {
          var t = typeSel.value, custom = t === 'custom';
          $('#a-name-field', body).hidden = !custom;
          $('#a-kcal-field', body).hidden = !custom;
          $('#a-int-field', body).hidden = custom;
          var prev = $('#a-preview', body), min = parseNum($('#a-min', body).value), w = weightOf(body);
          if (custom) { prev.innerHTML = '<span class="muted">Укажите сожжённые калории вручную (например, по данным часов или трекера).</span>'; return; }
          if (!(min >= 1)) { prev.innerHTML = '<span class="muted">Укажите длительность в минутах.</span>'; return; }
          if (!w) { prev.innerHTML = '<span class="muted">Укажите вес от 20 до 300 кг.</span>'; return; }
          var met = actMet(t, curInt(body));
          prev.innerHTML = '<span>MET: <b>' + fmt1(met) + '</b></span><span>Расход: <b>≈ ' + fmtInt(actKcal(met, w, min)) + ' ккал</b></span>' +
            '<span class="muted small">MET × ' + fmt1(w) + ' кг × ' + fmt(min / 60, 2) + ' ч</span>';
        }
        // слушаем обёртку формы, а не #modal-body (он живёт всё время — обработчики бы копились)
        var wrap = $('#a-wrap', body);
        wrap.addEventListener('input', update);
        wrap.addEventListener('change', update);
        $('.quick', body).addEventListener('click', function (e) {
          var chip = e.target.closest('[data-min]');
          if (chip) { $('#a-min', body).value = chip.getAttribute('data-min'); update(); }
        });
        update();
      },
      onSubmit: function (body) {
        var t = $('#a-type', body).value, custom = t === 'custom';
        var d = $('#a-date', body).value;
        if (!isDateStr(d)) return formError('Укажите корректную дату.', 'a-date');
        var tm = ($('#a-time', body).value || '').slice(0, 5);
        if (!isTimeStr(tm)) return formError('Укажите время в формате ЧЧ:ММ.', 'a-time');
        var min = parseNum($('#a-min', body).value);
        if (!(min >= 1 && min <= 1440)) return formError('Длительность — от 1 до 1440 минут.', 'a-min');
        var stepsRaw = $('#a-steps', body).value.trim(), steps = null;
        if (stepsRaw) {
          steps = parseNum(stepsRaw);
          if (!(steps >= 0 && steps <= 200000)) return formError('Шаги — число от 0 до 200 000 или пустое поле.', 'a-steps');
        }
        var name, met = null, kcal, intensity = custom ? 'mid' : curInt(body);
        if (custom) {
          name = $('#a-name', body).value.trim();
          if (!name) return formError('Укажите название активности.', 'a-name');
          kcal = parseNum($('#a-kcal', body).value);
          if (!(kcal >= 0 && kcal <= 5000)) return formError('Укажите сожжённые калории: от 0 до 5000.', 'a-kcal');
        } else {
          var w = weightOf(body);
          if (!w) return formError('Укажите вес от 20 до 300 кг.', 'a-weight');
          if (needWeight) { checkSaved(Store.saveSettings(Object.assign({}, S(), { weight: round1(w) }))); }
          name = ACTIVITY[t].name;
          met = actMet(t, intensity);
          kcal = actKcal(met, w, min);
        }
        var rec = {
          id: item ? item.id : Store.genId('a'), date: d, time: tm, type: t, name: name,
          minutes: Math.round(min), intensity: intensity, met: met, kcal: Math.round(kcal),
          steps: steps, note: $('#a-note', body).value
        };
        if (item && item.demo) rec.demo = true;
        var r = Store.upsert('activity', rec);
        if (!r.item) return formError('Не удалось сохранить: проверьте значения.');
        checkSaved(r.ok);
        state.date = d;
        renderView();
        toast(isEdit ? 'Активность обновлена' : 'Активность добавлена: ' + fmtInt(rec.kcal) + ' ккал');
      }
    });
  }

  function deleteActivity(id) {
    var a = Store.get('activity', id);
    if (!a) return;
    if (!window.confirm('Удалить запись «' + a.name + '» (' + a.minutes + ' мин)?')) return;
    checkSaved(Store.remove('activity', id));
    renderView();
    toast('Запись активности удалена');
  }

  // ---------- Окно добавления / редактирования записи ----------
  function openEntryModal(entry, preset) {
    preset = preset || {};
    var isEdit = !!entry;
    var sel = preset.product ? snapshotOf(preset.product) : entry ? snapshotOf(entry) : null;
    var meal = preset.meal || (entry && entry.meal) || guessMeal();
    var date = preset.date || (entry && entry.date) || state.date;
    var time = preset.time || (entry && entry.time) || nowTime();
    var grams = preset.grams || (entry && entry.grams) || 100;

    var html =
      '<div class="row">' +
        '<div class="field"><label for="e-meal">Приём пищи</label><select id="e-meal">' +
          MEALS.map(function (m) { return '<option value="' + m.key + '"' + (m.key === meal ? ' selected' : '') + '>' + m.label + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="field"><label for="e-date">Дата</label><input id="e-date" type="date" value="' + esc(date) + '"></div>' +
      '</div>' +
      '<div class="field">' +
        '<label for="e-product">Продукт</label>' +
        '<input id="e-product" type="text" autocomplete="off" spellcheck="false"' + (sel ? '' : ' data-autofocus') + ' ' +
          'placeholder="Начните вводить: гречка, яблоко…" role="combobox" aria-autocomplete="list" ' +
          'aria-expanded="false" aria-controls="e-results" value="' + (sel ? esc(sel.name) : '') + '">' +
        '<ul id="e-results" class="search-results" role="listbox" aria-label="Найденные продукты"></ul>' +
        '<div id="e-selected"></div>' +
      '</div>' +
      '<div class="row">' +
        '<div class="field"><label for="e-grams">Количество, г</label><input id="e-grams" type="text" inputmode="decimal"' + (sel ? ' data-autofocus' : '') + ' value="' + inputNum(grams) + '"></div>' +
        '<div class="field"><label for="e-time">Время</label><input id="e-time" type="time" value="' + esc(time) + '"></div>' +
      '</div>' +
      '<div class="quick" role="group" aria-label="Быстрый выбор веса">' +
        [50, 100, 150, 200, 250, 300].map(function (g) { return '<button type="button" class="chip" data-grams="' + g + '">' + g + ' г</button>'; }).join('') +
      '</div>' +
      '<div id="e-preview" class="preview" aria-live="polite"></div>' +
      '<div id="form-error" class="form-error" role="alert"></div>';

    Modal.open({
      title: isEdit ? 'Изменить запись' : 'Новая запись',
      html: html,
      submitLabel: isEdit ? 'Сохранить' : 'Добавить',
      onOpen: function (body) {
        var input = $('#e-product', body), ul = $('#e-results', body), gramsIn = $('#e-grams', body);
        var results = [], active = -1, shown = PICK_PAGE, searchTimer = null;

        function itemHtml(f, i, hl) {
          var gt = giText(f);
          return '<li role="option" id="e-opt-' + i + '" data-idx="' + i + '">' +
            '<span class="sr-name">' + (hl ? FoodSearch.highlight(f.name, hl, esc) : esc(f.name)) + (f.custom ? ' <span class="badge badge-custom">мой</span>' : '') + '</span>' +
            '<span class="sr-meta">' + fmtInt(f.kcal) + ' ккал' + (gt ? ' · ' + gt : '') + '</span></li>';
        }

        /** more = true — догрузить следующую порцию результатов («Показать ещё») */
        function renderResults(more) {
          var q = input.value.trim();
          var h = '';
          if (!q) {
            var rec = recentFoods(6), freq = frequentFoods(6, rec);
            results = rec.concat(freq);
            if (rec.length) h += '<li class="group" role="presentation">Недавние</li>' + rec.map(function (f, j) { return itemHtml(f, j); }).join('');
            if (freq.length) h += '<li class="group" role="presentation">Часто</li>' + freq.map(function (f, j) { return itemHtml(f, rec.length + j); }).join('');
          } else {
            if (!more) shown = PICK_PAGE;
            var found = searchFoods(q, 0);
            var page = found.slice(0, shown);
            results = page.map(function (r) { return r.f; });
            h = page.map(function (r, j) { return itemHtml(r.f, j, r.hl); }).join('');
            if (found.length > shown) {
              h += '<li class="more" role="presentation"><button type="button" class="btn btn-sm btn-ghost" data-more-results>Показать ещё (' + (found.length - shown) + ')</button></li>';
            }
            h += '<li class="empty" role="presentation">' +
              (results.length ? '' : '<span>Ничего не найдено.</span>') +
              '<button type="button" class="btn btn-sm" data-create-food>' + ICON.plus + ' Создать продукт «' + esc(q.slice(0, 60)) + '»</button></li>';
          }
          ul.innerHTML = h;
          if (!more || active < 0) active = results.length ? 0 : -1;
          highlight();
          input.setAttribute('aria-expanded', h ? 'true' : 'false');
        }

        function hideResults() {
          ul.innerHTML = '';
          results = [];
          active = -1;
          input.setAttribute('aria-expanded', 'false');
          input.removeAttribute('aria-activedescendant');
        }

        function highlight() {
          $$('li[data-idx]', ul).forEach(function (li) {
            var on = +li.getAttribute('data-idx') === active;
            li.classList.toggle('active', on);
            li.setAttribute('aria-selected', on ? 'true' : 'false');
            if (on) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
          });
        }

        function choose(i) {
          var f = results[i];
          if (!f) return;
          sel = snapshotOf(f);
          input.value = sel.name;
          hideResults();
          update();
          gramsIn.focus();
          gramsIn.select();
        }

        function update() {
          var selBox = $('#e-selected', body), prev = $('#e-preview', body);
          if (!sel) {
            selBox.innerHTML = '';
            prev.innerHTML = '<span class="muted">Выберите продукт из списка и укажите вес.</span>';
            return;
          }
          var gt = giText(sel);
          selBox.innerHTML = '<div class="selected-product"><span>На 100 г: ' + fmtInt(sel.kcal) + ' ккал · Б ' + fmt1(sel.p) +
            ' · Ж ' + fmt1(sel.f) + ' · У ' + fmt1(sel.c) + ' · <span title="' + esc(giTitle(sel)) + '">' + (gt || 'нет данных ГИ') + '</span>' +
            (sel.gi != null && sel.giSrc === 'e' ? ' <span class="muted">(оценка по составу)</span>' : '') + '</span></div>';
          var g = parseNum(gramsIn.value);
          if (!(g > 0)) { prev.innerHTML = '<span class="muted">Укажите количество в граммах.</span>'; return; }
          var c = calc({ grams: g, kcal: sel.kcal, p: sel.p, f: sel.f, c: sel.c, gi: sel.gi, giSrc: sel.giSrc });
          var glHtml = '';
          if (sel.gi != null) {
            var gc = glClass(c.gl);
            glHtml = '<span>ГН: <b>' + fmt1(c.gl) + '</b> <span class="badge ' + gc.cls + '">' + gc.label + '</span></span>';
          }
          prev.innerHTML = '<span>Калории: <b>' + fmtInt(c.kcal) + ' ккал</b></span>' +
            '<span>Б: <b>' + fmt1(c.p) + ' г</b></span><span>Ж: <b>' + fmt1(c.f) + ' г</b></span><span>У: <b>' + fmt1(c.c) + ' г</b></span>' +
            (sel.gi != null ? '<span title="' + esc(giTitle(sel)) + '">ГИ: <b>' + (sel.giSrc === 'e' ? '≈' : '') + fmtInt(sel.gi) + '</b></span>' : '') + glHtml;
        }

        input.addEventListener('input', function () {
          if (sel && input.value !== sel.name) sel = null;
          update();
          // небольшая задержка: при быстром наборе не пересчитываем поиск на каждую букву
          clearTimeout(searchTimer);
          searchTimer = setTimeout(function () { if (document.body.contains(input)) renderResults(); }, 80);
        });
        input.addEventListener('focus', function () { if (!sel) renderResults(); });
        input.addEventListener('keydown', function (e) {
          var open = results.length > 0;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) { renderResults(); return; }
            active = (active + 1) % results.length; highlight();
          } else if (e.key === 'ArrowUp') {
            if (!open) return;
            e.preventDefault();
            active = (active - 1 + results.length) % results.length; highlight();
          } else if (e.key === 'Enter') {
            if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; if (input.value.trim()) { renderResults(); open = results.length > 0; } }
            if (open && active >= 0) { e.preventDefault(); choose(active); }
          } else if (e.key === 'Escape') {
            if (ul.innerHTML) { e.preventDefault(); e.stopPropagation(); hideResults(); }
          }
        });
        // mousedown + preventDefault — чтобы поле не теряло фокус до выбора
        ul.addEventListener('mousedown', function (e) { if (e.target.closest('li[data-idx], [data-more-results]')) e.preventDefault(); });
        ul.addEventListener('click', function (e) {
          var li = e.target.closest('li[data-idx]');
          if (li) { choose(+li.getAttribute('data-idx')); return; }
          if (e.target.closest('[data-more-results]')) { shown += PICK_PAGE; renderResults(true); return; }
          if (e.target.closest('[data-create-food]')) {
            // создаём продукт и возвращаемся к записи с ним
            var snap = {
              meal: $('#e-meal', body).value,
              date: $('#e-date', body).value,
              time: $('#e-time', body).value,
              grams: parseNum(gramsIn.value) > 0 ? parseNum(gramsIn.value) : 100
            };
            var name = input.value.trim();
            openFoodModal(null, { name: name }, function (saved) {
              snap.product = Object.assign({ custom: true }, saved);
              openEntryModal(entry, snap);
            }, function () { openEntryModal(entry, snap); });
          }
        });
        gramsIn.addEventListener('input', update);
        // Обработчик вешаем на блок чипов, а не на #modal-body: тот живёт всё время,
        // и обработчики копились бы при каждом открытии окна (утечка + лишние перерисовки).
        $('.quick', body).addEventListener('click', function (e) {
          var chip = e.target.closest('[data-grams]');
          if (chip) { gramsIn.value = chip.getAttribute('data-grams'); update(); }
        });
        update();
      },
      onSubmit: function (body) {
        if (!sel) return formError('Выберите продукт из списка — начните вводить название.', 'e-product');
        var g = parseNum($('#e-grams', body).value);
        if (!(g >= 0.1) || g > 5000) return formError('Укажите количество от 0,1 до 5000 г.', 'e-grams');
        var d = $('#e-date', body).value;
        if (!isDateStr(d)) return formError('Укажите корректную дату.', 'e-date');
        var t = ($('#e-time', body).value || '').slice(0, 5);
        if (!isTimeStr(t)) return formError('Укажите время в формате ЧЧ:ММ.', 'e-time');
        var item = {
          id: entry ? entry.id : Store.genId('e'),
          date: d, time: t,
          meal: $('#e-meal', body).value,
          productId: sel.productId || null,
          name: sel.name,
          grams: round1(g),
          kcal: sel.kcal, p: sel.p, f: sel.f, c: sel.c, gi: sel.gi, giSrc: sel.giSrc
        };
        if (entry && entry.demo) item.demo = true;
        // ингредиент блюда по фото остаётся в своём блюде; пометка «≈ ИИ» — пока продукт не заменён на продукт базы
        if (entry && entry.dishId) { item.dishId = entry.dishId; item.dishName = entry.dishName; }
        if (entry && entry.src === 'ai' && !sel.productId) item.src = 'ai';
        var r = Store.upsert('entries', item);
        if (!r.item) return formError('Не удалось сохранить запись: некорректные данные.');
        checkSaved(r.ok);
        var sameDay = d === state.date;
        state.date = d;
        renderView();
        toast(isEdit ? 'Запись обновлена' : (sameDay ? 'Запись добавлена' : 'Запись добавлена на ' + fmtDDMMYYYY(d)));
      }
    });
  }

  function deleteEntry(id) {
    var e = Store.get('entries', id);
    if (!e) return;
    if (!window.confirm('Удалить запись «' + e.name + '» (' + fmt1(e.grams) + ' г)?')) return;
    checkSaved(Store.remove('entries', id));
    renderView();
    toast('Запись удалена');
  }

  /** Удалить все ингредиенты блюда, распознанного по фото (общий dishId) */
  function deleteDish(dishId) {
    if (!dishId) return;
    var items = Store.list('entries').filter(function (e) { return e.dishId === dishId; });
    if (!items.length) return;
    if (!window.confirm('Удалить блюдо «' + (items[0].dishName || items[0].name) + '» целиком (' + items.length + ' ингр.)?')) return;
    Store.removeWhere('entries', function (e) { return e.dishId === dishId; });
    renderView();
    toast('Блюдо удалено');
  }

  // ---------- Копирование приёмов пищи из другого дня ----------
  /** Последняя дата с записями раньше указанной (при meal — только с этим приёмом пищи) */
  function prevDateWithEntries(before, meal) {
    var best = null;
    Store.list('entries').forEach(function (e) {
      if (e.date < before && (!meal || e.meal === meal) && (!best || e.date > best)) best = e.date;
    });
    return best;
  }

  /** onlyMeal — ключ приёма пищи («Повторить» в карточке) или null (весь день) */
  function openCopyModal(onlyMeal) {
    var target = state.date;
    var src = prevDateWithEntries(target, onlyMeal) || prevDateWithEntries(target) || addDays(target, -1);
    var chosen = {};
    MEALS.forEach(function (m) { chosen[m.key] = !onlyMeal || m.key === onlyMeal; });

    var html =
      '<p class="small muted" style="margin-top:0">Записи будут добавлены на <b>' + esc(fmtDateLong(target)) + '</b> с тем же временем и весом — потом их можно изменить.</p>' +
      '<div class="field"><label for="cp-date">Копировать из дня</label><input id="cp-date" type="date" data-autofocus value="' + esc(src) + '"></div>' +
      '<div class="quick" role="group" aria-label="Быстрый выбор дня">' +
        [[-1, 'Вчера'], [-2, 'Позавчера'], [-7, 'Неделю назад']].map(function (x) {
          return '<button type="button" class="chip" data-cp-delta="' + x[0] + '">' + x[1] + '</button>';
        }).join('') +
      '</div>' +
      '<fieldset class="cp-meals"><legend class="field-label">Что копировать</legend><div id="cp-list"></div></fieldset>' +
      '<div id="form-error" class="form-error" role="alert"></div>';

    function srcEntries(body) {
      var d = $('#cp-date', body).value;
      return isDateStr(d) ? dayEntries(d) : [];
    }

    Modal.open({
      title: onlyMeal ? 'Повторить: ' + MEAL_LABEL[onlyMeal].toLowerCase() : 'Копировать из другого дня',
      html: html,
      submitLabel: 'Копировать',
      onOpen: function (body) {
        var dateIn = $('#cp-date', body), listBox = $('#cp-list', body);
        function renderList() {
          var d = dateIn.value;
          if (!isDateStr(d)) { listBox.innerHTML = '<p class="small muted">Выберите дату.</p>'; return; }
          var all = dayEntries(d);
          listBox.innerHTML = (d === target ? '<p class="small muted">Это тот же день — выберите другой.</p>' : '') +
            '<p class="small muted" style="margin:0 0 4px">' + esc(dateCaption(d)) + ', ' + fmtDDMMYYYY(d) + (all.length ? '' : ' — записей нет') + '</p>' +
            MEALS.map(function (m) {
              var items = all.filter(function (e) { return e.meal === m.key; });
              var t = sumEntries(items);
              return '<label class="check cp-row' + (items.length ? '' : ' muted') + '">' +
                '<input type="checkbox" value="' + m.key + '"' + (items.length && chosen[m.key] ? ' checked' : '') + (items.length ? '' : ' disabled') + '>' +
                '<span><b>' + m.label + '</b>' + (items.length
                  ? ' — ' + fmtInt(t.kcal) + ' ккал<br><span class="small muted">' + items.map(function (e) { return esc(e.name) + ' ' + fmt1(e.grams) + ' г'; }).join(', ') + '</span>'
                  : ' <span class="small">— нет записей</span>') + '</span></label>';
            }).join('');
        }
        dateIn.addEventListener('change', renderList);
        dateIn.addEventListener('input', renderList);
        listBox.addEventListener('change', function (e) {
          if (e.target.type === 'checkbox') chosen[e.target.value] = e.target.checked;
        });
        $('.quick', body).addEventListener('click', function (e) {
          var chip = e.target.closest('[data-cp-delta]');
          if (chip) { dateIn.value = addDays(target, +chip.getAttribute('data-cp-delta')); renderList(); }
        });
        renderList();
      },
      onSubmit: function (body) {
        var d = $('#cp-date', body).value;
        if (!isDateStr(d)) return formError('Укажите корректную дату.', 'cp-date');
        if (d === target) return formError('Выберите другой день — записи этого дня уже на месте.', 'cp-date');
        var meals = $$('#cp-list input:checked', body).map(function (x) { return x.value; });
        var src2 = srcEntries(body).filter(function (e) { return meals.indexOf(e.meal) >= 0; });
        if (!src2.length) return formError('Нечего копировать: отметьте приёмы пищи, в которых есть записи.');
        var dishMap = {}; // блюдо по фото копируется как новое блюдо (новый dishId), состав сохраняется
        var copies = src2.map(function (e) {
          if (e.dishId && !dishMap[e.dishId]) dishMap[e.dishId] = Store.genId('d');
          return Store.sanitizeEntry({
            id: Store.genId('e'), date: target, time: e.time, meal: e.meal, productId: e.productId,
            name: e.name, grams: e.grams, kcal: e.kcal, p: e.p, f: e.f, c: e.c, gi: e.gi, giSrc: e.giSrc,
            dishId: e.dishId ? dishMap[e.dishId] : undefined, dishName: e.dishName, src: e.src
          });
        }).filter(Boolean);
        checkSaved(Store.addMany('entries', copies));
        renderView();
        toast('Скопировано записей: ' + copies.length);
      }
    });
  }

  // =====================================================================
  // САХАР КРОВИ
  // =====================================================================
  function legendHtml() {
    var s = S(), u = unitLabel();
    return '<div class="legend">' +
      '<span><span class="dot" style="background:var(--g-low);border-radius:50%"></span>Низкий: &lt; ' + gFmt(s.low) + '</span>' +
      '<span><span class="dot" style="background:var(--g-ok);border-radius:50%"></span>Цель: ' + gFmt(s.low) + '–' + gFmt(s.high) + '</span>' +
      '<span><span class="dot" style="background:var(--g-high);border-radius:50%"></span>Высокий: &gt; ' + gFmt(s.high) + '</span>' +
      '<span><span class="dot" style="background:var(--g-vhigh);border-radius:50%"></span>Очень высокий: &gt; ' + gFmt(s.veryHigh) + '</span>' +
      '<span class="muted">(' + u + ')</span></div>';
  }

  function glucoseItemHtml(g) {
    var st = STATUS[gStatus(g.mmol)];
    return '<li class="g-item">' +
      '<div class="g-value ' + st.cls + '">' + gFmt(g.mmol) + '<small>' + unitLabel() + '</small></div>' +
      '<div class="g-main">' +
        '<div class="g-ctx">' + esc(CTX_LABEL[g.ctx] || 'Другое') + ' <span class="muted">· ' + esc(g.time) + '</span></div>' +
        '<div class="status-tag"><span class="dot" style="background:var(' + st.color + ')"></span>' + st.label + '</div>' +
        (g.note ? '<div class="g-note">' + esc(g.note) + '</div>' : '') +
      '</div>' +
      actionBtns('glucose', g.id, gFmt(g.mmol) + ' ' + unitLabel()) +
      '</li>';
  }

  function renderGlucose() {
    renderDatebars();
    var list = Store.list('glucose').filter(function (g) { return g.date === state.date; })
      .sort(function (a, b) { return a.time.localeCompare(b.time); });
    var html = '<div class="card">';
    if (list.length) {
      var vals = list.map(function (g) { return g.mmol; });
      var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      html += '<div class="macros" style="margin-top:0;grid-template-columns:repeat(4,1fr)">' +
        '<div><div class="macro-label">Измерений</div><div class="macro-val">' + list.length + '</div></div>' +
        '<div><div class="macro-label">Среднее</div><div class="macro-val">' + gFmt(avg) + '</div></div>' +
        '<div><div class="macro-label">Мин.</div><div class="macro-val">' + gFmt(Math.min.apply(null, vals)) + '</div></div>' +
        '<div><div class="macro-label">Макс.</div><div class="macro-val">' + gFmt(Math.max.apply(null, vals)) + '</div></div>' +
        '</div><div style="height:12px"></div>';
    }
    html += legendHtml() +
      '<div style="margin-top:12px"><button type="button" class="btn btn-primary btn-block" data-action="add-glucose">' + ICON.plus + ' Добавить измерение</button></div>' +
      '</div>';
    html += '<div class="card">' + (list.length
      ? '<ul class="list">' + list.map(glucoseItemHtml).join('') + '</ul>'
      : emptyState(ICON.drop, 'За этот день измерений нет.')) + '</div>';
    $('#glucose-content').innerHTML = html;
  }

  function openGlucoseModal(item) {
    var isEdit = !!item;
    var unit = S().unit;
    var ctx = item ? item.ctx : guessContext();
    var html =
      '<div class="row">' +
        '<div class="field"><label for="g-date">Дата</label><input id="g-date" type="date" value="' + esc(item ? item.date : state.date) + '"></div>' +
        '<div class="field"><label for="g-time">Время</label><input id="g-time" type="time" value="' + esc(item ? item.time : nowTime()) + '"></div>' +
      '</div>' +
      '<div class="row">' +
        '<div class="field"><label for="g-value">Сахар, ' + unitLabel(unit) + '</label>' +
          '<input id="g-value" type="text" inputmode="decimal" data-autofocus placeholder="' + (unit === 'mgdl' ? 'например, 101' : 'например, 5,6') + '" value="' + (item ? gInput(item.mmol, unit) : '') + '"></div>' +
        '<div class="field"><label for="g-ctx">Когда измерено</label><select id="g-ctx">' +
          CONTEXTS.map(function (c) { return '<option value="' + c.key + '"' + (c.key === ctx ? ' selected' : '') + '>' + c.label + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div id="g-preview" class="g-preview" aria-live="polite"></div>' +
      '<div class="field"><label for="g-note">Заметка (необязательно)</label>' +
        '<textarea id="g-note" maxlength="500" placeholder="Самочувствие, препараты, нагрузка…">' + esc(item ? item.note : '') + '</textarea></div>' +
      '<div id="form-error" class="form-error" role="alert"></div>';

    // нижняя граница в мг/дл — 10: 9 мг/дл = 0,4996 ммоль/л отбрасывалось хранилищем (минимум 0,5)
    var range = unit === 'mgdl' ? [10, 720] : [0.5, 40];

    Modal.open({
      title: isEdit ? 'Изменить измерение' : 'Новое измерение сахара',
      html: html,
      submitLabel: isEdit ? 'Сохранить' : 'Добавить',
      onOpen: function (body) {
        var inp = $('#g-value', body), prev = $('#g-preview', body);
        function update() {
          var v = parseNum(inp.value);
          if (!(v >= range[0] && v <= range[1])) { prev.className = 'g-preview'; prev.innerHTML = ''; return; }
          var mm = toMmol(v, unit), st = STATUS[gStatus(mm)];
          prev.className = 'g-preview ' + st.cls;
          prev.innerHTML = '<span class="status-tag"><span class="dot" style="background:var(' + st.color + ')"></span>' + st.label + '</span>' +
            ' <span class="muted">(' + (unit === 'mgdl' ? fmt(mm, 1, true) + ' ммоль/л' : fmtInt(mm * MGDL) + ' мг/дл') + ')</span>';
        }
        inp.addEventListener('input', update);
        update();
      },
      onSubmit: function (body) {
        var d = $('#g-date', body).value;
        if (!isDateStr(d)) return formError('Укажите корректную дату.', 'g-date');
        var t = ($('#g-time', body).value || '').slice(0, 5);
        if (!isTimeStr(t)) return formError('Укажите время в формате ЧЧ:ММ.', 'g-time');
        var v = parseNum($('#g-value', body).value);
        if (!(v >= range[0] && v <= range[1])) {
          return formError('Введите значение от ' + fmt(range[0], 1) + ' до ' + fmt(range[1], 1) + ' ' + unitLabel(unit) + '.', 'g-value');
        }
        var rec = {
          id: item ? item.id : Store.genId('g'),
          date: d, time: t,
          mmol: toMmol(v, unit),
          ctx: $('#g-ctx', body).value,
          note: $('#g-note', body).value
        };
        if (item && item.demo) rec.demo = true;
        var r = Store.upsert('glucose', rec);
        if (!r.item) return formError('Не удалось сохранить: некорректные данные.');
        checkSaved(r.ok);
        state.date = d;
        renderView();
        toast(isEdit ? 'Измерение обновлено' : 'Измерение добавлено');
      }
    });
  }

  function deleteGlucose(id) {
    var g = Store.get('glucose', id);
    if (!g) return;
    if (!window.confirm('Удалить измерение ' + gFmt(g.mmol) + ' ' + unitLabel() + ' (' + fmtDDMM(g.date) + ', ' + g.time + ')?')) return;
    checkSaved(Store.remove('glucose', id));
    renderView();
    toast('Измерение удалено');
  }

  // =====================================================================
  // ПРОДУКТЫ
  // =====================================================================
  function allCategories() {
    var cats = FOOD_CATEGORIES.slice();
    Store.list('customFoods').forEach(function (f) { if (cats.indexOf(f.cat) < 0) cats.push(f.cat); });
    return cats;
  }

  function renderFoods() {
    var sel = $('#food-cat');
    var cats = allCategories();
    if (state.foodCat && cats.indexOf(state.foodCat) < 0) state.foodCat = '';
    sel.innerHTML = '<option value="">Все категории</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === state.foodCat ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    $('#food-search').value = state.foodQuery;
    $('#food-only-custom').checked = state.onlyCustom;
    renderFoodList();
  }

  function foodItemHtml(f, hl) {
    var name = esc(f.name);
    var gt = giText(f);
    var actions = '<button type="button" class="icon-btn" data-action="food-to-diary" data-id="' + esc(f.id) + '" title="Добавить в дневник" aria-label="Добавить «' + name + '» в дневник">' + ICON.plus + '</button>';
    if (f.custom) {
      actions += '<button type="button" class="icon-btn" data-action="edit-food" data-id="' + esc(f.id) + '" title="Изменить" aria-label="Изменить «' + name + '»">' + ICON.edit + '</button>' +
        '<button type="button" class="icon-btn danger" data-action="del-food" data-id="' + esc(f.id) + '" title="Удалить" aria-label="Удалить «' + name + '»">' + ICON.del + '</button>';
    } else {
      actions += '<button type="button" class="icon-btn" data-action="copy-food" data-id="' + esc(f.id) + '" title="Копировать в мои продукты" aria-label="Копировать «' + name + '» в мои продукты">' + ICON.copy + '</button>';
    }
    return '<div class="food-item">' +
      '<div class="food-main">' +
        '<div class="food-name">' + (hl ? FoodSearch.highlight(f.name, hl, esc) : name) + (f.custom ? ' <span class="badge badge-custom">Мой</span>' : '') + '</div>' +
        '<div class="food-meta">' + esc(f.cat) + ' · ' + fmtInt(f.kcal) + ' ккал · Б ' + fmt1(f.p) + ' · Ж ' + fmt1(f.f) + ' · У ' + fmt1(f.c) +
          (gt ? ' · <span title="' + esc(giTitle(f)) + '">' + gt + '</span>' : '') + '</div>' +
      '</div>' +
      '<div class="food-actions">' + actions + '</div>' +
      '</div>';
  }

  function renderFoodList() {
    var list = allFoods(), rows;
    if (state.foodCat) list = list.filter(function (f) { return f.cat === state.foodCat; });
    if (state.onlyCustom) list = list.filter(function (f) { return f.custom; });
    if (state.foodQuery.trim()) {
      rows = searchFoods(state.foodQuery, 0, list);
    } else {
      list.sort(function (a, b) { return (b.custom ? 1 : 0) - (a.custom ? 1 : 0) || a.name.localeCompare(b.name, 'ru'); });
      rows = list.map(function (f) { return { f: f, hl: null }; });
    }
    var customCount = Store.list('customFoods').length;
    var page = rows.slice(0, state.foodShown);
    $('#food-count').textContent = 'Найдено: ' + rows.length + (rows.length > page.length ? ' (показано ' + page.length + ')' : '') +
      ' · встроенных продуктов: ' + FOODS.length + ' · моих: ' + customCount;
    $('#food-list').innerHTML = rows.length
      ? '<div class="card">' + page.map(function (r) { return foodItemHtml(r.f, r.hl); }).join('') +
        (rows.length > page.length ? '<div class="more-row"><button type="button" class="btn" data-action="more-foods">Показать ещё (' + (rows.length - page.length) + ')</button></div>' : '') +
        '</div>'
      : '<div class="card">' + emptyState(ICON.plus, state.onlyCustom && !customCount
          ? 'У вас пока нет своих продуктов. Создайте новый или скопируйте встроенный, чтобы изменить значения.'
          : 'Ничего не найдено.',
        '<button type="button" class="btn btn-primary" data-action="new-food">+ Новый продукт</button>') + '</div>';
  }

  /**
   * Окно продукта.
   * food — существующий пользовательский продукт (редактирование) или null.
   * preset — начальные значения (копия встроенного, имя из поиска).
   * afterSave(saved) / onCancel — используются при создании продукта из окна записи.
   */
  function openFoodModal(food, preset, afterSave, onCancel) {
    var v = food || preset || {};
    var isEdit = !!food;
    var html =
      '<div class="field"><label for="p-name">Название</label><input id="p-name" type="text" maxlength="100" data-autofocus value="' + esc(v.name || '') + '"></div>' +
      '<div class="field"><label for="p-cat">Категория</label><input id="p-cat" type="text" maxlength="60" list="p-cat-list" placeholder="Например, Готовые блюда" value="' + esc(v.cat || '') + '">' +
        '<datalist id="p-cat-list">' + allCategories().map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></div>' +
      '<p class="field-label" style="margin:0 0 6px">Пищевая ценность на 100 г</p>' +
      '<div class="row-4">' +
        '<div class="field"><label for="p-kcal">Ккал</label><input id="p-kcal" type="text" inputmode="decimal" value="' + inputNum(v.kcal) + '"></div>' +
        '<div class="field"><label for="p-p">Белки, г</label><input id="p-p" type="text" inputmode="decimal" value="' + inputNum(v.p) + '"></div>' +
        '<div class="field"><label for="p-f">Жиры, г</label><input id="p-f" type="text" inputmode="decimal" value="' + inputNum(v.f) + '"></div>' +
        '<div class="field"><label for="p-c">Углеводы, г</label><input id="p-c" type="text" inputmode="decimal" value="' + inputNum(v.c) + '"></div>' +
      '</div>' +
      '<p class="hint" id="p-hint" style="margin-top:-6px"></p>' +
      '<div class="field"><label for="p-gi">Гликемический индекс (необязательно)</label><input id="p-gi" type="text" inputmode="numeric" placeholder="0–150, если известен" value="' + (v.gi != null ? inputNum(v.gi) : '') + '">' +
        (v.gi != null && (v.giSrc === 'e' || v.giSrc === 't')
          ? '<span class="hint">Источник: ' + (v.giSrc === 'e' ? 'оценка по составу (≈)' : 'таблицы ГИ') + '. Если измените значение, оно будет отмечено как «своё значение».</span>'
          : '') + '</div>' +
      '<div id="form-error" class="form-error" role="alert"></div>';

    Modal.open({
      title: isEdit ? 'Изменить продукт' : 'Новый продукт',
      html: html,
      submitLabel: 'Сохранить',
      buttons: onCancel ? [{ label: '← Назад к записи', cls: 'btn-ghost', onClick: function () { onCancel(); } }] : [],
      onOpen: function (body) {
        function hint() {
          var p = parseNum($('#p-p', body).value), f = parseNum($('#p-f', body).value), c = parseNum($('#p-c', body).value);
          var h = $('#p-hint', body);
          if (p >= 0 && f >= 0 && c >= 0) {
            h.textContent = 'Расчётная калорийность по БЖУ: ≈ ' + fmtInt(p * 4 + f * 9 + c * 4) + ' ккал; сумма Б+Ж+У: ' + fmt1(p + f + c) + ' г.';
          } else h.textContent = '';
        }
        ['#p-p', '#p-f', '#p-c'].forEach(function (id) { $(id, body).addEventListener('input', hint); });
        hint();
      },
      onSubmit: function (body) {
        var name = $('#p-name', body).value.trim().replace(/\s+/g, ' ');
        if (!name) return formError('Укажите название продукта.', 'p-name');
        var cat = $('#p-cat', body).value.trim() || 'Другое';
        var nums = {};
        var fields = [['kcal', 'p-kcal', 'Калорийность'], ['p', 'p-p', 'Белки'], ['f', 'p-f', 'Жиры'], ['c', 'p-c', 'Углеводы']];
        for (var i = 0; i < fields.length; i++) {
          var n = parseNum($('#' + fields[i][1], body).value);
          if (!(n >= 0)) return formError(fields[i][2] + ': введите неотрицательное число (можно с запятой).', fields[i][1]);
          nums[fields[i][0]] = round1(n);
        }
        if (nums.kcal > 900) return formError('Калорийность не может превышать 900 ккал на 100 г.', 'p-kcal');
        if (nums.p + nums.f + nums.c > 100) return formError('Сумма белков, жиров и углеводов не может превышать 100 г на 100 г продукта.', 'p-c');
        var giRaw = $('#p-gi', body).value.trim();
        var gi = null;
        if (giRaw) {
          gi = parseNum(giRaw);
          if (!(gi >= 0 && gi <= 150)) return formError('ГИ должен быть числом от 0 до 150 или оставьте поле пустым.', 'p-gi');
          gi = Math.round(gi);
        }
        var dup = Store.list('customFoods').some(function (f) {
          return norm(f.name) === norm(name) && (!food || f.id !== food.id);
        });
        if (dup) return formError('Среди ваших продуктов уже есть «' + name + '». Измените название.', 'p-name');

        // источник ГИ: если значение скопировано без изменений — сохраняем источник (≈ оценка / таблицы),
        // если введено или изменено вручную — «своё значение»
        var giSrc = gi == null ? null
          : (v.gi != null && gi === Math.round(v.gi) && (v.giSrc === 'e' || v.giSrc === 't' || v.giSrc === 'u') ? v.giSrc : 'u');
        var r = Store.upsert('customFoods', {
          id: food ? food.id : Store.genId('c'),
          name: name, cat: cat, kcal: nums.kcal, p: nums.p, f: nums.f, c: nums.c, gi: gi, giSrc: giSrc
        });
        if (!r.item) return formError('Не удалось сохранить продукт: проверьте значения.');
        checkSaved(r.ok);
        toast(isEdit ? 'Продукт обновлён' : 'Продукт добавлен в «Мои»');
        if (state.view === 'foods') renderFoodList();
        if (afterSave) afterSave(r.item);
      }
    });
  }

  function deleteFood(id) {
    var f = Store.get('customFoods', id);
    if (!f) return;
    if (!window.confirm('Удалить продукт «' + f.name + '»?\nЗаписи дневника с этим продуктом сохранятся.')) return;
    checkSaved(Store.remove('customFoods', id));
    renderFoods();
    toast('Продукт удалён');
  }

  // =====================================================================
  // СТАТИСТИКА
  // =====================================================================
  /** Момент времени записи/измерения (мс) в локальном времени */
  function tsOf(o) { var p = o.time.split(':'); return strToDate(o.date, +p[0], +p[1]).getTime(); }

  // Окно «еда перед измерением после еды»: от 4 ч до 30 мин до измерения
  var LINK_FROM_MS = 4 * 3600000, LINK_TO_MS = 30 * 60000;
  var GL_BUCKETS = [
    { key: 'low', label: 'Низкая (≤ 10)' },
    { key: 'mid', label: 'Средняя (10–20)' },
    { key: 'high', label: 'Высокая (≥ 20)' }
  ];

  function pearson(xs, ys) {
    var n = xs.length;
    if (n < 3) return null;
    var mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    var sxy = 0, sxx = 0, syy = 0;
    for (i = 0; i < n; i++) {
      var dx = xs[i] - mx, dy = ys[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx <= 0 || syy <= 0) return null;
    return sxy / Math.sqrt(sxx * syy);
  }

  /**
   * Связь питания и сахара: для каждого измерения «через 1/2 ч после еды» суммируем
   * углеводы и ГН продуктов, записанных за 4 ч … 30 мин до него.
   */
  function computeMealLink(readings, start, dates, byDate) {
    var post = readings.filter(function (g) { return g.ctx === 'after1' || g.ctx === 'after2'; });
    var from = addDays(start, -1); // еда накануне вечером может относиться к ночному измерению
    var ents = Store.list('entries').filter(function (e) { return e.date >= from; })
      .map(function (e) { return { ts: tsOf(e), e: e }; });
    var pairs = [], noFood = 0;
    post.forEach(function (g) {
      var t = tsOf(g), carbs = 0, glv = 0, n = 0, noGi = 0;
      ents.forEach(function (x) {
        if (x.ts > t - LINK_TO_MS || x.ts < t - LINK_FROM_MS) return;
        var c = calc(x.e);
        carbs += c.c; n++;
        if (c.gl != null) glv += c.gl; else if (c.c >= 1) noGi++;
      });
      if (!n) { noFood++; return; }
      pairs.push({ mmol: g.mmol, carbs: carbs, gl: glv, noGi: noGi });
    });
    var buckets = GL_BUCKETS.map(function (b) {
      var list = pairs.filter(function (p) {
        var cls = glClass(p.gl).cls;
        return cls === 'badge-gl-' + b.key;
      });
      var vals = list.map(function (p) { return p.mmol; });
      var above = vals.filter(function (v) { var s0 = gStatus(v); return s0 === 'high' || s0 === 'vhigh'; }).length;
      return {
        key: b.key, label: b.label, n: list.length,
        avg: vals.length ? vals.reduce(function (a, v) { return a + v; }, 0) / vals.length : null,
        carbs: list.length ? list.reduce(function (a, p) { return a + p.carbs; }, 0) / list.length : null,
        pctHigh: vals.length ? Math.round(above / vals.length * 100) : null
      };
    });
    // по дням: углеводы за день и средний сахар после еды
    var postByDate = {};
    post.forEach(function (g) { (postByDate[g.date] = postByDate[g.date] || []).push(g.mmol); });
    var daily = dates.map(function (d) {
      var a = postByDate[d];
      return { date: d, carbs: byDate[d].n ? byDate[d].c : 0, hasFood: byDate[d].n > 0, post: a ? a.reduce(function (s0, v) { return s0 + v; }, 0) / a.length : null, postN: a ? a.length : 0 };
    });
    return {
      postCount: post.length,
      pairs: pairs.length,
      noFood: noFood,
      noGi: pairs.filter(function (p) { return p.noGi > 0; }).length,
      buckets: buckets,
      rCarbs: pairs.length >= 5 ? pearson(pairs.map(function (p) { return p.carbs; }), pairs.map(function (p) { return p.mmol; })) : null,
      rGl: pairs.length >= 5 ? pearson(pairs.map(function (p) { return p.gl; }), pairs.map(function (p) { return p.mmol; })) : null,
      daily: daily
    };
  }

  /**
   * Активность за период: минуты и ккал по дням, частые виды, а также сравнение сахара
   * в дни с ≥ 30 мин активности и без неё и измерений в течение 3 ч после окончания активности.
   */
  function computeActivity(readings, start, end, dates) {
    var list = Store.list('activity').filter(function (a) { return a.date >= start && a.date <= end; });
    var byDate = {};
    dates.forEach(function (d) { byDate[d] = { min: 0, kcal: 0, names: [] }; });
    var types = {};
    list.forEach(function (a) {
      var b = byDate[a.date];
      if (!b) return;
      b.min += a.minutes; b.kcal += a.kcal;
      if (b.names.indexOf(a.name) < 0) b.names.push(a.name);
      var k = norm(a.name);
      if (!types[k]) types[k] = { name: a.name, count: 0, min: 0, kcal: 0 };
      types[k].count++; types[k].min += a.minutes; types[k].kcal += a.kcal;
    });
    var totalMin = 0, totalKcal = 0, activeDays = 0, anyDays = 0;
    dates.forEach(function (d) {
      totalMin += byDate[d].min; totalKcal += byDate[d].kcal;
      if (byDate[d].min >= ACTIVE_DAY_MIN) activeDays++;
      if (byDate[d].min > 0) anyDays++;
    });
    var avg = function (arr) { return arr.length ? arr.reduce(function (s0, v) { return s0 + v; }, 0) / arr.length : null; };

    // Сахар в «активные» дни и в остальные дни (только дни с измерениями)
    var gA = [], gB = [], dA = {}, dB = {};
    readings.forEach(function (g) {
      var b = byDate[g.date];
      if (!b) return;
      if (b.min >= ACTIVE_DAY_MIN) { gA.push(g.mmol); dA[g.date] = 1; } else { gB.push(g.mmol); dB[g.date] = 1; }
    });
    // Измерения в течение 3 ч после окончания активности (или во время неё)
    var spans = Store.list('activity').filter(function (a) { return a.date >= addDays(start, -1) && a.date <= end; })
      .map(function (a) { var t0 = tsOf(a); return [t0, t0 + a.minutes * 60000 + 3 * 3600000]; });
    var after = [], other = [];
    readings.forEach(function (g) {
      var t = tsOf(g);
      if (spans.some(function (sp) { return t >= sp[0] && t <= sp[1]; })) after.push(g.mmol); else other.push(g.mmol);
    });
    return {
      count: list.length, byDate: byDate, totalMin: totalMin, totalKcal: totalKcal,
      avgMin: dates.length ? totalMin / dates.length : 0,
      activeDays: activeDays, anyDays: anyDays,
      top: Object.keys(types).map(function (k) { return types[k]; }).sort(function (a, b) { return b.min - a.min; }).slice(0, 5),
      daysCmp: { a: avg(gA), nA: gA.length, daysA: Object.keys(dA).length, b: avg(gB), nB: gB.length, daysB: Object.keys(dB).length },
      afterCmp: { a: avg(after), nA: after.length, b: avg(other), nB: other.length }
    };
  }

  function corrText(r) {
    if (r == null) return '';
    var a = Math.abs(r);
    var strength = a < 0.1 ? 'практически нет' : a < 0.3 ? 'слабая' : a < 0.5 ? 'умеренная' : 'сильная';
    if (a < 0.1) return 'связи практически нет';
    return strength + (r > 0 ? ' прямая связь (больше — выше сахар)' : ' обратная связь');
  }

  function computeStats(days) {
    var s = S();
    var end = todayStr(), start = addDays(end, -(days - 1));
    var dates = [];
    for (var i = 0; i < days; i++) dates.push(addDays(start, i));
    var byDate = {};
    dates.forEach(function (d) { byDate[d] = { kcal: 0, p: 0, f: 0, c: 0, gl: 0, n: 0 }; });
    var mealK = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
    var prod = {};

    Store.list('entries').forEach(function (e) {
      if (e.date < start || e.date > end) return;
      var c = calc(e), b = byDate[e.date];
      if (!b) return;
      b.kcal += c.kcal; b.p += c.p; b.f += c.f; b.c += c.c; b.n++;
      if (c.gl != null) b.gl += c.gl;
      mealK[e.meal] += c.kcal;
      var key = norm(e.name);
      if (!prod[key]) prod[key] = { name: e.name, grams: 0, kcal: 0, count: 0 };
      prod[key].grams += e.grams; prod[key].kcal += c.kcal; prod[key].count++;
    });

    var logged = dates.filter(function (d) { return byDate[d].n > 0; });
    var sum = function (k) { return logged.reduce(function (a, d) { return a + byDate[d][k]; }, 0); };
    var nL = logged.length;

    var gl = Store.list('glucose').filter(function (g) { return g.date >= start && g.date <= end; });
    var gv = gl.map(function (g) { return g.mmol; });
    var gst = { low: 0, ok: 0, high: 0, vhigh: 0 };
    gv.forEach(function (v) { gst[gStatus(v)]++; });
    var fasting = gl.filter(function (g) { return g.ctx === 'fasting'; });
    var avg = function (arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null; };

    var top = Object.keys(prod).map(function (k) { return prod[k]; })
      .sort(function (a, b) { return b.grams - a.grams; }).slice(0, 10);

    // средний сахар по каждому контексту измерения (для отчёта)
    var byCtx = {};
    gl.forEach(function (g) { (byCtx[g.ctx] = byCtx[g.ctx] || []).push(g.mmol); });
    var ctxAvg = CONTEXTS.map(function (cx) {
      var a = byCtx[cx.key] || [];
      return { key: cx.key, label: cx.label, n: a.length, avg: avg(a), min: a.length ? Math.min.apply(null, a) : null, max: a.length ? Math.max.apply(null, a) : null };
    });

    return {
      act: computeActivity(gl, start, end, dates),
      link: computeMealLink(gl, start, dates, byDate),
      ctxAvg: ctxAvg,
      avgGl: nL ? logged.reduce(function (a, d) { return a + byDate[d].gl; }, 0) / nL : null,
      days: days, start: start, end: end, dates: dates, byDate: byDate,
      loggedDays: nL,
      avgKcal: nL ? sum('kcal') / nL : null,
      avgP: nL ? sum('p') / nL : null,
      avgF: nL ? sum('f') / nL : null,
      avgC: nL ? sum('c') / nL : null,
      mealK: mealK,
      top: top,
      glucose: gl,
      gCount: gv.length,
      gAvg: avg(gv),
      gMin: gv.length ? Math.min.apply(null, gv) : null,
      gMax: gv.length ? Math.max.apply(null, gv) : null,
      // те же правила, что и для цветовой подсветки (gStatus)
      gInRange: gst.ok,
      gLow: gst.low,
      gHigh: gst.high + gst.vhigh,
      gVeryHigh: gst.vhigh,
      gFastingAvg: avg(fasting.map(function (g) { return g.mmol; })),
      gFastingCount: fasting.length
    };
  }

  function tile(label, value, sub) {
    return '<div class="tile"><div class="tile-label">' + label + '</div><div class="tile-value">' + value + '</div>' +
      (sub ? '<div class="tile-sub">' + sub + '</div>' : '') + '</div>';
  }

  function legendItem(color, text, dashed) {
    var sw = dashed
      ? '<span style="display:inline-block;width:16px;border-top:2px dashed var(--text)"></span>'
      : '<span class="dot" style="background:var(' + color + ')"></span>';
    return '<span>' + sw + text + '</span>';
  }

  function renderStats() {
    $$('[data-action="period"]').forEach(function (b) {
      var on = +b.getAttribute('data-days') === state.period;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var st = computeStats(state.period);
    state.stats = st;
    var s = S(), u = unitLabel();
    var box = $('#stats-content');

    if (!st.loggedDays && !st.gCount && !st.act.count) {
      state.stats = null;
      box.innerHTML = '<div class="card">' + emptyState(ICON.chart,
        'За последние ' + state.period + ' дн. нет ни записей питания, ни измерений сахара, ни активности.<br>Добавьте данные в «Дневнике» и «Сахаре» или загрузите демо-данные, чтобы посмотреть, как выглядит статистика.',
        '<div class="btn-row" style="justify-content:center"><a class="btn btn-primary" href="#diary">Перейти в дневник</a>' +
        '<button type="button" class="btn" data-action="demo-load">Загрузить демо-данные</button></div>') + '</div>';
      return;
    }

    var pct = st.gCount ? Math.round(st.gInRange / st.gCount * 100) : null;
    var tiles =
      tile('Средняя калорийность', st.avgKcal != null ? fmtInt(st.avgKcal) + ' ккал' : '—',
        st.avgKcal != null ? 'в день (по дням с записями) · цель ' + fmtInt(s.kcalGoal) : 'нет записей питания') +
      tile('Дней с записями', st.loggedDays + ' из ' + st.days) +
      tile('Средние Б / Ж / У', st.avgKcal != null ? fmtInt(st.avgP) + ' / ' + fmtInt(st.avgF) + ' / ' + fmtInt(st.avgC) + ' г' : '—', 'в день') +
      tile('Средний сахар', st.gCount ? gFmt(st.gAvg) + ' <span class="small muted">' + u + '</span>' : '—',
        st.gCount ? 'измерений: ' + st.gCount : 'нет измерений') +
      tile('Мин. / макс. сахар', st.gCount ? gFmt(st.gMin) + ' / ' + gFmt(st.gMax) : '—', st.gCount ? u : '') +
      tile('В целевом диапазоне', pct != null ? pct + '%' : '—',
        pct != null ? st.gInRange + ' из ' + st.gCount + ' · ' + gFmt(s.low) + '–' + gFmt(s.high) + ' ' + u : '') +
      tile('Низких / высоких', st.gCount ? st.gLow + ' / ' + st.gHigh : '—',
        st.gCount ? 'из них очень высоких: ' + st.gVeryHigh : '') +
      tile('Средний сахар натощак', st.gFastingCount ? gFmt(st.gFastingAvg) + ' <span class="small muted">' + u + '</span>' : '—',
        st.gFastingCount ? 'измерений: ' + st.gFastingCount : 'нет измерений натощак') +
      tile('Активность в среднем', st.act.count ? fmtInt(st.act.avgMin) + ' мин/день' : '—',
        st.act.count ? 'всего ' + fmtInt(st.act.totalMin) + ' мин · дней от ' + ACTIVE_DAY_MIN + ' мин: ' + st.act.activeDays + ' из ' + st.days : 'нет записей активности') +
      tile('Сожжено активностью', st.act.count ? fmtInt(st.act.totalKcal) + ' ккал' : '—',
        st.act.count ? 'за период · ≈ ' + fmtInt(st.act.totalKcal / st.days) + ' ккал/день' : '');

    var avgKcalMacros = st.avgKcal != null ? (st.avgP * 4 + st.avgF * 9 + st.avgC * 4) : 0;
    var share = function (g, k) { return avgKcalMacros ? Math.round(g * k / avgKcalMacros * 100) + '%' : '—'; };
    var mealTotal = MEALS.reduce(function (a, m) { return a + st.mealK[m.key]; }, 0);

    var html = '<div class="tiles">' + tiles + '</div>';

    html += '<div class="grid-2">';
    // Калории
    html += '<section class="card"><div class="card-head"><h3>Калории по дням</h3></div>' +
      (st.loggedDays ? '<div class="chart-box"><canvas id="ch-kcal" role="img" aria-label="Столбчатая диаграмма калорий по дням с линией цели"></canvas></div>' +
        '<div class="chart-legend">' + legendItem('--series-1', 'Калории за день') + legendItem(null, 'Цель ' + fmtInt(s.kcalGoal) + ' ккал', true) + '</div>'
        : emptyState('', 'Нет записей питания за период.')) + '</section>';
    // БЖУ
    html += '<section class="card"><div class="card-head"><h3>Белки, жиры, углеводы по дням, г</h3></div>' +
      (st.loggedDays ? '<div class="chart-box"><canvas id="ch-macros" role="img" aria-label="Составные столбцы белков, жиров и углеводов по дням"></canvas></div>' +
        '<div class="chart-legend">' +
          legendItem(MACRO_COLORS.p, 'Белки — в среднем ' + fmtInt(st.avgP) + ' г (' + share(st.avgP, 4) + ' ккал)') +
          legendItem(MACRO_COLORS.f, 'Жиры — ' + fmtInt(st.avgF) + ' г (' + share(st.avgF, 9) + ')') +
          legendItem(MACRO_COLORS.c, 'Углеводы — ' + fmtInt(st.avgC) + ' г (' + share(st.avgC, 4) + ')') +
        '</div>'
        : emptyState('', 'Нет записей питания за период.')) + '</section>';
    html += '</div>';

    // Сахар
    html += '<section class="card"><div class="card-head"><h3>Сахар крови, ' + u + '</h3></div>' +
      (st.gCount ? '<div class="chart-box"><canvas id="ch-glucose" role="img" aria-label="График сахара крови с закрашенным целевым диапазоном"></canvas></div>' +
        '<div class="chart-legend">' +
          '<span><span class="dot" style="background:var(--chart-band);outline:1px dashed var(--chart-muted)"></span>Целевой диапазон ' + gFmt(s.low) + '–' + gFmt(s.high) + '</span>' +
          legendItem('--g-low', 'Низкий') + legendItem('--g-ok', 'В цели') + legendItem('--g-high', 'Высокий') + legendItem('--g-vhigh', 'Очень высокий') +
        '</div>'
        : emptyState('', 'Нет измерений сахара за период.')) + '</section>';

    if (st.loggedDays && st.gCount) html += linkSectionHtml(st, u);
    html += activitySectionHtml(st, u);

    html += '<div class="grid-2">';
    // Приёмы пищи
    html += '<section class="card"><div class="card-head"><h3>Калории по приёмам пищи</h3></div>' +
      (mealTotal > 0 ? '<div class="chart-box"><canvas id="ch-meals" role="img" aria-label="Кольцевая диаграмма распределения калорий по приёмам пищи"></canvas></div>' +
        '<div class="chart-legend">' + MEALS.map(function (m) {
          return legendItem(m.color, m.label + ' — ' + Math.round(st.mealK[m.key] / mealTotal * 100) + '%');
        }).join('') + '</div>'
        : emptyState('', 'Нет записей питания за период.')) + '</section>';
    // Топ продуктов
    var maxG = st.top.length ? st.top[0].grams : 1;
    html += '<section class="card"><div class="card-head"><h3>Топ-10 продуктов по весу</h3></div>' +
      (st.top.length ? '<table class="data"><thead><tr><th>#</th><th>Продукт</th><th class="r">Всего, г</th><th class="r">Раз</th><th class="r">Ккал</th></tr></thead><tbody>' +
        st.top.map(function (p, i) {
          return '<tr><td class="muted">' + (i + 1) + '</td><td class="bar-cell">' + esc(p.name) +
            '<div class="bar-bg" style="width:' + (p.grams / maxG * 100).toFixed(1) + '%"></div></td>' +
            '<td class="r">' + fmtInt(p.grams) + '</td><td class="r">' + p.count + '</td><td class="r">' + fmtInt(p.kcal) + '</td></tr>';
        }).join('') + '</tbody></table>'
        : emptyState('', 'Нет записей питания за период.')) + '</section>';
    html += '</div>';

    box.innerHTML = html;
    drawStatsCharts();
  }

  /** Таблица «ГН еды перед измерением → сахар после еды» */
  function linkTableHtml(L, u) {
    return '<table class="data"><thead><tr><th>ГН еды до измерения</th><th class="r" title="Число измерений">Изм.</th>' +
      '<th class="r" title="Углеводы съеденного, в среднем">Углев., г</th><th class="r">Сахар после, ' + u + '</th><th class="r">Выше цели</th></tr></thead><tbody>' +
      L.buckets.map(function (b) {
        return '<tr><td>' + b.label + '</td><td class="r">' + b.n + '</td>' +
          '<td class="r">' + (b.n ? fmtInt(b.carbs) : '—') + '</td>' +
          '<td class="r">' + (b.n ? '<b>' + gFmt(b.avg) + '</b>' : '—') + '</td>' +
          '<td class="r">' + (b.n ? b.pctHigh + '%' : '—') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function linkNotesHtml(L) {
    var notes = [];
    if (L.rCarbs != null) notes.push('Связь «углеводы перед измерением → сахар после еды»: r = ' + fmt(L.rCarbs, 2, true) + ' — ' + corrText(L.rCarbs) + '.');
    else if (L.pairs) notes.push('Для оценки связи нужно не меньше 5 измерений после еды с записями питания (сейчас: ' + L.pairs + ').');
    if (L.noFood) notes.push('Без записей еды за 4 ч до измерения: ' + L.noFood + ' — в расчёт не вошли.');
    if (L.noGi) notes.push('ГИ известен не для всех продуктов (например, супов и сложных блюд): в ' + L.noGi + ' из ' + L.pairs + ' случаев ГН еды может быть занижена.');
    return notes.map(function (n) { return '<p class="small muted" style="margin:6px 0 0">' + n + '</p>'; }).join('');
  }

  function linkSectionHtml(st, u) {
    var L = st.link;
    var html = '<section class="card"><div class="card-head"><h3>Питание и сахар после еды</h3></div>';
    if (!L.postCount) {
      return html + '<p class="small muted">Отмечайте измерения как «Через 1 ч после еды» или «Через 2 ч после еды» — ' +
        'здесь появится сравнение сахара после еды с углеводами и гликемической нагрузкой съеденного.</p></section>';
    }
    html += '<div class="chart-box"><canvas id="ch-link" role="img" aria-label="Углеводы за день (столбцы) и средний сахар после еды (точки)"></canvas></div>' +
      '<div class="chart-legend">' + legendItem('--series-3', 'Углеводы за день, г (левая шкала)') +
        '<span><span class="dot" style="background:var(--text);border-radius:50%"></span>Средний сахар после еды, ' + u + ' (правая шкала)</span>' +
        '<span><span class="dot" style="background:var(--chart-band);outline:1px dashed var(--chart-muted)"></span>Целевой диапазон</span></div>';
    if (L.pairs) html += '<div style="margin-top:12px;overflow-x:auto">' + linkTableHtml(L, u) + '</div>';
    html += linkNotesHtml(L) +
      '<p class="hint" style="margin-top:6px">Для каждого измерения «через 1 ч / 2 ч после еды» учитываются продукты, записанные за 30 мин – 4 ч до него. ' +
      'Связь не означает причинность: на сахар влияют также препараты, активность, стресс.</p></section>';
    return html;
  }

  /** Таблица «сахар и активность» (общая для экрана и отчёта); пустая строка, если данных мало */
  function actGlucoseTableHtml(A, u) {
    var rows = [], dc = A.daysCmp, ac = A.afterCmp;
    if (dc.daysA >= 2 && dc.daysB >= 2) {
      rows.push(['Дни с активностью от ' + ACTIVE_DAY_MIN + ' мин', dc.daysA + ' дн. / ' + dc.nA, gFmt(dc.a)]);
      rows.push(['Дни без активности или меньше ' + ACTIVE_DAY_MIN + ' мин', dc.daysB + ' дн. / ' + dc.nB, gFmt(dc.b)]);
    }
    if (ac.nA >= 3 && ac.nB >= 3) {
      rows.push(['Измерения во время активности и до 3 ч после', ac.nA + ' изм.', gFmt(ac.a)]);
      rows.push(['Остальные измерения', ac.nB + ' изм.', gFmt(ac.b)]);
    }
    if (!rows.length) return '';
    return '<table class="data"><thead><tr><th>Группа</th><th class="r">Дней / измерений</th><th class="r">Средний сахар, ' + u + '</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="r">' + r[1] + '</td><td class="r"><b>' + r[2] + '</b></td></tr>'; }).join('') +
      '</tbody></table>';
  }

  function activitySectionHtml(st, u) {
    var A = st.act;
    if (!A.count) {
      return '<section class="card"><div class="card-head"><h3>Активность</h3></div>' +
        '<p class="small muted">Записывайте прогулки, тренировки и работу в саду в разделе «Активность» дневника — здесь появятся минуты, сожжённые калории и сравнение сахара в активные и неактивные дни.</p></section>';
    }
    var html = '<div class="grid-2">' +
      '<section class="card"><div class="card-head"><h3>Активность по дням, мин</h3></div>' +
        '<div class="chart-box"><canvas id="ch-act" role="img" aria-label="Минуты активности по дням с линией 30 минут"></canvas></div>' +
        '<div class="chart-legend">' + legendItem('--series-2', 'Минуты активности') + legendItem(null, ACTIVE_DAY_MIN + ' мин в день', true) + '</div>' +
      '</section>' +
      '<section class="card"><div class="card-head"><h3>Частые виды активности</h3></div>' +
        '<table class="data"><thead><tr><th>Вид</th><th class="r">Раз</th><th class="r">Мин</th><th class="r">Ккал</th></tr></thead><tbody>' +
        A.top.map(function (t) {
          return '<tr><td>' + esc(t.name) + '</td><td class="r">' + t.count + '</td><td class="r">' + fmtInt(t.min) + '</td><td class="r">' + fmtInt(t.kcal) + '</td></tr>';
        }).join('') + '</tbody></table>' +
      '</section></div>';
    if (st.gCount) {
      var tbl = actGlucoseTableHtml(A, u);
      html += '<section class="card"><div class="card-head"><h3>Активность и сахар</h3></div>' +
        (tbl ? '<div style="overflow-x:auto">' + tbl + '</div>'
          : '<p class="small muted">Пока мало данных для сравнения: нужны хотя бы 2 дня с активностью от ' + ACTIVE_DAY_MIN + ' мин и 2 дня без неё (с измерениями сахара) или по 3 измерения после активности и в другое время.</p>') +
        '<p class="hint" style="margin-top:6px">Это простое сравнение средних, а не доказательство влияния: на сахар одновременно действуют питание, препараты, сон, стресс и время измерения. ' +
        'Если вы получаете инсулин или препараты, снижающие сахар, обсудите режим нагрузок с врачом — активность может вызывать гипогликемию, в том числе отсроченную.</p></section>';
    }
    return html;
  }

  function drawStatsCharts() {
    var st = state.stats;
    if (!st || state.view !== 'stats') return;
    var s = S(), css = Charts.cssVar;
    var labels = st.dates.map(fmtDDMM);
    var short = function (d) { return fmtDDMM(d) + ', ' + strToDate(d).toLocaleDateString('ru-RU', { weekday: 'short' }); };

    var cK = $('#ch-kcal');
    if (cK) {
      Charts.bar(cK, {
        labels: labels,
        values: st.dates.map(function (d) { return st.byDate[d].kcal; }),
        goal: s.kcalGoal,
        goalLabel: 'Цель ' + fmtInt(s.kcalGoal),
        color: css('--series-1'),
        height: 220,
        tips: st.dates.map(function (d) {
          var b = st.byDate[d];
          return short(d) + '\n' + (b.n ? fmtInt(b.kcal) + ' ккал (' + fmtInt(b.kcal / s.kcalGoal * 100) + '% цели)' : 'нет записей');
        })
      });
    }

    var cM = $('#ch-macros');
    if (cM) {
      Charts.stacked(cM, {
        labels: labels,
        height: 220,
        series: [
          { name: 'Белки', color: css(MACRO_COLORS.p), values: st.dates.map(function (d) { return st.byDate[d].p; }) },
          { name: 'Жиры', color: css(MACRO_COLORS.f), values: st.dates.map(function (d) { return st.byDate[d].f; }) },
          { name: 'Углеводы', color: css(MACRO_COLORS.c), values: st.dates.map(function (d) { return st.byDate[d].c; }) }
        ],
        tips: st.dates.map(function (d) {
          var b = st.byDate[d];
          return short(d) + '\n' + (b.n ? 'Белки ' + fmt1(b.p) + ' г\nЖиры ' + fmt1(b.f) + ' г\nУглеводы ' + fmt1(b.c) + ' г' : 'нет записей');
        })
      });
    }

    var cG = $('#ch-glucose');
    if (cG) {
      var mg = isMgdl();
      var conv = function (mm) { return mg ? mm * MGDL : mm; };
      var points = st.glucose.map(function (g) {
        var p = g.time.split(':');
        var stt = gStatus(g.mmol);
        return {
          t: strToDate(g.date, +p[0], +p[1]).getTime(),
          v: conv(g.mmol),
          color: css(STATUS[stt].color),
          tip: fmtDDMM(g.date) + ' ' + g.time + ' — ' + gFmt(g.mmol) + ' ' + unitLabel() + '\n' +
            (CTX_LABEL[g.ctx] || '') + ' · ' + STATUS[stt].label + (g.note ? '\n' + g.note.slice(0, 80) : '')
        };
      });
      Charts.glucose(cG, {
        points: points,
        tMin: strToDate(st.start, 0, 0).getTime(),
        tMax: strToDate(addDays(st.end, 1), 0, 0).getTime(),
        low: conv(s.low),
        high: conv(s.high),
        height: 250,
        dayTicks: st.dates.map(function (d) { return { t: strToDate(d, 0, 0).getTime(), label: fmtDDMM(d) }; })
      });
    }

    var cL = $('#ch-link');
    if (cL) {
      var mg2 = isMgdl();
      var conv2 = function (mm) { return mm == null ? null : (mg2 ? mm * MGDL : mm); };
      var daily = st.link.daily;
      Charts.combo(cL, {
        labels: labels,
        height: 230,
        bars: daily.map(function (x) { return x.carbs; }),
        barColor: css('--series-3'),
        points: daily.map(function (x) { return conv2(x.post); }),
        pointColors: daily.map(function (x) { return x.post == null ? null : css(STATUS[gStatus(x.post)].color); }),
        low: conv2(s.low),
        high: conv2(s.high),
        rightFmt: mg2 ? function (v) { return String(Math.round(v)); } : null,
        tips: daily.map(function (x) {
          return short(x.date) + '\n' + (x.hasFood ? 'Углеводы: ' + fmtInt(x.carbs) + ' г' : 'нет записей питания') +
            (x.post != null ? '\nСахар после еды: ' + gFmt(x.post) + ' ' + unitLabel() + (x.postN > 1 ? ' (среднее из ' + x.postN + ')' : '') : '');
        })
      });
    }

    var cA = $('#ch-act');
    if (cA) {
      var AB = st.act.byDate;
      Charts.bar(cA, {
        labels: labels,
        values: st.dates.map(function (d) { return AB[d].min; }),
        goal: ACTIVE_DAY_MIN,
        goalLabel: ACTIVE_DAY_MIN + ' мин',
        color: css('--series-2'),
        overColor: css('--series-2'), // превышение «цели» по активности — это хорошо, цвет не меняем
        height: 200,
        tips: st.dates.map(function (d) {
          var b = AB[d];
          return short(d) + '\n' + (b.min ? b.min + ' мин · ' + fmtInt(b.kcal) + ' ккал\n' + b.names.slice(0, 3).join(', ') : 'нет активности');
        })
      });
    }

    var cP = $('#ch-meals');
    if (cP) {
      var total = MEALS.reduce(function (a, m) { return a + st.mealK[m.key]; }, 0);
      Charts.donut(cP, {
        height: 220,
        items: MEALS.map(function (m) {
          return {
            label: m.label, value: st.mealK[m.key], color: css(m.color),
            tip: m.label + ': ' + fmtInt(st.mealK[m.key]) + ' ккал (' + Math.round(st.mealK[m.key] / total * 100) + '%)\nв среднем ' +
              fmtInt(st.loggedDays ? st.mealK[m.key] / st.loggedDays : 0) + ' ккал в день'
          };
        }),
        center: fmtInt(total / Math.max(1, st.loggedDays)),
        centerSub: 'ккал в день'
      });
    }
  }

  // =====================================================================
  // ОТЧЁТ ДЛЯ ВРАЧА (печать / сохранение в PDF)
  // =====================================================================
  var REPORT_COLS = [
    { label: 'Натощак', ctx: ['fasting'] },
    { label: 'До еды', ctx: ['before'] },
    { label: 'После еды (1–2 ч)', ctx: ['after1', 'after2'] },
    { label: 'Перед сном', ctx: ['bedtime'] },
    { label: 'Ночью / другое', ctx: ['night', 'other'] }
  ];

  /** Значение сахара для печати: стрелка дублирует цвет (отчёт часто печатают в ч/б) */
  function gPrint(g, withTime) {
    var stt = gStatus(g.mmol);
    var mark = stt === 'low' ? ' ↓' : stt === 'high' ? ' ↑' : stt === 'vhigh' ? ' ↑↑' : '';
    return '<span class="rp-g ' + STATUS[stt].cls + '">' + gFmt(g.mmol) + mark + '</span>' +
      (withTime ? ' <small>' + esc(g.time) + '</small>' : '');
  }

  function buildReport(st) {
    var s = S(), u = unitLabel();
    var kv = function (rows) {
      return '<table class="rp-kv"><tbody>' + rows.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</tbody></table>';
    };
    var pct = st.gCount ? Math.round(st.gInRange / st.gCount * 100) + '% (' + st.gInRange + ' из ' + st.gCount + ')' : '—';
    var html = '<header class="rp-head"><h1>Дневник сахара и питания</h1>' +
      '<p>Период: <b>' + fmtDDMMYYYY(st.start) + ' – ' + fmtDDMMYYYY(st.end) + '</b> (' + st.days + ' дн.) · ' +
      'единицы: ' + u + ' · целевой диапазон: ' + gFmt(s.low) + '–' + gFmt(s.high) + ' ' + u +
      ' · сформирован ' + fmtDDMMYYYY(todayStr()) + ' ' + nowTime() + '</p>' +
      '<p class="rp-patient">Пациент: ______________________________ &nbsp; Дата рождения: ____________</p></header>';

    html += '<div class="rp-grid"><section><h2>Сахар крови</h2>' + kv([
      ['Измерений', st.gCount || '—'],
      ['Средний', st.gCount ? gFmt(st.gAvg) + ' ' + u : '—'],
      ['Мин. / макс.', st.gCount ? gFmt(st.gMin) + ' / ' + gFmt(st.gMax) + ' ' + u : '—'],
      ['В целевом диапазоне', pct],
      ['Ниже цели (↓)', st.gCount ? st.gLow : '—'],
      ['Выше цели (↑) / из них очень высоких (↑↑, > ' + gFmt(s.veryHigh) + ')', st.gCount ? st.gHigh + ' / ' + st.gVeryHigh : '—']
    ]) + '</section>';
    html += '<section><h2>Питание</h2>' + kv([
      ['Дней с записями', st.loggedDays + ' из ' + st.days],
      ['Калорийность в среднем', st.avgKcal != null ? fmtInt(st.avgKcal) + ' ккал/день (цель ' + fmtInt(s.kcalGoal) + ')' : '—'],
      ['Белки / жиры / углеводы', st.avgKcal != null ? fmtInt(st.avgP) + ' / ' + fmtInt(st.avgF) + ' / ' + fmtInt(st.avgC) + ' г/день' : '—'],
      ['Гликемическая нагрузка', st.avgGl != null ? fmtInt(st.avgGl) + ' в день (по продуктам с известным ГИ)' : '—']
    ]) + '</section></div>';

    var A = st.act;
    if (A.count) {
      html += '<section><h2>Физическая активность</h2>' + kv([
        ['Всего за период', fmtInt(A.totalMin) + ' мин, ≈ ' + fmtInt(A.totalKcal) + ' ккал'],
        ['В среднем', fmtInt(A.avgMin) + ' мин/день'],
        ['Дней с активностью от ' + ACTIVE_DAY_MIN + ' мин', A.activeDays + ' из ' + st.days],
        ['Основные виды', A.top.slice(0, 3).map(function (t) { return esc(t.name) + ' (' + fmtInt(t.min) + ' мин)'; }).join('; ')]
      ]) + (st.gCount ? actGlucoseTableHtml(A, u) : '') + '</section>';
    }

    var ctxRows = st.ctxAvg.filter(function (c) { return c.n; });
    if (ctxRows.length) {
      html += '<section><h2>Сахар по времени измерения, ' + u + '</h2><table class="data"><thead><tr><th>Когда измерено</th><th class="r">Измерений</th><th class="r">Среднее</th><th class="r">Мин.</th><th class="r">Макс.</th></tr></thead><tbody>' +
        ctxRows.map(function (c) {
          return '<tr><td>' + c.label + '</td><td class="r">' + c.n + '</td><td class="r"><b>' + gFmt(c.avg) + '</b></td><td class="r">' + gFmt(c.min) + '</td><td class="r">' + gFmt(c.max) + '</td></tr>';
        }).join('') + '</tbody></table></section>';
    }

    if (st.link.pairs) {
      html += '<section><h2>Питание и сахар после еды</h2>' + linkTableHtml(st.link, u) + linkNotesHtml(st.link) + '</section>';
    }

    // Дневник по дням (только дни с данными)
    var gByDate = {};
    st.glucose.slice().sort(byDateTime).forEach(function (g) { (gByDate[g.date] = gByDate[g.date] || []).push(g); });
    var rows = st.dates.filter(function (d) { return st.byDate[d].n || gByDate[d] || A.byDate[d].min; }).map(function (d) {
      var b = st.byDate[d], gs = gByDate[d] || [], am = A.byDate[d].min;
      return '<tr><td class="nowrap">' + fmtDDMM(d) + ' ' + strToDate(d).toLocaleDateString('ru-RU', { weekday: 'short' }) + '</td>' +
        REPORT_COLS.map(function (col) {
          var vals = gs.filter(function (g) { return col.ctx.indexOf(g.ctx) >= 0; });
          return '<td>' + vals.map(function (g) { return gPrint(g, col.ctx[0] !== 'fasting'); }).join('<br>') + '</td>';
        }).join('') +
        '<td class="r">' + (b.n ? fmtInt(b.kcal) : '') + '</td>' +
        '<td class="r nowrap">' + (b.n ? fmtInt(b.p) + ' / ' + fmtInt(b.f) + ' / ' + fmtInt(b.c) : '') + '</td>' +
        '<td class="r">' + (b.n ? fmtInt(b.gl) : '') + '</td>' +
        '<td class="r">' + (am ? am : '') + '</td></tr>';
    });
    html += '<section><h2>Дневник по дням</h2><table class="data rp-days"><thead><tr><th>Дата</th>' +
      REPORT_COLS.map(function (c) { return '<th>' + c.label + '</th>'; }).join('') +
      '<th class="r">Ккал</th><th class="r">Б / Ж / У, г</th><th class="r">ГН</th><th class="r">Активн., мин</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
      '<p class="rp-legend">↓ — ниже цели (&lt; ' + gFmt(s.low) + '), ↑ — выше цели (&gt; ' + gFmt(s.high) + '), ↑↑ — очень высокий (&gt; ' + gFmt(s.veryHigh) + '). ' +
      'Время измерения указано мелким шрифтом.</p></section>';

    var notes = st.glucose.filter(function (g) { return g.note; }).sort(byDateTime);
    if (notes.length) {
      html += '<section><h2>Заметки к измерениям</h2><ul class="rp-notes">' + notes.map(function (g) {
        return '<li>' + fmtDDMM(g.date) + ' ' + esc(g.time) + ' — ' + gPrint(g) + ' ' + u + ', ' + esc((CTX_LABEL[g.ctx] || '').toLowerCase()) + ': ' + esc(g.note) + '</li>';
      }).join('') + '</ul></section>';
    }
    html += '<p class="rp-foot">Данные внесены пациентом вручную в приложении «Дневник питания и сахара». Калорийность, ГИ и ГН — ориентировочные.</p>';
    return html;
  }

  function printReport() {
    var st = computeStats(state.period);
    if (!st.loggedDays && !st.gCount && !st.act.count) { toast('За выбранный период нет данных для отчёта', true); return; }
    Charts.hideTip();
    if (isIOS()) {
      // На iPhone/iPad (особенно в установленном приложении) печать из скрипта ненадёжна:
      // показываем отчёт на экране с кнопками «Печать» и «Поделиться» (там есть «Сохранить в Файлы» и печать).
      $('#print-report').innerHTML =
        '<div class="rp-toolbar">' +
          '<button type="button" class="btn btn-primary btn-sm" data-action="report-print">Печать / PDF</button>' +
          (canShareFiles() ? '<button type="button" class="btn btn-sm" data-action="report-share">Поделиться</button>' : '') +
          '<button type="button" class="btn btn-sm" data-action="report-close">Закрыть</button>' +
          '<p class="rp-tip">Если окно печати не открылось, нажмите «Поделиться» и выберите «Напечатать» или «Сохранить в Файлы». ' +
          'В окне печати PDF можно получить, разведя двумя пальцами миниатюру страницы.</p>' +
        '</div><div class="rp-body">' + buildReport(st) + '</div>';
      document.body.classList.add('report-screen');
      window.scrollTo(0, 0);
      return;
    }
    $('#print-report').innerHTML = '<div class="rp-body">' + buildReport(st) + '</div>';
    document.body.classList.add('printing-report');
    window.print();
    // очистка — по событию afterprint (см. init); класс влияет только на печать, на экране отчёт не виден
  }

  function endPrintReport() {
    // в экранном режиме (iPhone) отчёт остаётся открытым после печати — закрывается кнопкой
    if (document.body.classList.contains('report-screen') && this === window) return;
    document.body.classList.remove('printing-report');
    document.body.classList.remove('report-screen');
    $('#print-report').innerHTML = '';
  }

  // Короткие стили для отчёта, которым делятся как HTML-файлом (iPhone → «Поделиться»)
  var REPORT_SHARE_CSS = 'body{font:12pt -apple-system,system-ui,sans-serif;color:#000;margin:16px}' +
    'h1{font-size:18pt;margin:0 0 4pt}h2{font-size:13pt;margin:14pt 0 4pt}table{width:100%;border-collapse:collapse;font-size:10pt}' +
    'th,td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top}th{background:#eee}.r{text-align:right}' +
    '.rp-g{font-weight:700;white-space:nowrap}.st-low,.st-high,.st-vhigh{text-decoration:underline}small{color:#444}' +
    '.rp-legend,.rp-foot{font-size:9pt;color:#333}.rp-kv th{width:55%;background:none;font-weight:500}';

  function shareReport() {
    var body = $('#print-report .rp-body');
    if (!body) return;
    var html = '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Дневник сахара и питания</title><style>' + REPORT_SHARE_CSS + '</style></head><body>' + body.innerHTML + '</body></html>';
    var file = new File([html], 'otchet-' + todayStr() + '.html', { type: 'text/html' });
    try {
      navigator.share({ files: [file], title: 'Дневник сахара и питания' }).catch(function (e) {
        if (e && e.name !== 'AbortError') toast('Не удалось поделиться отчётом', true);
      });
    } catch (e) { toast('Не удалось поделиться отчётом', true); }
  }

  // =====================================================================
  // НАСТРОЙКИ
  // =====================================================================
  function renderSettings() {
    var s = S();
    var cnt = {
      e: Store.list('entries').length,
      g: Store.list('glucose').length,
      c: Store.list('customFoods').length,
      a: Store.list('activity').length,
      demo: ['entries', 'glucose', 'activity'].reduce(function (n, k) {
        return n + Store.list(k).filter(function (x) { return x.demo; }).length;
      }, 0)
    };
    var u = s.unit;
    var html = syncCardHtml() +
      '<div class="grid-2">' +
      '<form class="card settings-section" id="settings-form" novalidate data-unit="' + u + '">' +
        '<h3>Цели питания</h3>' +
        '<div class="field"><label for="s-kcal">Дневная норма калорий, ккал</label><input id="s-kcal" type="text" inputmode="numeric" value="' + s.kcalGoal + '"></div>' +
        '<div class="row-3">' +
          '<div class="field"><label for="s-p">Белки, г</label><input id="s-p" type="text" inputmode="decimal" placeholder="не задано" value="' + inputNum(s.pGoal) + '"></div>' +
          '<div class="field"><label for="s-f">Жиры, г</label><input id="s-f" type="text" inputmode="decimal" placeholder="не задано" value="' + inputNum(s.fGoal) + '"></div>' +
          '<div class="field"><label for="s-c">Углеводы, г</label><input id="s-c" type="text" inputmode="decimal" placeholder="не задано" value="' + inputNum(s.cGoal) + '"></div>' +
        '</div>' +
        '<p class="hint" style="margin-top:-6px">Цели по БЖУ необязательны — оставьте поле пустым, если не нужны.</p>' +
        '<h3 style="margin-top:16px">Сахар крови</h3>' +
        '<div class="field"><label for="s-unit">Единицы измерения</label><select id="s-unit">' +
          '<option value="mmol"' + (u === 'mmol' ? ' selected' : '') + '>ммоль/л</option>' +
          '<option value="mgdl"' + (u === 'mgdl' ? ' selected' : '') + '>мг/дл</option></select></div>' +
        '<div class="row-3">' +
          '<div class="field"><label for="s-low">Нижняя граница цели</label><input id="s-low" type="text" inputmode="decimal" value="' + gInput(s.low, u) + '"></div>' +
          '<div class="field"><label for="s-high">Верхняя граница цели</label><input id="s-high" type="text" inputmode="decimal" value="' + gInput(s.high, u) + '"></div>' +
          '<div class="field"><label for="s-vhigh">«Очень высокий» выше</label><input id="s-vhigh" type="text" inputmode="decimal" value="' + gInput(s.veryHigh, u) + '"></div>' +
        '</div>' +
        '<p class="hint" style="margin-top:-6px">Значения в <b class="unit-lbl">' + unitLabel(u) + '</b>. По умолчанию: 3,9 / 7,8 / 13,9 ммоль/л (70 / 141 / 250 мг/дл). Индивидуальные цели согласуйте с врачом.</p>' +
        '<h3 style="margin-top:16px">Активность</h3>' +
        '<div class="field"><label for="s-weight">Вес тела, кг</label><input id="s-weight" type="text" inputmode="decimal" placeholder="не указан (считается ' + DEFAULT_WEIGHT + ')" value="' + inputNum(s.weight) + '"></div>' +
        '<p class="hint" style="margin-top:-6px">Нужен для расчёта сожжённых калорий: ккал = MET × вес × время. Если не указан, используется ' + DEFAULT_WEIGHT + ' кг.</p>' +
        '<div id="settings-error" class="form-error" role="alert"></div>' +
        '<div class="btn-row" style="margin-top:12px">' +
          '<button type="submit" class="btn btn-primary">Сохранить настройки</button>' +
          '<button type="button" class="btn" data-action="settings-reset">Сбросить по умолчанию</button>' +
        '</div>' +
      '</form>' +
      '<div>' +
        '<section class="card settings-section"><h3>Резервная копия</h3>' +
          '<p class="small muted">Данные хранятся только на этом устройстве. Время от времени сохраняйте резервную копию в JSON — из неё можно всё восстановить (это не то же самое, что синхронизация: импорт копии просто добавляет или заменяет данные).</p>' +
          '<div class="btn-row" style="margin-bottom:8px">' +
            '<button type="button" class="btn btn-primary" data-action="export-json">Экспорт в JSON</button>' +
            '<button type="button" class="btn" data-action="import-json">Импорт из JSON…</button>' +
          '</div>' +
          '<div class="btn-row">' +
            '<button type="button" class="btn" data-action="csv-food">CSV: питание</button>' +
            '<button type="button" class="btn" data-action="csv-glucose">CSV: сахар</button>' +
            '<button type="button" class="btn" data-action="csv-activity">CSV: активность</button>' +
          '</div>' +
          '<p class="hint" style="margin-top:8px">CSV в кодировке UTF-8 с разделителем «;» — открывается в русском Excel.</p>' +
        '</section>' +
        '<section class="card settings-section"><h3>Демо-данные</h3>' +
          '<p class="small muted">Для знакомства с приложением: добавляет примерно 14 дней записей питания, измерений сахара и активности. Демо-записи помечаются и удаляются отдельной кнопкой, ваши данные не затрагиваются.</p>' +
          '<div class="btn-row">' +
            '<button type="button" class="btn" data-action="demo-load">Загрузить демо-данные</button>' +
            '<button type="button" class="btn" data-action="demo-remove"' + (cnt.demo ? '' : ' disabled') + '>Удалить демо-данные' + (cnt.demo ? ' (' + cnt.demo + ')' : '') + '</button>' +
          '</div>' +
        '</section>' +
        '<section class="card settings-section"><h3>Хранилище</h3>' +
          '<ul class="info-list">' +
            '<li>Состояние: ' + (Store.available ? 'localStorage доступен' : '<b>недоступно</b> — данные не сохранятся после закрытия') + '</li>' +
            '<li>Записей питания: ' + cnt.e + '</li>' +
            '<li>Измерений сахара: ' + cnt.g + '</li>' +
            '<li>Записей активности: ' + cnt.a + '</li>' +
            '<li>Моих продуктов: ' + cnt.c + '</li>' +
            '<li>Запомнено из распознавания по фото: ' + Store.list('aiMemory').length + ' (не больше ' + Store.AI_MEMORY_MAX + ')</li>' +
            (Store.available ? '<li>Объём данных: ≈ ' + fmtInt(Store.usage(true) / 1000) + ' тыс. символов — ' + storagePct() + '% от лимита ' +
              '(считаем по самому строгому браузеру — Safari на iPhone, около 2,5 млн символов; при ~12 записях питания в день это примерно 2 года)</li>' : '') +
          '</ul>' +
          '<div style="margin-top:12px"><button type="button" class="btn btn-danger" data-action="clear-all">Удалить все данные…</button></div>' +
        '</section>' +
      '</div>' +
      '</div>' +
      (function () { var p = PhotoUI.settingsParts(); return '<div class="grid-2">' + p.ai + '<div>' + p.refs + p.mem + '</div></div>'; })() +
      '<p class="disclaimer"><b>Важно.</b> Приложение не является медицинским изделием. Расчёты калорий, ГИ и ГН ориентировочные. ' +
        'Не используйте его для подбора доз инсулина и других препаратов — по всем вопросам лечения консультируйтесь с врачом.</p>';
    $('#settings-content').innerHTML = html;
  }

  function settingsError(msg, fieldId) {
    var el = $('#settings-error');
    if (el) el.textContent = msg || '';
    $$('#settings-form .invalid').forEach(function (x) { x.classList.remove('invalid'); });
    if (fieldId) { var f = document.getElementById(fieldId); if (f) { f.classList.add('invalid'); f.focus(); } }
  }

  function saveSettingsForm(form) {
    var unit = $('#s-unit', form).value;
    var kcal = parseNum($('#s-kcal', form).value);
    if (!(kcal >= 500 && kcal <= 10000)) return settingsError('Норма калорий: число от 500 до 10 000.', 's-kcal');
    var goals = {};
    var mf = [['pGoal', 's-p', 'Белки'], ['fGoal', 's-f', 'Жиры'], ['cGoal', 's-c', 'Углеводы']];
    for (var i = 0; i < mf.length; i++) {
      var raw = $('#' + mf[i][1], form).value.trim();
      if (!raw) { goals[mf[i][0]] = null; continue; }
      var v = parseNum(raw);
      if (!(v > 0 && v <= 1000)) return settingsError(mf[i][2] + ': число от 1 до 1000 г или пустое поле.', mf[i][1]);
      goals[mf[i][0]] = round1(v);
    }
    var low = parseNum($('#s-low', form).value), high = parseNum($('#s-high', form).value), vh = parseNum($('#s-vhigh', form).value);
    if (![low, high, vh].every(function (x) { return x > 0; })) return settingsError('Границы сахара: введите положительные числа.', 's-low');
    // Если значение не меняли (только сменили единицы) — сохраняем исходное в ммоль/л без потерь округления
    var cur = S();
    var keep = function (id, stored, v) { return parseNum($(id, form).value) === parseNum(gInput(stored, unit)) ? stored : toMmol(v, unit); };
    low = keep('#s-low', cur.low, low); high = keep('#s-high', cur.high, high); vh = keep('#s-vhigh', cur.veryHigh, vh);
    if (low < 2 || low > 10) return settingsError('Нижняя граница: от ' + gFmt(2, unit) + ' до ' + gFmt(10, unit) + ' ' + unitLabel(unit) + '.', 's-low');
    if (high <= low || high > 20) return settingsError('Верхняя граница должна быть больше нижней и не выше ' + gFmt(20, unit) + ' ' + unitLabel(unit) + '.', 's-high');
    if (vh <= high || vh > 35) return settingsError('Порог «очень высокий» должен быть больше верхней границы цели (не выше ' + gFmt(35, unit) + ').', 's-vhigh');
    var wRaw = $('#s-weight', form).value.trim(), weight = null;
    if (wRaw) {
      weight = parseNum(wRaw);
      if (!(weight >= 20 && weight <= 300)) return settingsError('Вес: число от 20 до 300 кг или пустое поле.', 's-weight');
      weight = round1(weight);
    }
    var ok = Store.saveSettings({
      kcalGoal: Math.round(kcal), pGoal: goals.pGoal, fGoal: goals.fGoal, cGoal: goals.cGoal,
      unit: unit, low: Math.round(low * 100) / 100, high: Math.round(high * 100) / 100, veryHigh: Math.round(vh * 100) / 100,
      weight: weight
    });
    checkSaved(ok);
    renderSettings();
    toast('Настройки сохранены');
  }

  /** При смене единиц пересчитываем введённые пороги */
  function onUnitChange(form) {
    var oldU = form.getAttribute('data-unit'), newU = $('#s-unit', form).value;
    if (oldU === newU) return;
    ['#s-low', '#s-high', '#s-vhigh'].forEach(function (id) {
      var inp = $(id, form), v = parseNum(inp.value);
      if (v > 0) inp.value = gInput(toMmol(v, oldU), newU);
    });
    form.setAttribute('data-unit', newU);
    var lbl = $('.unit-lbl', form);
    if (lbl) lbl.textContent = unitLabel(newU);
  }

  // ---------- Экспорт / импорт ----------
  function download(name, text, mime) {
    try {
      var blob = new Blob([text], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      return true;
    } catch (e) {
      toast('Не удалось сохранить файл: ' + e.message, true);
      return false;
    }
  }

  function exportJson() {
    var data = Store.exportAll();
    if (download('foodtracker-backup-' + todayStr() + '.json', JSON.stringify(data, null, 2), 'application/json;charset=utf-8')) {
      toast('Резервная копия сохранена');
    }
  }

  function csvText(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // защита от формул в Excel
    if (/[";\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function csvNum(n, d) {
    if (n == null || !isFinite(n)) return '';
    var k = Math.pow(10, d || 0);
    return String(Math.round(n * k) / k).replace('.', ',');
  }
  function toCsv(rows) { return '﻿' + rows.map(function (r) { return r.join(';'); }).join('\r\n') + '\r\n'; }
  function byDateTime(a, b) { return (a.date + a.time).localeCompare(b.date + b.time); }

  function exportFoodCsv() {
    var list = Store.list('entries').slice().sort(byDateTime);
    if (!list.length) { toast('Нет записей питания для экспорта', true); return; }
    var rows = [['Дата', 'Время', 'Приём пищи', 'Блюдо', 'Продукт', 'Количество, г', 'Ккал', 'Белки, г', 'Жиры, г', 'Углеводы, г', 'ГИ', 'Источник ГИ', 'ГН']];
    list.forEach(function (e) {
      var c = calc(e);
      var src = e.gi != null ? (e.giSrc === 'e' ? 'оценка' : e.giSrc === 'u' ? 'своё значение' : 'таблицы') : (giNA(e) ? 'неприменимо' : '');
      if (e.src === 'ai') src = (src ? src + ', ' : '') + 'значения ИИ';
      rows.push([fmtDDMMYYYY(e.date), e.time, MEAL_LABEL[e.meal], csvText(e.dishName || ''), csvText(e.name), csvNum(e.grams, 1), csvNum(c.kcal, 0),
        csvNum(c.p, 1), csvNum(c.f, 1), csvNum(c.c, 1), e.gi != null ? csvNum(e.gi, 0) : '', src, c.gl != null ? csvNum(c.gl, 1) : '']);
    });
    if (download('foodtracker-pitanie-' + todayStr() + '.csv', toCsv(rows), 'text/csv;charset=utf-8')) toast('CSV с питанием сохранён');
  }

  function exportActivityCsv() {
    var list = Store.list('activity').slice().sort(byDateTime);
    if (!list.length) { toast('Нет записей активности для экспорта', true); return; }
    var rows = [['Дата', 'Время', 'Вид активности', 'Интенсивность', 'Длительность, мин', 'MET', 'Ккал', 'Шаги', 'Заметка']];
    list.forEach(function (a) {
      rows.push([fmtDDMMYYYY(a.date), a.time, csvText(a.name), a.type === 'custom' ? '' : INTENSITY_LABEL[a.intensity],
        a.minutes, a.met != null ? csvNum(a.met, 1) : '', csvNum(a.kcal, 0), a.steps != null ? a.steps : '', csvText(a.note)]);
    });
    if (download('foodtracker-aktivnost-' + todayStr() + '.csv', toCsv(rows), 'text/csv;charset=utf-8')) toast('CSV с активностью сохранён');
  }

  function exportGlucoseCsv() {
    var list = Store.list('glucose').slice().sort(byDateTime);
    if (!list.length) { toast('Нет измерений сахара для экспорта', true); return; }
    var rows = [['Дата', 'Время', 'Сахар, ммоль/л', 'Сахар, мг/дл', 'Когда измерено', 'Статус', 'Заметка']];
    list.forEach(function (g) {
      rows.push([fmtDDMMYYYY(g.date), g.time, csvNum(g.mmol, 1), csvNum(g.mmol * MGDL, 0), CTX_LABEL[g.ctx],
        STATUS[gStatus(g.mmol)].label, csvText(g.note)]);
    });
    if (download('foodtracker-sahar-' + todayStr() + '.csv', toCsv(rows), 'text/csv;charset=utf-8')) toast('CSV с измерениями сохранён');
  }

  var IMPORT_FAIL = 'Импорт не выполнен: не хватает места в хранилище браузера. Данные на этом устройстве не изменены.';

  function startImport() {
    var inp = $('#import-file');
    inp.value = '';
    inp.click();
  }

  function handleImportFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { toast('Файл слишком большой (более 20 МБ)', true); return; }
    var reader = new FileReader();
    reader.onerror = function () { toast('Не удалось прочитать файл', true); };
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(String(reader.result).replace(/^﻿/, '')); }
      catch (e) { toast('Файл не является корректным JSON', true); return; }
      var parsed = Store.parseImport(obj);
      if (!parsed) { toast('Структура файла не распознана — это не резервная копия приложения', true); return; }
      var total = parsed.entries.length + parsed.glucose.length + parsed.customFoods.length + parsed.activity.length + parsed.aiMemory.length;
      if (!total && !parsed.settings) { toast('В файле нет данных для импорта', true); return; }
      Modal.open({
        title: 'Импорт данных',
        html: '<p>Файл: <b>' + esc(file.name) + '</b></p>' +
          '<ul class="info-list">' +
            '<li>Записей питания: ' + parsed.entries.length + '</li>' +
            '<li>Измерений сахара: ' + parsed.glucose.length + '</li>' +
            '<li>Записей активности: ' + parsed.activity.length + '</li>' +
            '<li>Моих продуктов: ' + parsed.customFoods.length + '</li>' +
            (parsed.aiMemory.length ? '<li>Запомненное по фото: ' + parsed.aiMemory.length + '</li>' : '') +
            '<li>Настройки: ' + (parsed.settings ? 'есть' : 'нет') + '</li>' +
            (parsed.skipped ? '<li>Пропущено некорректных элементов: ' + parsed.skipped + '</li>' : '') +
          '</ul>' +
          '<p class="small muted" style="margin-top:10px"><b>Объединить</b> — добавить записи, которых ещё нет (текущие данные и настройки сохранятся).<br>' +
          '<b>Заменить всё</b> — удалить текущие данные и загрузить данные из файла (включая настройки).</p>' +
          (Store.syncMeta().lastSync ? '<p class="small muted">Вы пользуетесь синхронизацией: импорт меняет данные только на этом устройстве. ' +
            'При следующей синхронизации записи с других устройств снова добавятся, а более новые правки из файла синхронизации заменят старые. ' +
            'Записи из копии, удалённые на этом устройстве, восстановятся и на других устройствах.</p>' : ''),
        buttons: [
          { label: 'Заменить всё', cls: 'btn-danger', onClick: function () {
            if (!window.confirm('Все текущие данные будут удалены и заменены данными из файла. Продолжить?')) return;
            var r = Store.applyImport(parsed, 'replace');
            Modal.close(); renderView();
            if (!r.ok && Store.available) toast(IMPORT_FAIL, true);
            else toast('Данные заменены: загружено ' + r.added + ' элементов');
          } },
          { label: 'Объединить', cls: 'btn-primary', onClick: function () {
            var r = Store.applyImport(parsed, 'merge');
            Modal.close(); renderView();
            if (!r.ok && Store.available) toast(IMPORT_FAIL, true);
            else toast('Импорт завершён: добавлено ' + r.added + ' новых элементов');
          } }
        ]
      });
    };
    reader.readAsText(file, 'utf-8');
  }

  // ---------- Демо-данные ----------
  function generateDemo() {
    var byName = {};
    FOODS.forEach(function (f) { byName[f.name] = f; });
    var T = {
      breakfast: [
        [['Овсяная каша на молоке', 250], ['Банан', 100], ['Чай чёрный без сахара', 250]],
        [['Яйцо куриное', 110], ['Хлеб ржаной', 40], ['Сыр твёрдый (Российский)', 20], ['Кофе чёрный без сахара', 200]],
        [['Творог 5%', 180], ['Сметана 15%', 30], ['Чай чёрный без сахара', 250]],
        [['Гречка варёная', 200], ['Молоко 2,5%', 200]],
        [['Сырники', 170], ['Сметана 15%', 30], ['Капучино (молоко 2,5%)', 250]],
        [['Омлет с молоком', 180], ['Хлеб цельнозерновой', 40], ['Помидор', 100]]
      ],
      lunch: [
        [['Борщ', 300], ['Сметана 15%', 20], ['Хлеб ржаной', 50], ['Котлета говяжья жареная', 100], ['Гречка варёная', 150]],
        [['Суп куриный с лапшой', 300], ['Куриная грудка варёная', 120], ['Рис белый варёный', 150], ['Огурец', 100]],
        [['Щи из свежей капусты', 300], ['Пельмени варёные', 200], ['Сметана 15%', 30]],
        [['Плов с курицей', 300], ['Салат овощной с маслом', 150], ['Компот из сухофруктов', 200]],
        [['Суп гороховый', 300], ['Котлета куриная', 100], ['Макароны варёные', 150]]
      ],
      dinner: [
        [['Минтай отварной', 150], ['Картофельное пюре на молоке', 200], ['Салат овощной с маслом', 100]],
        [['Куриное бедро запечённое', 150], ['Булгур варёный', 150], ['Помидор', 100]],
        [['Голубцы', 300], ['Сметана 15%', 30]],
        [['Скумбрия запечённая', 130], ['Картофель варёный', 200], ['Капуста квашеная', 100]],
        [['Индейка (филе) варёная', 150], ['Брокколи', 150], ['Рис бурый варёный', 120]]
      ],
      snack: [
        [['Яблоко', 150]], [['Кефир 2,5%', 250]], [['Грецкий орех', 25], ['Мандарин', 100]],
        [['Печенье овсяное', 40], ['Чай чёрный без сахара', 250]], [['Йогурт натуральный 2,5%', 150]],
        [['Шоколад горький 70%', 20]], [['Творог 5%', 100], ['Черника', 80]]
      ]
    };
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function tm(h0, h1) { var m = Math.round(rnd(h0 * 60, h1 * 60)); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }

    var entries = [], gl = [], acts = [], today = todayStr(), now = nowTime();
    for (var i = 13; i >= 0; i--) {
      var d = addDays(today, -i);
      var plan = [['breakfast', tm(7.3, 9)], ['lunch', tm(12.5, 14)], ['dinner', tm(18.5, 20)]];
      if (Math.random() < 0.75) plan.push(['snack', tm(15.5, 17)]);
      if (Math.random() < 0.3) plan.push(['snack', tm(21, 22)]);
      var lunchGl = null, sweet = false; // ГН обеда — от неё зависит демо-сахар через 2 ч после еды
      plan.forEach(function (pl) {
        if (i === 0 && pl[1] > now) return; // сегодня — только то, что уже «было»
        var items = pick(T[pl[0]]);
        if (pl[0] === 'lunch') {
          lunchGl = 0;
          if (Math.random() < 0.2) {
            sweet = true;
            items = items.concat([pick([['Торт бисквитный с кремом', 100], ['Конфеты шоколадные', 40]])]);
          }
        }
        items.forEach(function (it) {
          var f = byName[it[0]];
          if (!f) return;
          var grams = Math.max(5, Math.round(it[1] * rnd(0.85, 1.15) / 5) * 5);
          if (pl[0] === 'lunch' && f.gi != null) lunchGl += f.gi * f.c * grams / 10000;
          var e = Store.sanitizeEntry({
            id: Store.genId('e'), date: d, time: pl[1], meal: pl[0], productId: f.id, name: f.name,
            grams: grams, kcal: f.kcal, p: f.p, f: f.f, c: f.c, gi: f.gi, giSrc: f.giSrc, demo: true
          });
          if (e) entries.push(e);
        });
      });

      // активность: частые прогулки и иногда тренировки
      var dayMin = 0, w = userWeight();
      var actPlan = [];
      if (Math.random() < 0.65) actPlan.push(['walk_brisk', tm(17.5, 18.5), 5 * Math.round(rnd(6, 12)), 'mid']);
      if (Math.random() < 0.3) actPlan.push([pick(['run_jog', 'bike_leisure', 'strength', 'swim_leisure', 'yoga', 'garden', 'morning']), tm(7, 7.5), 5 * Math.round(rnd(4, 10)), pick(['low', 'mid', 'mid', 'high'])]);
      actPlan.forEach(function (ap) {
        if (i === 0 && ap[1] > now) return;
        var met = actMet(ap[0], ap[3]);
        var rec = Store.sanitizeActivity({
          id: Store.genId('a'), date: d, time: ap[1], type: ap[0], name: ACTIVITY[ap[0]].name, minutes: ap[2],
          intensity: ap[3], met: met, kcal: actKcal(met, w, ap[2]),
          steps: ap[0] === 'walk_brisk' ? Math.round(ap[2] * rnd(95, 115)) : null, note: '', demo: true
        });
        if (rec) { acts.push(rec); dayMin += rec.minutes; }
      });

      var gp = [
        ['fasting', tm(6.8, 7.3), rnd(4.8, 6.6), ''],
        ['after2', tm(14.6, 15.8), lunchGl != null ? 4.6 + lunchGl * 0.09 + rnd(-0.7, 0.9) : rnd(6.2, 9.4), ''],
        ['bedtime', tm(22, 23), rnd(5.6, 8.2), '']
      ];
      if (Math.random() < 0.6) gp.push(['before', tm(18.2, 18.4), rnd(4.6, 6.8), '']);
      if (Math.random() < 0.12) gp.push(['other', tm(16.5, 17.3), rnd(3.2, 3.8), 'Слабость, потливость — съел(а) 2 кусочка сахара']);
      if (sweet) gp[1][3] = 'Сладкое на обед';
      if (dayMin >= ACTIVE_DAY_MIN) gp[2][2] -= rnd(0.3, 0.9); // после вечерней прогулки сахар перед сном чуть ниже
      gp.forEach(function (g) {
        if (i === 0 && g[1] > now) return;
        var rec = Store.sanitizeGlucose({ id: Store.genId('g'), date: d, time: g[1], mmol: round1(g[2]), ctx: g[0], note: g[3], demo: true });
        if (rec) gl.push(rec);
      });
    }
    return { entries: entries, glucose: gl, activity: acts };
  }

  function loadDemo() {
    if (!window.confirm('Добавить демонстрационные записи питания, измерения сахара и активность за последние 14 дней?\nОни будут помечены как демо и их можно удалить отдельной кнопкой в «Настройках».')) return;
    var demo = generateDemo();
    var ok1 = Store.addMany('entries', demo.entries);
    var ok2 = Store.addMany('glucose', demo.glucose);
    var ok3 = Store.addMany('activity', demo.activity);
    checkSaved(ok1 && ok2 && ok3);
    renderView();
    toast('Добавлено: ' + demo.entries.length + ' записей питания, ' + demo.glucose.length + ' измерений, ' + demo.activity.length + ' записей активности');
  }

  function removeDemo() {
    var n = Store.removeWhere('entries', function (e) { return e.demo; }) +
      Store.removeWhere('glucose', function (g) { return g.demo; }) +
      Store.removeWhere('activity', function (a) { return a.demo; });
    renderView();
    toast(n ? 'Демо-данные удалены (' + n + ')' : 'Демо-данных нет');
  }

  function clearAll() {
    if (!window.confirm('Удалить ВСЕ данные: дневник питания, измерения сахара, активность, ваши продукты, запомненные исправления распознавания и настройки?\n\n' +
      'С этого устройства также будет удалён ключ Gemini (его можно снова скопировать из Google AI Studio).\n\n' +
      'Если вы пользуетесь синхронизацией, после следующей синхронизации эти записи удалятся и на других устройствах.\n\nРекомендуем сначала сделать резервную копию (экспорт в JSON).')) return;
    if (!window.confirm('Это действие необратимо. Точно удалить все данные?')) return;
    Store.clearAll();
    AI.forgetDeviceSettings(); // ключ Gemini, выбранная модель и способ распознавания
    try { window.localStorage.removeItem('ft_v1_ai_models'); } catch (e) { /* ignore */ }
    state.date = todayStr();
    renderView();
    toast('Все данные удалены');
  }

  // =====================================================================
  // СИНХРОНИЗАЦИЯ ЧЕРЕЗ ФАЙЛ (Google Диск и т.п.)
  // =====================================================================
  var DAY_MS = 86400000;
  var SYNC_REMIND_MS = 3 * DAY_MS;
  var sync = { handle: null, busy: false, justLoaded: false };
  var SYNC_LABELS = { entries: 'Питание', glucose: 'Сахар', activity: 'Активность', customFoods: 'Мои продукты', aiMemory: 'Запомненное по фото' };

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isStandalone() {
    return navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  function isHttp() { return /^https?:$/.test(location.protocol); }
  /** Доступ к файлу «в одно нажатие» (Chrome / Edge на компьютере) */
  function fsSupported() {
    return typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function' && !isIOS();
  }
  function canShareFiles() {
    try {
      return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] }));
    } catch (e) { return false; }
  }
  /** Сохранять файл через «Поделиться» (iPhone, телефоны), иначе — обычной загрузкой */
  function preferShare() {
    return canShareFiles() && (isIOS() || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
  }
  function fmtDateTime(ms) {
    var d = new Date(ms);
    return fmtDDMMYYYY(dateToStr(d)) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function updateMeta(patch) { Store.setSyncMeta(Object.assign(Store.syncMeta(), patch)); }

  // ---------- IndexedDB: запоминаем выбранный файл (только Chrome/Edge) ----------
  var HandleDB = {
    open: function () {
      return new Promise(function (resolve, reject) {
        if (!window.indexedDB) { reject(new Error('no idb')); return; }
        var r = window.indexedDB.open('ft_v1_fs', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('handles'); };
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    },
    run: function (mode, fn) {
      return HandleDB.open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction('handles', mode), st = tx.objectStore('handles'), req = fn(st);
          tx.oncomplete = function () { db.close(); resolve(req && req.result); };
          tx.onerror = tx.onabort = function () { db.close(); reject(tx.error); };
        });
      });
    },
    get: function (k) { return HandleDB.run('readonly', function (st) { return st.get(k); }); },
    set: function (k, v) { return HandleDB.run('readwrite', function (st) { return st.put(v, k); }); },
    del: function (k) { return HandleDB.run('readwrite', function (st) { return st.delete(k); }); }
  };

  function initSyncHandle() {
    if (!fsSupported()) return;
    HandleDB.get('sync').then(function (h) {
      if (h && typeof h.getFile === 'function') {
        sync.handle = h;
        if (state.view === 'settings') renderSettings();
      }
    }).catch(function () { /* IndexedDB недоступен — файл придётся выбирать заново */ });
  }

  function syncHelpHtml() {
    return '<details class="help"><summary>Как синхронизировать</summary>' +
      '<p>Синхронизация идёт через один файл <b>' + Sync.FILE_NAME + '</b>, который лежит на вашем Google Диске. ' +
      'Приложение объединяет данные: новые записи добавляются, изменённые обновляются, удалённые удаляются — ничего не теряется. Больше данные никуда не отправляются.</p>' +
      '<p><b>iPhone</b> (приложение «Google Диск» должно быть установлено — тогда Диск виден в приложении «Файлы»):</p>' +
      '<ol><li>Нажмите «1. Загрузить файл с Google Диска», в окне выбора откройте «Обзор» → «Google Диск» и выберите файл ' + Sync.FILE_NAME + '.</li>' +
      '<li>После объединения сразу нажмите «2. Сохранить файл на Google Диск» → «Сохранить в Файлы» → «Google Диск» → «Сохранить». Если спросят — выберите «Заменить».</li>' +
      '<li>Самый первый раз (файла ещё нет) — сделайте только шаг 2.</li></ol>' +
      '<p><b>Компьютер, Chrome или Edge</b>: удобнее всего установить «Google Диск для компьютера» — тогда Диск выглядит как обычная папка. ' +
      'Нажмите «Выбрать файл синхронизации» (или «Создать новый файл») и укажите файл в этой папке. Дальше — одна кнопка «Синхронизировать».</p>' +
      '<p><b>Компьютер, другие браузеры или без программы Google Диска</b>: «1. Загрузить файл» — выберите файл, скачанный с drive.google.com; ' +
      '«2. Сохранить файл» — файл попадёт в «Загрузки», затем загрузите его на drive.google.com вместо старого (меню файла → «Управление версиями» → «Загрузить новую версию»).</p>' +
      '<p>Синхронизируйте перед работой на другом устройстве и после внесения записей. Если что-то пошло не так — «Отменить последнюю синхронизацию».</p>' +
      '</details>';
  }

  function syncCardHtml() {
    var meta = Store.syncMeta(), undo = Store.getUndo();
    var status = meta.lastSync
      ? 'Последняя синхронизация: <b>' + fmtDateTime(meta.lastSync) + '</b>' + (meta.fileName ? ' · файл «' + esc(meta.fileName) + '»' : '')
      : 'Синхронизация на этом устройстве ещё не выполнялась.';
    var manual =
      '<div class="sync-steps">' +
        '<button type="button" class="btn" data-action="sync-load">1. Загрузить файл с Google Диска</button>' +
        '<button type="button" class="btn ' + (sync.justLoaded ? 'btn-primary pulse' : '') + '" data-action="sync-save">2. Сохранить файл на Google Диск</button>' +
      '</div>' +
      '<p class="hint">Шаг 1 объединяет данные из файла с данными на этом устройстве, шаг 2 записывает общий результат обратно в файл. ' +
        'На первом устройстве, когда файла ещё нет, достаточно шага 2.</p>';
    var body;
    if (fsSupported()) {
      body = sync.handle
        ? '<p class="small">Файл: <b>' + esc(sync.handle.name) + '</b></p>' +
          '<div class="btn-row"><button type="button" class="btn btn-primary" data-action="sync-fs">Синхронизировать</button>' +
          '<button type="button" class="btn" data-action="sync-pick-open">Выбрать другой файл</button>' +
          '<button type="button" class="btn btn-ghost" data-action="sync-forget">Отвязать файл</button></div>'
        : '<p class="small muted">Выберите файл синхронизации в папке Google Диска на компьютере (программа «Google Диск для компьютера») — после этого синхронизация займёт одно нажатие.</p>' +
          '<div class="btn-row"><button type="button" class="btn btn-primary" data-action="sync-pick-open">Выбрать файл синхронизации</button>' +
          '<button type="button" class="btn" data-action="sync-pick-new">Создать новый файл</button></div>';
      body += '<details class="help"><summary>Ручной режим (загрузить / сохранить файл)</summary>' + manual + '</details>';
    } else {
      body = manual;
    }
    return '<section class="card settings-section sync-card" id="sync-card"><h3>Синхронизация между устройствами</h3>' +
      '<p class="small">' + status + '</p>' + body +
      (undo ? '<div class="btn-row" style="margin-top:10px"><button type="button" class="btn btn-ghost btn-sm" data-action="sync-undo">Отменить последнюю синхронизацию</button>' +
        '<span class="hint">состояние до ' + fmtDateTime(undo.savedAt) + '</span></div>' : '') +
      syncHelpHtml() + '</section>';
  }

  /** Объединить данные из файла с локальными. Возвращает сводку изменений. */
  function applyRemote(remoteData) {
    var t0 = Date.now();
    var local = Store.snapshot();
    var merged = Sync.merge(local, remoteData, t0);
    var summary = Sync.diff(local, merged);
    var changed = summary.settings || Sync.KINDS.some(function (k) { var x = summary[k]; return x.added || x.updated || x.deleted; }) ||
      Sync.canon(local.tombstones) !== Sync.canon(merged.tombstones);
    if (!changed) return summary; // повторная синхронизация без изменений — копию для отмены не трогаем
    // Сначала — основные данные (всё или ничего), потом копия для отмены: при нехватке места
    // жертвуем отменой, а не данными.
    if (!Store.applySnapshot(merged) && Store.available) {
      var err = new Error('Не хватает места в хранилище браузера — синхронизация не выполнена, данные на этом устройстве не изменены. ' +
        'Сделайте резервную копию (экспорт в JSON) и удалите демо-данные или старые записи.');
      err.code = 'quota';
      throw err;
    }
    if (!Store.saveUndo(local, t0) && Store.available) toast('Не хватило места для копии «до синхронизации» — отменить синхронизацию будет нельзя.', true);
    return summary;
  }

  function syncFileContent() { return JSON.stringify(Sync.buildFile(Store.snapshot(), Store.deviceId())); }

  function summaryHtml(s) {
    if (!s) return '<p>Файл был пустым — в него записаны данные этого устройства.</p>';
    var rows = Sync.KINDS.filter(function (k) { var x = s[k]; return x.added || x.updated || x.deleted; });
    if (!rows.length && !s.settings) return '<p>Изменений нет — данные на этом устройстве уже совпадают с файлом.</p>';
    return '<table class="data"><thead><tr><th></th><th class="r">Добавлено</th><th class="r">Обновлено</th><th class="r">Удалено</th></tr></thead><tbody>' +
      rows.map(function (k) {
        return '<tr><td>' + SYNC_LABELS[k] + '</td><td class="r">' + s[k].added + '</td><td class="r">' + s[k].updated + '</td><td class="r">' + s[k].deleted + '</td></tr>';
      }).join('') + '</tbody></table>' +
      (s.settings ? '<p class="small" style="margin-top:8px">Настройки обновлены (взяты более новые).</p>' : '');
  }

  function showSyncSummary(summary, opts) {
    opts = opts || {};
    Modal.open({
      title: opts.offerSave ? 'Шаг 1 выполнен: данные объединены' : 'Синхронизация выполнена',
      html: summaryHtml(summary) +
        (opts.offerSave ? '<p class="note-box" style="margin-top:12px"><b>Шаг 2.</b> Сохраните объединённые данные обратно в файл на Google Диске — тогда они появятся и на других устройствах.' +
          (preferShare() ? ' В меню «Поделиться» выберите «Сохранить в Файлы» → «Google Диск» и подтвердите замену файла.' : '') + '</p>' : '') +
        (opts.saved ? '<p class="small muted" style="margin-top:8px">Файл «' + esc(opts.fileName || Sync.FILE_NAME) + '» обновлён.</p>' : ''),
      cancelLabel: opts.offerSave ? 'Позже' : 'Готово',
      buttons: opts.offerSave ? [{ label: '2. Сохранить файл на Google Диск', cls: 'btn-primary', onClick: function () { saveSyncFile(); Modal.close(); } }] : []
    });
  }

  function afterSync() {
    renderView();
    renderBanners();
  }

  // ---------- Chrome/Edge: файл на диске, одно нажатие ----------
  var FILE_TYPES = [{ description: 'Файл синхронизации (JSON)', accept: { 'application/json': ['.json'] } }];

  function syncWithHandle() {
    var h = sync.handle;
    if (!h) { pickSyncFile(false); return; }
    if (sync.busy) return;
    sync.busy = true;
    var perm = h.queryPermission ? h.queryPermission({ mode: 'readwrite' }) : Promise.resolve('granted');
    perm.then(function (p) {
      // requestPermission вызывается в обработчике нажатия — браузер покажет запрос доступа
      return p === 'granted' ? p : h.requestPermission({ mode: 'readwrite' });
    }).then(function (p) {
      if (p !== 'granted') { var e = new Error('perm'); e.code = 'perm'; throw e; }
      return h.getFile();
    }).then(function (file) {
      return file.text();
    }).then(function (text) {
      var summary = null;
      if (text.trim()) {
        var obj;
        try { obj = JSON.parse(text.replace(/^﻿/, '')); } catch (err) { var e1 = new Error('json'); e1.code = 'json'; throw e1; }
        var pf = Sync.parseFile(obj);
        if (pf.error) { var e2 = new Error(pf.error); e2.code = 'format'; throw e2; }
        summary = applyRemote(pf.data);
      }
      var content = syncFileContent();
      return h.createWritable().then(function (w) {
        return w.write(content).then(function () { return w.close(); });
      }).then(function () { return summary; });
    }).then(function (summary) {
      sync.busy = false;
      var now = Date.now();
      updateMeta({ lastSync: now, lastSaved: now, fileName: h.name, mode: 'fs' });
      afterSync();
      showSyncSummary(summary, { saved: true, fileName: h.name });
    }).catch(function (err) {
      sync.busy = false;
      var msg = err && err.code === 'perm' ? 'Нет доступа к файлу. Нажмите «Синхронизировать» ещё раз и разрешите доступ.'
        : err && err.code === 'json' ? 'Файл синхронизации повреждён (это не JSON). Он не был изменён.'
        : err && (err.code === 'format' || err.code === 'quota') ? err.message
        : err && err.name === 'NotFoundError' ? 'Файл не найден (перемещён или удалён). Выберите файл заново.'
        : err && err.name === 'SecurityError' ? 'Браузер требует подтверждения: нажмите «Синхронизировать» ещё раз.'
        : 'Не удалось синхронизировать: ' + (err && err.message ? err.message : 'ошибка');
      toast(msg, true);
      afterSync();
    });
  }

  function pickSyncFile(create) {
    if (!fsSupported()) return;
    var p;
    try {
      p = create
        ? window.showSaveFilePicker({ suggestedName: Sync.FILE_NAME, types: FILE_TYPES })
        : window.showOpenFilePicker({ types: FILE_TYPES, multiple: false }).then(function (a) { return a[0]; });
    } catch (e) { toast('Браузер не дал открыть окно выбора файла. Используйте ручной режим.', true); return; }
    p.then(function (h) {
      sync.handle = h;
      return HandleDB.set('sync', h).catch(function () { /* без IndexedDB — запомним до перезагрузки */ });
    }).then(function () {
      renderView();
      syncWithHandle();
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      toast('Не удалось выбрать файл: ' + (e && e.message ? e.message : 'ошибка'), true);
    });
  }

  function forgetSyncFile() {
    sync.handle = null;
    HandleDB.del('sync').catch(function () {});
    renderView();
    toast('Файл синхронизации отвязан. Сам файл не удалён.');
  }

  // ---------- iPhone и другие браузеры: загрузить файл → объединить → сохранить файл ----------
  function startSyncLoad() {
    var inp = $('#sync-file');
    inp.value = '';
    inp.click();
  }

  function handleSyncFile(file) {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) { toast('Файл слишком большой', true); return; }
    var reader = new FileReader();
    reader.onerror = function () { toast('Не удалось прочитать файл', true); };
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(String(reader.result).replace(/^﻿/, '')); }
      catch (e) { toast('Файл не является корректным JSON', true); return; }
      var pf = Sync.parseFile(obj);
      if (pf.error) { toast(pf.error, true); return; }
      var summary;
      try { summary = applyRemote(pf.data); } catch (err) { toast(err.message, true); afterSync(); return; }
      updateMeta({ lastSync: Date.now(), lastLoaded: Date.now(), fileName: file.name, mode: 'manual' });
      sync.justLoaded = true;
      afterSync();
      showSyncSummary(summary, { offerSave: true });
    };
    reader.readAsText(file, 'utf-8');
  }

  /** Шаг 2: отдельное нажатие (iOS теряет «жест пользователя» после асинхронных действий) */
  function saveSyncFile() {
    var content = syncFileContent();
    var done = function (msg) {
      var now = Date.now();
      updateMeta({ lastSaved: now, lastSync: now });
      sync.justLoaded = false;
      afterSync();
      toast(msg);
    };
    if (preferShare()) {
      var file = new File([content], Sync.FILE_NAME, { type: 'application/json' });
      try {
        navigator.share({ files: [file], title: 'Дневник: файл синхронизации' }).then(function () {
          done('Готово. Убедитесь, что файл сохранён на Google Диск с заменой старого.');
        }).catch(function (e) {
          if (e && e.name === 'AbortError') return;
          if (download(Sync.FILE_NAME, content, 'application/json')) done('Файл сохранён. Перенесите его на Google Диск с заменой старого.');
        });
        return;
      } catch (e) { /* ниже — обычная загрузка */ }
    }
    if (download(Sync.FILE_NAME, content, 'application/json')) {
      done('Файл «' + Sync.FILE_NAME + '» сохранён в «Загрузки». Перенесите его в Google Диск вместо старого.');
    }
  }

  function undoSync() {
    var u = Store.getUndo();
    if (!u) return;
    if (!window.confirm('Вернуть данные к состоянию до последней синхронизации (' + fmtDateTime(u.savedAt) + ')?\n\n' +
      'Записи, добавленные или изменённые на этом устройстве после синхронизации, сохранятся.\n' +
      'Файл синхронизации при этом не изменится: при следующей синхронизации данные из него снова объединятся с вашими.')) return;
    var ok = Store.applySnapshot(Store.undoState(u));
    checkSaved(ok);
    if (!ok && Store.available) return;
    Store.clearUndo();
    afterSync();
    toast('Последняя синхронизация отменена');
  }

  function quickSync() {
    if (fsSupported() && sync.handle) { syncWithHandle(); return; }
    if (state.view !== 'settings') location.hash = 'settings';
    setTimeout(function () {
      var card = $('#sync-card');
      if (!card) return;
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      card.classList.add('flash');
      setTimeout(function () { card.classList.remove('flash'); }, 1500);
    }, 60);
  }

  // =====================================================================
  // PWA: офлайн-режим, обновления, плашки
  // =====================================================================
  var pwa = { waiting: null, updating: false };

  function initPwa() {
    if (!isHttp()) return; // при открытии через file:// service worker недоступен
    if (navigator.storage && navigator.storage.persist) {
      // просим браузер не удалять данные при нехватке места
      try {
        navigator.storage.persisted().then(function (p) { if (!p) return navigator.storage.persist(); }).catch(function () {});
      } catch (e) { /* ignore */ }
    }
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (pwa.updating) { pwa.updating = false; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      var track = function (w) {
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) { pwa.waiting = w; renderBanners(); }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) { pwa.waiting = reg.waiting; renderBanners(); }
      track(reg.installing);
      reg.addEventListener('updatefound', function () { track(reg.installing); });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) reg.update().catch(function () {});
      });
    }).catch(function () { /* без офлайн-режима приложение тоже работает */ });
  }

  function applySwUpdate() {
    if (!pwa.waiting) { location.reload(); return; }
    pwa.updating = true;
    pwa.waiting.postMessage({ type: 'skipWaiting' });
  }

  function bannerHtml(key, text, actions, closable) {
    return '<div class="banner banner-info" role="status" data-banner-key="' + key + '"><span class="banner-text">' + text + '</span>' +
      '<span class="banner-actions">' + (actions || '') +
      (closable ? '<button type="button" class="icon-btn" data-action="banner-close" data-banner="' + key + '" aria-label="Скрыть подсказку">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' : '') +
      '</span></div>';
  }

  function renderBanners() {
    var box = $('#banners');
    if (!box) return;
    var ui = Store.ui(), meta = Store.syncMeta(), now = Date.now(), html = '';
    if (pwa.waiting) {
      html += bannerHtml('update', 'Доступна новая версия приложения.', '<button type="button" class="btn btn-primary btn-sm" data-action="sw-update">Обновить</button>', false);
    }
    if (isHttp() && isIOS() && !isStandalone() && !ui.iosHintDismissed) {
      html += bannerHtml('ios', 'Установите приложение: <b>Поделиться</b> → <b>На экран «Домой»</b>. Так данные не будут удалены Safari.', '', true);
    }
    var pct = Store.available ? storagePct() : 0;
    if (pct >= 70 && !(ui.storageWarnAt && now - ui.storageWarnAt < 7 * DAY_MS)) {
      html += bannerHtml('storage', 'Хранилище браузера заполнено примерно на ' + pct + '%. Когда место закончится, новые записи перестанут сохраняться. ' +
        'Сделайте резервную копию (Настройки → Экспорт в JSON) и удалите демо-данные, если они есть.', '', true);
    }
    if (meta.lastSync && now - meta.lastSync > SYNC_REMIND_MS && !(ui.syncReminderAt && now - ui.syncReminderAt < SYNC_REMIND_MS)) {
      html += bannerHtml('sync', 'Данные не синхронизировались больше 3 дней.', '<button type="button" class="btn btn-sm" data-action="quick-sync">Синхронизировать</button>', true);
    }
    box.innerHTML = html;
  }

  /** Заполненность localStorage, % — от консервативной оценки лимита (Safari на iPhone ≈ 2,5 млн символов) */
  var STORAGE_LIMIT_CHARS = 2500000;
  // копия «до синхронизации» не учитывается: при нехватке места она удаляется первой
  function storagePct() { return Math.min(100, Math.round(Store.usage(true) / STORAGE_LIMIT_CHARS * 100)); }

  function closeBanner(key) {
    if (key === 'ios') Store.setUi({ iosHintDismissed: true });
    if (key === 'sync') Store.setUi({ syncReminderAt: Date.now() });
    if (key === 'storage') Store.setUi({ storageWarnAt: Date.now() });
    renderBanners();
  }

  // =====================================================================
  // Обработчики событий
  // =====================================================================
  function onClick(e) {
    var tab = e.target.closest('.tab');
    if (tab) {
      var v = tab.getAttribute('data-view');
      if (location.hash !== '#' + v) location.hash = v; else showView(v);
      return;
    }
    // кнопки блоков «Распознавание по фото», «Эталоны размера», «Что приложение запомнило»
    var aiBtn = e.target.closest('[data-ai]');
    if (aiBtn && !aiBtn.disabled && PhotoUI.onSettingsAction(aiBtn)) return;
    var btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    var id = btn.getAttribute('data-id');
    switch (btn.getAttribute('data-action')) {
      case 'photo': PhotoUI.open({ date: state.date }); break;
      case 'day': setDate(addDays(state.date, +btn.getAttribute('data-delta'))); break;
      case 'today': setDate(todayStr()); break;
      case 'add-entry': openEntryModal(null, { meal: btn.getAttribute('data-meal') || null }); break;
      case 'edit-entry': { var en = Store.get('entries', id); if (en) openEntryModal(en); break; }
      case 'del-entry': deleteEntry(id); break;
      case 'del-dish': deleteDish(id); break;
      case 'copy-meals': openCopyModal(btn.getAttribute('data-meal') || null); break;
      case 'print-report': printReport(); break;
      case 'add-glucose': openGlucoseModal(null); break;
      case 'edit-glucose': { var gg = Store.get('glucose', id); if (gg) openGlucoseModal(gg); break; }
      case 'del-glucose': deleteGlucose(id); break;
      case 'add-activity': openActivityModal(null); break;
      case 'edit-activity': { var ac = Store.get('activity', id); if (ac) openActivityModal(ac); break; }
      case 'del-activity': deleteActivity(id); break;
      case 'csv-activity': exportActivityCsv(); break;
      case 'more-foods': state.foodShown += FOOD_PAGE; renderFoodList(); break;
      case 'period': state.period = +btn.getAttribute('data-days'); renderStats(); break;
      case 'new-food': openFoodModal(null, { name: state.foodQuery.trim() }); break;
      case 'edit-food': { var cf = Store.get('customFoods', id); if (cf) openFoodModal(cf); break; }
      case 'del-food': deleteFood(id); break;
      case 'copy-food': {
        var bf = findFood(id);
        if (bf) openFoodModal(null, { name: bf.name, cat: bf.cat, kcal: bf.kcal, p: bf.p, f: bf.f, c: bf.c, gi: bf.gi, giSrc: bf.giSrc });
        break;
      }
      case 'quick-sync': quickSync(); break;
      case 'sync-fs': syncWithHandle(); break;
      case 'sync-pick-open': pickSyncFile(false); break;
      case 'sync-pick-new': pickSyncFile(true); break;
      case 'sync-forget': forgetSyncFile(); break;
      case 'sync-load': startSyncLoad(); break;
      case 'sync-save': saveSyncFile(); break;
      case 'sync-undo': undoSync(); break;
      case 'banner-close': closeBanner(btn.getAttribute('data-banner')); break;
      case 'sw-update': applySwUpdate(); break;
      case 'report-print': window.print(); break;
      case 'report-share': shareReport(); break;
      case 'report-close': endPrintReport(); break;
      case 'food-to-diary': { var fd = findFood(id); if (fd) openEntryModal(null, { product: fd }); break; }
      case 'export-json': exportJson(); break;
      case 'import-json': startImport(); break;
      case 'csv-food': exportFoodCsv(); break;
      case 'csv-glucose': exportGlucoseCsv(); break;
      case 'demo-load': loadDemo(); break;
      case 'demo-remove': removeDemo(); break;
      case 'clear-all': clearAll(); break;
      case 'settings-reset':
        if (window.confirm('Вернуть настройки по умолчанию? Данные дневника и вес тела не изменятся.')) {
          checkSaved(Store.saveSettings(Object.assign({}, Store.DEFAULT_SETTINGS, { weight: S().weight })));
          renderView();
          toast('Настройки сброшены');
        }
        break;
    }
  }

  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  /**
   * Связка с модулем «Еда по фото» (photo.js): всё, что ему нужно от приложения.
   * Записи блюда сохраняются обычными записями дневника с общим dishId — поэтому статистика,
   * CSV, отчёт, копирование и синхронизация работают с ними без особых случаев.
   */
  function photoContext() {
    return {
      Modal: Modal, MEALS: MEALS,
      esc: esc, toast: toast, hideToast: hideToast, parseNum: parseNum, fmtInt: fmtInt, fmt1: fmt1, inputNum: inputNum, round1: round1,
      guessMeal: guessMeal, nowTime: nowTime, isDateStr: isDateStr, isTimeStr: isTimeStr, genId: Store.genId,
      state: function () { return state; },
      searchFoods: function (q, limit) { return searchFoods(q, limit); },
      highlight: hlName, normName: norm, findFood: findFood, snapshotOf: snapshotOf, giText: giText,
      sizeRefs: function () { return S().sizeRefs; },
      setSizeRefs: function (refs) { checkSaved(Store.saveSettings(Object.assign({}, S(), { sizeRefs: refs }))); },
      memoryList: function () { return Store.list('aiMemory'); },
      memorySave: function (recs) { checkSaved(Store.putMany('aiMemory', recs)); },
      memoryClear: function () { Store.removeWhere('aiMemory', function () { return true; }); },
      saveEntries: function (list) {
        var clean = list.map(function (e) { return Store.sanitizeEntry(Object.assign({ id: Store.genId('e') }, e)); }).filter(Boolean);
        if (clean.length !== list.length) return false;
        var ok = Store.addMany('entries', clean);
        if (!ok && Store.available) {
          // не записалось (нет места) — убираем несохранённое из памяти, черновик остаётся открытым
          Store.load();
          return false;
        }
        return true;
      },
      afterSave: function (date, n, dishName) {
        state.date = date;
        if (location.hash !== '#diary') location.hash = 'diary'; else renderView();
        toast('Записано: «' + dishName + '»' + (n > 1 ? ' — ' + n + ' ингр.' : ''));
      },
      rerender: function () { renderView(); }
    };
  }

  function init() {
    Store.load();
    if (!Store.available) $('#storage-warning').hidden = false;
    PhotoUI.init(photoContext());

    document.addEventListener('click', onClick);

    document.addEventListener('change', function (e) {
      if (e.target.classList.contains('date-input')) {
        if (isDateStr(e.target.value)) setDate(e.target.value); else renderDatebars();
      } else if (e.target.id === 'food-cat') {
        state.foodCat = e.target.value; state.foodShown = FOOD_PAGE; renderFoodList();
      } else if (e.target.id === 'food-only-custom') {
        state.onlyCustom = e.target.checked; state.foodShown = FOOD_PAGE; renderFoodList();
      } else if (e.target.id === 's-unit') {
        onUnitChange(e.target.form);
      } else if (e.target.id === 'import-file') {
        handleImportFile(e.target.files && e.target.files[0]);
      } else if (e.target.id === 'sync-file') {
        handleSyncFile(e.target.files && e.target.files[0]);
      } else {
        PhotoUI.onSettingsChange(e.target);
      }
    });

    $('#food-search').addEventListener('input', debounce(function () {
      state.foodQuery = $('#food-search').value;
      state.foodShown = FOOD_PAGE;
      renderFoodList();
    }, 100));

    document.addEventListener('submit', function (e) {
      if (e.target.id === 'settings-form') { e.preventDefault(); saveSettingsForm(e.target); }
    });

    window.addEventListener('hashchange', function () { showView(viewFromHash()); });

    // Перерисовка графиков при изменении размера и темы
    window.addEventListener('resize', debounce(drawStatsCharts, 150));
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onTheme = function () { drawStatsCharts(); };
      if (mq.addEventListener) mq.addEventListener('change', onTheme);
      else if (mq.addListener) mq.addListener(onTheme);
    }

    window.addEventListener('afterprint', endPrintReport);

    // Переход через полночь: если был открыт «сегодняшний» день, после возврата на вкладку
    // показываем новый «сегодня» (иначе запись по умолчанию попала бы во вчерашний день)
    var lastToday = todayStr();
    var onWake = function () {
      if (document.hidden || Modal.isOpen()) return;
      var t = todayStr();
      if (t === lastToday) return;
      if (state.date === lastToday) state.date = t;
      lastToday = t;
      renderView();
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);

    // Изменения из другой вкладки
    window.addEventListener('storage', function (e) {
      if (!e.key || e.key.indexOf('ft_v1_') === 0) {
        Store.load();
        if (!Modal.isOpen()) renderView();
      }
    });

    showView(viewFromHash());
    initPwa();
    initSyncHandle();
    renderBanners();
  }

  init();
})();
