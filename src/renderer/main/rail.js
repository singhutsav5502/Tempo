'use strict';

// Today's goals, beside the calendar: docked full panel on wide windows, a slim strip otherwise, and a slide-over
// when the strip is expanded. Uses GoalUI (shared with the widget) and helpers from app.js.

let railSeq = 0;

async function logGoal(id, patch) {
  try { await tempo.habits.log(ymd(new Date()), id, patch); } catch (err) { toast(err.message); }
  renderRail();
}

function blockingSummary() {
  const b = state.blocker;
  const active = b?.active?.filter((a) => a.type) || [];
  if (!active.length || !(b.apps.length || b.sites.length)) return null;
  const end = new Date(Math.min(...active.map((a) => Date.parse(a.end))));
  const box = GoalUI.el('div', 'rail-blocking');
  box.append(GoalUI.el('b', '', `Blocking until ${fmtTime(end)}`),
    document.createTextNode([friendlyList(b.appNames || b.apps), friendlyList(b.sites)].filter(Boolean).join(' · ')));
  return box;
}

const friendlyList = (items) => (items.length > 3 ? `${items.slice(0, 3).join(', ')} +${items.length - 3} more` : items.join(', '));

async function renderRail() {
  const rail = $('#rail');
  const seq = ++railSeq;
  const rows = await tempo.habits.day(ymd(new Date()));
  if (seq !== railSeq) return;
  const s = GoalUI.summary(rows);

  // The toolbar Goals button always shows progress, so goals are visible even with the panel collapsed.
  const btn = $('#goals-btn');
  $('#goals-count').textContent = s.due ? `${s.done}/${s.due}` : '';
  btn.classList.toggle('all', s.due > 0 && s.done === s.due);
  btn.classList.toggle('pending', s.open.length > 0);
  btn.title = s.due ? `Goals: ${s.done} of ${s.due} done today (g)` : 'Goals (g)';
  btn.setAttribute('aria-label', btn.title);
  if (rail.hidden) return;

  const scroll = rail.scrollTop;
  if (railMode() === 'slim') {
    const ring = GoalUI.el('button', 'ring');
    ring.style.setProperty('--p', s.due ? String(Math.round((s.done / s.due) * 100)) : '0');
    ring.title = `${s.done} of ${s.due} goals done. Show goals`;
    ring.setAttribute('aria-label', ring.title);
    ring.append(GoalUI.el('span', '', s.due ? `${s.done}/${s.due}` : '–'));
    ring.onclick = () => { state.railOverlay = true; refreshRailLayout(); };
    const dots = rows.map((r) => {
      const d = GoalUI.el('button', `gdot${r.status ? ` ${r.status}` : ''}${r.scheduled ? '' : ' rest'}`, r.status === 'done' ? '✓' : r.status === 'missed' ? '✕' : '');
      d.style.setProperty('--c', r.habit.color);
      d.title = `${r.habit.name}${r.status ? `: ${r.status}` : ''}`;
      d.setAttribute('aria-label', `${r.habit.name}: ${r.status || 'not logged'}. ${r.habit.kind === 'number' ? 'Open goals to enter a value' : 'Toggle done'}`);
      d.onclick = () => {
        if (r.habit.kind === 'number') { state.railOverlay = true; refreshRailLayout(); return; }
        logGoal(r.habit.id, { status: r.entry?.manual && r.entry.status === 'done' ? null : 'done' });
      };
      return d;
    });
    const expand = GoalUI.el('button', 'rail-expand', '‹');
    expand.title = 'Show goals'; expand.setAttribute('aria-label', 'Show goals');
    expand.onclick = () => { state.railOverlay = true; refreshRailLayout(); };
    const strip = GoalUI.el('div', 'rail-slim'); strip.append(ring, ...dots, expand);
    rail.replaceChildren(strip);
  } else {
    const title = GoalUI.el('div', 'rail-title');
    title.append(GoalUI.el('span', '', 'Goals'));
    const collapse = GoalUI.el('button', 'rail-collapse', '›');
    collapse.title = state.railOverlay ? 'Close' : 'Collapse to a strip';
    collapse.setAttribute('aria-label', collapse.title);
    collapse.onclick = () => { if (state.railOverlay) { state.railOverlay = false; refreshRailLayout(); } else toggleGoals(); };
    title.append(collapse);
    const foot = GoalUI.el('div', 'rail-foot');
    const open = GoalUI.el('button', 'btn', 'Open full sheet');
    open.onclick = () => setPage('sheet');
    foot.append(open);
    const blocking = blockingSummary();
    rail.replaceChildren(title, ...(blocking ? [blocking] : []), GoalUI.header(rows),
      ...(rows.length ? rows.map((r) => GoalUI.row(r, logGoal)) : [GoalUI.el('div', 'tempty', 'No goals yet. Open the full sheet to add some.')]), foot);
  }
  rail.scrollTop = scroll;
}
