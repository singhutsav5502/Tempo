// Local-first event service. Google Calendar is synced in the background (see google.js);
// everything here works offline, and blocking only ever reads from this cache.
const { EventEmitter } = require('events');
const crypto = require('crypto');
const store = require('./store');

const bus = new EventEmitter();
let syncHook = () => {};

const list = () => store.get().events.filter((e) => e.pending !== 'delete');
const byId = (id) => store.get().events.find((e) => e.id === id);
const types = () => store.get().types;
const typeOf = (id) => types().find((t) => t.id === id) || null;

function changed(needsSync = true) {
  store.save();
  bus.emit('changed');
  if (needsSync) syncHook();
}

function range(startMs, endMs) {
  return list()
    .filter((e) => Date.parse(e.end) > startMs && Date.parse(e.start) < endMs)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

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

function create(input) {
  const ev = normalize({ type: null, allDay: false, ...input }, { id: crypto.randomUUID(), pending: 'create' });
  store.get().events.push(ev);
  changed();
  return ev;
}

function update(id, patch) {
  const cur = byId(id);
  if (!cur || cur.pending === 'delete') throw new Error(`No event with id ${id}`);
  const ev = normalize(patch, cur);
  Object.assign(cur, ev);
  if (cur.pending !== 'create') cur.pending = 'update';
  changed();
  return cur;
}

function remove(id) {
  const cur = byId(id);
  if (!cur) return false;
  if (cur.gid) cur.pending = 'delete';
  else store.get().events.splice(store.get().events.indexOf(cur), 1);
  changed();
  return true;
}

// Events whose time slot covers `now`. All-day events never trigger blocking.
function activeAt(now = Date.now()) {
  return list().filter((e) => !e.allDay && Date.parse(e.start) <= now && now < Date.parse(e.end));
}

function nextAfter(now = Date.now()) {
  return list()
    .filter((e) => !e.allDay && Date.parse(e.start) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] || null;
}

module.exports = {
  bus, list, byId, range, create, update, remove, activeAt, nextAfter, typeOf, types,
  changed, setSyncHook: (fn) => { syncHook = fn; },
};
