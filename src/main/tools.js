// Tools, system prompt and helpers shared by every assistant backend (Anthropic API, Claude Code).
const events = require('./events');

const SYSTEM = `You are Tempo, the calendar assistant built into a small always-on-screen widget on the user's Windows PC. You manage their calendar (synced with Google Calendar) and their "blocks": calendar entries with a type that makes the app close distracting apps and websites while the slot is active.

How to work:
- Act on clear requests immediately with your tools; ask one short question only when essential info is missing (usually the time).
- Each user message begins with a bracketed line giving the current local date, time and timezone. Resolve relative dates ("tomorrow", "Thursday") from it, and pass local times to tools as YYYY-MM-DDTHH:mm.
- Default durations when none is given: focus/deep work 90 minutes, meetings and calls 30 minutes, everything else 60 minutes.
- Deep work, studying, coding and writing sessions should use the "focus" block type so distractions get blocked. Call list_block_types if you are unsure which ids exist.
- Before scheduling, check for conflicts (list_events or find_free_time). If something overlaps, say so plainly and suggest an alternative rather than silently double-booking.
- Your replies appear in a narrow chat panel: keep them to one to three short sentences, plain text, no tables or headings. Confirm what you did with the concrete day and time.`;

const T = (name, description, properties, required = []) => ({
  name,
  description,
  eager_input_streaming: true,
  input_schema: { type: 'object', properties, required },
});

const TOOLS = [
  T('list_events', 'List calendar events that overlap a time range. Times are local, YYYY-MM-DDTHH:mm.', {
    start: { type: 'string' }, end: { type: 'string' },
  }, ['start', 'end']),
  T('create_event', 'Create a calendar entry. Set `type` to a block type id to make it enforce blocking while active.', {
    title: { type: 'string' },
    start: { type: 'string', description: 'Local time YYYY-MM-DDTHH:mm, or YYYY-MM-DD for all_day' },
    end: { type: 'string', description: 'Local time YYYY-MM-DDTHH:mm. Ignored for all_day.' },
    type: { type: 'string', description: 'Block type id, e.g. focus. Omit for a plain event.' },
    all_day: { type: 'boolean' },
  }, ['title', 'start']),
  T('update_event', 'Change an existing event. Only pass the fields you want to change. type "none" clears the block type.', {
    id: { type: 'string' }, title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, type: { type: 'string' },
  }, ['id']),
  T('delete_event', 'Delete an event by id.', { id: { type: 'string' } }, ['id']),
  T('find_free_time', 'Find free gaps between existing timed events over a date range (max 7 days).', {
    from_date: { type: 'string', description: 'YYYY-MM-DD' },
    to_date: { type: 'string', description: 'YYYY-MM-DD, inclusive. Defaults to from_date.' },
    duration_minutes: { type: 'integer' },
    day_start_hour: { type: 'integer', description: 'Default 9' },
    day_end_hour: { type: 'integer', description: 'Default 18' },
  }, ['from_date', 'duration_minutes']),
  T('list_block_types', 'List block types with the apps (process names) and websites each one blocks.', {}),
  T('edit_block_type', 'Add or remove blocked apps (process names like discord.exe) or websites (domains like youtube.com) for a block type.', {
    type_id: { type: 'string' },
    add_apps: { type: 'array', items: { type: 'string' } }, remove_apps: { type: 'array', items: { type: 'string' } },
    add_sites: { type: 'array', items: { type: 'string' } }, remove_sites: { type: 'array', items: { type: 'string' } },
  }, ['type_id']),
];

// ---- helpers --------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDay = (d) => d.toLocaleDateString('en-US', { weekday: 'short' });

function parseTime(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Could not parse time "${s}". Use YYYY-MM-DDTHH:mm.`);
  return d;
}

function line(e) {
  const t = e.type ? ` [${e.type}]` : '';
  if (e.allDay) return `${e.id.slice(0, 8)} | ${e.start} all day | ${e.title}${t}`;
  const s = new Date(e.start);
  const en = new Date(e.end);
  return `${e.id.slice(0, 8)} | ${fmtDay(s)} ${fmtDate(s)} ${fmtTime(s)}-${fmtTime(en)} | ${e.title}${t}`;
}

function resolveId(prefix) {
  const matches = events.list().filter((e) => e.id.startsWith(prefix));
  if (matches.length !== 1) throw new Error(matches.length ? `Id "${prefix}" is ambiguous` : `No event with id "${prefix}"`);
  return matches[0].id;
}

function checkType(id) {
  if (id && id !== 'none' && !events.typeOf(id)) {
    throw new Error(`Unknown block type "${id}". Valid ids: ${events.types().map((t) => t.id).join(', ')}`);
  }
}

function overlaps(start, end, ignoreId) {
  return events.range(start.getTime(), end.getTime()).filter((e) => !e.allDay && e.id !== ignoreId);
}

function freeSlots({ from_date, to_date, duration_minutes, day_start_hour = 9, day_end_hour = 18 }) {
  const first = parseTime(`${from_date}T00:00`);
  const last = parseTime(`${to_date || from_date}T00:00`);
  const out = [];
  for (let day = new Date(first); day <= last && out.length < 12 && day - first < 7 * 86400000; day.setDate(day.getDate() + 1)) {
    let cursor = new Date(day); cursor.setHours(day_start_hour, 0, 0, 0);
    const close = new Date(day); close.setHours(day_end_hour, 0, 0, 0);
    if (cursor < new Date()) cursor = new Date(Math.ceil(Date.now() / 900000) * 900000);
    const busy = events.range(cursor.getTime(), close.getTime()).filter((e) => !e.allDay);
    for (const e of [...busy, { start: close.toISOString(), end: close.toISOString() }]) {
      const s = new Date(e.start);
      if (s - cursor >= duration_minutes * 60000) out.push(`${fmtDay(cursor)} ${fmtDate(cursor)} ${fmtTime(cursor)}-${fmtTime(s)}`);
      if (new Date(e.end) > cursor) cursor = new Date(e.end);
    }
  }
  return out;
}

// ---- tool execution -------------------------------------------------------

function runTool(name, input) {
  switch (name) {
    case 'list_events': {
      const found = events.range(parseTime(input.start).getTime(), parseTime(input.end).getTime());
      return found.length ? found.slice(0, 100).map(line).join('\n') : 'No events in that range.';
    }
    case 'create_event': {
      checkType(input.type);
      let ev;
      if (input.all_day) {
        const day = input.start.slice(0, 10);
        const next = new Date(`${day}T00:00`); next.setDate(next.getDate() + 1);
        ev = events.create({ title: input.title, allDay: true, start: day, end: fmtDate(next), type: input.type });
      } else {
        if (!input.end) throw new Error('end is required for timed events');
        const s = parseTime(input.start); const e = parseTime(input.end);
        ev = events.create({ title: input.title, start: s.toISOString(), end: e.toISOString(), type: input.type });
        const clash = overlaps(s, e, ev.id);
        return `Created: ${line(ev)}${clash.length ? `\nWarning, overlaps:\n${clash.map(line).join('\n')}` : ''}`;
      }
      return `Created: ${line(ev)}`;
    }
    case 'update_event': {
      checkType(input.type);
      const patch = {};
      if (input.title) patch.title = input.title;
      if (input.start) patch.start = parseTime(input.start).toISOString();
      if (input.end) patch.end = parseTime(input.end).toISOString();
      if (input.type) patch.type = input.type === 'none' ? null : input.type;
      const ev = events.update(resolveId(input.id), patch);
      return `Updated: ${line(ev)}`;
    }
    case 'delete_event': {
      const id = resolveId(input.id);
      const label = line(events.byId(id));
      events.remove(id);
      return `Deleted: ${label}`;
    }
    case 'find_free_time': {
      const slots = freeSlots(input);
      return slots.length ? `Free slots (>= ${input.duration_minutes} min):\n${slots.join('\n')}` : 'No free slot of that length in that range.';
    }
    case 'list_block_types':
      return events.types().map((t) => `${t.id} (${t.name}) apps: ${t.apps.join(', ') || '-'} | sites: ${t.sites.join(', ') || '-'}`).join('\n');
    case 'edit_block_type': {
      const t = events.typeOf(input.type_id);
      if (!t) throw new Error(`Unknown block type "${input.type_id}"`);
      const norm = (xs) => (xs || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
      const merge = (cur, add, rem) => [...new Set([...cur, ...norm(add)])].filter((x) => !norm(rem).includes(x));
      t.apps = merge(t.apps, input.add_apps, input.remove_apps);
      t.sites = merge(t.sites, input.add_sites, input.remove_sites);
      events.changed(false);
      return `${t.name} now blocks apps: ${t.apps.join(', ') || '-'} | sites: ${t.sites.join(', ') || '-'}`;
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

function nowLine() {
  const now = new Date();
  const text = now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `[Now: ${text} (${Intl.DateTimeFormat().resolvedOptions().timeZone}); ISO local ${fmtDate(now)}T${fmtTime(now)}]`;
}

function toolLabel(name, input) {
  const t = input.title ? ` "${input.title}"` : '';
  return ({
    list_events: 'Checking calendar', create_event: `Adding${t}`, update_event: `Updating${t}`, delete_event: 'Deleting event',
    find_free_time: 'Finding free time', list_block_types: 'Reading block types', edit_block_type: 'Editing block list',
  })[name] || name;
}

module.exports = { SYSTEM, TOOLS, runTool, nowLine, toolLabel };
