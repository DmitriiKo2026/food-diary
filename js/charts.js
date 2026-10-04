/*
 * Простые графики на <canvas> без библиотек.
 * - HiDPI: размер буфера умножается на devicePixelRatio.
 * - Цвета берутся из CSS-переменных, поэтому графики следуют светлой/тёмной теме
 *   (app.js перерисовывает их при смене темы и изменении размера окна).
 * - Подсказки: каждый график сохраняет «зоны попадания» в canvas._hits,
 *   общий обработчик показывает всплывающую подсказку при наведении/касании.
 */
var Charts = (function () {
  'use strict';

  var FONT = '12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  }

  function theme() {
    return {
      text: cssVar('--text'),
      muted: cssVar('--chart-muted'),
      grid: cssVar('--chart-grid'),
      axis: cssVar('--chart-axis'),
      surface: cssVar('--surface'),
      band: cssVar('--chart-band'),
      primary: cssVar('--series-1')
    };
  }

  /** Подготовка canvas под текущую ширину контейнера и DPR */
  function setup(canvas, height) {
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(200, Math.floor(canvas.parentNode.clientWidth || 300));
    canvas.style.width = w + 'px';
    canvas.style.height = height + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    canvas._hits = [];
    attachTip(canvas);
    return { ctx: ctx, w: w, h: height };
  }

  /** «Красивый» шаг шкалы */
  function niceStep(raw) {
    if (raw <= 0 || !isFinite(raw)) return 1;
    var exp = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var f = raw / exp;
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * exp;
  }

  function niceScale(min, max, count) {
    if (max <= min) max = min + 1;
    var step = niceStep((max - min) / (count || 4));
    return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step: step };
  }

  function fmtTick(v) {
    var r = Math.round(v * 100) / 100;
    return r.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  }

  /** Горизонтальная сетка + подписи оси Y */
  function drawYGrid(ctx, area, scale, t, fmt) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.fillStyle = t.muted;
    ctx.textAlign = 'right';
    for (var v = scale.min; v <= scale.max + scale.step / 1000; v += scale.step) {
      var y = Math.round(area.y + area.h - (v - scale.min) / (scale.max - scale.min) * area.h) + 0.5;
      ctx.strokeStyle = Math.abs(v - scale.min) < 1e-9 ? t.axis : t.grid;
      ctx.beginPath();
      ctx.moveTo(area.x, y);
      ctx.lineTo(area.x + area.w, y);
      ctx.stroke();
      ctx.fillText((fmt || fmtTick)(v), area.x - 6, y);
    }
    ctx.restore();
  }

  /** Подписи оси X с прореживанием */
  function drawXLabels(ctx, labels, xAt, y, t, minGap) {
    ctx.save();
    ctx.fillStyle = t.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var lastRight = -Infinity;
    var n = labels.length;
    var widest = 0;
    labels.forEach(function (l) { widest = Math.max(widest, ctx.measureText(l).width); });
    var step = 1;
    if (n > 1) {
      var slot = Math.abs(xAt(1) - xAt(0));
      step = Math.max(1, Math.ceil((widest + (minGap || 8)) / slot));
    }
    for (var i = 0; i < n; i++) {
      // всегда показываем последнюю подпись, остальные — с шагом от конца
      if ((n - 1 - i) % step !== 0) continue;
      var x = xAt(i);
      var wdt = ctx.measureText(labels[i]).width;
      if (x - wdt / 2 < lastRight + 4) continue;
      ctx.fillText(labels[i], x, y);
      lastRight = x + wdt / 2;
    }
    ctx.restore();
  }

  /** Прямоугольник со скруглённым верхом (столбец, «прикреплённый» к оси) */
  function topRoundedRect(ctx, x, y, w, h, r) {
    if (h <= 0 || w <= 0) return;
    r = Math.min(r, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
  }

  function emptyText(c, text) {
    c.ctx.fillStyle = theme().muted;
    c.ctx.textAlign = 'center';
    c.ctx.fillText(text, c.w / 2, c.h / 2);
  }

  // ---------------------------------------------------------------
  // Столбчатая диаграмма с линией цели
  // opts: {labels[], values[], goal, color, overColor, height, tips[], unit}
  // ---------------------------------------------------------------
  function bar(canvas, opts) {
    var t = theme();
    var c = setup(canvas, opts.height || 220);
    var ctx = c.ctx;
    var vals = opts.values;
    var maxV = Math.max.apply(null, vals.concat([opts.goal || 0]));
    if (maxV <= 0) { emptyText(c, 'Нет данных'); return; }
    var scale = niceScale(0, maxV * 1.08, 4);
    var area = { x: 44, y: 10, w: c.w - 44 - 8, h: c.h - 10 - 26 };
    drawYGrid(ctx, area, scale, t);

    var n = vals.length;
    var slot = area.w / n;
    var bw = Math.max(2, Math.min(36, slot - Math.max(2, slot * 0.25)));
    var yAt = function (v) { return area.y + area.h - (v - scale.min) / (scale.max - scale.min) * area.h; };
    var xAt = function (i) { return area.x + slot * i + slot / 2; };

    for (var i = 0; i < n; i++) {
      var v = vals[i];
      var x = xAt(i) - bw / 2;
      if (v > 0) {
        var y = yAt(v);
        ctx.fillStyle = opts.goal && v > opts.goal ? (opts.overColor || t.primary) : (opts.color || t.primary);
        topRoundedRect(ctx, x, y, bw, area.y + area.h - y, 4);
      }
      canvas._hits.push({ x0: area.x + slot * i, x1: area.x + slot * (i + 1), y0: area.y, y1: area.y + area.h, text: opts.tips ? opts.tips[i] : String(v) });
    }

    // линия цели
    if (opts.goal > 0) {
      var gy = Math.round(yAt(opts.goal)) + 0.5;
      ctx.save();
      ctx.strokeStyle = t.text;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(area.x, gy);
      ctx.lineTo(area.x + area.w, gy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = t.text;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(opts.goalLabel || 'Цель', area.x + area.w, gy - 3);
      ctx.restore();
    }
    drawXLabels(ctx, opts.labels, xAt, area.y + area.h + 6, t);
  }

  // ---------------------------------------------------------------
  // Составные столбцы (например, Б/Ж/У по дням)
  // opts: {labels[], series:[{name,color,values[]}], height, tips[]}
  // ---------------------------------------------------------------
  function stacked(canvas, opts) {
    var t = theme();
    var c = setup(canvas, opts.height || 220);
    var ctx = c.ctx;
    var n = opts.labels.length;
    var totals = [];
    for (var i = 0; i < n; i++) {
      var s = 0;
      opts.series.forEach(function (ser) { s += ser.values[i] || 0; });
      totals.push(s);
    }
    var maxV = Math.max.apply(null, totals);
    if (maxV <= 0) { emptyText(c, 'Нет данных'); return; }
    var scale = niceScale(0, maxV * 1.05, 4);
    var area = { x: 44, y: 10, w: c.w - 44 - 8, h: c.h - 10 - 26 };
    drawYGrid(ctx, area, scale, t);
    var slot = area.w / n;
    var bw = Math.max(2, Math.min(36, slot - Math.max(2, slot * 0.25)));
    var k = area.h / (scale.max - scale.min);
    var xAt = function (j) { return area.x + slot * j + slot / 2; };

    for (var j = 0; j < n; j++) {
      var base = area.y + area.h;
      var x = xAt(j) - bw / 2;
      var segs = opts.series.filter(function (ser) { return (ser.values[j] || 0) > 0; });
      segs.forEach(function (ser, si) {
        var hgt = ser.values[j] * k;
        var top = base - hgt;
        ctx.fillStyle = ser.color;
        var isTop = si === segs.length - 1;
        // 2px зазор цвета фона между сегментами
        var gap = si > 0 && hgt > 3 ? 2 : 0;
        if (isTop) topRoundedRect(ctx, x, top, bw, hgt - gap, 4);
        else ctx.fillRect(x, top, bw, hgt - gap);
        base = top;
      });
      canvas._hits.push({ x0: area.x + slot * j, x1: area.x + slot * (j + 1), y0: area.y, y1: area.y + area.h, text: opts.tips ? opts.tips[j] : '' });
    }
    drawXLabels(ctx, opts.labels, xAt, area.y + area.h + 6, t);
  }

  // ---------------------------------------------------------------
  // Сахар крови во времени: точки + тонкая линия, целевой диапазон закрашен
  // opts: {points:[{t,v,color,tip}], tMin, tMax, low, high, dayTicks:[{t,label}], height, digits}
  // ---------------------------------------------------------------
  function glucose(canvas, opts) {
    var t = theme();
    var c = setup(canvas, opts.height || 240);
    var ctx = c.ctx;
    var pts = opts.points.slice().sort(function (a, b) { return a.t - b.t; });
    if (!pts.length) { emptyText(c, 'Нет измерений'); return; }
    var vMin = Math.min(opts.low, Math.min.apply(null, pts.map(function (p) { return p.v; })));
    var vMax = Math.max(opts.high, Math.max.apply(null, pts.map(function (p) { return p.v; })));
    var pad = (vMax - vMin) * 0.08;
    var scale = niceScale(Math.max(0, vMin - pad), vMax + pad, 5);
    var area = { x: 44, y: 10, w: c.w - 44 - 12, h: c.h - 10 - 26 };
    var yAt = function (v) { return area.y + area.h - (v - scale.min) / (scale.max - scale.min) * area.h; };
    var span = Math.max(1, opts.tMax - opts.tMin);
    var xAt = function (tm) { return area.x + (tm - opts.tMin) / span * area.w; };

    // целевой диапазон
    ctx.fillStyle = t.band;
    var yH = yAt(opts.high), yL = yAt(opts.low);
    ctx.fillRect(area.x, yH, area.w, yL - yH);
    drawYGrid(ctx, area, scale, t);

    // пунктир границ диапазона
    ctx.save();
    ctx.strokeStyle = t.muted;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    [yH, yL].forEach(function (y) {
      ctx.beginPath();
      ctx.moveTo(area.x, Math.round(y) + 0.5);
      ctx.lineTo(area.x + area.w, Math.round(y) + 0.5);
      ctx.stroke();
    });
    ctx.restore();

    // вертикальные отметки дней
    if (opts.dayTicks && opts.dayTicks.length) {
      ctx.save();
      ctx.strokeStyle = t.grid;
      ctx.lineWidth = 1;
      opts.dayTicks.forEach(function (d) {
        var x = Math.round(xAt(d.t)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, area.y + area.h);
        ctx.lineTo(x, area.y + area.h + 4);
        ctx.stroke();
      });
      ctx.restore();
      var centers = opts.dayTicks.map(function (d) { return xAt(d.t + 43200000); });
      drawXLabels(ctx, opts.dayTicks.map(function (d) { return d.label; }), function (i) { return centers[i]; }, area.y + area.h + 6, t);
    }

    // соединительная линия
    if (pts.length > 1) {
      ctx.save();
      ctx.strokeStyle = t.muted;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(function (p, i) {
        var x = xAt(p.t), y = yAt(p.v);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
    }

    // точки с кольцом цвета фона
    // радиус точки зависит от плотности данных
    var r = Math.max(2.5, Math.min(4.5, area.w / pts.length * 0.8));
    pts.forEach(function (p) {
      var x = xAt(p.t), y = yAt(p.v);
      ctx.beginPath();
      ctx.arc(x, y, r + 2, 0, Math.PI * 2);
      ctx.fillStyle = t.surface;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      canvas._hits.push({ cx: x, cy: y, r: Math.max(10, r + 6), text: p.tip });
    });
  }

  // ---------------------------------------------------------------
  // Столбцы (левая ось) + точки (правая ось) — например, углеводы за день и средний сахар после еды
  // opts: {labels[], bars[], barColor, points[] (число или null), pointColors[], low, high,
  //        leftFmt, rightFmt, height, tips[]}
  // ---------------------------------------------------------------
  function combo(canvas, opts) {
    var t = theme();
    var c = setup(canvas, opts.height || 220);
    var ctx = c.ctx;
    var n = opts.labels.length;
    var bars = opts.bars, pts = opts.points;
    var maxB = Math.max.apply(null, bars.concat([0]));
    var pv = pts.filter(function (v) { return v != null && isFinite(v); });
    if (maxB <= 0 && !pv.length) { emptyText(c, 'Нет данных'); return; }
    var area = { x: 44, y: 10, w: c.w - 44 - 44, h: c.h - 10 - 26 };
    var lScale = niceScale(0, Math.max(20, maxB) * 1.08, 4);
    // правая шкала — с теми же «делениями», что и левая, чтобы сетка была общей
    var rMin = Math.min.apply(null, pv.concat([opts.low]));
    var rMax = Math.max.apply(null, pv.concat([opts.high]));
    var ticks = Math.max(1, Math.round((lScale.max - lScale.min) / lScale.step));
    var rLoRaw = Math.max(0, rMin - (rMax - rMin) * 0.1);
    var rStep = niceStep((rMax * 1.04 - rLoRaw) / ticks);
    var rLo = Math.floor(rLoRaw / rStep) * rStep;
    for (var guard = 0; guard < 10 && rLo + rStep * ticks < rMax * 1.02; guard++) {
      rStep = niceStep(rStep * 1.01);
      rLo = Math.floor(rLoRaw / rStep) * rStep;
    }
    var rScale = { min: rLo, max: rLo + rStep * ticks, step: rStep };
    var yL = function (v) { return area.y + area.h - (v - lScale.min) / (lScale.max - lScale.min) * area.h; };
    var yR = function (v) { return area.y + area.h - (v - rScale.min) / (rScale.max - rScale.min) * area.h; };
    var slot = area.w / n;
    var xAt = function (i) { return area.x + slot * i + slot / 2; };

    // целевой диапазон сахара (по правой оси)
    if (opts.low != null && opts.high != null) {
      ctx.fillStyle = t.band;
      var b0 = Math.max(area.y, yR(opts.high)), b1 = Math.min(area.y + area.h, yR(opts.low));
      if (b1 > b0) ctx.fillRect(area.x, b0, area.w, b1 - b0);
    }
    drawYGrid(ctx, area, lScale, t, opts.leftFmt);
    // подписи правой оси
    ctx.save();
    ctx.fillStyle = t.muted;
    ctx.textAlign = 'left';
    for (var k = 0; k <= ticks; k++) {
      var rv = rScale.min + rStep * k;
      ctx.fillText((opts.rightFmt || fmtTick)(rv), area.x + area.w + 6, Math.round(yR(rv)) + 0.5);
    }
    ctx.restore();

    var bw = Math.max(2, Math.min(28, slot - Math.max(2, slot * 0.3)));
    for (var i = 0; i < n; i++) {
      if (bars[i] > 0) {
        var y = yL(bars[i]);
        ctx.fillStyle = opts.barColor || t.primary;
        ctx.globalAlpha = 0.55;
        topRoundedRect(ctx, xAt(i) - bw / 2, y, bw, area.y + area.h - y, 4);
        ctx.globalAlpha = 1;
      }
      canvas._hits.push({ x0: area.x + slot * i, x1: area.x + slot * (i + 1), y0: area.y, y1: area.y + area.h, text: opts.tips ? opts.tips[i] : '' });
    }

    // линия и точки сахара
    ctx.save();
    ctx.strokeStyle = t.text;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    var started = false;
    for (var j = 0; j < n; j++) {
      if (pts[j] == null) continue;
      if (!started) { ctx.moveTo(xAt(j), yR(pts[j])); started = true; } else ctx.lineTo(xAt(j), yR(pts[j]));
    }
    if (pv.length > 1) ctx.stroke();
    ctx.restore();
    var r = Math.max(3, Math.min(5, slot * 0.3));
    for (var q = 0; q < n; q++) {
      if (pts[q] == null) continue;
      ctx.beginPath();
      ctx.arc(xAt(q), yR(pts[q]), r + 2, 0, Math.PI * 2);
      ctx.fillStyle = t.surface;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(xAt(q), yR(pts[q]), r, 0, Math.PI * 2);
      ctx.fillStyle = (opts.pointColors && opts.pointColors[q]) || t.text;
      ctx.fill();
    }
    drawXLabels(ctx, opts.labels, xAt, area.y + area.h + 6, t);
  }

  // ---------------------------------------------------------------
  // Кольцевая диаграмма
  // opts: {items:[{label,value,color,tip}], center, centerSub, height}
  // ---------------------------------------------------------------
  function donut(canvas, opts) {
    var t = theme();
    var c = setup(canvas, opts.height || 220);
    var ctx = c.ctx;
    var total = opts.items.reduce(function (s, it) { return s + Math.max(0, it.value); }, 0);
    if (total <= 0) { emptyText(c, 'Нет данных'); return; }
    var cx = c.w / 2, cy = c.h / 2;
    var r1 = Math.min(c.w, c.h) / 2 - 6;
    var r0 = r1 * 0.62;
    var a = -Math.PI / 2;
    var gapAngle = opts.items.filter(function (it) { return it.value > 0; }).length > 1 ? 2 / r1 : 0;
    opts.items.forEach(function (it) {
      if (it.value <= 0) return;
      var da = it.value / total * Math.PI * 2;
      var a0 = a + gapAngle / 2, a1 = a + da - gapAngle / 2;
      if (a1 > a0) {
        ctx.beginPath();
        ctx.arc(cx, cy, r1, a0, a1);
        ctx.arc(cx, cy, r0, a1, a0, true);
        ctx.closePath();
        ctx.fillStyle = it.color;
        ctx.fill();
      }
      canvas._hits.push({ arc: true, cx: cx, cy: cy, r0: r0, r1: r1, a0: a, a1: a + da, text: it.tip || it.label });
      a += da;
    });
    ctx.fillStyle = t.text;
    ctx.textAlign = 'center';
    if (opts.center) {
      ctx.font = '600 18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(opts.center, cx, cy - (opts.centerSub ? 8 : 0));
    }
    if (opts.centerSub) {
      ctx.font = FONT;
      ctx.fillStyle = t.muted;
      ctx.fillText(opts.centerSub, cx, cy + 12);
    }
  }

  // ---------------------------------------------------------------
  // Подсказки
  // ---------------------------------------------------------------
  var tipEl = null, tipTimer = null;

  function hitTest(canvas, x, y) {
    var hits = canvas._hits || [];
    var best = null, bestD = Infinity;
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      if (h.arc) {
        var dx = x - h.cx, dy = y - h.cy, d = Math.sqrt(dx * dx + dy * dy);
        if (d < h.r0 || d > h.r1) continue;
        var ang = Math.atan2(dy, dx);
        // приводим угол к диапазону [a0, a0 + 2π)
        while (ang < h.a0) ang += Math.PI * 2;
        while (ang >= h.a0 + Math.PI * 2) ang -= Math.PI * 2;
        if (ang <= h.a1) return h;
      } else if (h.r != null) {
        var ddx = x - h.cx, ddy = y - h.cy, dd = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dd <= h.r && dd < bestD) { best = h; bestD = dd; }
      } else if (x >= h.x0 && x < h.x1 && y >= h.y0 - 10 && y <= h.y1 + 10) {
        return h;
      }
    }
    return best;
  }

  function showTip(text, clientX, clientY) {
    if (!tipEl) tipEl = document.getElementById('chart-tip');
    if (!tipEl || !text) { hideTip(); return; }
    tipEl.textContent = text; // textContent — без риска XSS
    tipEl.hidden = false;
    var tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    var x = clientX + 12, y = clientY - th - 12;
    if (x + tw > window.innerWidth - 8) x = clientX - tw - 12;
    if (x < 8) x = 8;
    if (y < 8) y = clientY + 16;
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
  }

  function hideTip() {
    if (!tipEl) tipEl = document.getElementById('chart-tip');
    if (tipEl) tipEl.hidden = true;
  }

  function attachTip(canvas) {
    if (canvas._tipAttached) return;
    canvas._tipAttached = true;
    function handle(ev) {
      var rect = canvas.getBoundingClientRect();
      var h = hitTest(canvas, ev.clientX - rect.left, ev.clientY - rect.top);
      if (h) showTip(h.text, ev.clientX, ev.clientY); else hideTip();
      if (ev.pointerType === 'touch') {
        clearTimeout(tipTimer);
        tipTimer = setTimeout(hideTip, 3000);
      }
    }
    canvas.addEventListener('pointermove', handle);
    canvas.addEventListener('pointerdown', handle);
    canvas.addEventListener('pointerleave', function (ev) { if (ev.pointerType !== 'touch') hideTip(); });
  }

  window.addEventListener('scroll', hideTip, { passive: true });

  return { bar: bar, stacked: stacked, glucose: glucose, combo: combo, donut: donut, hideTip: hideTip, cssVar: cssVar };
})();
