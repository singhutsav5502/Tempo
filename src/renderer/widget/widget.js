'use strict';

const $ = (s) => document.querySelector(s);
const NO_TYPE_COLOR = '#8b90a0';
const SUGGESTIONS = [
  "What's on my calendar today?",
  'Block 2 hours of deep work tomorrow morning',
  'Find me a free 45 minutes this week',
];

let types = [];
let busy = false;
let bot = null;          // assistant bubble currently receiving text
let typing = null;
let blocker = null;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const mins = (ms) => Math.max(0, Math.round(ms / 60000));
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

// ---- status pill -------------------------------------------------------------

async function refreshPill() {
  const cfg = await tempo.settings.get();
  types = cfg.types;
  $('#chat-btn').title = `Ask Tempo${cfg.hotkeyChat ? ` (${cfg.hotkeyChat.replace('Control', 'Ctrl')})` : ''}`;
  const { active, next } = await tempo.events.now();
  const now = Date.now();
  const enforcing = (e) => { const ty = types.find((x) => x.id === e.type); return !!ty && ty.apps.length + ty.sites.length > 0; };
  // A block that is actually enforcing something takes the pill over an ordinary overlapping event.
  const cur = active.sort((a, b) => enforcing(b) - enforcing(a) || Date.parse(a.start) - Date.parse(b.start))[0];
  const root = document.documentElement;
  const t = cur && types.find((x) => x.id === cur.type);
  const color = t?.color || NO_TYPE_COLOR;

  if (cur) {
    const end = Date.parse(cur.end); const start = Date.parse(cur.start);
    root.style.setProperty('--c', color);
    $('#dot').classList.toggle('live', !!t && (t.apps.length + t.sites.length) > 0);
    $('#name').textContent = cur.title;
    $('#sub').textContent = `${t ? `${t.name} · ` : ''}${dur(mins(end - now))} left · until ${fmtTime(new Date(end))}`;
    $('#progress').style.width = `${Math.min(100, ((now - start) / (end - start)) * 100)}%`;
  } else {
    root.style.setProperty('--c', NO_TYPE_COLOR);
    $('#dot').classList.remove('live');
    $('#progress').style.width = '0';
    if (next) {
      const nt = types.find((x) => x.id === next.type);
      root.style.setProperty('--c', nt?.color || NO_TYPE_COLOR);
      $('#name').textContent = 'Free';
      $('#sub').textContent = `Next: ${next.title} in ${dur(mins(Date.parse(next.start) - now))}`;
    } else {
      $('#name').textContent = 'Free';
      $('#sub').textContent = 'Nothing else scheduled';
    }
  }
}

function renderBanner() {
  const b = $('#banner');
  const active = blocker?.active?.filter((a) => a.type) || [];
  if (!active.length || !(blocker.apps.length || blocker.sites.length)) { b.hidden = true; return; }
  b.hidden = false;
  const paused = blocker.pausedUntil && blocker.pausedUntil > Date.now();
  const parts = [];
  if (blocker.apps.length) parts.push(`${blocker.apps.length} app${blocker.apps.length > 1 ? 's' : ''}`);
  if (blocker.sites.length) parts.push(`${blocker.sites.length} site${blocker.sites.length > 1 ? 's' : ''}`);
  const span = el('span', '', paused ? `Sites unblocked until ${fmtTime(new Date(blocker.pausedUntil))}` : `Blocking ${parts.join(' and ')}`);
  b.replaceChildren(span);
  if (blocker.sites.length && !blocker.sitesReady) {
    const btn = el('button', 'btn', 'Enable site blocking');
    btn.onclick = () => tempo.widget.openMain();
    b.append(btn);
  } else if (blocker.sites.length && !paused && !blocker.strict) {
    const btn = el('button', 'btn', `Pause sites ${blocker.overrideMinutes}m · ${blocker.overridesLeft} left`);
    btn.disabled = blocker.overridesLeft <= 0;
    btn.onclick = async () => { await tempo.blocker.pause(); blocker = await tempo.blocker.state(); renderBanner(); };
    b.append(btn);
  }
}

// ---- chat ---------------------------------------------------------------------

const msgs = $('#msgs');
const scrollDown = () => { msgs.scrollTop = msgs.scrollHeight; };

function showEmpty() {
  const box = el('div', 'empty');
  box.append(el('p', '', 'Tell me what to schedule, move or block.'));
  for (const s of SUGGESTIONS) {
    const b = el('button', 'suggest', s);
    b.onclick = () => send(s);
    box.append(b);
  }
  msgs.replaceChildren(box);
}

function setBusy(v) {
  busy = v;
  $('#send').disabled = v;
  if (v && !typing) { typing = el('div', 'typing'); typing.append(el('i'), el('i'), el('i')); msgs.append(typing); scrollDown(); }
  if (!v && typing) { typing.remove(); typing = null; }
}

async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  msgs.querySelector('.empty')?.remove();
  msgs.append(el('div', 'msg user', text));
  $('#input').value = ''; autosize();
  bot = null;
  setBusy(true);
  scrollDown();
  await tempo.chat.send(text);
}

tempo.chat.onEvent((m) => {
  if (m.type === 'text') {
    typing?.remove(); typing = null;
    if (!bot) { bot = el('div', 'msg bot'); msgs.append(bot); }
    bot.textContent += m.delta;
  } else if (m.type === 'tool') {
    bot = null;
    if (typing) typing.before(el('div', `tool ${m.ok ? 'ok' : 'bad'}`, m.label)); else msgs.append(el('div', `tool ${m.ok ? 'ok' : 'bad'}`, m.label));
  } else if (m.type === 'error') {
    bot = null;
    setBusy(false);
    msgs.append(el('div', 'msg err', m.message));
  } else if (m.type === 'end') {
    bot = null;
    setBusy(false);
  }
  scrollDown();
});

function autosize() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 110)}px`;
}

// ---- wiring ---------------------------------------------------------------------

let open = false;
function setOpen(v) {
  open = v;
  document.body.classList.toggle('open', v);
  if (v) { $('#input').focus(); scrollDown(); }
}

$('#chat-btn').onclick = () => tempo.widget.setOpen(!open);
$('#collapse').onclick = () => tempo.widget.setOpen(false);
$('#open-main').onclick = () => tempo.widget.openMain();
$('#new-chat').onclick = async () => { await tempo.chat.reset(); bot = null; showEmpty(); };
$('#composer').onsubmit = (e) => { e.preventDefault(); send($('#input').value); };
$('#input').addEventListener('input', autosize);
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#input').value); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) tempo.widget.setOpen(false); });

tempo.widget.onOpen(setOpen);
tempo.events.onChanged(refreshPill);
tempo.blocker.onState((b) => { blocker = b; renderBanner(); refreshPill(); });

(async function boot() {
  showEmpty();
  blocker = await tempo.blocker.state();
  renderBanner();
  await refreshPill();
  setInterval(() => { refreshPill(); renderBanner(); }, 15000);
})();
