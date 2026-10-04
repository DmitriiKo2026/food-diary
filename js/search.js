/*
 * Умный поиск продуктов.
 * - регистр, «ё»/«е» и знаки препинания не важны;
 * - все слова запроса должны найтись в названии (в любом порядке);
 * - совпадение по началу слова («греч» → «Гречка»), по основе слова с упрощённым
 *   отбрасыванием окончаний («гречневую» → «Гречневая», «грече» → «Гречка»), по синонимам
 *   («картошка» → «Картофель») и с одной опечаткой для слов от 4 букв («картофиль», «гречька»);
 * - нормализованные слова названий вычисляются один раз и кэшируются.
 *
 * Уровни совпадения (меньше — лучше): 0 — точное название, 1 — название начинается с запроса,
 * 2 — все слова совпали по началу слова, 3 — по основе/синониму, 4 — с опечаткой.
 */
var FoodSearch = (function () {
  'use strict';

  // Окончания для упрощённого «стемминга» (от длинных к коротким)
  var ENDINGS = ['иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ией', 'иях', 'иям',
    'ов', 'ев', 'ей', 'ой', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ую', 'юю', 'ам', 'ям',
    'ах', 'ях', 'ом', 'ем', 'ка', 'ки', 'ку', 'ке', 'ок', 'ек', 'ть',
    'а', 'я', 'ы', 'и', 'е', 'у', 'ю', 'о', 'ь', 'й'];

  // Синонимы и разговорные формы: начало слова запроса → альтернативные начала слов в названиях
  var SYN = {
    'картош': ['картоф'], 'картох': ['картоф'], 'картофан': ['картоф'],
    'греч': ['гречн', 'гречк'],
    'макарон': ['паст', 'спагет', 'вермиш', 'лапш', 'пенне', 'феттуч'], 'паст': ['макарон', 'спагет', 'пенне'],
    'спагет': ['макарон', 'паст'], 'вермиш': ['макарон', 'лапш'],
    'сосиск': ['сосиск', 'сардел'], 'сарделк': ['сардел'],
    'творожок': ['творожн', 'творог', 'сырок'], 'творожк': ['творожн', 'творог', 'сырок'], 'сырок': ['сырок', 'сырки'],
    'куриц': ['курин', 'курят', 'цыпл'], 'курин': ['куриц'], 'курочк': ['куриц', 'курин'],
    // ключи с «=» — только для слова целиком (иначе «кура» сработало бы на «курага»)
    '=кура': ['куриц', 'курин'], '=куры': ['куриц', 'курин'], '=кур': ['куриц', 'курин'],
    'булк': ['булоч', 'булк'], 'макарош': ['макарон'], 'манк': ['манн'], 'пшенк': ['пшен'], 'овсянк': ['овсян'], 'перловк': ['перлов'], 'ячк': ['ячнев'],
    'говядин': ['говяж'], 'говяж': ['говядин'], 'свинин': ['свин'], 'свин': ['свинин'],
    'баранин': ['баран'], 'индюш': ['индейк'], 'индейк': ['индюш'],
    'помидор': ['томат'], 'томат': ['помидор'], 'помидорк': ['помидор', 'томат'],
    'кабачок': ['цукини', 'кабачк'], 'кабачк': ['цукини'], 'цукини': ['кабачк', 'кабачок'],
    'яйц': ['яичн', 'яиц'], 'яиц': ['яйц', 'яичн'], 'яичн': ['яйц', 'яйцо'], 'яйко': ['яйц'], 'яичк': ['яйц'],
    'молок': ['молочн'], 'молочн': ['молок'],
    'газировк': ['лимонад', 'кола'], 'шоколадк': ['шоколад'],
    'печеньк': ['печенье'], 'печенюшк': ['печенье'], 'пельмешк': ['пельмен'],
    'блинчик': ['блин'], 'блин': ['блинчик'], 'котлетк': ['котлет'], 'огурчик': ['огур', 'огурц'], 'огурец': ['огурц'],
    'морковк': ['морков'], 'капустк': ['капуст'], 'колбаск': ['колбас'], 'кефирчик': ['кефир'],
    'кофеек': ['кофе'], 'кофейк': ['кофе'], 'чаек': ['чай'], 'чайк': ['чай'], 'компотик': ['компот'],
    'супчик': ['суп'], 'хлебушк': ['хлеб'], 'булочк': ['булочк', 'булк'], 'сметанк': ['сметан'],
    'мороженк': ['морожен'], 'конфетк': ['конфет'], 'яблочк': ['яблок', 'яблоч'], 'яблок': ['яблоч'],
    'рыбк': ['рыб'], 'грибочк': ['гриб'], 'отбивн': ['шницел'], 'шницел': ['отбивн'],
    'шашлычок': ['шашлык'], 'чебурешк': ['чебурек'], 'сгущенк': ['сгущен'], 'сгущ': ['сгущен']
  };

  var STOP = { 'с': 1, 'со': 1, 'на': 1, 'в': 1, 'во': 1, 'и': 1, 'из': 1 };

  function normalize(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е');
  }

  var WORD_RE = /[0-9a-zа-яё%]+/gi;

  function stem(w) {
    if (w.length <= 3 || /^\d/.test(w)) return w;
    for (var i = 0; i < ENDINGS.length; i++) {
      var e = ENDINGS[i];
      // уменьшительные «-ка/-ки/…» отбрасываем, только если остаётся основа от 4 букв
      // (иначе «манка» → «ман» совпадало бы с «манго», «манты»)
      var dim = e.charAt(0) === 'к' || e === 'ок' || e === 'ек';
      var minStem = dim ? 4 : 3;
      if (w.length - e.length >= minStem && w.slice(-e.length) === e) {
        // «-ики/-ика» — это суффикс «-ик», а не уменьшительное «-ка»: «вареники» → «вареник», «сырники» → «сырник»
        if (dim && w.charAt(w.length - e.length - 1) === 'и') continue;
        return w.slice(0, -e.length);
      }
    }
    return w;
  }

  /** Слова названия с позициями в исходной строке */
  function tokenizeName(name) {
    var out = [], m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(name))) {
      var w = normalize(m[0]);
      out.push({ w: w, s: stem(w), start: m.index, len: m[0].length });
    }
    return out;
  }

  function queryTokens(q) {
    var out = [], m;
    WORD_RE.lastIndex = 0;
    var s = normalize(q);
    while ((m = WORD_RE.exec(s))) out.push(m[0]);
    return out;
  }

  // Кэш индекса: у встроенных продуктов — свойство объекта, у своих — по id+названию
  var customCache = {};
  function indexOf(f) {
    if (f.builtin) {
      if (!f._ix) f._ix = build(f.name);
      return f._ix;
    }
    var key = f.id + '|' + f.name;
    var ix = customCache[key];
    if (!ix) ix = customCache[key] = build(f.name);
    return ix;
  }
  function build(name) {
    var words = tokenizeName(name);
    return { words: words, joined: words.map(function (x) { return x.w; }).join(' ') };
  }

  /** Расстояние Дамерау–Левенштейна (вариант OSA) */
  function dl(a, b) {
    var n = a.length, m = b.length;
    if (Math.abs(n - m) > 1) return 2;
    var prev2 = null, prev = [], cur, i, j;
    for (j = 0; j <= m; j++) prev[j] = j;
    for (i = 1; i <= n; i++) {
      cur = [i];
      var rowMin = i;
      for (j = 1; j <= m; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > 1) return 2; // дальше только больше
      prev2 = prev; prev = cur;
    }
    return prev[m];
  }

  /** Подготовка слова запроса: основа и альтернативы-синонимы */
  function prepToken(t) {
    var st = stem(t), alts = [];
    Object.keys(SYN).forEach(function (k) {
      var hit = k.charAt(0) === '=' ? t === k.slice(1) : (t.indexOf(k) === 0 || st.indexOf(k) === 0);
      if (hit) alts = alts.concat(SYN[k]);
    });
    return { t: t, st: st, alts: alts, fuzzy: t.length >= 4 && !/^\d/.test(t) };
  }

  /** Лучшее совпадение слова запроса со словами названия: {level, wi, len} или null */
  function matchToken(pt, words) {
    var best = null;
    for (var i = 0; i < words.length; i++) {
      var w = words[i], lvl = 0, len = 0;
      if (w.w.indexOf(pt.t) === 0) { lvl = 2; len = pt.t.length; }
      // одинаковая основа («грече» / «гречка» → «греч») — так же хорошо, как совпадение по началу слова
      else if (pt.st.length >= 4 && w.s === pt.st) { lvl = 2; len = Math.min(w.len, pt.st.length); }
      else if (pt.st.length >= 3 && w.s.indexOf(pt.st) === 0) { lvl = 3; len = Math.min(w.len, pt.st.length); }
      // основа слова названия — начало основы запроса, но не намного короче
      // (иначе «вареники» находили бы все «варёные …»)
      else if (w.s.length >= 4 && w.s.length >= pt.st.length - 1 && pt.st.indexOf(w.s) === 0) { lvl = 3; len = w.s.length; }
      else {
        for (var a = 0; a < pt.alts.length; a++) {
          if (w.w.indexOf(pt.alts[a]) === 0) { lvl = 3; len = Math.min(w.len, pt.alts[a].length); break; }
        }
        if (!lvl && pt.fuzzy && w.w.length >= 3) {
          var L = pt.t.length;
          for (var d = -1; d <= 1 && !lvl; d++) {
            var pl = L + d;
            if (pl < 3 || pl > w.w.length) continue;
            if (dl(pt.t, w.w.slice(0, pl)) <= 1) { lvl = 4; len = pl; }
          }
        }
      }
      var exact = lvl === 2 && (w.w === pt.t || w.s === pt.st);
      if (lvl && (!best || lvl < best.level || (lvl === best.level && exact && !best.exact))) best = { level: lvl, wi: i, len: len, exact: exact };
      if (best && best.exact) break;
    }
    return best;
  }

  /**
   * Поиск. foods — массив продуктов; opts.boost(f) — дополнительный вес (больше — выше),
   * opts.limit — ограничение числа результатов (0/нет — все).
   * Возвращает [{f, level, hl:[[start,len],...]}], отсортированные по релевантности.
   */
  function search(q, foods, opts) {
    opts = opts || {};
    var toks = queryTokens(q);
    if (!toks.length) return [];
    var qj = toks.join(' ');
    // предлоги не обязательны: «греча с молоком» → «Каша гречневая на молоке»
    var meaningful = toks.filter(function (t) { return !STOP[t]; });
    if (meaningful.length) toks = meaningful;
    var pts = toks.map(prepToken);
    var out = [];
    for (var i = 0; i < foods.length; i++) {
      var f = foods[i], ix = indexOf(f), worst = 0, hl = [], first = false, ok = true, exact = 0;
      for (var k = 0; k < pts.length; k++) {
        var m = matchToken(pts[k], ix.words);
        if (!m) { ok = false; break; }
        if (m.level > worst) worst = m.level;
        if (m.exact) exact++;
        if (k === 0 && m.wi === 0) first = true;
        hl.push([ix.words[m.wi].start, m.len]);
      }
      if (!ok) continue;
      // 1 — название начинается с запроса по границе слова («батон» не поднимает «Батончик» выше «Хлеб (батон)»)
      var level = ix.joined === qj ? 0 : ix.joined.indexOf(qj + ' ') === 0 ? 1 : worst;
      out.push({ f: f, level: level, hl: hl, first: first, exact: exact, boost: opts.boost ? opts.boost(f) : 0 });
    }
    // при равном уровне: свои/частые, затем целые слова («батон» → «Хлеб белый (батон)» выше «Батончика»)
    out.sort(function (a, b) {
      return a.level - b.level || b.boost - a.boost || b.exact - a.exact || (b.first ? 1 : 0) - (a.first ? 1 : 0) ||
        a.f.name.length - b.f.name.length || a.f.name.localeCompare(b.f.name, 'ru');
    });
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  /** Название с подсветкой совпадений (<mark>), всё остальное экранируется через escFn */
  function highlight(name, hl, escFn) {
    if (!hl || !hl.length) return escFn(name);
    var marks = new Array(name.length);
    hl.forEach(function (r) { for (var i = r[0]; i < r[0] + r[1] && i < name.length; i++) marks[i] = true; });
    var html = '', i = 0;
    while (i < name.length) {
      var j = i, on = !!marks[i];
      while (j < name.length && !!marks[j] === on) j++;
      var part = escFn(name.slice(i, j));
      html += on ? '<mark>' + part + '</mark>' : part;
      i = j;
    }
    return html;
  }

  return { search: search, highlight: highlight, normalize: normalize, stem: stem, dl: dl };
})();
