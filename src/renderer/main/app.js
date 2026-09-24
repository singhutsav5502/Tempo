'use strict';

const HOUR_H = 52;
const SNAP = 15;
const NO_TYPE_COLOR = '#8b90a0';
const DAY = 86400000;

const state = {
  view: 'week',
  anchor: startOfDay(new Date()),
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
const visibleDays = () => state.view === 'day' ? [state.anchor] : Array.from({ length: 7 }, (_, i) => addDays(weekStart(state.anchor), i));

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}

// ---- data -------------------------------------------------------------------

async function loadEvents() {
  const days = visibleDays();
  state.events = await tempo.events.range(days[0].getTime(), addDays(days[days.length - 1], 1).getTime());
  render();
}

// ---- rendering ----------------------------------------------------------------

function render() {
  const days = visibleDays();
  const todayMs = startOfDay(new Date()).getTime();
  document.documentElement.style.setProperty('--days', days.length);
  document.documentElement.style.setProperty('--hour', `${HOUR_H}px`);

  const first = days[0]; const last = days[days.length - 1];
  $('#range-label').textContent = state.view === 'day'
    ? first.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    : first.getMonth() === last.getMonth()
      ? `${first.toLocaleDateString([], { month: 'long' })} ${first.getDate()}–${last.getDate()}, ${last.getFullYear()}`
      : `${first.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${last.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`;
  document.querySelectorAll('#view-seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));

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
  const gutter = h('div', { class: 'gutter' }, Array.from({ length: 23 }, (_, i) => h('span', { style: `top:${(i + 1) * HOUR_H}px` }, fmtHour(i + 1))));
  const cols = days.map((d) => {
    const col = h('div', { class: `col${d.getTime() === todayMs ? ' today' : ''}`, 'data-day': String(d.getTime()) });
    for (const item of layoutDay(d)) col.append(eventEl(item));
    return col;
  });
  grid.replaceChildren(gutter, ...cols);
  updateNowLine();
  renderChips();
}

// Clip events to the day and pack overlaps into side-by-side lanes.
function layoutDay(day) {
  const s0 = day.getTime(); const s1 = s0 + DAY;
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
  return out.map((seg) => ({ ...seg, day: s0 }));
}

function eventEl({ e, s, t, lane, lanes, day }) {
  const top = (s - day) / 60000 / 60 * HOUR_H;
  const height = Math.max((t - s) / 60000 / 60 * HOUR_H - 2, 18);
  const short = height < 38;
  const start = new Date(e.start); const end = new Date(e.end);
  const el = h('div', {
    class: `ev${blocksSomething(e) ? ' blocks' : ''}${short ? ' short' : ''}${e.pending ? ' pending' : ''}`,
    style: `--c:${colorOf(e)};top:${top}px;height:${height}px;left:calc(${lane / lanes * 100}% + 2px);width:calc(${100 / lanes}% - 6px)`,
    'data-id': e.id,
  }, h('div', { class: 't' }, e.title), h('div', { class: 's' }, `${fmtTime(start)} – ${fmtTime(end)}`));
  // Only same-day events can be dragged; multi-day ones open the editor.
  if (ymd(start) === ymd(new Date(end - 1))) el.append(h('div', { class: 'rz' }));
  return el;
}

function updateNowLine() {
  document.querySelectorAll('.now-line').forEach((n) => n.remove());
  const col = $(`.col[data-day="${startOfDay(new Date()).getTime()}"]`);
  if (!col) return;
  const now = new Date();
  col.append(h('div', { class: 'now-line', style: `top:${(now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_H}px` }));
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
  sync.replaceChildren(h('span', { class: 'dot' }), text);

  const b = state.blocker; const chip = $('#block-chip');
  const active = b?.active?.filter((a) => a.type) || [];
  if (active.length && (b.apps.length || b.sites.length)) {
    const end = new Date(Math.min(...active.map((a) => Date.parse(a.end))));
    chip.hidden = false;
    chip.replaceChildren(shieldIcon(), `Blocking · ${active[0].title} · until ${fmtTime(end)}`);
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
  return Math.max(0, Math.min(24 * 60, (y - r.top) / HOUR_H * 60));
}

function initGrid() {
  const grid = $('#grid');
  let drag = null;

  grid.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const evEl = ev.target.closest('.ev');
    const col = colAt(ev.clientX);
    if (!col) return;
    if (evEl) {
      const item = state.events.find((e) => e.id === evEl.dataset.id);
      const resizing = !!ev.target.closest('.rz');
      drag = { kind: resizing ? 'resize' : 'move', el: evEl, item, startY: ev.clientY, startCol: col, moved: false,
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
      drag.ghost.style.top = `${a / 60 * HOUR_H}px`;
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
      } else if (!d.moved) {
        openEditor(d.item);
      } else if (d.kind === 'move') {
        const col = d.col || d.startCol;
        const minutes = snapMin(parseFloat(d.el.style.top) / HOUR_H * 60);
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

function openModal(node) {
  const root = $('#modal-root');
  const scrim = h('div', { class: 'scrim', onmousedown: (e) => { if (e.target === scrim) closeModal(); } }, node);
  root.replaceChildren(scrim);
  return scrim;
}
const closeModal = () => $('#modal-root').replaceChildren();

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

  const drawChips = () => {
    chips.replaceChildren(
      ...[{ id: null, name: 'None', color: null }, ...state.settings.types].map((t) => h('button', {
        class: `type-chip${type === t.id ? ' on' : ''}`, style: t.color ? `--c:${t.color}` : '', type: 'button',
        onclick: () => { type = t.id; drawChips(); },
      }, h('i'), t.name)));
    const t = typeById(type);
    const n = t ? t.apps.length + t.sites.length : 0;
    hint.textContent = t ? (n ? `While this is on, ${t.apps.length} apps and ${t.sites.length} sites are blocked.` : 'Nothing is blocked for this type.') : '';
  };
  drawChips();

  const save = async () => {
    const s = parseLocal(date.value, from.value); const e = parseLocal(date.value, to.value);
    try {
      const payload = { title: title.value, type, start: s.toISOString(), end: e.toISOString() };
      if (existing) await tempo.events.update(existing.id, payload); else await tempo.events.create(payload);
      closeModal(); loadEvents();
    } catch (err) { toast(err.message); }
  };

  const modal = h('div', { class: 'modal', onkeydown: (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') save(); if (e.key === 'Escape') closeModal(); } },
    title,
    h('div', { class: 'row' }, date, from, to),
    h('div', {}, h('div', { class: 'lbl' }, 'Block type'), chips, hint),
    h('div', { class: 'actions' },
      existing && h('button', { class: 'btn danger left', onclick: async () => { await tempo.events.remove(existing.id); closeModal(); loadEvents(); } }, 'Delete'),
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: save }, 'Save')));
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

async function openSettings() {
  const d = $('#drawer');
  if (!d.hidden) { d.hidden = true; return; }
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

function drawSettings() {
  const d = $('#drawer'); const s = state.settings; const g = state.google; const b = state.blocker;
  const scroll = d.scrollTop;

  const clientId = h('input', { type: 'text', value: s.googleClientId, placeholder: 'xxxx.apps.googleusercontent.com', onchange: (e) => saveSettings({ googleClientId: e.target.value.trim() }) });
  const clientSecret = h('input', { type: 'password', placeholder: s.hasGoogleSecret ? '•••••••• saved' : 'GOCSPX-…', onchange: async (e) => { await saveSettings({ googleClientSecret: e.target.value.trim() }); e.target.value = ''; drawSettings(); } });
  const apiKey = h('input', { type: 'password', placeholder: s.hasAnthropicKey ? '•••••••• saved' : 'sk-ant-…', onchange: async (e) => { await saveSettings({ anthropicKey: e.target.value.trim() }); e.target.value = ''; drawSettings(); } });
  const model = h('input', { type: 'text', value: s.model, list: 'models', onchange: (e) => saveSettings({ model: e.target.value.trim() }) });
  const provider = h('select', { onchange: async (e) => { await saveSettings({ provider: e.target.value }); drawSettings(); } },
    h('option', { value: 'claude-code', selected: s.provider !== 'api' }, 'Claude Code (my Claude login)'),
    h('option', { value: 'api', selected: s.provider === 'api' }, 'Anthropic API key'));
  const ccModel = h('select', { onchange: (e) => saveSettings({ ccModel: e.target.value }) },
    [['sonnet', 'Sonnet (fast)'], ['opus', 'Opus (smartest)'], ['haiku', 'Haiku (fastest)']].map(([v, l]) => h('option', { value: v, selected: s.ccModel === v }, l)));
  const models = h('datalist', { id: 'models' }, ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'].map((m) => h('option', { value: m })));

  const num = (key, min, max) => h('input', { type: 'number', min, max, value: s[key], onchange: (e) => saveSettings({ [key]: Math.max(min, Math.min(max, Number(e.target.value) || 0)) }) });

  const typeCards = s.types.map((t, i) => {
    const patch = (p) => { s.types[i] = { ...t, ...p }; return saveSettings({ types: s.types }); };
    return h('div', { class: 'type-card' },
      h('div', { class: 'head' },
        h('input', { type: 'color', value: t.color, onchange: (e) => patch({ color: e.target.value }).then(() => loadEvents()) }),
        h('input', { type: 'text', value: t.name, onchange: (e) => patch({ name: e.target.value.trim() || t.name }) }),
        h('button', { class: 'icon-btn', title: 'Delete type', onclick: async () => { s.types.splice(i, 1); await saveSettings({ types: s.types }); drawSettings(); loadEvents(); } }, '✕')),
      field('Apps to close (process names)', h('textarea', { spellcheck: 'false', placeholder: 'discord.exe\nsteam.exe', onchange: (e) => patch({ apps: splitList(e.target.value) }) }, t.apps.join('\n'))),
      field('Websites to block', h('textarea', { spellcheck: 'false', placeholder: 'youtube.com\nreddit.com', onchange: (e) => patch({ sites: splitList(e.target.value) }) }, t.sites.join('\n'))));
  });

  const googleStatus = g.connected
    ? h('div', { class: 'status-line' }, h('span', { class: `dot ${g.error ? 'err' : 'ok'}` }), g.error ? g.error : `Connected${g.lastSync ? ` · synced ${timeAgo(g.lastSync)}` : ''}`)
    : h('div', { class: 'status-line' }, h('span', { class: 'dot' }), 'Not connected');

  d.replaceChildren(
    h('div', { class: 'row' }, h('h2', {}, 'Settings'), h('button', { class: 'icon-btn', style: 'flex:none', onclick: () => { d.hidden = true; } }, '✕')),

    h('section', {}, h('h3', {}, 'Google Calendar'),
      field('OAuth client ID', clientId), field('OAuth client secret', clientSecret, 'Desktop-app credentials from Google Cloud. Stored encrypted on this PC.'),
      googleStatus,
      h('div', { class: 'row' },
        g.connected
          ? [h('button', { class: 'btn', onclick: () => tempo.google.sync() }, 'Sync now'), h('button', { class: 'btn danger', onclick: async () => { state.google = await tempo.google.disconnect(); loadEvents(); drawSettings(); } }, 'Disconnect')]
          : h('button', { class: 'btn primary', onclick: async (e) => { e.target.textContent = 'Waiting for browser…'; try { state.google = await tempo.google.connect(); loadEvents(); } catch (err) { toast(err.message); } drawSettings(); } }, 'Connect Google'))),

    h('section', {}, h('h3', {}, 'Assistant'),
      field('Powered by', provider, s.provider === 'api'
        ? 'Calls the Anthropic API directly with your own key (billed per use).'
        : 'Runs your installed Claude Code in the background using your Claude login. No API key needed.'),
      s.provider === 'api'
        ? [field('Anthropic API key', apiKey, 'Stored encrypted on this PC and only sent to Anthropic.'),
          field('Model', model, 'claude-opus-5 is the most capable; claude-sonnet-5 is faster and cheaper.'), models]
        : field('Model', ccModel, 'Sonnet is the fastest for everyday scheduling; Opus is smarter but slower.')),

    h('section', {}, h('h3', {}, 'Block types'),
      h('div', { class: 'hint', style: 'margin:-2px 0 12px' }, 'Give a calendar entry one of these types and its apps and sites are blocked while it is active.'),
      typeCards,
      h('button', { class: 'btn', onclick: async () => { s.types.push({ id: `t${Date.now().toString(36)}`, name: 'New type', color: '#7c93ff', apps: [], sites: [] }); await saveSettings({ types: s.types }); drawSettings(); } }, '+ Add block type')),

    h('section', {}, h('h3', {}, 'Enforcement'),
      h('div', { class: 'grid2' }, field('Overrides / block', num('overridesPerBlock', 0, 20)), field('Override minutes', num('overrideMinutes', 1, 60)), field('Warning seconds', num('warnSeconds', 3, 120))),
      h('div', { class: 'hint', style: 'margin:-6px 0 14px' }, 'Set overrides to 0 for strict mode: blocked apps close after the warning, no exceptions.'),
      h('div', { class: 'status-line' }, h('span', { class: `dot ${b.sitesReady ? 'ok' : ''}` }), b.sitesReady ? 'Website blocking is enabled' : 'Website blocking needs a one-time permission'),
      !b.sitesReady && h('button', { class: 'btn primary', onclick: async () => { try { state.blocker = await tempo.blocker.enableSites(); toast('Website blocking enabled.'); } catch (err) { toast(err.message); } drawSettings(); } }, 'Enable website blocking'),
      !b.sitesReady && h('div', { class: 'hint' }, 'Shows one Windows permission prompt so Tempo can edit the hosts file. After that it runs without admin rights.')),

    h('section', {}, h('h3', {}, 'General'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.launchAtStartup, onchange: (e) => saveSettings({ launchAtStartup: e.target.checked }) }), 'Launch Tempo when I sign in to Windows'),
      h('div', { class: 'grid2', style: 'grid-template-columns:1fr 1fr;margin-top:14px' },
        hotkeyField('Ask Tempo (chat) hotkey', 'hotkeyChat'), hotkeyField('Open calendar hotkey', 'hotkeyCalendar')),
      h('div', { class: 'hint', style: 'margin-top:-6px' }, 'Work from anywhere. Press again to put the window away. Backspace clears one.')));
  d.scrollTop = scroll;
}

// ---- boot -------------------------------------------------------------------------------------------

function initChrome() {
  $('#prev').onclick = () => { state.anchor = addDays(state.anchor, state.view === 'day' ? -1 : -7); loadEvents(); };
  $('#next').onclick = () => { state.anchor = addDays(state.anchor, state.view === 'day' ? 1 : 7); loadEvents(); };
  $('#today').onclick = () => { state.anchor = startOfDay(new Date()); loadEvents(); scrollToNow(); };
  document.querySelectorAll('#view-seg button').forEach((b) => { b.onclick = () => { state.view = b.dataset.view; loadEvents(); }; });
  $('#settings-btn').onclick = openSettings;
  $('#sync-chip').onclick = () => {
    if (state.google?.connected) tempo.google.sync(); else openSettings();
  };
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowLeft') $('#prev').click();
    if (e.key === 'ArrowRight') $('#next').click();
    if (e.key === 't') $('#today').click();
  });
}

function scrollToNow() {
  const now = new Date();
  $('#cal-scroll').scrollTop = Math.max(0, (now.getHours() - 2) * HOUR_H);
}

async function main() {
  initChrome();
  initGrid();
  [state.settings, state.google, state.blocker] = await Promise.all([tempo.settings.get(), tempo.google.state(), tempo.blocker.state()]);
  await loadEvents();
  scrollToNow();

  tempo.events.onChanged(async () => { state.settings = await tempo.settings.get(); loadEvents(); });
  tempo.google.onState((g) => { state.google = g; renderChips(); if (!$('#drawer').hidden) drawSettings(); });
  tempo.blocker.onState((b) => { state.blocker = b; renderChips(); });
  tempo.onError((m) => toast(m));
  setInterval(() => { updateNowLine(); renderChips(); }, 30000);
}

main();
