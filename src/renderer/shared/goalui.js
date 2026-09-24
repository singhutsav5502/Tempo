'use strict';

// Compact "today's goals" UI shared by the calendar's goals panel and the widget's Today tab.
// Pure DOM builders: callers pass the rows from tempo.habits.day() and a handler that records a change.
const GoalUI = (() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const goalText = (hb) => (hb.kind === 'number' && hb.target != null ? `${hb.direction === 'atmost' ? '≤' : '≥'} ${hb.target}${hb.unit ? ` ${hb.unit}` : ''}` : '');

  function summary(rows) {
    const due = rows.filter((r) => r.scheduled);
    return {
      due: due.length,
      done: due.filter((r) => r.status === 'done').length,
      open: due.filter((r) => !r.status).map((r) => r.habit.name),
    };
  }

  /** Big "3 / 5 done" count, a progress bar and a plain-language "still to do" line. */
  function header(rows) {
    const s = summary(rows);
    const box = el('div', 'goal-head');
    const top = el('div', 'tsum');
    const left = el('div');
    left.append(el('b', '', String(s.done)), el('span', '', ` / ${s.due} done today`));
    top.append(left);
    const prog = el('div', 'tprog');
    const fill = el('i');
    fill.style.width = `${s.due ? (s.done / s.due) * 100 : 0}%`;
    prog.append(fill);
    const left2 = el('div', `tleft${s.due && !s.open.length ? ' all' : ''}`,
      !s.due ? 'Nothing scheduled today.' : s.open.length ? `To go: ${s.open.join(', ')}` : 'All done. Nice work.');
    box.append(top, prog, left2);
    return box;
  }

  function row({ habit, entry, status, scheduled }, onLog) {
    const manual = !!entry?.manual;
    const btn = (kind, label, target) => {
      const b = el('button', `tbtn ${kind}${status === target ? ' on' : ''}${status === target && !manual ? ' auto' : ''}`, label);
      b.title = target === 'done' ? 'Done' : 'Missed';
      b.setAttribute('aria-label', `${habit.name}: mark ${target === 'done' ? 'done' : 'missed'}`);
      b.setAttribute('aria-pressed', status === target ? 'true' : 'false');
      b.onclick = () => onLog(habit.id, { status: entry?.manual && entry.status === target ? null : target });
      return b;
    };
    const r = el('div', `trow${status ? ` ${status}` : ' open'}${scheduled ? '' : ' rest'}`);
    r.style.setProperty('--c', habit.color);
    const name = el('div', 'tname');
    name.append(el('b', '', habit.name));
    const sub = [goalText(habit), !scheduled && 'rest day'].filter(Boolean).join(' · ');
    if (sub) name.append(el('small', '', sub));
    r.append(name);

    if (habit.kind === 'number') {
      const step = habit.target != null && habit.target >= 100 ? 50 : 1;
      const input = el('input');
      input.type = 'number'; input.step = 'any'; input.min = '0';
      input.placeholder = '–';
      input.value = entry?.value ?? '';
      input.setAttribute('aria-label', `${habit.name} amount${habit.unit ? ` (${habit.unit})` : ''}`);
      input.onchange = () => onLog(habit.id, { value: input.value === '' ? null : Number(input.value) });
      const minus = el('button', 'step', '−');
      minus.setAttribute('aria-label', `${habit.name}: minus ${step}`);
      minus.onclick = () => onLog(habit.id, { value: Math.max(0, (entry?.value ?? 0) - step) });
      const plus = el('button', 'step', '+');
      plus.setAttribute('aria-label', `${habit.name}: plus ${step}`);
      plus.onclick = () => onLog(habit.id, { value: (entry?.value ?? 0) + step });
      const num = el('div', 'tnum');
      num.append(minus, input, plus);
      r.append(num);
    }
    r.append(btn('cross', '✕', 'missed'), btn('tick', '✓', 'done'));
    return r;
  }

  return { summary, header, row, goalText, el };
})();
