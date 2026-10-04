/*
 * Хранилище данных (localStorage) с версионированными ключами.
 * Все обращения к localStorage обёрнуты в try/catch. Если хранилище недоступно
 * (приватный режим, запрет cookies и т.п.), данные живут только в памяти до закрытия вкладки.
 *
 * Ключи:
 *   ft_v1_settings      — объект настроек (+ updatedAt)
 *   ft_v1_custom_foods  — массив пользовательских продуктов
 *   ft_v1_entries       — массив записей дневника питания
 *   ft_v1_glucose       — массив измерений сахара (значения в ммоль/л)
 *   ft_v1_activity      — массив записей физической активности
 *   ft_v1_ai_memory     — что приложение запомнило из исправлений распознавания по фото
 *                         {id, key, aiName, productId, productName, grams, count, lastUsed}
 *   ft_v1_tombstones    — «надгробия» удалённых записей {id, coll, deletedAt} — чтобы удаление
 *                         дошло до других устройств при синхронизации
 *   ft_v1_device        — случайный идентификатор этого устройства
 *   ft_v1_sync_meta     — сведения о последней синхронизации
 *   ft_v1_sync_undo     — состояние до последней синхронизации (для отмены)
 *   ft_v1_ui            — мелкие настройки интерфейса (скрытые подсказки и т.п.)
 *
 * У каждой записи есть updatedAt (мс): ставится при создании и изменении.
 * Для записей, созданных до появления этого поля, оно восстанавливается из времени,
 * зашитого в id (id = префикс + Date.now() в 36-ричной записи + случайный хвост), иначе 0.
 */
var Store = (function () {
  'use strict';

  var PREFIX = 'ft_v1_';
  var KEYS = {
    settings: PREFIX + 'settings',
    customFoods: PREFIX + 'custom_foods',
    entries: PREFIX + 'entries',
    glucose: PREFIX + 'glucose',
    activity: PREFIX + 'activity',
    aiMemory: PREFIX + 'ai_memory',
    tombstones: PREFIX + 'tombstones'
  };
  var DEVICE_KEY = PREFIX + 'device';
  var META_KEY = PREFIX + 'sync_meta';
  var UNDO_KEY = PREFIX + 'sync_undo';
  var UI_KEY = PREFIX + 'ui';
  var LIST_KINDS = ['customFoods', 'entries', 'glucose', 'activity', 'aiMemory'];
  var AI_MEMORY_MAX = 500; // больше — самые давно не использованные записи удаляются (с надгробием)
  var TOMBSTONE_TTL = 400 * 24 * 3600 * 1000; // надгробия старше 400 дней удаляются

  var MEAL_KEYS = ['breakfast', 'lunch', 'dinner', 'snack'];
  var CONTEXT_KEYS = ['fasting', 'before', 'after1', 'after2', 'bedtime', 'night', 'other'];
  var INTENSITY_KEYS = ['low', 'mid', 'high'];
  // источник ГИ: t — таблицы, e — оценка, n — неприменимо, u — своё значение пользователя
  var GI_SRC = ['t', 'e', 'n', 'u'];

  var DEFAULT_SETTINGS = {
    kcalGoal: 2000,
    pGoal: null,
    fGoal: null,
    cGoal: null,
    unit: 'mmol',     // 'mmol' | 'mgdl'
    low: 3.9,         // ммоль/л
    high: 7.8,        // ммоль/л
    veryHigh: 13.9,   // ммоль/л
    weight: null,     // вес тела, кг (null — не указан, для расчёта активности берётся 70)
    sizeRefs: null,   // эталоны размера для распознавания по фото [{name, cm}] (null — по умолчанию)
    updatedAt: 0
  };

  // Проверяем доступность localStorage
  var available = (function () {
    try {
      var k = PREFIX + '__test';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  })();

  var data = {
    settings: copy(DEFAULT_SETTINGS),
    customFoods: [],
    entries: [],
    glucose: [],
    activity: [],
    aiMemory: [],
    tombstones: []
  };

  // ---------- helpers ----------
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  function genId(prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** Время создания, зашитое в id (см. genId); 0, если id «чужой» */
  function idTime(id) {
    var m = /^[a-z]([0-9a-z]{8})[0-9a-z]{0,6}$/.exec(typeof id === 'string' ? id : '');
    if (!m) return 0;
    var t = parseInt(m[1], 36);
    return t > 1500000000000 && t < Date.now() + 86400000 ? t : 0;
  }

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (typeof v === 'string') {
      var s = v.trim().replace(/[\s  ]/g, '').replace(',', '.');
      if (s === '') return NaN;
      var n = Number(s);
      return isFinite(n) ? n : NaN;
    }
    return NaN;
  }

  function str(v, max) {
    // объекты/массивы из импортируемого файла не превращаем в «[object Object]»
    if (v == null || (typeof v !== 'string' && typeof v !== 'number')) return '';
    return String(v).trim().slice(0, max || 200);
  }

  /** Строка YYYY-MM-DD с реальной календарной датой (отсекаем «2024-02-31», «2024-13-01») */
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    if (y < 1900 || y > 2200) return false;
    var dt = new Date(y, m - 1, d, 12);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

  /** updatedAt записи: из поля, иначе из времени в id, иначе 0 */
  var MAX_STAMP = 4102444800000; // 01.01.2100 — защита от «бессмертных» записей с абсурдным временем из файла
  function stamp(o, id) {
    var u = num(o.updatedAt);
    return u >= 0 ? Math.min(Math.round(u), MAX_STAMP) : idTime(id);
  }

  function read(key, fallback) {
    if (!available) return fallback;
    try {
      var raw = window.localStorage.getItem(key);
      if (raw == null) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    if (!available) return false;
    var s = JSON.stringify(value);
    try {
      window.localStorage.setItem(key, s);
      return true;
    } catch (e) {
      // Переполнение квоты. Копия «до синхронизации» (для отмены) — самое большое и наименее
      // важное, что мы храним: жертвуем ею ради основных данных и пробуем ещё раз.
      if (key === UNDO_KEY) return false;
      try {
        if (window.localStorage.getItem(UNDO_KEY) == null) return false;
        window.localStorage.removeItem(UNDO_KEY);
        window.localStorage.setItem(key, s);
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  function removeKey(key) {
    if (!available) return;
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  /**
   * Записать несколько ключей «всё или ничего». Если какой-то ключ не записался
   * (переполнение квоты), уже записанные ключи возвращаются к прежним значениям —
   * чтобы в хранилище не осталась смесь старых и новых данных (например, после
   * синхронизации: новые надгробия + старые записи).
   * kinds — имена из KEYS. Возвращает true при успехе.
   */
  function writeAll(kinds) {
    if (!available) return false;
    var done = [];
    for (var i = 0; i < kinds.length; i++) {
      var key = KEYS[kinds[i]], old = null;
      try { old = window.localStorage.getItem(key); } catch (e) { /* ignore */ }
      if (!write(key, data[kinds[i]])) {
        for (var j = done.length - 1; j >= 0; j--) {
          try {
            if (done[j].old == null) window.localStorage.removeItem(done[j].key);
            else window.localStorage.setItem(done[j].key, done[j].old);
          } catch (e) { /* ignore */ }
        }
        return false;
      }
      done.push({ key: key, old: old });
    }
    return true;
  }

  /** Время изменения, которое гарантированно новее предыдущей версии записи
   *  (защита от расхождения часов между устройствами: правка на устройстве с «отстающими»
   *  часами иначе проиграла бы при синхронизации старой версии с «будущим» временем) */
  function nextStamp(prev) {
    var now = Date.now(), p = prev && prev.updatedAt > 0 ? prev.updatedAt : 0;
    return Math.max(now, p + 1);
  }

  // ---------- санитайзеры (используются при загрузке, импорте и синхронизации) ----------
  function sanitizeFood(o) {
    if (!o || typeof o !== 'object') return null;
    var name = str(o.name, 100);
    if (!name) return null;
    var kcal = num(o.kcal), p = num(o.p), f = num(o.f), c = num(o.c);
    if ([kcal, p, f, c].some(function (x) { return !(x >= 0); })) return null;
    if (kcal > 950 || p + f + c > 100.05) return null;
    var gi = o.gi == null || o.gi === '' ? null : num(o.gi);
    if (gi !== null && !(gi >= 0 && gi <= 150)) gi = null;
    // id вида «b123» зарезервированы за встроенной базой — иначе свой продукт «перекрыл» бы встроенный
    var okId = typeof o.id === 'string' && o.id && !/^b\d+$/.test(o.id);
    var id = okId ? o.id.slice(0, 40) : genId('c');
    var food = {
      id: id,
      name: name,
      cat: str(o.cat, 60) || 'Другое',
      kcal: kcal, p: p, f: f, c: c, gi: gi,
      updatedAt: stamp(o, id)
    };
    if (GI_SRC.indexOf(o.giSrc) >= 0 && (gi !== null || o.giSrc === 'n')) food.giSrc = o.giSrc;
    return food;
  }

  function sanitizeEntry(o) {
    if (!o || typeof o !== 'object') return null;
    if (!isDate(o.date)) return null;
    var name = str(o.name, 100);
    if (!name) return null;
    var grams = num(o.grams);
    if (!(grams > 0 && grams <= 10000)) return null;
    var kcal = num(o.kcal), p = num(o.p), f = num(o.f), c = num(o.c);
    if ([kcal, p, f, c].some(function (x) { return !(x >= 0); })) return null;
    // значения записи — на 100 г продукта: те же физические пределы, что и для продуктов
    if (kcal > 950 || p > 100 || f > 100 || c > 100) return null;
    var gi = o.gi == null || o.gi === '' ? null : num(o.gi);
    if (gi !== null && !(gi >= 0 && gi <= 150)) gi = null;
    var id = typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : genId('e');
    var e = {
      id: id,
      date: o.date,
      time: isTime(o.time) ? o.time : '12:00',
      meal: MEAL_KEYS.indexOf(o.meal) >= 0 ? o.meal : 'snack',
      productId: typeof o.productId === 'string' ? o.productId.slice(0, 40) : null,
      name: name,
      grams: grams,
      kcal: kcal, p: p, f: f, c: c, gi: gi,
      updatedAt: stamp(o, id)
    };
    if (GI_SRC.indexOf(o.giSrc) >= 0) e.giSrc = o.giSrc;
    // блюдо, распознанное по фото: ингредиенты объединены общим dishId и названием блюда
    if (typeof o.dishId === 'string' && /^[0-9a-z]{2,40}$/.test(o.dishId)) {
      e.dishId = o.dishId;
      e.dishName = str(o.dishName, 100) || name;
    }
    if (o.src === 'ai') e.src = 'ai'; // значения от ИИ (продукт не найден в базе)
    if (o.demo === true) e.demo = true;
    return e;
  }

  /** Запомненное из исправлений распознавания: ключ — нормализованное название от ИИ */
  function memKey(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я%]+/g, ' ').trim().slice(0, 100);
  }
  function sanitizeAiMemory(o) {
    if (!o || typeof o !== 'object') return null;
    var key = memKey(o.key || o.aiName);
    if (!key) return null;
    var grams = num(o.grams), count = num(o.count), last = num(o.lastUsed);
    if (!(grams > 0 && grams <= 5000)) return null;
    var id = typeof o.id === 'string' && /^m[0-9a-z]{2,30}$/.test(o.id) ? o.id : null;
    if (!id) return null; // id детерминирован по ключу (см. AI.memId) — без него записи с разных устройств не сольются
    return {
      id: id,
      key: key,
      aiName: str(o.aiName, 100) || key,
      productId: typeof o.productId === 'string' && o.productId ? o.productId.slice(0, 40) : null,
      productName: o.productId ? (str(o.productName, 100) || null) : null,
      grams: Math.round(grams * 10) / 10,
      count: count >= 1 ? Math.min(Math.round(count), 100000) : 1,
      lastUsed: last > 0 ? Math.min(Math.round(last), MAX_STAMP) : 0,
      updatedAt: stamp(o, id)
    };
  }

  function sanitizeActivity(o) {
    if (!o || typeof o !== 'object') return null;
    if (!isDate(o.date)) return null;
    var name = str(o.name, 100);
    if (!name) return null;
    var minutes = num(o.minutes);
    if (!(minutes >= 1 && minutes <= 1440)) return null;
    var kcal = num(o.kcal);
    if (!(kcal >= 0 && kcal <= 10000)) return null;
    var met = o.met == null || o.met === '' ? null : num(o.met);
    if (met !== null && !(met >= 0.5 && met <= 25)) met = null;
    var steps = o.steps == null || o.steps === '' ? null : num(o.steps);
    if (steps !== null && !(steps >= 0 && steps <= 200000)) steps = null;
    var id = typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : genId('a');
    var a = {
      id: id,
      date: o.date,
      time: isTime(o.time) ? o.time : '12:00',
      type: str(o.type, 40) || 'custom',
      name: name,
      minutes: Math.round(minutes),
      intensity: INTENSITY_KEYS.indexOf(o.intensity) >= 0 ? o.intensity : 'mid',
      met: met,
      kcal: Math.round(kcal),
      steps: steps === null ? null : Math.round(steps),
      note: str(o.note, 500),
      updatedAt: stamp(o, id)
    };
    if (o.demo === true) a.demo = true;
    return a;
  }

  function sanitizeGlucose(o) {
    if (!o || typeof o !== 'object') return null;
    if (!isDate(o.date)) return null;
    var mmol = num(o.mmol);
    if (!(mmol >= 0.5 && mmol <= 50)) return null;
    var id = typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : genId('g');
    var g = {
      id: id,
      date: o.date,
      time: isTime(o.time) ? o.time : '12:00',
      mmol: Math.round(mmol * 100) / 100,
      ctx: CONTEXT_KEYS.indexOf(o.ctx) >= 0 ? o.ctx : 'other',
      note: str(o.note, 500),
      updatedAt: stamp(o, id)
    };
    if (o.demo === true) g.demo = true;
    return g;
  }

  function sanitizeSettings(o) {
    var s = copy(DEFAULT_SETTINGS);
    if (!o || typeof o !== 'object') return s;
    var kg = num(o.kcalGoal);
    if (kg >= 500 && kg <= 10000) s.kcalGoal = Math.round(kg);
    ['pGoal', 'fGoal', 'cGoal'].forEach(function (k) {
      var v = num(o[k]);
      s[k] = v > 0 && v <= 1000 ? v : null;
    });
    if (o.unit === 'mgdl' || o.unit === 'mmol') s.unit = o.unit;
    var low = num(o.low), high = num(o.high), vh = num(o.veryHigh);
    if (low >= 2 && high > low && vh > high && vh <= 35) {
      s.low = low; s.high = high; s.veryHigh = vh;
    }
    var w = num(o.weight);
    s.weight = w >= 20 && w <= 300 ? Math.round(w * 10) / 10 : null;
    if (Array.isArray(o.sizeRefs)) {
      s.sizeRefs = o.sizeRefs.map(function (r) {
        var cm = r && num(r.cm), name = r && str(r.name, 60);
        return name && cm >= 0.5 && cm <= 100 ? { name: name, cm: Math.round(cm * 10) / 10 } : null;
      }).filter(Boolean).slice(0, 10);
    }
    var u = num(o.updatedAt);
    s.updatedAt = u >= 0 ? Math.min(Math.round(u), MAX_STAMP) : 0;
    return s;
  }

  function sanitizeTombstone(o) {
    if (!o || typeof o !== 'object') return null;
    if (typeof o.id !== 'string' || !o.id || LIST_KINDS.indexOf(o.coll) < 0) return null;
    var t = num(o.deletedAt);
    if (!(t > 0)) return null;
    return { id: o.id.slice(0, 40), coll: o.coll, deletedAt: Math.min(Math.round(t), MAX_STAMP) };
  }

  function sanitizeList(arr, fn) {
    var out = [], skipped = 0, ids = {};
    if (!Array.isArray(arr)) return { items: out, skipped: 0 };
    arr.forEach(function (x) {
      var v = fn(x);
      if (!v) { skipped++; return; }
      // повторяющиеся id ломают редактирование/удаление — дубликату выдаём новый id
      if (ids[v.id]) v.id = genId(v.id.charAt(0) || 'x');
      ids[v.id] = true;
      out.push(v);
    });
    return { items: out, skipped: skipped };
  }

  var SANITIZERS = { customFoods: sanitizeFood, entries: sanitizeEntry, glucose: sanitizeGlucose, activity: sanitizeActivity, aiMemory: sanitizeAiMemory };

  /** Надгробия: по одному (самому новому) на запись, без слишком старых */
  function normTombstones(arr, now) {
    var by = {};
    (Array.isArray(arr) ? arr : []).forEach(function (x) {
      var t = sanitizeTombstone(x);
      if (!t || t.deletedAt < (now || Date.now()) - TOMBSTONE_TTL) return;
      var k = t.coll + ':' + t.id;
      if (!by[k] || by[k].deletedAt < t.deletedAt) by[k] = t;
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }

  // ---------- загрузка (с миграцией старых данных) ----------
  function load() {
    var rawSettings = read(KEYS.settings, null);
    data.settings = sanitizeSettings(rawSettings);
    var migrate = !!rawSettings && rawSettings.updatedAt == null;
    LIST_KINDS.forEach(function (kind) {
      var raw = read(KEYS[kind], []);
      data[kind] = sanitizeList(raw, SANITIZERS[kind]).items;
      // миграция: у записей до 3-го этапа не было updatedAt — сохраняем восстановленные значения
      if (Array.isArray(raw) && raw.some(function (x) { return x && typeof x === 'object' && x.updatedAt == null; })) {
        persist(kind);
      }
    });
    if (migrate) persist('settings');
    data.tombstones = normTombstones(read(KEYS.tombstones, []));
  }

  function persist(kind) {
    return write(KEYS[kind], data[kind]);
  }

  /** Надгробие не старше удаляемой версии записи (иначе при «спешащих» часах другого устройства
   *  удаление проиграло бы, и запись вернулась бы после синхронизации) */
  function tombFor(kind, x, now) {
    return { id: x.id, coll: kind, deletedAt: Math.max(now, (x.updatedAt || 0)) };
  }

  function addTombstones(kind, items) {
    var now = Date.now();
    items.forEach(function (x) { data.tombstones.push(tombFor(kind, x, now)); });
    data.tombstones = normTombstones(data.tombstones, now);
    return persist('tombstones');
  }

  // ---------- публичный API ----------
  return {
    available: available,
    DEFAULT_SETTINGS: copy(DEFAULT_SETTINGS),
    LIST_KINDS: LIST_KINDS.slice(),
    genId: genId,
    load: load,
    sanitizeFood: sanitizeFood,
    sanitizeEntry: sanitizeEntry,
    sanitizeGlucose: sanitizeGlucose,
    sanitizeActivity: sanitizeActivity,
    sanitizeAiMemory: sanitizeAiMemory,
    sanitizeSettings: sanitizeSettings,
    AI_MEMORY_MAX: AI_MEMORY_MAX,
    sanitizeTombstone: sanitizeTombstone,
    sanitizers: SANITIZERS,
    normTombstones: normTombstones,

    settings: function () { return data.settings; },
    /** Сохранить настройки; updatedAt = сейчас (если не передан явно keepStamp) */
    saveSettings: function (s, keepStamp) {
      var clean = sanitizeSettings(s);
      if (!keepStamp) clean.updatedAt = nextStamp(data.settings);
      data.settings = clean;
      return persist('settings');
    },

    /** kind: 'entries' | 'glucose' | 'customFoods' | 'activity' */
    list: function (kind) { return data[kind]; },
    tombstones: function () { return data.tombstones; },

    get: function (kind, id) {
      for (var i = 0; i < data[kind].length; i++) if (data[kind][i].id === id) return data[kind][i];
      return null;
    },

    /** Добавить или заменить элемент (по id); updatedAt = сейчас. Возвращает {ok, item}. */
    upsert: function (kind, item) {
      var list = data[kind], idx = -1;
      for (var i = 0; i < list.length; i++) if (list[i].id === item.id) { idx = i; break; }
      var src = Object.assign({}, item, { updatedAt: nextStamp(idx >= 0 ? list[idx] : null) });
      var clean = SANITIZERS[kind](src);
      if (!clean) return { ok: false, item: null, invalid: true };
      if (idx >= 0) list[idx] = clean; else list.push(clean);
      return { ok: persist(kind), item: clean };
    },

    /** Удаление с «надгробием» — чтобы удаление дошло до других устройств */
    remove: function (kind, id) {
      var gone = data[kind].filter(function (x) { return x.id === id; });
      data[kind] = data[kind].filter(function (x) { return x.id !== id; });
      var ok = persist(kind);
      if (gone.length) ok = addTombstones(kind, gone) && ok;
      return ok;
    },

    removeWhere: function (kind, pred) {
      var gone = data[kind].filter(pred);
      data[kind] = data[kind].filter(function (x) { return !pred(x); });
      persist(kind);
      if (gone.length) addTombstones(kind, gone);
      return gone.length;
    },

    /** Добавить новые элементы (уже прошедшие санитайзер; updatedAt берётся из них) */
    addMany: function (kind, items) {
      Array.prototype.push.apply(data[kind], items);
      return persist(kind);
    },

    /**
     * Добавить или заменить несколько элементов по id за одну запись; updatedAt = nextStamp.
     * Для aiMemory: если записей больше AI_MEMORY_MAX, самые давно не использованные удаляются
     * с надгробием (обычное удаление — слияние остаётся сходящимся).
     */
    putMany: function (kind, items) {
      var list = data[kind], index = {};
      list.forEach(function (x, i) { index[x.id] = i; });
      items.forEach(function (item) {
        var i = index[item.id];
        var clean = SANITIZERS[kind](Object.assign({}, item, { updatedAt: nextStamp(i != null ? list[i] : null) }));
        if (!clean) return;
        if (i != null) list[i] = clean; else { index[clean.id] = list.length; list.push(clean); }
      });
      var evicted = [];
      if (kind === 'aiMemory' && list.length > AI_MEMORY_MAX) {
        var sorted = list.slice().sort(function (a, b) { return (a.lastUsed || a.updatedAt) - (b.lastUsed || b.updatedAt) || (a.id < b.id ? -1 : 1); });
        evicted = sorted.slice(0, list.length - AI_MEMORY_MAX);
        var gone = {};
        evicted.forEach(function (x) { gone[x.id] = true; });
        data[kind] = list.filter(function (x) { return !gone[x.id]; });
        var now = Date.now();
        evicted.forEach(function (x) { data.tombstones.push(tombFor(kind, x, now)); });
        data.tombstones = normTombstones(data.tombstones, now);
        return writeAll([kind, 'tombstones']);
      }
      return persist(kind);
    },

    /** Полный экспорт (резервная копия) */
    exportAll: function () {
      return {
        app: 'FoodTracker',
        format: 1,
        exportedAt: new Date().toISOString(),
        settings: copy(data.settings),
        customFoods: copy(data.customFoods),
        entries: copy(data.entries),
        glucose: copy(data.glucose),
        activity: copy(data.activity),
        aiMemory: copy(data.aiMemory)
      };
    },

    /**
     * Разбор файла импорта. Возвращает null, если структура не распознана,
     * иначе {settings|null, customFoods[], entries[], glucose[], activity[], skipped}.
     * Старые резервные копии без поля activity импортируются как раньше (activity = []).
     */
    parseImport: function (obj) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
      var hasAny = LIST_KINDS.some(function (k) { return Array.isArray(obj[k]); }) ||
        (obj.settings && typeof obj.settings === 'object');
      if (!hasAny) return null;
      var res = {
        settings: obj.settings && typeof obj.settings === 'object' ? sanitizeSettings(obj.settings) : null,
        skipped: 0
      };
      LIST_KINDS.forEach(function (kind) {
        var r = sanitizeList(obj[kind], SANITIZERS[kind]);
        res[kind] = r.items;
        res.skipped += r.skipped;
      });
      return res;
    },

    /** mode: 'merge' (добавить новые по id, настройки не трогать) | 'replace' */
    applyImport: function (parsed, mode) {
      var added = 0, now = Date.now();
      // Восстановление из копии должно пережить синхронизацию: если запись из файла была
      // удалена на этом устройстве (есть надгробие), она «воскрешается» — получает новое время
      // изменения, а надгробие снимается. Иначе следующая синхронизация удалила бы её снова.
      var tomb = {};
      data.tombstones.forEach(function (t) { tomb[t.coll + ':' + t.id] = t.deletedAt; });
      var revived = {};
      var revive = function (kind, x) {
        var d = tomb[kind + ':' + x.id];
        if (d != null && d >= (x.updatedAt || 0)) {
          x = Object.assign({}, x, { updatedAt: Math.max(now, d + 1) });
          revived[kind + ':' + x.id] = true;
        }
        return x;
      };
      LIST_KINDS.forEach(function (kind) {
        if (!parsed[kind]) parsed[kind] = [];
        if (mode === 'replace') {
          data[kind] = parsed[kind].map(function (x) { return revive(kind, x); });
          added += parsed[kind].length;
        } else {
          var ids = {};
          data[kind].forEach(function (x) { ids[x.id] = true; });
          parsed[kind].forEach(function (x) {
            if (!ids[x.id]) { data[kind].push(revive(kind, x)); ids[x.id] = true; added++; }
          });
        }
      });
      data.tombstones = data.tombstones.filter(function (t) { return !revived[t.coll + ':' + t.id]; });
      if (mode === 'replace' && parsed.settings) data.settings = parsed.settings;
      var ok = writeAll(['settings', 'tombstones'].concat(LIST_KINDS));
      if (!ok && available) load(); // не записалось (нет места) — возвращаемся к сохранённому состоянию
      return { ok: ok, added: ok ? added : 0 };
    },

    /**
     * Удалить все данные на этом устройстве. Для каждой записи создаётся «надгробие» —
     * после синхронизации записи удалятся и на других устройствах. Настройки сбрасываются
     * с updatedAt = 0, поэтому настройки других устройств при синхронизации не затираются.
     */
    clearAll: function () {
      var now = Date.now();
      LIST_KINDS.forEach(function (kind) {
        data[kind].forEach(function (x) { data.tombstones.push(tombFor(kind, x, now)); });
        data[kind] = [];
        removeKey(KEYS[kind]);
      });
      data.tombstones = normTombstones(data.tombstones, now);
      persist('tombstones');
      data.settings = copy(DEFAULT_SETTINGS);
      removeKey(KEYS.settings);
      removeKey(UNDO_KEY);
    },

    // ---------- для синхронизации ----------
    /** Копия всех синхронизируемых данных */
    snapshot: function () {
      return {
        settings: copy(data.settings),
        customFoods: copy(data.customFoods),
        entries: copy(data.entries),
        glucose: copy(data.glucose),
        activity: copy(data.activity),
        aiMemory: copy(data.aiMemory),
        tombstones: copy(data.tombstones)
      };
    },
    /** Заменить данные результатом слияния (или состоянием для отмены). Возвращает успех записи. */
    applySnapshot: function (snap) {
      var prev = { settings: data.settings, tombstones: data.tombstones };
      LIST_KINDS.forEach(function (kind) { prev[kind] = data[kind]; });
      data.settings = sanitizeSettings(snap.settings);
      LIST_KINDS.forEach(function (kind) { data[kind] = sanitizeList(snap[kind], SANITIZERS[kind]).items; });
      data.tombstones = normTombstones(snap.tombstones);
      if (!available) return false;
      // всё или ничего: при нехватке места остаёмся с прежними данными (и в памяти, и в хранилище)
      if (writeAll(['settings', 'tombstones'].concat(LIST_KINDS))) return true;
      Object.keys(prev).forEach(function (k) { data[k] = prev[k]; });
      return false;
    },
    deviceId: function () {
      var id = read(DEVICE_KEY, null);
      if (typeof id !== 'string' || !/^d[0-9a-z]{6,20}$/.test(id)) {
        id = 'd' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
        write(DEVICE_KEY, id);
      }
      return id;
    },
    syncMeta: function () { var m = read(META_KEY, null); return m && typeof m === 'object' ? m : {}; },
    setSyncMeta: function (m) { return write(META_KEY, m); },
    /** savedAt — момент непосредственно перед синхронизацией */
    saveUndo: function (snap, savedAt) { return write(UNDO_KEY, { savedAt: savedAt || Date.now(), snapshot: snap }); },
    getUndo: function () { var u = read(UNDO_KEY, null); return u && u.snapshot && u.savedAt > 0 ? u : null; },
    clearUndo: function () { removeKey(UNDO_KEY); },
    /**
     * Состояние для отмены синхронизации: данные «до синхронизации», но изменения,
     * сделанные на этом устройстве ПОСЛЕ неё (новые/изменённые записи, удаления, настройки),
     * сохраняются — иначе отмена стёрла бы всё, что внесено после синхронизации.
     */
    undoState: function (u) {
      var t0 = u.savedAt, base = u.snapshot || {}, out = { tombstones: [] };
      var tomb = {};
      (Array.isArray(base.tombstones) ? base.tombstones : []).forEach(function (t) { tomb[t.coll + ':' + t.id] = t; });
      data.tombstones.forEach(function (t) { if (t.deletedAt > t0) tomb[t.coll + ':' + t.id] = t; });
      LIST_KINDS.forEach(function (kind) {
        var by = {}, order = [];
        (Array.isArray(base[kind]) ? base[kind] : []).forEach(function (x) { if (x && x.id && !by[x.id]) order.push(x.id); if (x && x.id) by[x.id] = x; });
        data[kind].forEach(function (x) {
          if (x.updatedAt > t0) { if (!by[x.id]) order.push(x.id); by[x.id] = x; }
        });
        data.tombstones.forEach(function (t) { if (t.coll === kind && t.deletedAt > t0 && by[t.id] && by[t.id].updatedAt <= t.deletedAt) delete by[t.id]; });
        out[kind] = order.filter(function (id) { return by[id]; }).map(function (id) { return by[id]; });
      });
      out.tombstones = Object.keys(tomb).map(function (k) { return tomb[k]; });
      out.settings = data.settings.updatedAt > t0 ? data.settings : base.settings;
      return out;
    },
    ui: function () { var u = read(UI_KEY, null); return u && typeof u === 'object' ? u : {}; },
    setUi: function (patch) { return write(UI_KEY, Object.assign(this.ui(), patch)); },

    /** Примерный объём данных в localStorage (символы) */
    usage: function (withoutUndo) {
      if (!available) return 0;
      var total = 0;
      Object.keys(KEYS).concat(withoutUndo ? [] : ['undo']).forEach(function (k) {
        try { var v = window.localStorage.getItem(k === 'undo' ? UNDO_KEY : KEYS[k]); if (v) total += v.length; } catch (e) { /* ignore */ }
      });
      return total;
    }
  };
})();
