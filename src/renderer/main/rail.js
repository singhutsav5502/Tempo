'use strict';

// Today's goals, always visible beside the calendar so they can't be forgotten.
// Uses GoalUI (shared with the widget) and helpers from app.js.

let railSeq = 0;

async function logGoal(id, patch) {
  try { await tempo.habits.log(ymd(new Date()), id, patch); } catch (err) { toast(err.message); }
  renderRail();
}

async function renderRail() {
  const rail = $('#rail');
  const seq = ++railSeq;
  const rows = await tempo.habits.day(ymd(new Date()));
  if (seq !== railSeq) return;
  const s = GoalUI.summary(rows);

  // A dot on the toolbar icon while goals are still open, even with the panel closed.
  $('#rail-btn').classList.toggle('pending', s.open.length > 0);
  $('#rail-btn').title = s.due ? `Today's goals: ${s.done}/${s.due} done (g)` : "Today's goals (g)";
  if (rail.hidden) return;

  const scroll = rail.scrollTop;
  rail.replaceChildren(
    GoalUI.el('div', 'rail-title', "Today's goals"),
    GoalUI.header(rows),
    ...(rows.length ? rows.map((r) => GoalUI.row(r, logGoal)) : [GoalUI.el('div', 'tempty', 'No habits yet. Open the daily sheet to add some.')]),
    (() => {
      const foot = GoalUI.el('div', 'rail-foot');
      const open = GoalUI.el('button', 'btn', 'Open full sheet');
      open.onclick = () => setPage('sheet');
      foot.append(open);
      return foot;
    })());
  rail.scrollTop = scroll;
}
