/*
 * Синхронизация через один JSON-файл (например, на Google Диске).
 * Здесь только «чистая» логика: формат файла, слияние двух наборов данных и сводка изменений.
 * Работа с файлами и интерфейсом — в app.js.
 *
 * Слияние детерминировано, коммутативно (A+B = B+A) и идемпотентно (A+B+B = A+B):
 *  - записи объединяются по id; при совпадении id побеждает больший updatedAt,
 *    при равенстве — запись с «большим» каноническим JSON (чтобы результат не зависел от порядка);
 *  - «надгробие» {id, coll, deletedAt} удаляет запись, если deletedAt >= updatedAt записи
 *    (правка после удаления «воскрешает» запись); хранится самое новое надгробие на id,
 *    надгробия старше 400 дней отбрасываются;
 *  - настройки — целиком, побеждает больший updatedAt;
 *  - все входящие данные проходят через санитайзеры хранилища (Store).
 */
var Sync = (function () {
  'use strict';

  // aiMemory — запомненные исправления распознавания по фото (id детерминирован по названию от ИИ)
  var KINDS = ['customFoods', 'entries', 'glucose', 'activity', 'aiMemory'];
  var FILE_NAME = 'food-diary-sync.json';

  /** JSON с отсортированными ключами — для детерминированного сравнения */
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort()
      .map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }

  function newer(a, b) {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
    return canon(a) > canon(b);
  }

  /** Привести набор данных к нормальному виду (санитайзеры, без генерации дубликатов) */
  function normalize(set, now) {
    set = set || {};
    var out = { settings: set.settings ? Store.sanitizeSettings(set.settings) : null, tombstones: Store.normTombstones(set.tombstones, now) };
    KINDS.forEach(function (kind) {
      var san = Store.sanitizers[kind], by = {};
      (Array.isArray(set[kind]) ? set[kind] : []).forEach(function (x) {
        var r = san(x);
        if (r && (!by[r.id] || newer(r, by[r.id]))) by[r.id] = r;
      });
      out[kind] = by;
    });
    return out;
  }

  /**
   * Слияние двух наборов {settings, customFoods[], entries[], glucose[], activity[], tombstones[]}.
   * now — текущее время (для удаления устаревших надгробий).
   */
  function merge(a, b, now) {
    now = now || Date.now();
    var A = normalize(a, now), B = normalize(b, now);
    var tomb = Store.normTombstones(A.tombstones.concat(B.tombstones), now);
    var tmap = {};
    tomb.forEach(function (t) { tmap[t.coll + ':' + t.id] = t.deletedAt; });
    var res = { tombstones: tomb };
    KINDS.forEach(function (kind) {
      var by = {};
      [A[kind], B[kind]].forEach(function (src) {
        Object.keys(src).forEach(function (id) {
          var r = src[id];
          if (!by[id] || newer(r, by[id])) by[id] = r;
        });
      });
      res[kind] = Object.keys(by).sort().filter(function (id) {
        var d = tmap[kind + ':' + id];
        return !(d != null && d >= by[id].updatedAt);
      }).map(function (id) { return by[id]; });
    });
    var sa = A.settings, sb = B.settings;
    res.settings = !sa ? (sb || Store.sanitizeSettings(null)) : !sb ? sa : (newer(sb, sa) ? sb : sa);
    return res;
  }

  /** Сводка изменений локальных данных: {kind: {added, updated, deleted}, settings: bool} */
  function diff(before, after) {
    var out = {};
    KINDS.forEach(function (kind) {
      var b = {}, a = {}, s = { added: 0, updated: 0, deleted: 0 };
      (before[kind] || []).forEach(function (x) { b[x.id] = canon(x); });
      (after[kind] || []).forEach(function (x) { a[x.id] = canon(x); });
      Object.keys(a).forEach(function (id) { if (!(id in b)) s.added++; else if (a[id] !== b[id]) s.updated++; });
      Object.keys(b).forEach(function (id) { if (!(id in a)) s.deleted++; });
      out[kind] = s;
    });
    out.settings = canon(before.settings) !== canon(after.settings);
    return out;
  }

  /** Содержимое файла синхронизации */
  function buildFile(snapshot, deviceId) {
    return {
      app: 'food-diary', format: 'ft-sync', version: 1,
      savedAt: Date.now(), deviceId: deviceId,
      data: {
        settings: snapshot.settings, customFoods: snapshot.customFoods, entries: snapshot.entries,
        glucose: snapshot.glucose, activity: snapshot.activity, aiMemory: snapshot.aiMemory || [],
        tombstones: snapshot.tombstones
      }
    };
  }

  /**
   * Разбор входящего файла: формат синхронизации или обычная резервная копия (экспорт JSON).
   * Возвращает {data, kind: 'sync'|'backup', savedAt, deviceId} или {error}.
   */
  function parseFile(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: 'Файл не похож на файл синхронизации или резервную копию.' };
    if (obj.format === 'ft-sync') {
      if (typeof obj.version === 'number' && obj.version > 1) return { error: 'Файл создан более новой версией приложения. Обновите приложение на этом устройстве.' };
      if (!obj.data || typeof obj.data !== 'object') return { error: 'В файле синхронизации нет данных.' };
      return { data: obj.data, kind: 'sync', savedAt: obj.savedAt, deviceId: obj.deviceId };
    }
    var looks = KINDS.some(function (k) { return Array.isArray(obj[k]); }) || (obj.settings && typeof obj.settings === 'object');
    if (!looks) return { error: 'Структура файла не распознана.' };
    return { data: obj, kind: 'backup' };
  }

  return { merge: merge, diff: diff, buildFile: buildFile, parseFile: parseFile, canon: canon, FILE_NAME: FILE_NAME, KINDS: KINDS };
})();
