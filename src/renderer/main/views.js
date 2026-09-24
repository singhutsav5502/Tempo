'use strict';

// Month and year views. Helpers (h, ymd, state, colorOf, openEditor, ...) come from app.js.

const CHIP_H = 22;

function shortTime(d) {
  const withMinutes = d.getMinutes() !== 0;
  return d.toLocaleTimeString([], { hour: 'numeric', ...(withMinutes ? { minute: '2-digit' } : {}) }).replace(/\s/g, '').toLowerCase();
}

/** Events touching a calendar day: all-day first, then by start time. */
function eventsOnDay(day) {
  const s0 = day.getTime(); const s1 = s0 + DAY;
  const key = ymd(day);
  return state.events
    .filter((e) => (e.allDay ? e.start <= key && key < e.end : Date.parse(e.end) > s0 && Date.parse(e.start) < s1))
    .sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || Date.parse(a.start) - Date.parse(b.start));
}

function goToDay(day, view = 'day') {
  state.anchor = startOfDay(day);
  state.view = view;
  savePrefs();
  loadEvents();
}

// ---- month ----------------------------------------------------------------------------------------

function renderMonth() {
  const root = $('#month');
  const start = monthGridStart();
  const rows = monthRows();
  const month = state.anchor.getMonth();
  const today = ymd(new Date());

  const head = h('div', { class: 'mhead' }, Array.from({ length: 7 }, (_, i) => h('div', {}, addDays(start, i).toLocaleDateString([], { weekday: 'short' }))));
  const cells = Array.from({ length: rows * 7 }, (_, i) => {
    const d = addDays(start, i);
    const label = d.getDate() === 1 ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) : String(d.getDate());
    return h('div', { class: `mcell${d.getMonth() !== month ? ' other' : ''}${ymd(d) === today ? ' today' : ''}`, 'data-day': ymd(d) },
      h('button', { class: 'mnum', title: 'Open this day' }, label));
  });
  const grid = h('div', { class: 'mgrid', style: `grid-template-rows:repeat(${rows},minmax(0,1fr))` }, cells);
  root.replaceChildren(head, grid);

  // Measure after layout so each cell shows as many chips as actually fit, plus "+N more".
  const capacity = Math.max(1, Math.floor((cells[0].getBoundingClientRect().height - 30) / CHIP_H));
  for (const cell of cells) fillMonthCell(cell, capacity);
}

function chipEl(e) {
  const t = new Date(e.start);
  const marks = `${blocksSomething(e) ? '⛨' : ''}${e.recurring ? '↻' : ''}`;
  return h('div', {
    class: `mchip${e.allDay ? ' allday' : ''}`, style: `--c:${colorOf(e)}`, 'data-id': e.id,
    draggable: e.allDay ? false : 'true',
    title: `${e.title}${e.allDay ? '' : ` · ${fmtTime(t)} – ${fmtTime(new Date(e.end))}`}`,
  }, e.allDay ? null : h('span', { class: 'tm' }, shortTime(t)), h('span', { class: 'tt' }, e.title), marks && h('span', { class: 'ic' }, marks));
}

function fillMonthCell(cell, capacity) {
  const list = eventsOnDay(parseLocal(cell.dataset.day, '00:00'));
  const shown = list.length > capacity ? capacity - 1 : list.length; // keep a row free for "+N more"
  for (const e of list.slice(0, Math.max(0, shown))) cell.append(chipEl(e));
  if (list.length > shown) cell.append(h('button', { class: 'more', 'data-more': cell.dataset.day }, `+${list.length - shown} more`));
}

function initMonth() {
  const root = $('#month');

  root.addEventListener('click', (ev) => {
    const cell = ev.target.closest('.mcell');
    if (!cell) return;
    const day = parseLocal(cell.dataset.day, '00:00');
    const chip = ev.target.closest('.mchip');
    if (chip) { const e = state.events.find((x) => x.id === chip.dataset.id); if (e) openEditor(e); return; }
    if (ev.target.closest('.more') || ev.target.closest('.mnum')) { goToDay(day); return; }
    openEditor(null, { start: parseLocal(cell.dataset.day, '09:00'), end: parseLocal(cell.dataset.day, '10:00') });
  });

  // Drag an event onto another day to move it (keeps its time of day).
  root.addEventListener('dragstart', (ev) => {
    const chip = ev.target.closest?.('.mchip');
    if (!chip) return;
    ev.dataTransfer.setData('text/plain', chip.dataset.id);
    ev.dataTransfer.effectAllowed = 'move';
  });
  root.addEventListener('dragover', (ev) => {
    const cell = ev.target.closest('.mcell');
    if (!cell) return;
    ev.preventDefault();
    root.querySelectorAll('.mcell.drop').forEach((c) => { if (c !== cell) c.classList.remove('drop'); });
    cell.classList.add('drop');
  });
  root.addEventListener('dragleave', (ev) => { if (!root.contains(ev.relatedTarget)) root.querySelectorAll('.mcell.drop').forEach((c) => c.classList.remove('drop')); });
  root.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    root.querySelectorAll('.mcell.drop').forEach((c) => c.classList.remove('drop'));
    const cell = ev.target.closest('.mcell');
    const item = state.events.find((x) => x.id === ev.dataTransfer.getData('text/plain'));
    if (!cell || !item) return;
    const shiftDays = Math.round((parseLocal(cell.dataset.day, '00:00') - startOfDay(new Date(item.start))) / DAY);
    if (!shiftDays) return;
    try {
      await tempo.events.update(item.id, { start: addDays(new Date(item.start), shiftDays).toISOString(), end: addDays(new Date(item.end), shiftDays).toISOString() }, 'this');
    } catch (err) { toast(err.message); }
    loadEvents();
  });
}

// ---- year -----------------------------------------------------------------------------------------

function renderYear() {
  const root = $('#year');
  const year = state.anchor.getFullYear();
  const now = new Date();
  const today = ymd(now);

  // Count events per day (multi-day events count on each day they touch).
  const perDay = new Map();
  const touch = (key, e) => { const v = perDay.get(key) || []; v.push(e); perDay.set(key, v); };
  for (const e of state.events) {
    if (e.allDay) {
      for (let d = parseLocal(e.start, '00:00'); ymd(d) < e.end; d = addDays(d, 1)) touch(ymd(d), e);
    } else {
      const last = startOfDay(new Date(Date.parse(e.end) - 1));
      for (let d = startOfDay(new Date(e.start)); d <= last; d = addDays(d, 1)) touch(ymd(d), e);
    }
  }

  const monday = weekStart(new Date());
  const initials = Array.from({ length: 7 }, (_, i) => h('div', { class: 'wd' }, addDays(monday, i).toLocaleDateString([], { weekday: 'narrow' })));

  const months = Array.from({ length: 12 }, (_, m) => {
    const first = new Date(year, m, 1);
    const days = new Date(year, m + 1, 0).getDate();
    const blanks = Array.from({ length: (first.getDay() + 6) % 7 }, () => h('div'));
    const cells = Array.from({ length: days }, (_, i) => {
      const d = new Date(year, m, i + 1);
      const list = perDay.get(ymd(d)) || [];
      const level = list.length === 0 ? 0 : list.length === 1 ? 1 : list.length <= 3 ? 2 : list.length <= 5 ? 3 : 4;
      const tip = list.length ? `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}: ${list.slice(0, 4).map((e) => e.title).join(', ')}${list.length > 4 ? ` +${list.length - 4} more` : ''}` : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      return h('button', { class: `yday${ymd(d) === today ? ' today' : ''}`, 'data-day': ymd(d), 'data-l': String(level), title: tip }, String(i + 1));
    });
    return h('section', { class: `ymonth${year === now.getFullYear() && m === now.getMonth() ? ' current' : ''}` },
      h('button', { class: 'ytitle', 'data-month': String(m) }, first.toLocaleDateString([], { month: 'long' })),
      h('div', { class: 'ygrid' }, initials.map((n) => n.cloneNode(true)), blanks, cells));
  });
  root.replaceChildren(...months);
}

function initYear() {
  $('#year').addEventListener('click', (ev) => {
    const day = ev.target.closest('.yday');
    if (day) { goToDay(parseLocal(day.dataset.day, '00:00')); return; }
    const title = ev.target.closest('.ytitle');
    if (title) goToDay(new Date(state.anchor.getFullYear(), Number(title.dataset.month), 1), 'month');
  });
}
