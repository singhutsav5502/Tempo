// Daily sheet: customisable habits (tick/cross or a number against a goal) and a per-day log.
//
// Data model (stored in tempo.json, local only):
//   habits:   [{ id, name, kind:'check'|'number', target, direction:'atleast'|'atmost', unit, days:[0-6],
//                color, category, created:'YYYY-MM-DD', archived? }]
//   habitLog: { 'YYYY-MM-DD': { [habitId]: { status:'done'|'missed'|'skip'|null, value:number|null, note, manual } } }
//
// `status` is what was recorded. For number habits it is derived from the value against the goal unless the user
// ticked/crossed it by hand (`manual`). Everything an analytics layer needs (per-day status + value + note, per-habit
// category) is queryable through range() and stats().
const { EventEmitter } = require('events');
const crypto = require('crypto');
const store = require('./store');

const bus = new EventEmitter();
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const todayStr = () => ymd(new Date());
const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

const all = () => store.get().habits;
const logs = () => store.get().habitLog;
const active = () => all().filter((h) => !h.archived);
const byId = (id) => all().find((h) => h.id === id);

function changed() {
  store.save();
  bus.emit('changed');
}

// ---- definitions ------------------------------------------------------------------------

function normalize(input, existing = {}) {
  const h = { ...existing };
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new Error('A habit needs a name');
    h.name = name;
  }
  if (input.kind !== undefined) {
    if (!['check', 'number'].includes(input.kind)) throw new Error('kind must be "check" or "number"');
    h.kind = input.kind;
  }
  if (h.kind === 'number') {
    if (input.target !== undefined) {
      const t = input.target === null || input.target === '' ? null : Number(input.target);
      if (t !== null && !Number.isFinite(t)) throw new Error('target must be a number');
      h.target = t;
    }
    if (input.direction !== undefined) {
      if (!['atleast', 'atmost'].includes(input.direction)) throw new Error('direction must be "atleast" or "atmost"');
      h.direction = input.direction;
    }
    h.direction ||= 'atleast';
    h.target ??= null;
    if (input.unit !== undefined) h.unit = String(input.unit).trim();
  } else {
    delete h.target; delete h.direction; delete h.unit;
  }
  if (input.days !== undefined) {
    const days = [...new Set((input.days || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
    h.days = days.length ? days : [0, 1, 2, 3, 4, 5, 6];
  }
  h.days ||= [0, 1, 2, 3, 4, 5, 6];
  if (input.color !== undefined) h.color = input.color;
  if (input.category !== undefined) h.category = String(input.category).trim().toLowerCase();
  h.color ||= '#7c93ff';
  h.category ||= 'other';
  h.unit ??= h.kind === 'number' ? '' : undefined;
  return h;
}

function list() { return active(); }

function save(input) {
  const existing = input.id ? byId(input.id) : null;
  if (existing) {
    const next = normalize(input, existing);
    for (const k of Object.keys(existing)) if (!(k in next)) delete existing[k]; // e.g. a goal that no longer applies
    Object.assign(existing, next);
    changed();
    return existing;
  }
  const h = normalize({ kind: 'check', ...input }, { id: `h_${crypto.randomUUID().slice(0, 8)}`, created: todayStr() });
  all().push(h);
  changed();
  return h;
}

/** Habits are archived rather than deleted so their history (and future analytics) stay intact. */
function remove(id) {
  const h = byId(id);
  if (!h) return false;
  h.archived = true;
  changed();
  return true;
}

function reorder(ids) {
  const pos = new Map(ids.map((id, i) => [id, i]));
  const arch = all().filter((h) => h.archived);
  const act = active().sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  store.get().habits = [...act, ...arch];
  changed();
}

// ---- log --------------------------------------------------------------------------------

const scheduled = (habit, dateStr) => habit.days.includes(parseYmd(dateStr).getDay());

function meets(habit, value) {
  if (habit.target == null) return true;
  return habit.direction === 'atmost' ? value <= habit.target : value >= habit.target;
}

function derive(habit, entry) {
  if (!entry) return null;
  if (entry.status) return entry.status;
  if (habit.kind === 'number' && typeof entry.value === 'number') return meets(habit, entry.value) ? 'done' : 'missed';
  return null;
}

/** patch: { status?: 'done'|'missed'|'skip'|null, value?: number|null, note?: string } */
function logEntry(dateStr, habitId, patch) {
  const habit = byId(habitId);
  if (!habit) throw new Error(`No habit with id ${habitId}`);
  if (!isDateStr(dateStr)) throw new Error('date must be YYYY-MM-DD');
  const day = (logs()[dateStr] ||= {});
  const e = (day[habitId] ||= { status: null, value: null, note: '', manual: false });

  if (patch.value !== undefined) {
    const v = patch.value === null || patch.value === '' ? null : Number(patch.value);
    if (v !== null && !Number.isFinite(v)) throw new Error('value must be a number');
    if (habit.kind !== 'number' && v !== null) throw new Error(`${habit.name} is a tick/cross habit; it has no number`);
    e.value = v;
    if (!e.manual) e.status = v === null ? null : (meets(habit, v) ? 'done' : 'missed');
  }
  if (patch.status !== undefined) {
    if (![null, 'done', 'missed', 'skip'].includes(patch.status)) throw new Error('status must be done, missed, skip or null');
    e.status = patch.status;
    e.manual = patch.status !== null;
    if (patch.status === null && e.value !== null) e.status = meets(habit, e.value) ? 'done' : 'missed'; // back to automatic
  }
  if (patch.note !== undefined) e.note = String(patch.note).trim();

  if (!e.status && e.value === null && !e.note) { delete day[habitId]; if (!Object.keys(day).length) delete logs()[dateStr]; }
  changed();
  return logs()[dateStr]?.[habitId] || null;
}

/** One day of the sheet: every active habit with its entry and effective status. */
function day(dateStr) {
  return active().map((habit) => {
    const entry = logs()[dateStr]?.[habit.id] || null;
    return { habit, entry, status: derive(habit, entry), scheduled: scheduled(habit, dateStr) };
  });
}

/** Log entries between two dates (inclusive), for matrices and analytics: { date: { habitId: entry } }. */
function range(fromStr, toStr) {
  const out = {};
  for (let d = parseYmd(fromStr); ymd(d) <= toStr; d = addDays(d, 1)) out[ymd(d)] = logs()[ymd(d)] || {};
  return out;
}

// ---- stats ------------------------------------------------------------------------------

/**
 * Streak counts consecutive scheduled days ending at `endStr` (skipped days neither extend nor break it, and a
 * still-pending today doesn't break it). `windowDays` bounds the completion rate and averages.
 */
function statsFor(habit, endStr = todayStr(), windowDays = 30) {
  const end = parseYmd(endStr);
  const today = todayStr();
  let streak = 0; let open = true; let run = 0; let best = 0;
  let done = 0; let missed = 0; let sum = 0; let n = 0; let total = 0;
  for (let i = 0; i < 730; i++) {
    const key = ymd(addDays(end, -i));
    if (habit.created && key < habit.created && !logs()[key]?.[habit.id]) break;
    if (!scheduled(habit, key)) continue;
    const entry = logs()[key]?.[habit.id] || null;
    const st = derive(habit, entry);
    const inWindow = i < windowDays;
    if (typeof entry?.value === 'number') { total += entry.value; if (inWindow) { sum += entry.value; n++; } }
    if (st === 'skip') continue;
    if (st === 'done') {
      run++; best = Math.max(best, run);
      if (open) streak++;
      if (inWindow) done++;
    } else if (st === 'missed' || (st === null && key !== today && key < today)) {
      open = false; run = 0;
      if (inWindow) missed++;
    } // pending today: neither
  }
  return {
    id: habit.id, name: habit.name, streak, best, done, missed,
    rate: done + missed ? Math.round((done / (done + missed)) * 100) : null,
    average: n ? Math.round((sum / n) * 10) / 10 : null,
    total,
  };
}

function stats(endStr, windowDays) { return active().map((h) => statsFor(h, endStr, windowDays)); }

// ---- helpers for the assistant ------------------------------------------------------------

/** Find a habit by id, exact name, or unique partial name. */
function find(query) {
  const q = String(query || '').trim().toLowerCase();
  const list = active();
  const exact = list.filter((h) => h.id === q || h.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const partial = list.filter((h) => h.name.toLowerCase().includes(q) || q.includes(h.name.toLowerCase()));
  if (partial.length === 1) return partial[0];
  throw new Error(`${partial.length ? 'Ambiguous' : 'No'} habit "${query}". Habits: ${list.map((h) => h.name).join(', ')}`);
}

const goalText = (h) => (h.kind === 'number' && h.target != null ? `${h.direction === 'atmost' ? '≤' : '≥'} ${h.target}${h.unit ? ' ' + h.unit : ''}` : '');

module.exports = {
  bus, list, save, remove, reorder, byId, find, day, range, logEntry, stats, statsFor, derive, meets, scheduled, goalText,
  todayStr, ymd, parseYmd,
};
