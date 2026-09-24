'use strict';

const HOUR_H = 52;
const SNAP = 15;
const NO_TYPE_COLOR = '#8b90a0';
const DAY = 86400000;

const MAX_CUSTOM_DAYS = 14;
const TIME_GRID_VIEWS = ['day', 'week', 'custom'];

const RAIL_WIDE = 1360; // at least this wide: the goals panel is docked; otherwise a slim strip

const state = {
  railCollapsed: false, // user choice while the window is wide
  railOverlay: false,   // slide-over opened from the slim strip
  settingsTab: 'connections',
  page: 'calendar', // 'calendar' | 'sheet'
  sheetDate: startOfDay(new Date()),
  view: 'week',
  anchor: startOfDay(new Date()),
  custom: { start: startOfDay(new Date()), days: 5 },
  events: [],
  settings: null,
  google: null,
  blocker: null,
};

// ---- tiny DOM + date helpers ------------------------------------------------

const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtHour = (i) => new Date(2000, 0, 1, i).toLocaleTimeString([], { hour: 'numeric' });
const parseLocal = (dateStr, timeStr) => new Date(`${dateStr}T${timeStr}`);
const typeById = (id) => state.settings?.types.find((t) => t.id === id) || null;
const colorOf = (e) => typeById(e.type)?.color || NO_TYPE_COLOR;
const blocksSomething = (e) => { const t = typeById(e.type); return !!t && (t.apps.length || t.sites.length); };

function weekStart(d) { const x = startOfDay(d); const dow = (x.getDay() + 6) % 7; return addDays(x, -dow); }
// Visible hour window of the time grid (settings: dayStartHour / dayEndHour).
const H0 = () => state.settings?.dayStartHour ?? 0;
const H1 = () => state.settings?.dayEndHour ?? 24;

function visibleDays() {
  if (state.view === 'day') return [state.anchor];
  if (state.view === 'custom') return Array.from({ length: state.custom.days }, (_, i) => addDays(state.custom.start, i));
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart(state.anchor), i));
}

const monthGridStart = () => weekStart(new Date(state.anchor.getFullYear(), state.anchor.getMonth(), 1));
function monthRows() {
  const y = state.anchor.getFullYear(); const m = state.anchor.getMonth();
  return Math.ceil((((new Date(y, m, 1).getDay() + 6) % 7) + new Date(y, m + 1, 0).getDate()) / 7);
}

/** [start, end) of the dates the current view needs events for. */
function viewRange() {
  if (state.view === 'month') { const s = monthGridStart(); return [s, addDays(s, monthRows() * 7)]; }
  if (state.view === 'year') return [new Date(state.anchor.getFullYear(), 0, 1), new Date(state.anchor.getFullYear() + 1, 0, 1)];
  const d = visibleDays();
  return [d[0], addDays(d[d.length - 1], 1)];
}

function step(dir) {
  if (state.page === 'sheet') { state.sheetDate = addDays(state.sheetDate, dir); applyPage(); renderSheet(); return; }
  const a = state.anchor;
  if (state.view === 'day') state.anchor = addDays(a, dir);
  else if (state.view === 'week') state.anchor = addDays(a, 7 * dir);
  else if (state.view === 'month') state.anchor = new Date(a.getFullYear(), a.getMonth() + dir, 1);
  else if (state.view === 'year') state.anchor = new Date(a.getFullYear() + dir, a.getMonth(), 1);
  else state.custom = { ...state.custom, start: addDays(state.custom.start, dir * state.custom.days) };
  savePrefs();
  loadEvents();
}

// View and custom range survive restarts (a convenience only, so failures are ignored).
function savePrefs() {
  try { localStorage.setItem('tempo.view', JSON.stringify({ view: state.view, custom: { start: ymd(state.custom.start), days: state.custom.days } })); } catch { /* storage unavailable */ }
}
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('tempo.view') || 'null');
    if (!p) return;
    if (['day', 'week', 'month', 'year', 'custom'].includes(p.view)) state.view = p.view;
    if (p.custom?.start && p.custom.days >= 1 && p.custom.days <= MAX_CUSTOM_DAYS) state.custom = { start: parseLocal(p.custom.start, '00:00'), days: p.custom.days };
  } catch { /* ignore */ }
}

function applyCustomInputs() {
  const f = $('#c-from').value; const t = $('#c-to').value;
  if (!f || !t) return;
  let a = parseLocal(f, '00:00'); let b = parseLocal(t, '00:00');
  if (b < a) [a, b] = [b, a];
  let days = Math.round((b - a) / DAY) + 1;
  if (days > MAX_CUSTOM_DAYS) { days = MAX_CUSTOM_DAYS; toast(`Custom view shows up to ${MAX_CUSTOM_DAYS} days at a time.`); }
  state.custom = { start: a, days };
  savePrefs();
  loadEvents();
}

function toast(msg, ms = 3200, action = null) {
  const t = $('#toast');
  t.replaceChildren(h('span', {}, msg), action && h('button', { class: 'toast-act', onclick: () => { t.hidden = true; action.run(); } }, action.label));
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}

async function undoLast() {
  const r = await tempo.events.undo();
  toast(r.message, r.ok ? 3000 : 6000);
  loadEvents();
}

// ---- data -------------------------------------------------------------------

async function loadEvents() {
  const [from, to] = viewRange();
  state.events = await tempo.events.range(from.getTime(), to.getTime());
  render();
  tempo.google.ensureRange(from.getTime(), to.getTime()); // pulls more of Google's calendar if we navigated beyond what's synced
}

// ---- rendering ----------------------------------------------------------------

// Calendar <-> daily sheet. In the sheet, the top bar's arrows/Today move through days instead of calendar ranges.
const isWide = () => window.innerWidth >= RAIL_WIDE;

/** 'full' (docked or slide-over), 'slim' (icon strip) or 'none' (on the goals sheet page). */
function railMode() {
  if (state.page === 'sheet') return 'none';
  if (state.railOverlay) return 'full';
  return isWide() && !state.railCollapsed ? 'full' : 'slim';
}

function applyPage() {
  const sheet = state.page === 'sheet';
  const custom = state.view === 'custom' && !sheet;
  $('#cal').hidden = sheet;
  $('#sheet').hidden = !sheet;
  $('#view-seg').hidden = sheet;
  $('#view-select').hidden = sheet;
  $('#subbar').hidden = !custom;
  const mode = railMode();
  const rail = $('#rail');
  rail.hidden = sheet;
  rail.classList.toggle('slim', mode === 'slim');
  rail.classList.toggle('overlay', state.railOverlay && !sheet);
  $('#goals-btn').classList.toggle('on', sheet || mode === 'full');
  if (sheet) {
    $('#range-label').hidden = false;
    $('#range-label').textContent = sheetLabel();
  }
}

function setPage(page) {
  state.page = page;
  state.railOverlay = false;
  applyPage();
  if (page === 'sheet') renderSheet(); else { loadEvents(); renderRail(); }
}

/** The Goals button: leave the sheet, collapse/expand the docked panel, or open/close the slide-over. */
function toggleGoals() {
  if (state.page === 'sheet') { setPage('calendar'); return; }
  if (isWide()) {
    state.railCollapsed = !state.railCollapsed;
    state.railOverlay = false;
    try { localStorage.setItem('tempo.railCollapsed', state.railCollapsed ? '1' : '0'); } catch { /* storage unavailable */ }
  } else {
    state.railOverlay = !state.railOverlay;
  }
  refreshRailLayout();
}

function refreshRailLayout() {
  applyPage();
  renderRail();
  if (state.view === 'month') requestAnimationFrame(() => renderMonth()); // the calendar just changed width
}

function render() {
  applyPage();
  if (state.page === 'sheet') { renderSheet(); renderChips(); return; }
  const timeGrid = TIME_GRID_VIEWS.includes(state.view);
  for (const id of ['#cal-head', '#allday', '#cal-scroll']) $(id).hidden = !timeGrid;
  $('#month').hidden = state.view !== 'month';
  $('#year').hidden = state.view !== 'year';
  document.querySelectorAll('#view-seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  $('#range-label').hidden = state.view === 'custom';
  $('#view-select').value = state.view;
  $('#range-label').textContent = rangeLabel();

  if (timeGrid) renderTimeGrid();
  else if (state.view === 'month') renderMonth();
  else renderYear();
  renderChips();
}

function rangeLabel() {
  const a = state.anchor;
  if (state.view === 'month') return a.toLocaleDateString([], { month: 'long', year: 'numeric' });
  if (state.view === 'year') return String(a.getFullYear());
  const days = visibleDays();
  const first = days[0]; const last = days[days.length - 1];
  if (state.view === 'custom') {
    $('#c-from').value = ymd(first); $('#c-to').value = ymd(last);
    $('#c-note').textContent = `${days.length} day${days.length > 1 ? 's' : ''} (up to ${MAX_CUSTOM_DAYS})`;
    return '';
  }
  if (state.view === 'day') return first.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  return first.getMonth() === last.getMonth()
    ? `${first.toLocaleDateString([], { month: 'long' })} ${first.getDate()}\u2013${last.getDate()}, ${last.getFullYear()}`
    : `${first.toLocaleDateString([], { month: 'short', day: 'numeric' })} \u2013 ${last.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function renderTimeGrid() {
  const days = visibleDays();
  const todayMs = startOfDay(new Date()).getTime();
  const root = document.documentElement.style;
  root.setProperty('--days', days.length);
  root.setProperty('--hour', `${HOUR_H}px`);
  root.setProperty('--hours', H1() - H0());

  // day headers + all-day row
  const head = $('#cal-head');
  head.replaceChildren(h('div'), ...days.map((d) => h('div', { class: `dh${d.getTime() === todayMs ? ' today' : ''}` },
    h('span', {}, d.toLocaleDateString([], { weekday: 'short' })), h('span', { class: 'num' }, String(d.getDate())))));

  const allDay = state.events.filter((e) => e.allDay);
  const ad = $('#allday');
  ad.classList.toggle('none', !allDay.length);
  ad.replaceChildren(h('div'), ...days.map((d) => h('div', { class: 'cell' },
    allDay.filter((e) => e.start <= ymd(d) && ymd(d) < e.end).map((e) =>
      h('div', { class: 'pill', style: `--c:${colorOf(e)}`, onclick: () => openEditor(e) }, e.title)))));

  // time grid
  const grid = $('#grid');
  const gutter = h('div', { class: 'gutter' }, Array.from({ length: H1() - H0() - 1 }, (_, i) => h('span', { style: `top:${(i + 1) * HOUR_H}px` }, fmtHour(H0() + i + 1))));
  const cols = days.map((d) => {
    const col = h('div', { class: `col${d.getTime() === todayMs ? ' today' : ''}`, 'data-day': String(d.getTime()) });
    for (const item of layoutDay(d)) col.append(eventEl(item));
    return col;
  });
  grid.replaceChildren(gutter, ...cols);
  updateNowLine();
  requestAnimationFrame(updateEdgeMarkers);
}

// Clip events to the day and pack overlaps into side-by-side lanes.
function layoutDay(day) {
  const s0 = day.getTime() + H0() * 3600000; const s1 = day.getTime() + H1() * 3600000; // visible window only
  const segs = state.events.filter((e) => !e.allDay && Date.parse(e.end) > s0 && Date.parse(e.start) < s1)
    .map((e) => ({ e, s: Math.max(Date.parse(e.start), s0), t: Math.min(Date.parse(e.end), s1) }))
    .sort((a, b) => a.s - b.s || b.t - a.t);
  let cluster = []; let clusterEnd = 0; const out = [];
  const flush = () => {
    const lanes = [];
    for (const seg of cluster) {
      let lane = lanes.findIndex((end) => end <= seg.s);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = seg.t; seg.lane = lane;
    }
    for (const seg of cluster) { seg.lanes = lanes.length; out.push(seg); }
    cluster = [];
  };
  for (const seg of segs) {
    if (cluster.length && seg.s >= clusterEnd) flush();
    cluster.push(seg); clusterEnd = Math.max(clusterEnd, seg.t);
  }
  flush();
  return out.map((seg) => ({ ...seg, day: day.getTime() }));
}

function eventEl({ e, s, t, lane, lanes, day }) {
  const top = (s - (day + H0() * 3600000)) / 3600000 * HOUR_H;
  const height = Math.max((t - s) / 3600000 * HOUR_H - 2, 18);
  const short = height < 38;
  const start = new Date(e.start); const end = new Date(e.end);
  const clipped = Date.parse(e.start) < s || Date.parse(e.end) > t; // cut off by the visible-hours window
  const el = h('div', {
    class: `ev${blocksSomething(e) ? ' blocks' : ''}${short ? ' short' : ''}${e.pending ? ' pending' : ''}${e.recurring ? ' recurring' : ''}`,
    style: `--c:${colorOf(e)};top:${top}px;height:${height}px;left:calc(${lane / lanes * 100}% + 2px);width:calc(${100 / lanes}% - 6px)`,
    'data-id': e.id,
    'data-clipped': clipped ? '1' : false,
    tabindex: '0', role: 'button',
    'aria-label': `${e.title}, ${fmtTime(start)} to ${fmtTime(end)}${blocksSomething(e) ? `, ${typeById(e.type).name} block` : ''}${e.recurring ? ', repeats' : ''}${e.description ? ', has notes' : ''}`,
    title: `${e.title}\n${fmtTime(start)} – ${fmtTime(end)}${e.description ? `\n${e.description.slice(0, 200)}` : ''}`,
  }, h('div', { class: 't' }, e.title), h('div', { class: 's' }, `${e.recurring ? '↻ ' : ''}${e.description ? '≡ ' : ''}${fmtTime(start)} – ${fmtTime(end)}`),
    e.description && !short && height >= 48 ? h('div', { class: 'n' }, e.description.split('\n')[0]) : null);
  // Only same-day events can be dragged; multi-day ones open the editor.
  if (!clipped && ymd(start) === ymd(new Date(end - 1))) el.append(h('div', { class: 'rz' }));
  return el;
}

function updateNowLine() {
  document.querySelectorAll('.now-line').forEach((n) => n.remove());
  const col = $(`.col[data-day="${startOfDay(new Date()).getTime()}"]`);
  if (!col) return;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < H0() * 60 || minutes > H1() * 60) return;
  col.append(h('div', { class: 'now-line', style: `top:${(minutes - H0() * 60) / 60 * HOUR_H}px` }));
}

function renderChips() {
  const g = state.google;
  const sync = $('#sync-chip');
  if (!g) return;
  let text; let cls = 'chip';
  if (!g.connected) text = g.hasClient ? 'Connect Google' : 'Google not set up';
  else if (g.error) { text = 'Sync error'; cls += ' err'; sync.title = g.error; }
  else if (g.syncing) { text = 'Syncing…'; cls += ' ok'; }
  else { text = g.lastSync ? `Synced ${timeAgo(g.lastSync)}` : 'Connected'; cls += ' ok'; }
  sync.className = cls;
  sync.title = g.error ? `Sync error: ${g.error}` : text;
  sync.replaceChildren(h('span', { class: 'dot' }), h('span', { class: 'tl' }, text));

  const b = state.blocker; const chip = $('#block-chip');
  const active = b?.active?.filter((a) => a.type) || [];
  if (active.length && (b.apps.length || b.sites.length)) {
    const end = new Date(Math.min(...active.map((a) => Date.parse(a.end))));
    chip.hidden = false;
    chip.title = `Blocking · ${active[0].title} · until ${fmtTime(end)}`; // full detail in the tooltip; the label stays short
    chip.replaceChildren(shieldIcon(), h('span', { class: 'tl' }, `Blocking until ${fmtTime(end)}`));
  } else chip.hidden = true;
}

function shieldIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M12 3l8 3v6c0 4.5-3.3 8-8 9-4.7-1-8-4.5-8-9V6z');
  s.append(p);
  return s;
}

function timeAgo(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

// ---- grid interactions: drag to create, drag to move, drag bottom edge to resize ------------------

const snapMin = (m) => Math.round(m / SNAP) * SNAP;

function colAt(x) {
  return [...document.querySelectorAll('.col')].find((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; });
}

function minutesAt(col, y) {
  const r = col.getBoundingClientRect();
  return Math.max(H0() * 60, Math.min(H1() * 60, H0() * 60 + (y - r.top) / HOUR_H * 60));
}

// Enter/Space opens an event, Delete removes it (with undo), arrows move focus between events of the day.
async function eventKeys(ev) {
  const el = ev.target.closest('.ev, .mchip');
  if (!el) return;
  const item = state.events.find((x) => x.id === el.dataset.id);
  if (!item) return;
  if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEditor(item); return; }
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    ev.preventDefault();
    let scope = 'this';
    if (item.recurring) { scope = await askScope('Delete'); if (!scope) return; }
    await tempo.events.remove(item.id, scope);
    loadEvents();
    return;
  }
  if (el.classList.contains('ev') && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
    ev.preventDefault(); ev.stopPropagation();
    const col = [...el.parentElement.querySelectorAll('.ev')].sort((a, b) => a.offsetTop - b.offsetTop);
    const i = col.indexOf(el);
    const next = col[i + (ev.key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus();
  }
}

function initGrid() {
  const grid = $('#grid');
  let drag = null;
  grid.addEventListener('keydown', eventKeys);

  grid.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const evEl = ev.target.closest('.ev');
    const col = colAt(ev.clientX);
    if (!col) return;
    if (evEl) {
      const item = state.events.find((e) => e.id === evEl.dataset.id);
      const resizing = !!ev.target.closest('.rz');
      drag = { kind: evEl.dataset.clipped ? 'click' : resizing ? 'resize' : 'move', el: evEl, item, startY: ev.clientY, startCol: col, moved: false,
        origTop: parseFloat(evEl.style.top), origH: parseFloat(evEl.style.height), dur: Date.parse(item.end) - Date.parse(item.start) };
    } else {
      const startMin = snapMin(minutesAt(col, ev.clientY) - SNAP / 2);
      drag = { kind: 'create', col, startMin, endMin: startMin + 60, startY: ev.clientY, moved: false };
    }
    grid.setPointerCapture(ev.pointerId);
  });

  grid.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(ev.clientY - drag.startY) > 4) drag.moved = true;
    if (drag.kind === 'create' && drag.moved) {
      const cur = snapMin(minutesAt(drag.col, ev.clientY));
      const [a, b] = [Math.min(drag.startMin, cur), Math.max(drag.startMin + SNAP, cur)];
      drag.a = a; drag.b = b;
      drag.ghost ||= drag.col.appendChild(h('div', { class: 'ghost' }));
      drag.ghost.style.top = `${(a - H0() * 60) / 60 * HOUR_H}px`;
      drag.ghost.style.height = `${(b - a) / 60 * HOUR_H}px`;
      drag.ghost.textContent = `${fmtTime(new Date(2000, 0, 1, 0, a))} – ${fmtTime(new Date(2000, 0, 1, 0, b))}`;
    } else if (drag.kind === 'move' && drag.moved) {
      const dy = snapMin((ev.clientY - drag.startY) / HOUR_H * 60) / 60 * HOUR_H;
      const col = colAt(ev.clientX) || drag.startCol;
      drag.el.classList.add('dragging');
      drag.el.style.top = `${Math.max(0, drag.origTop + dy)}px`;
      drag.el.style.left = '2px'; drag.el.style.width = 'calc(100% - 6px)';
      if (drag.el.parentElement !== col) col.append(drag.el);
      drag.col = col;
    } else if (drag.kind === 'resize' && drag.moved) {
      const dy = snapMin((ev.clientY - drag.startY) / HOUR_H * 60) / 60 * HOUR_H;
      drag.el.classList.add('dragging');
      drag.el.style.height = `${Math.max(HOUR_H * SNAP / 60, drag.origH + dy)}px`;
    }
  });

  grid.addEventListener('pointerup', async (ev) => {
    if (!drag) return;
    const d = drag; drag = null;
    grid.releasePointerCapture(ev.pointerId);
    try {
      if (d.kind === 'create') {
        d.ghost?.remove();
        const a = d.moved ? d.a : d.startMin; const b = d.moved ? d.b : d.startMin + 60;
        const day = new Date(Number(d.col.dataset.day));
        openEditor(null, { start: new Date(day.getTime() + a * 60000), end: new Date(day.getTime() + b * 60000) });
      } else if (!d.moved || d.kind === 'click') {
        openEditor(d.item);
      } else if (d.kind === 'move') {
        const col = d.col || d.startCol;
        const minutes = snapMin(H0() * 60 + parseFloat(d.el.style.top) / HOUR_H * 60);
        const start = new Date(Number(col.dataset.day) + minutes * 60000);
        await tempo.events.update(d.item.id, { start: start.toISOString(), end: new Date(start.getTime() + d.dur).toISOString() });
      } else {
        const minutes = snapMin((parseFloat(d.el.style.height) + 2) / HOUR_H * 60);
        await tempo.events.update(d.item.id, { end: new Date(Date.parse(d.item.start) + minutes * 60000).toISOString() });
      }
    } catch (err) { toast(err.message); }
    loadEvents();
  });
}

// ---- event editor -----------------------------------------------------------------------------------

let modalReturnFocus = null;

// Keeps Tab inside the topmost dialog.
function trapTab(e) {
  if (e.key !== 'Tab') return;
  const layers = $('#modal-root').querySelectorAll('.scrim');
  const top = layers[layers.length - 1];
  if (!top) return;
  const f = [...top.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')].filter((x) => !x.disabled && x.offsetParent);
  if (!f.length) return;
  if (!top.contains(document.activeElement)) { e.preventDefault(); f[0].focus(); return; }
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
}

function openModal(node) {
  const root = $('#modal-root');
  if (!root.children.length) modalReturnFocus = document.activeElement;
  const scrim = h('div', { class: 'scrim', onmousedown: (e) => { if (e.target === scrim) closeModal(); }, onkeydown: trapTab }, node);
  root.replaceChildren(scrim);
  return scrim;
}
function closeModal() {
  $('#modal-root').replaceChildren();
  const back = modalReturnFocus; modalReturnFocus = null;
  if (back && back.isConnected) back.focus();
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Asks whether a change to a repeating event applies to one occurrence or the whole series. Resolves 'this' | 'all' | null.
function askScope(verb) {
  return new Promise((resolve) => {
    // Layered on top of the editor so cancelling leaves whatever was typed intact.
    const scrim = h('div', { class: 'scrim', style: 'z-index:30' });
    const done = (v) => { scrim.remove(); resolve(v); };
    scrim.append(h('div', { class: 'modal', style: 'width:340px', onkeydown: (e) => { if (e.key === 'Escape') done(null); } },
      h('div', { style: 'font-weight:600;font-size:15px' }, `${verb} repeating event`),
      h('div', { class: 'hint', style: 'margin:0' }, 'Should this apply to just this event, or every event in the series?'),
      h('div', { class: 'actions', style: 'flex-wrap:wrap' },
        h('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'),
        h('button', { class: 'btn', onclick: () => done('this') }, 'This event'),
        h('button', { class: 'btn primary', onclick: () => done('all') }, 'All events'))));
    $('#modal-root').append(scrim);
  });
}

function openEditor(existing, draft) {
  const start = existing ? new Date(existing.start) : draft.start;
  const end = existing ? new Date(existing.end) : draft.end;
  if (existing?.allDay) { toast('All-day events are edited in Google Calendar.'); return; }
  let type = existing?.type || null;

  const title = h('input', { type: 'text', class: 'title', placeholder: 'Add title', value: existing?.title || '' });
  const date = h('input', { type: 'date', value: ymd(start) });
  const from = h('input', { type: 'time', value: hm(start) });
  const to = h('input', { type: 'time', value: hm(end) });
  const hint = h('div', { class: 'hint' });
  const chips = h('div', { class: 'types' });
  const notes = h('textarea', { class: 'notes', placeholder: 'Notes, links, agenda…', rows: '3' }, existing?.description || '');

  // Repeat controls (new events only; existing series are edited via the scope prompt)
  const repeat = h('select', {},
    [['', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']]
      .map(([v, l]) => h('option', { value: v }, l)));
  const until = h('input', { type: 'date', title: 'Repeat until (optional)' });
  const untilNote = h('div', { class: 'hint' }, 'Repeats forever unless you pick an end date on the right.');
  const repeatRow = h('div', {}, h('div', { class: 'row' }, repeat, until), untilNote);
  until.hidden = true; untilNote.hidden = true;
  repeat.onchange = () => { until.hidden = untilNote.hidden = !repeat.value; };

  const drawChips = () => {
    chips.replaceChildren(
      ...[{ id: null, name: 'None', color: null }, ...state.settings.types].map((t) => h('button', {
        class: `type-chip${type === t.id ? ' on' : ''}`, style: t.color ? `--c:${t.color}` : '', type: 'button',
        onclick: () => { type = t.id; drawChips(); },
      }, h('i'), t.name)));
    const t = typeById(type);
    if (!t) { hint.textContent = 'Pick a type to block distractions while this event is on.'; return; }
    if (!t.apps.length && !t.sites.length) { hint.textContent = `${t.name} doesn't block anything. Change that in Settings.`; return; }
    hint.textContent = '';
    tempo.apps.names(t.apps).then((names) => {
      if (typeById(type) !== t) return; // changed while we were looking names up
      const list = (xs, max = 3) => (xs.length > max ? `${xs.slice(0, max).join(', ')} +${xs.length - max} more` : xs.join(', '));
      const uniq = [...new Set(names)];
      hint.textContent = `While this is on: ${[uniq.length && `closes ${list(uniq)}`, t.sites.length && `blocks ${list(t.sites)}`].filter(Boolean).join(' · ')}.`;
    });
  };
  drawChips();

  const recurrenceFromForm = (day) => {
    if (!repeat.value) return undefined;
    const rec = repeat.value === 'weekdays' ? { freq: 'weekly', days: ['MO', 'TU', 'WE', 'TH', 'FR'] }
      : repeat.value === 'weekly' ? { freq: 'weekly', days: [WEEKDAY_CODES[day.getDay()]] }
      : { freq: repeat.value };
    if (until.value) rec.until = until.value;
    return rec;
  };

  const save = async () => {
    const s = parseLocal(date.value, from.value); const e = parseLocal(date.value, to.value);
    try {
      const payload = { title: title.value, type, start: s.toISOString(), end: e.toISOString(), description: notes.value };
      if (existing) {
        let scope = 'this';
        if (existing.recurring) {
          // Moving to another day can only ever apply to one occurrence, so don't ask.
          if (date.value === ymd(start)) { scope = await askScope('Update'); if (!scope) return; }
        }
        await tempo.events.update(existing.id, payload, scope);
      } else {
        await tempo.events.create({ ...payload, recurrence: recurrenceFromForm(s) });
      }
      closeModal(); loadEvents();
    } catch (err) { toast(err.message); }
  };

  const remove = async () => {
    let scope = 'this';
    if (existing.recurring) { scope = await askScope('Delete'); if (!scope) return; }
    await tempo.events.remove(existing.id, scope);
    closeModal(); loadEvents();
  };

  const modal = h('div', { class: 'modal', onkeydown: (e) => { if ((e.key === 'Enter' && e.target.tagName === 'INPUT') || (e.key === 'Enter' && e.ctrlKey)) save(); if (e.key === 'Escape') closeModal(); } },
    title,
    h('div', { class: 'row' },
      h('label', { class: 'fld' }, h('span', {}, 'Date'), date),
      h('label', { class: 'fld' }, h('span', {}, 'Starts'), from),
      h('label', { class: 'fld' }, h('span', {}, 'Ends'), to)),
    existing
      ? existing.recurring && h('div', { class: 'hint', style: 'margin:0' }, `↻ ${existing.recurrenceText || 'Repeating event'}`)
      : h('div', {}, h('div', { class: 'lbl' }, 'Repeat'), repeatRow),
    h('div', {}, h('div', { class: 'lbl' }, 'Block type'), chips, hint),
    h('div', {}, h('div', { class: 'lbl' }, 'Notes'), notes),
    h('div', { class: 'actions' },
      existing && h('button', { class: 'btn danger left', onclick: remove }, 'Delete'),
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('span', { class: 'keyhint' }, 'Enter to save · Esc to cancel'),
      h('button', { class: 'btn primary', onclick: save }, 'Save')));
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', existing ? `Edit ${existing.title}` : 'New event');
  openModal(modal);
  title.focus(); title.select();
}

// ---- settings drawer --------------------------------------------------------------------------------

function field(label, input, hint) {
  return h('div', { class: 'field' }, h('label', {}, label), input, hint && h('div', { class: 'hint' }, hint));
}

const splitList = (s) => [...new Set(s.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];

async function saveSettings(patch) {
  state.settings = await tempo.settings.set(patch);
}

async function openSettings(force = false) {
  const d = $('#drawer');
  if (!d.hidden && !force) { d.hidden = true; return; }
  state.settings = await tempo.settings.get();
  state.google = await tempo.google.state();
  state.blocker = await tempo.blocker.state();
  d.hidden = false;
  drawSettings();
}

// Click the field, press the combination. Backspace clears, Esc cancels.
const KEY_NAMES = { Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', Tab: 'Tab', Backquote: '`', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/' };
function acceleratorFrom(e) {
  const code = e.code;
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^F\d{1,2}$/.test(code) ? code : KEY_NAMES[code];
  if (!key) return null;
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  return mods.length ? [...mods, key].join('+') : null;
}
const prettyKey = (a) => (a ? a.replace('Control', 'Ctrl').replace('Super', 'Win') : 'Not set');

function hotkeyField(label, setting) {
  const input = h('input', { type: 'text', readonly: true, value: prettyKey(state.settings[setting]), class: 'hotkey' });
  input.addEventListener('focus', () => { input.value = 'Press a shortcut…'; });
  input.addEventListener('blur', () => { input.value = prettyKey(state.settings[setting]); });
  input.addEventListener('keydown', async (e) => {
    e.preventDefault();
    if (e.key === 'Escape') { input.blur(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { await saveSettings({ [setting]: '' }); input.blur(); return; }
    const accel = acceleratorFrom(e);
    if (!accel) return; // still holding only modifiers, or no modifier yet
    await saveSettings({ [setting]: accel });
    if (state.settings.hotkeyErrors.includes(accel)) toast(`${prettyKey(accel)} is taken by another app. Try a different one.`, 4500);
    input.blur();
  });
  return field(label, input);
}

// Hour picker for the time grid's visible window; keeps at least four hours visible.
function hourSelect(s, key, min, max) {
  return h('select', {
    onchange: async (e) => {
      const v = Number(e.target.value);
      const patch = { [key]: v };
      if (key === 'dayStartHour' && s.dayEndHour - v < 4) patch.dayEndHour = Math.min(24, v + 4);
      if (key === 'dayEndHour' && v - s.dayStartHour < 4) patch.dayStartHour = Math.max(0, v - 4);
      await saveSettings(patch);
      drawSettings();
    },
  }, Array.from({ length: max - min + 1 }, (_, i) => h('option', { value: min + i, selected: s[key] === min + i }, min + i === 24 ? 'midnight' : fmtHour(min + i))));
}

// ---- boot -------------------------------------------------------------------------------------------

function initChrome() {
  $('#prev').onclick = () => step(-1);
  $('#next').onclick = () => step(1);
  $('#goals-btn').onclick = toggleGoals;
  $('#view-select').onchange = (e) => setView(e.target.value);
  $('#new-btn').onclick = () => {
    const d = new Date();
    if (state.view === 'day' && ymd(state.anchor) !== ymd(d)) { d.setTime(state.anchor.getTime()); d.setHours(9, 0, 0, 0); } else { d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); }
    openEditor(null, { start: d, end: new Date(d.getTime() + 3600000) });
  };
  $('#today').onclick = () => {
    const today = startOfDay(new Date());
    if (state.page === 'sheet') { state.sheetDate = today; applyPage(); renderSheet(); return; }
    state.anchor = today;
    if (state.view === 'custom') state.custom = { ...state.custom, start: today };
    savePrefs();
    loadEvents().then(scrollToNow);
  };
  document.querySelectorAll('#view-seg button').forEach((b) => {
    b.onclick = () => setView(b.dataset.view);
  });
  $('#c-from').onchange = applyCustomInputs;
  $('#c-to').onchange = applyCustomInputs;
  $('#settings-btn').onclick = () => openSettings();
  $('#sync-chip').onclick = () => {
    if (state.google?.connected) tempo.google.sync(); else openSettings();
  };
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select') || e.ctrlKey || e.altKey || e.metaKey) return;
    if (document.querySelector('.wiz-scrim') || ($('#modal-root').children.length && e.key !== '?')) return; // dialogs own the keyboard
    if (e.key === '?') { openShortcuts(); return; }
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 't') $('#today').click();
    else if (e.key === 's') setPage(state.page === 'sheet' ? 'calendar' : 'sheet');
    else if (e.key === 'g') $('#goals-btn').click();
    else if (e.key === 'n' && state.page !== 'sheet') $('#new-btn').click();
    else if (e.key === 'Escape' && state.railOverlay) { state.railOverlay = false; refreshRailLayout(); }
    else if (state.page === 'sheet') return;
    else { const v = { d: 'day', w: 'week', m: 'month', y: 'year', c: 'custom' }[e.key]; if (v) setView(v); }
  });
  window.addEventListener('resize', () => { applyPage(); renderRail(); if (state.view === 'month') renderMonth(); updateEdgeMarkers(); });
  $('#cal-scroll').addEventListener('scroll', () => { cancelAnimationFrame(updateEdgeMarkers.raf); updateEdgeMarkers.raf = requestAnimationFrame(updateEdgeMarkers); });
  // Clicking outside the slide-over closes it.
  document.addEventListener('mousedown', (e) => {
    if (state.railOverlay && !e.target.closest?.('#rail, #goals-btn')) { state.railOverlay = false; refreshRailLayout(); }
  });
}

function openShortcuts() {
  if (document.querySelector('.shortcuts')) { closeModal(); return; }
  const s = state.settings;
  const key = (k) => (k || '').replace('Control', 'Ctrl');
  const rows = [
    ['Anywhere', [[key(s.hotkeyChat), 'Talk to Tempo (press again to send)'], [key(s.hotkeyCalendar), 'Open or hide this window']]],
    ['Calendar', [['n', 'New event'], ['d  w  m  y  c', 'Day, week, month, year, custom'], ['←  →', 'Previous / next'], ['t', 'Today'], ['g', 'Goals panel'], ['s', 'Full goals sheet'], ['?', 'This list']]],
    ['Event editor', [['Enter', 'Save'], ['Ctrl + Enter', 'Save from the notes box'], ['Esc', 'Cancel']]],
    ['With the mouse', [['Drag on empty time', 'Create an event'], ['Drag an event', 'Move it'], ['Drag its bottom edge', 'Resize it'], ['Drag a month chip', 'Move to another day']]],
  ];
  const box = h('div', { class: 'modal shortcuts', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts', onkeydown: (e) => { if (e.key === 'Escape' || e.key === '?') closeModal(); } },
    h('div', { class: 'row' }, h('b', { style: 'font-size:15px' }, 'Shortcuts'), h('button', { class: 'icon-btn', style: 'flex:none', 'aria-label': 'Close', onclick: closeModal }, '✕')),
    rows.map(([group, items]) => h('div', {}, h('div', { class: 'lbl' }, group),
      h('table', { class: 'wiz-keys' }, items.filter(([k]) => k).map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v)))))));
  openModal(box);
  box.tabIndex = -1; box.focus();
}

function setView(view) {
  state.view = view;
  savePrefs();
  loadEvents().then(scrollToNow);
}

/** Scroll the time grid to what matters: the first event still ahead today (or now), keeping an hour of context. */
function scrollToNow() {
  if (!TIME_GRID_VIEWS.includes(state.view)) return;
  const now = Date.now();
  const days = visibleDays();
  const dayStart = (d) => d.getTime() + H0() * 3600000;
  const today = days.find((d) => ymd(d) === ymd(new Date()));
  let target;
  if (today) {
    const upcoming = state.events.filter((e) => !e.allDay && Date.parse(e.end) > now && ymd(new Date(e.start)) === ymd(today)).map((e) => Date.parse(e.start));
    target = Math.min(now, ...upcoming) - 3600000;
    target = (target - dayStart(today)) / 3600000;
  } else {
    // Another range: start at the earliest event in it, or 8 AM.
    const hours = state.events.filter((e) => !e.allDay).map((e) => { const d = new Date(e.start); return d.getHours() + d.getMinutes() / 60; });
    target = (hours.length ? Math.min(...hours) - 0.5 : 8) - H0();
  }
  $('#cal-scroll').scrollTop = Math.max(0, target * HOUR_H);
  updateEdgeMarkers();
}

/** Per-day "▲ 2 earlier" / "▼ 1 later" markers for events scrolled out of view. Click to reveal them. */
function updateEdgeMarkers() {
  const sc = $('#cal-scroll');
  if (!sc || sc.hidden) return;
  const top = sc.scrollTop; const bottom = top + sc.clientHeight;
  for (const col of document.querySelectorAll('#grid .col')) {
    col.querySelectorAll('.edge').forEach((n) => n.remove());
    const evs = [...col.querySelectorAll('.ev')];
    const above = evs.filter((e) => e.offsetTop + e.offsetHeight <= top + 4);
    const below = evs.filter((e) => e.offsetTop >= bottom - 4);
    if (above.length) col.append(h('button', { class: 'edge up', style: `top:${top + 4}px`, 'aria-label': `${above.length} earlier event${above.length > 1 ? 's' : ''}`, onclick: () => { sc.scrollTo({ top: Math.max(0, Math.min(...above.map((e) => e.offsetTop)) - 12), behavior: 'smooth' }); } }, `▲ ${above.length} earlier`));
    if (below.length) col.append(h('button', { class: 'edge down', style: `top:${bottom - 26}px`, 'aria-label': `${below.length} later event${below.length > 1 ? 's' : ''}`, onclick: () => { sc.scrollTo({ top: Math.min(...below.map((e) => e.offsetTop)) - 60, behavior: 'smooth' }); } }, `▼ ${below.length} later`));
  }
}

async function main() {
  loadPrefs();
  try { state.railCollapsed = localStorage.getItem('tempo.railCollapsed') === '1'; } catch { /* default: docked when wide */ }
  initChrome();
  initGrid();
  initMonth();
  initYear();
  [state.settings, state.google, state.blocker] = await Promise.all([tempo.settings.get(), tempo.google.state(), tempo.blocker.state()]);
  await loadEvents();
  renderRail();
  scrollToNow();
  if (!state.settings.onboarded) openWizard();

  tempo.events.onChanged(async () => { state.settings = await tempo.settings.get(); loadEvents(); });
  tempo.google.onState((g) => { state.google = g; renderChips(); if (!$('#drawer').hidden) drawSettings(); });
  tempo.blocker.onState((b) => { state.blocker = b; renderChips(); renderRail(); });
  // Repaint the sheet when habits change elsewhere (e.g. the widget or the assistant), but never under someone's cursor.
  tempo.habits.onChanged(() => {
    if (state.page === 'sheet' && !document.activeElement?.matches?.('#sheet input')) renderSheet();
    if (!document.activeElement?.matches?.('#rail input')) renderRail();
  });
  setInterval(renderRail, 60000); // also rolls the panel over at midnight
  tempo.onError((m) => toast(m));
  tempo.nav.onOpenSheet(() => setPage('sheet'));
  tempo.events.onUndoable((u) => toast(u.label, 6000, { label: 'Undo', run: undoLast }));
  tempo.settings.onChanged(async () => { state.settings = await tempo.settings.get(); if (!$('#drawer').hidden) drawSettings(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !e.target.matches('input, textarea, select') && !document.querySelector('.wiz-scrim')) { e.preventDefault(); undoLast(); }
  });
  tempo.nav.onOpenSettings(() => openSettings(true));
  setInterval(() => { updateNowLine(); renderChips(); }, 30000);
}

main();
