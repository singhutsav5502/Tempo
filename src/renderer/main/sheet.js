'use strict';

// Daily sheet page: today's checklist, a 14-day matrix with streaks, and the habit editor.
// Helpers (h, $, ymd, addDays, state, toast, openModal, closeModal, ...) come from app.js.

const MATRIX_DAYS = 14;
const SUGGESTED_CATEGORIES = ['fitness', 'coding', 'hobby', 'nutrition', 'wellness', 'learning', 'other'];
let sheetSeq = 0;

const sheetDateStr = () => ymd(state.sheetDate);
const isToday = (d) => ymd(d) === ymd(new Date());

function sheetLabel() {
  const d = state.sheetDate;
  return `Goals · ${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}${isToday(d) ? ' · Today' : ''}`;
}

function goalText(h) {
  if (h.kind !== 'number' || h.target == null) return '';
  return `${h.direction === 'atmost' ? '≤' : '≥'} ${h.target}${h.unit ? ` ${h.unit}` : ''}`;
}

const numberStep = (h) => (h.target != null && h.target >= 100 ? 50 : 1);

/** Saves a change, then repaints (the change event fires on blur/Enter, so focus loss is expected). */
async function logHabit(date, id, patch) {
  try { await tempo.habits.log(date, id, patch); } catch (err) { toast(err.message); }
  renderSheet();
}

// ---- one habit row (shared shape with the widget's Today tab) -------------------------------------

function habitRow({ habit, entry, status, scheduled }, date, stat) {
  const isNum = habit.kind === 'number';
  const manual = !!entry?.manual;
  const value = entry?.value;

  const tick = h('button', {
    class: `tick${status === 'done' ? ' on' : ''}${status === 'done' && !manual ? ' auto' : ''}`, title: 'Done',
    onclick: () => logHabit(date, habit.id, { status: entry?.manual && entry.status === 'done' ? null : 'done' }),
  }, '✓');
  const cross = h('button', {
    class: `cross${status === 'missed' ? ' on' : ''}${status === 'missed' && !manual ? ' auto' : ''}`, title: 'Missed',
    onclick: () => logHabit(date, habit.id, { status: entry?.manual && entry.status === 'missed' ? null : 'missed' }),
  }, '✕');

  let numberCtl = null;
  let bar = null;
  if (isNum) {
    const step = numberStep(habit);
    const input = h('input', {
      type: 'number', class: 'hnum', step: 'any', min: '0', placeholder: '–',
      value: value ?? '', onchange: (e) => logHabit(date, habit.id, { value: e.target.value === '' ? null : Number(e.target.value) }),
    });
    numberCtl = h('div', { class: 'numctl' },
      h('button', { class: 'step', title: `−${step}`, onclick: () => logHabit(date, habit.id, { value: Math.max(0, (value ?? 0) - step) }) }, '−'),
      input,
      h('button', { class: 'step', title: `+${step}`, onclick: () => logHabit(date, habit.id, { value: (value ?? 0) + step }) }, '+'),
      habit.unit && h('span', { class: 'unit' }, habit.unit));
    if (habit.target) {
      const pct = value != null ? Math.min(100, (value / habit.target) * 100) : 0;
      const over = habit.direction === 'atmost' && value != null && value > habit.target;
      bar = h('div', { class: `hbarfill${over ? ' over' : ''}` }, h('i', { style: `width:${pct}%` }));
    }
  }

  const note = h('input', {
    type: 'text', class: `hnote${entry?.note ? ' has' : ''}`, placeholder: 'Note', value: entry?.note || '',
    onchange: (e) => logHabit(date, habit.id, { note: e.target.value }),
  });

  const noteBtn = h('button', { class: 'notebtn', title: 'Add a note', onclick: (e) => { const row = e.target.closest('.hrow'); row.classList.toggle('noting'); row.querySelector('.hnote').focus(); } }, '✎');
  const meta = [goalText(habit), !scheduled && 'rest day', stat && stat.streak > 1 && `🔥 ${stat.streak} day streak`].filter(Boolean).join(' · ');
  return h('div', { class: `hrow${status ? ` ${status}` : ''}${scheduled ? '' : ' rest'}`, style: `--c:${habit.color}` },
    h('div', { class: 'hdot' }),
    h('div', { class: 'hmain' }, h('div', { class: 'hname' }, habit.name), h('div', { class: 'hmeta' }, meta), bar),
    h('div', { class: 'hctl' }, noteBtn, numberCtl, cross, tick),
    note);
}

// ---- page ------------------------------------------------------------------------------------------

async function renderSheet() {
  const seq = ++sheetSeq;
  const root = $('#sheet');
  const date = sheetDateStr();
  const from = ymd(addDays(state.sheetDate, -(MATRIX_DAYS - 1)));
  const [rows, range, stats] = await Promise.all([tempo.habits.day(date), tempo.habits.range(from, date), tempo.habits.stats(date, 30)]);
  if (seq !== sheetSeq) return; // a newer render superseded this one

  const scroll = root.scrollTop;
  const byStat = new Map(stats.map((s) => [s.id, s]));
  const due = rows.filter((r) => r.scheduled);
  const done = due.filter((r) => r.status === 'done').length;

  const summary = h('div', { class: 'ssum' },
    h('div', { class: 'ssum-top' },
      h('div', {}, h('span', { class: 'big' }, `${done}`), h('span', { class: 'of' }, ` / ${due.length} done`)),
      h('button', { class: 'btn', onclick: openHabitEditor }, 'Edit goals')),
    h('div', { class: 'sprog' }, h('i', { style: `width:${due.length ? (done / due.length) * 100 : 0}%` })));

  const list = h('div', { class: 'hlist' }, rows.length ? rows.map((r) => habitRow(r, date, byStat.get(r.habit.id))) : h('div', { class: 'hint' }, 'No goals yet. Use "Edit goals" to add some.'));

  root.replaceChildren(h('div', { class: 'sheet-inner' }, summary, list, matrixEl(rows, range, stats, date)));
  root.scrollTop = scroll;
}

function matrixEl(rows, range, stats, selected) {
  const days = Array.from({ length: MATRIX_DAYS }, (_, i) => addDays(parseLocal(selected, '00:00'), i - (MATRIX_DAYS - 1)));
  const byStat = new Map(stats.map((s) => [s.id, s]));
  const todayKey = ymd(new Date());

  const head = h('div', { class: 'mrow mhead-row' }, h('div', { class: 'mlabel' }),
    days.map((d) => h('div', { class: `mday${ymd(d) === todayKey ? ' today' : ''}${ymd(d) === selected ? ' sel' : ''}` },
      h('span', {}, d.toLocaleDateString([], { weekday: 'narrow' })), h('b', {}, String(d.getDate())))),
    h('div', { class: 'mstat' }, '🔥'), h('div', { class: 'mstat' }, 'best'), h('div', { class: 'mstat' }, '30d'));

  const body = rows.map(({ habit }) => {
    const st = byStat.get(habit.id);
    return h('div', { class: 'mrow', style: `--c:${habit.color}` },
      h('div', { class: 'mlabel' }, h('i'), habit.name),
      days.map((d) => {
        const key = ymd(d);
        const entry = range[key]?.[habit.id];
        const status = tempoDerive(habit, entry);
        const sched = habit.days.includes(d.getDay());
        const sym = status === 'done' ? '✓' : status === 'missed' ? '✕' : status === 'skip' ? '–' : sched && key <= todayKey ? '·' : '';
        const num = habit.kind === 'number' && entry && entry.value != null ? shortNumber(entry.value) : '';
        return h('button', {
          class: `mc ${status || 'none'}${sched ? '' : ' off'}${key === selected ? ' sel' : ''}${key === todayKey ? ' today' : ''}`,
          title: `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}${entry?.value != null ? ` · ${entry.value}${habit.unit ? ' ' + habit.unit : ''}` : ''}${status ? ` · ${status}` : ''}${entry?.note ? ` · ${entry.note}` : ''}`,
          onclick: () => { state.sheetDate = d; applyPage(); renderSheet(); },
        }, num ? h('span', { class: 'mv' }, num) : sym);
      }),
      h('div', { class: 'mstat' }, st && st.streak ? String(st.streak) : '–'),
      h('div', { class: 'mstat' }, st && st.best ? String(st.best) : '–'),
      h('div', { class: 'mstat' }, st && st.rate != null ? `${st.rate}%` : '–'));
  });

  return h('div', { class: 'matrix' }, h('div', { class: 'lbl' }, `Last ${MATRIX_DAYS} days`), h('div', { class: 'mgrid2' }, head, body));
}

const shortNumber = (v) => (Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}k` : String(Math.round(v * 10) / 10));

// Mirrors habits.derive() in the main process, for matrix cells built from the raw log.
function tempoDerive(habit, entry) {
  if (!entry) return null;
  if (entry.status) return entry.status;
  if (habit.kind === 'number' && typeof entry.value === 'number') {
    if (habit.target == null) return 'done';
    return (habit.direction === 'atmost' ? entry.value <= habit.target : entry.value >= habit.target) ? 'done' : 'missed';
  }
  return null;
}

// ---- habit editor -----------------------------------------------------------------------------------

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

async function openHabitEditor() {
  const box = h('div', { class: 'modal habit-editor' });
  openModal(box);

  const draw = async () => {
    const habits = await tempo.habits.list();
    const save = async (habit, patch) => { try { await tempo.habits.save({ id: habit.id, ...patch }); } catch (err) { toast(err.message); } draw(); };
    const cards = habits.map((hb, i) => {
      const isNum = hb.kind === 'number';
      return h('div', { class: 'type-card', style: `--c:${hb.color}` },
        h('div', { class: 'head' },
          h('input', { type: 'color', value: hb.color, onchange: (e) => save(hb, { color: e.target.value }) }),
          h('input', { type: 'text', value: hb.name, onchange: (e) => save(hb, { name: e.target.value }) }),
          h('button', { class: 'icon-btn', title: 'Move up', disabled: i === 0, onclick: async () => { const ids = habits.map((x) => x.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; await tempo.habits.reorder(ids); draw(); } }, '▲'),
          h('button', { class: 'icon-btn', title: 'Move down', disabled: i === habits.length - 1, onclick: async () => { const ids = habits.map((x) => x.id); [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; await tempo.habits.reorder(ids); draw(); } }, '▼'),
          h('button', { class: 'icon-btn', title: 'Remove (history is kept)', onclick: async () => { await tempo.habits.remove(hb.id); draw(); } }, '✕')),
        h('div', { class: 'row', style: 'margin-bottom:8px' },
          h('select', { style: 'flex:1.6', onchange: (e) => save(hb, { kind: e.target.value }) },
            h('option', { value: 'check', selected: !isNum }, 'Tick / cross'), h('option', { value: 'number', selected: isNum }, 'Number + goal')),
          isNum && h('select', { onchange: (e) => save(hb, { direction: e.target.value }) },
            h('option', { value: 'atleast', selected: hb.direction !== 'atmost' }, 'at least'), h('option', { value: 'atmost', selected: hb.direction === 'atmost' }, 'at most')),
          isNum && h('input', { type: 'number', placeholder: 'goal', value: hb.target ?? '', onchange: (e) => save(hb, { target: e.target.value }) }),
          isNum && h('input', { type: 'text', placeholder: 'unit', value: hb.unit || '', onchange: (e) => save(hb, { unit: e.target.value }) })),
        h('div', { class: 'row' },
          h('div', { class: 'dayrow' }, DAY_LETTERS.map((l, d) => h('button', {
            class: `daybtn${hb.days.includes(d) ? ' on' : ''}`, title: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d],
            onclick: () => save(hb, { days: hb.days.includes(d) ? hb.days.filter((x) => x !== d) : [...hb.days, d] }),
          }, l))),
          h('input', { type: 'text', list: 'habit-cats', placeholder: 'category', value: hb.category || '', onchange: (e) => save(hb, { category: e.target.value }) })));
    });
    box.replaceChildren(
      h('div', { style: 'font-weight:600;font-size:15px' }, 'Your goals'),
      h('div', { class: 'hint', style: 'margin:-6px 0 0' }, 'Tick / cross goals are done or not. Number goals have a target: enter the actual number and the tick or cross follows. Days set when a goal counts. Categories group goals for analytics.'),
      h('div', { class: 'hcards' }, cards),
      h('datalist', { id: 'habit-cats' }, SUGGESTED_CATEGORIES.map((c) => h('option', { value: c }))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: async () => { await tempo.habits.save({ name: 'New goal', kind: 'check' }); draw(); } }, '+ Add goal'),
        h('button', { class: 'btn primary', onclick: () => { closeModal(); renderSheet(); } }, 'Done')));
  };
  draw();
}
