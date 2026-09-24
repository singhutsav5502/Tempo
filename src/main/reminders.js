// Goal reminders: a morning list of today's goals and an evening nudge if some are still open.
// Each fires at most once per day, and a stale morning nudge is skipped if the app starts late.
const store = require('./store');
const habits = require('./habits');

const CHECK_MS = 30 * 1000;
const MORNING_GRACE_MIN = 180;

function parseHm(s) {
  const m = /^(\d{2}):(\d{2})$/.exec(s || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const label = (r) => `${r.habit.name}${habits.goalText(r.habit) ? ` ${habits.goalText(r.habit)}` : ''}`;

/** Which reminders are due at `now` (pure apart from reading the store, so it can be tested). */
function due(now = new Date()) {
  const settings = store.get().settings;
  const fired = (store.get().reminders ||= {});
  const today = habits.todayStr();
  const mins = now.getHours() * 60 + now.getMinutes();
  const rows = habits.day(today).filter((r) => r.scheduled);
  const out = [];
  if (!rows.length) return out;

  const morning = parseHm(settings.goalsMorning);
  if (morning !== null && fired.morning !== today && mins >= morning && mins < morning + MORNING_GRACE_MIN) {
    out.push({ kind: 'morning', title: `Today's goals (${rows.length})`, body: rows.map(label).join(' · ') });
  }

  const evening = parseHm(settings.goalsEvening);
  const open = rows.filter((r) => !r.status);
  if (evening !== null && fired.evening !== today && mins >= evening && open.length) {
    const done = rows.filter((r) => r.status === 'done').length;
    out.push({ kind: 'evening', title: `${open.length} goal${open.length > 1 ? 's' : ''} still open today`, body: `${open.map((r) => r.habit.name).join(', ')} · ${done} of ${rows.length} done` });
  }
  return out;
}

function tick(notify, now = new Date()) {
  const today = habits.todayStr();
  for (const r of due(now)) {
    notify(r);
    store.get().reminders[r.kind] = today;
    store.save();
  }
}

let timer = null;
function start(notify) {
  tick(notify);
  timer = setInterval(() => tick(notify), CHECK_MS);
  timer.unref?.();
}

const stop = () => clearInterval(timer);

module.exports = { start, stop, due, tick };
