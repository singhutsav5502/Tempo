// Local-first event service. Google Calendar is synced in the background (see google.js);
// everything here works offline, and blocking only ever reads from this cache.
//
// Recurrence: events that came from Google arrive already expanded into instances (each carries `seriesGid`).
// Series created here live in `store.series` until they have been pushed to Google, and are expanded on the fly
// into "virtual" instances (id = "<seriesId>@<startMs>") so they show up and enforce blocks immediately, even offline.
const { EventEmitter } = require('events');
const crypto = require('crypto');
const store = require('./store');

const bus = new EventEmitter();
let syncHook = () => {};

const DAY = 86400000;
const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const WD_NAMES = { SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat' };
const FREQS = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };

const types = () => store.get().types;
const typeOf = (id) => types().find((t) => t.id === id) || null;
const seriesList = () => (store.get().series ||= []);
const opsList = () => (store.get().ops ||= []);

function changed(needsSync = true) {
  store.save();
  bus.emit('changed');
  if (needsSync) syncHook();
}

// ---- recurrence rules ---------------------------------------------------------------

/** Validates user/AI input like {freq:'weekly', days:['MO','WE'], interval:1, count:10, until:'2026-12-31'}. */
function buildRule(input, startDate) {
  const freq = FREQS[String(input.freq || '').toLowerCase()];
  if (!freq) throw new Error('recurrence.freq must be daily, weekly, monthly or yearly');
  const interval = Math.max(1, Math.floor(Number(input.interval) || 1));
  let byday = null;
  if (freq === 'WEEKLY') {
    const days = (input.days || []).map((d) => String(d).slice(0, 2).toUpperCase());
    if (days.some((d) => !WD.includes(d))) throw new Error('recurrence.days must use MO, TU, WE, TH, FR, SA, SU');
    byday = days.length ? [...new Set(days)] : [WD[startDate.getDay()]];
  }
  const count = input.count ? Math.max(1, Math.floor(Number(input.count))) : null;
  let until = null;
  if (input.until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.until)) throw new Error('recurrence.until must be YYYY-MM-DD');
    until = input.until;
  }
  return { freq, interval, byday, count, until: count ? null : until };
}

function ruleText(r) {
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[r.freq];
  let text;
  if (r.freq === 'WEEKLY' && r.byday && r.interval === 1 && r.byday.join() === 'MO,TU,WE,TH,FR') text = 'Every weekday';
  else if (r.freq === 'WEEKLY') text = `${r.interval > 1 ? `Every ${r.interval} weeks` : 'Weekly'} on ${r.byday.map((d) => WD_NAMES[d]).join(', ')}`;
  else text = r.interval > 1 ? `Every ${r.interval} ${unit}s` : ({ DAILY: 'Daily', MONTHLY: 'Monthly', YEARLY: 'Yearly' })[r.freq];
  if (r.count) text += `, ${r.count} times`;
  else if (r.until) text += `, until ${r.until}`;
  return text;
}

const endOfDay = (ymd) => new Date(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), 23, 59, 59).getTime();
const pad = (n) => String(n).padStart(2, '0');
const localYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ymdHmsLocal = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** RRULE line for Google Calendar. */
function rruleString(r) {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byday) parts.push(`BYDAY=${r.byday.join(',')}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  if (r.until) parts.push(`UNTIL=${new Date(endOfDay(r.until)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
  return `RRULE:${parts.join(';')}`;
}

/** Start times (Date, wall-clock preserved across DST) of a series that overlap [fromMs, toMs). */
function occurrences(sr, fromMs, toMs) {
  const r = sr.rule;
  const first = new Date(sr.start);
  const dur = Date.parse(sr.end) - Date.parse(sr.start);
  const until = r.until ? endOfDay(r.until) : Infinity;
  const out = [];
  let n = 0;

  // Returns false once nothing later in the sequence can matter.
  const add = (d) => {
    const t = d.getTime();
    if (t > until || (r.count && n >= r.count)) return false;
    n++;
    if (t + dur > fromMs && t < toMs) out.push(new Date(t));
    return t < toMs;
  };

  if (r.freq === 'DAILY') {
    for (let k = 0; k < 5000; k++) {
      const d = new Date(first); d.setDate(first.getDate() + k * r.interval);
      if (!add(d)) break;
    }
  } else if (r.freq === 'WEEKLY') {
    const monday = new Date(first); monday.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const offsets = r.byday.map((x) => (WD.indexOf(x) + 6) % 7).sort((a, b) => a - b);
    outer: for (let w = 0; w < 1500; w++) {
      for (const off of offsets) {
        const d = new Date(monday); d.setDate(monday.getDate() + w * 7 * r.interval + off);
        if (d < first) continue;
        if (!add(d)) break outer;
      }
    }
  } else if (r.freq === 'MONTHLY') {
    for (let k = 0; k < 1200; k++) {
      const d = new Date(first); d.setMonth(first.getMonth() + k * r.interval);
      if (d.getDate() !== first.getDate()) continue; // no 31st in this month: skipped, like Google
      if (!add(d)) break;
    }
  } else {
    for (let k = 0; k < 200; k++) {
      const d = new Date(first); d.setFullYear(first.getFullYear() + k * r.interval);
      if (d.getDate() !== first.getDate()) continue;
      if (!add(d)) break;
    }
  }
  const skip = new Set(sr.exdates || []); // local dates ('YYYY-MM-DD'), so they survive time-of-day edits
  return out.filter((d) => !skip.has(localYmd(d)));
}

function instance(sr, startDate) {
  const s = startDate.getTime();
  const dur = Date.parse(sr.end) - Date.parse(sr.start);
  return {
    id: `${sr.id}@${localYmd(startDate)}`, seriesId: sr.id, virtual: true, recurring: true, recurrenceText: ruleText(sr.rule),
    title: sr.title, description: sr.description || '', type: sr.type || null, allDay: false,
    start: new Date(s).toISOString(), end: new Date(s + dur).toISOString(),
  };
}

// ---- reading -------------------------------------------------------------------------

/** Real events plus expanded not-yet-synced series, for the window (default: 45 days back, 200 ahead). */
function list(fromMs = Date.now() - 45 * DAY, toMs = Date.now() + 200 * DAY) {
  const real = store.get().events.filter((e) => e.pending !== 'delete');
  const virtual = [];
  for (const sr of seriesList()) {
    if (sr.gid || sr.pending === 'delete') continue;
    for (const d of occurrences(sr, fromMs, toMs)) virtual.push(instance(sr, d));
  }
  return real.concat(virtual);
}

function byId(id) {
  const real = store.get().events.find((e) => e.id === id);
  if (real) return real;
  const at = id.indexOf('@');
  if (at < 0) return null;
  const sr = seriesList().find((s) => s.id === id.slice(0, at));
  const day = id.slice(at + 1);
  if (!sr || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const from = new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)).getTime();
  const hit = occurrences(sr, from, from + DAY).find((d) => localYmd(d) === day);
  return hit ? instance(sr, hit) : null;
}

function range(startMs, endMs) {
  return list(startMs, endMs)
    .filter((e) => Date.parse(e.end) > startMs && Date.parse(e.start) < endMs)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

// ---- writing -------------------------------------------------------------------------

function normalize(input, existing = {}) {
  const ev = { ...existing };
  if (input.title !== undefined) ev.title = String(input.title).trim() || 'Untitled';
  if (input.type !== undefined) ev.type = input.type && typeOf(input.type) ? input.type : null;
  if (input.allDay !== undefined) ev.allDay = !!input.allDay;
  if (input.start !== undefined) ev.start = input.start;
  if (input.end !== undefined) ev.end = input.end;
  if (input.description !== undefined) ev.description = input.description;
  if (!ev.allDay) {
    const s = Date.parse(ev.start);
    const e = Date.parse(ev.end);
    if (Number.isNaN(s)) throw new Error(`Invalid start time: ${ev.start}`);
    if (Number.isNaN(e) || e <= s) throw new Error('End time must be after start time');
    ev.start = new Date(s).toISOString();
    ev.end = new Date(e).toISOString();
  }
  return ev;
}

function createImpl(input) {
  const { recurrence, ...fields } = input;
  const ev = normalize({ type: null, allDay: false, ...fields }, { id: crypto.randomUUID(), pending: 'create' });
  if (!recurrence) {
    store.get().events.push(ev);
    changed();
    return ev;
  }
  if (ev.allDay) throw new Error('Repeating all-day events are not supported yet');
  const sr = {
    id: ev.id, pending: 'create', title: ev.title, description: ev.description || '', type: ev.type,
    start: ev.start, end: ev.end, rule: buildRule(recurrence, new Date(ev.start)), exdates: [],
  };
  seriesList().push(sr);
  changed();
  return instance(sr, new Date(ev.start));
}

const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/** Deltas (ms) that turn the instance's current times into the patched ones, for whole-series edits. */
function timeDeltas(cur, patched) {
  if (localDay(patched.start) !== localDay(cur.start)) {
    throw new Error('Changing the day applies to one occurrence only. Edit "this event", or edit the series in Google Calendar.');
  }
  return { dStart: Date.parse(patched.start) - Date.parse(cur.start), dEnd: Date.parse(patched.end) - Date.parse(cur.end) };
}

const shift = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

/** scope: 'this' (default) edits one occurrence; 'all' edits the whole series. */
function updateImpl(id, patch, scope = 'this') {
  const cur = byId(id);
  if (!cur || cur.pending === 'delete') throw new Error(`No event with id ${id}`);

  if (cur.virtual) {
    const sr = seriesList().find((s) => s.id === cur.seriesId);
    const next = normalize(patch, cur);
    if (scope === 'all') {
      const { dStart, dEnd } = timeDeltas(cur, next);
      sr.title = next.title; sr.type = next.type; sr.description = next.description || '';
      sr.start = shift(sr.start, dStart); sr.end = shift(sr.end, dEnd);
      changed();
      return instance(sr, new Date(Date.parse(cur.start) + dStart));
    }
    (sr.exdates ||= []).push(localYmd(new Date(cur.start)));
    const { virtual, seriesId, recurring, recurrenceText, id: _id, ...plain } = next;
    const ev = { ...plain, id: crypto.randomUUID(), pending: 'create' };
    store.get().events.push(ev);
    changed();
    return ev;
  }

  const next = normalize(patch, cur);
  if (scope === 'all' && cur.seriesGid) {
    const { dStart, dEnd } = timeDeltas(cur, next);
    const gid = cur.seriesGid;
    const descChanged = patch.description !== undefined && (patch.description || '') !== (cur.description || '');
    opsList().push({ type: 'series-update', gid, patch: { title: next.title, type: next.type || '', dStart, dEnd, ...(descChanged ? { description: next.description || '' } : {}) } });
    for (const e of store.get().events) {
      if (e.seriesGid !== gid || e.pending === 'delete') continue;
      e.title = next.title; e.type = next.type || null;
      if (descChanged) e.description = next.description || '';
      e.start = shift(e.start, dStart); e.end = shift(e.end, dEnd);
    }
    changed();
    return byId(id);
  }
  // Remember that the notes were edited here, so an update that doesn't touch them never overwrites Google's copy.
  if (patch.description !== undefined && (patch.description || '') !== (cur.description || '')) cur.descEdited = true;
  Object.assign(cur, next);
  if (cur.pending !== 'create') cur.pending = 'update';
  changed();
  return cur;
}

function removeImpl(id, scope = 'this') {
  const cur = byId(id);
  if (!cur) return false;

  if (cur.virtual) {
    const all = seriesList();
    const sr = all.find((s) => s.id === cur.seriesId);
    if (scope === 'all') all.splice(all.indexOf(sr), 1);
    else (sr.exdates ||= []).push(localYmd(new Date(cur.start)));
    changed();
    return true;
  }
  if (scope === 'all' && cur.seriesGid) {
    const gid = cur.seriesGid;
    opsList().push({ type: 'series-delete', gid });
    store.get().events = store.get().events.filter((e) => e.seriesGid !== gid);
    changed();
    return true;
  }
  if (cur.gid) cur.pending = 'delete';
  else store.get().events.splice(store.get().events.indexOf(cur), 1);
  changed();
  return true;
}

// ---- undo -------------------------------------------------------------------------------
// Every create/update/remove records how to reverse itself (including changes made by the assistant). Reversals check
// what sync has already done: a deleted event that Google already removed is re-created rather than half-restored.
// Whole-series changes can be undone until they have synced; after that undo says so instead of guessing.

const UNDO_LIMIT = 30;
const undoStack = [];
let replaying = false;
const FIELDS = ['title', 'type', 'start', 'end', 'description', 'allDay'];
const pick = (e) => Object.fromEntries(FIELDS.map((k) => [k, e[k]]));
const quote = (t) => `"${String(t || 'Untitled').slice(0, 40)}"`;

function record(label, fn) {
  if (replaying) return;
  undoStack.push({ label, fn });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  bus.emit('undoable', { label, depth: undoStack.length });
}

function undo() {
  const u = undoStack.pop();
  if (!u) return { ok: false, message: 'Nothing to undo.' };
  replaying = true;
  try {
    const ok = u.fn() !== false;
    return { ok, message: ok ? `Undone: ${u.label}` : `Can't undo ${u.label} any more: it has already synced to Google Calendar.` };
  } catch (err) {
    return { ok: false, message: `Couldn't undo: ${err.message}` };
  } finally {
    replaying = false;
  }
}

const findSeries = (sr) => seriesList().includes(sr);
const dropExdate = (sr, day) => { sr.exdates = (sr.exdates || []).filter((d) => d !== day); };

function create(input) {
  const out = createImpl(input);
  if (out.virtual) {
    const sr = seriesList().find((x) => x.id === out.seriesId);
    record(`Added ${quote(out.title)}`, () => {
      if (findSeries(sr)) { seriesList().splice(seriesList().indexOf(sr), 1); changed(); return true; }
      const inst = sr.gid && store.get().events.find((e) => e.seriesGid === sr.gid);
      if (!inst) return false;
      removeImpl(inst.id, 'all');
      return true;
    });
  } else {
    record(`Added ${quote(out.title)}`, () => { if (!byId(out.id)) return false; removeImpl(out.id); return true; });
  }
  return out;
}

function update(id, patch, scope = 'this') {
  const cur = byId(id);
  if (!cur) return updateImpl(id, patch, scope);
  const prev = pick(cur);
  const verb = patch.start !== undefined && patch.start !== cur.start ? 'Moved' : 'Changed';

  if (cur.virtual) {
    const sr = seriesList().find((x) => x.id === cur.seriesId);
    const before = { ...sr, exdates: [...(sr.exdates || [])] };
    const out = updateImpl(id, patch, scope);
    record(`${verb} ${quote(prev.title)}`, () => {
      if (!findSeries(sr)) return false;
      if (scope === 'all') Object.assign(sr, { title: before.title, type: before.type, description: before.description, start: before.start, end: before.end });
      else { dropExdate(sr, localYmd(new Date(cur.start))); const ev = store.get().events.find((e) => e.id === out.id); if (ev) removeImpl(ev.id); }
      changed();
      return true;
    });
    return out;
  }

  if (scope === 'all' && cur.seriesGid) {
    const out = updateImpl(id, patch, scope);
    const op = opsList()[opsList().length - 1];
    record(`${verb} all ${quote(prev.title)}`, () => {
      const i = opsList().indexOf(op);
      if (i < 0) return false;
      opsList().splice(i, 1);
      // Walk the cached instances back by the same amounts.
      for (const e of store.get().events) {
        if (e.seriesGid !== cur.seriesGid || e.pending === 'delete') continue;
        e.title = prev.title; e.type = prev.type || null;
        if (op.patch.description !== undefined) e.description = prev.description || '';
        e.start = shift(e.start, -op.patch.dStart); e.end = shift(e.end, -op.patch.dEnd);
      }
      changed();
      return true;
    });
    return out;
  }

  const out = updateImpl(id, patch, scope);
  record(`${verb} ${quote(prev.title)}`, () => {
    const c = byId(id);
    if (!c || c.pending === 'delete') return false;
    updateImpl(id, prev);
    return true;
  });
  return out;
}

function remove(id, scope = 'this') {
  const cur = byId(id);
  if (!cur) return false;
  const label = `Deleted ${quote(cur.title)}${scope === 'all' && cur.recurring ? ' (all events)' : ''}`;

  if (cur.virtual) {
    const sr = seriesList().find((x) => x.id === cur.seriesId);
    const day = localYmd(new Date(cur.start));
    const ok = removeImpl(id, scope);
    record(label, () => {
      if (scope === 'all') { if (!findSeries(sr) && !sr.gid) { seriesList().push(sr); changed(); return true; } return false; }
      if (!findSeries(sr)) return false;
      dropExdate(sr, day); changed(); return true;
    });
    return ok;
  }

  if (scope === 'all' && cur.seriesGid) {
    const copies = store.get().events.filter((e) => e.seriesGid === cur.seriesGid).map((e) => ({ ...e }));
    const ok = removeImpl(id, scope);
    const op = opsList()[opsList().length - 1];
    record(label, () => {
      const i = opsList().indexOf(op);
      if (i < 0) return false;
      opsList().splice(i, 1);
      store.get().events.push(...copies);
      changed();
      return true;
    });
    return ok;
  }

  const copy = { ...cur };
  const ok = removeImpl(id, scope);
  record(label, () => {
    const still = store.get().events.find((e) => e.id === copy.id);
    if (still && still.pending === 'delete') { still.pending = 'update'; changed(); return true; } // not pushed yet
    if (still) return false;
    // Gone locally (and from Google, if it was synced): bring it back as a new event.
    const { gid, etag, pending, descEdited, ...fields } = copy;
    store.get().events.push({ ...fields, id: crypto.randomUUID(), pending: 'create', ...(copy.description ? { descEdited: true } : {}) });
    changed();
    return true;
  });
  return ok;
}

const canUndo = () => undoStack.length > 0;

// Events whose time slot covers `now`. All-day events never trigger blocking.
function activeAt(now = Date.now()) {
  return list(now - DAY, now + DAY).filter((e) => !e.allDay && Date.parse(e.start) <= now && now < Date.parse(e.end));
}

function nextAfter(now = Date.now()) {
  return list(now, now + 30 * DAY)
    .filter((e) => !e.allDay && Date.parse(e.start) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] || null;
}

module.exports = {
  bus, list, byId, range, create, update, remove, undo, canUndo, activeAt, nextAfter, typeOf, types,
  changed, setSyncHook: (fn) => { syncHook = fn; },
  // used by google.js
  seriesList, opsList, rruleString, ymdHmsLocal, occurrences, localYmd,
};
