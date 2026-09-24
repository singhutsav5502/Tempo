'use strict';

const $ = (s) => document.querySelector(s);
const NO_TYPE_COLOR = '#8b90a0';
const SUGGESTIONS = [
  "What's on my calendar today?",
  'Block 2 hours of deep work tomorrow morning',
  'Find me a free 45 minutes this week',
  'I did gym and ate 1450 calories today',
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
  autoSend = cfg.voiceAutoSend !== false;
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

// ---- voice --------------------------------------------------------------------

let voice = null;            // active VoiceCapture
let voiceState = 'idle';     // idle | listening | transcribing
let autoSend = true;
let statusTimer = null;
let modelStatus = null;      // { phase, percent } while Whisper is loading/downloading

function setVoiceState(state, message) {
  voiceState = state;
  document.body.classList.toggle('listening', state === 'listening');
  document.body.classList.toggle('transcribing', state === 'transcribing');
  showVoiceStatus(message);
}

function showVoiceStatus(message, ttl) {
  const box = $('#voice-status');
  clearTimeout(statusTimer);
  let text = message;
  if (modelStatus && modelStatus.phase === 'loading' && voiceState !== 'idle') text = `Getting speech ready… ${modelStatus.percent}%`;
  box.textContent = text || '';
  box.hidden = !text;
  if (ttl) statusTimer = setTimeout(() => { box.hidden = true; }, ttl);
}

function micErrorText(err) {
  if (err && err.name === 'NotFoundError') return 'No microphone found.';
  if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) return 'Microphone access is blocked. Turn it on in Windows Settings → Privacy → Microphone.';
  return `Couldn't use the microphone: ${err?.message || err}`;
}

const cleanTranscript = (t) => t.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(); // drops [BLANK_AUDIO], (silence)...

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function showLive(base, text) {
  const input = $('#input');
  input.value = base ? `${base} ${text}` : text;
  autosize();
  input.scrollTop = input.scrollHeight;
}

// Whisper isn't a streaming model, so "live" means: while you talk, keep re-transcribing what has been said so far
// (one pass at a time, always on the latest audio) and show the newest result. The final pass polishes it.
function startLive(cap, base) {
  const st = { seq: 0, covered: 0, text: '', stopped: false, inflight: null };
  st.done = (async () => {
    while (!st.stopped) {
      const snap = cap.snapshot();
      if (!snap || snap.voicedSamples < 8000 || snap.voicedSamples - st.covered < 6400) { await sleep(120); continue; }
      const seq = ++st.seq;
      st.inflight = tempo.stt.transcribe(snap.audio).then((t) => ({ t, seq, covered: snap.voicedSamples }), () => null);
      const r = await st.inflight;
      st.inflight = null;
      if (!r || r.seq !== st.seq) continue;
      st.covered = r.covered;                       // advance even on empty results so noise doesn't spin the loop
      const text = cleanTranscript(r.t);
      if (text) { st.text = text; if (!st.stopped) showLive(base, text); }
    }
  })();
  return st;
}

async function startListening() {
  if (voiceState !== 'idle') return;
  const input = $('#input');
  const base = input.value.trim();
  setVoiceState('listening', 'Listening… say what to schedule');
  input.readOnly = true;
  input.classList.add('live');
  tempo.stt.warm();

  voice = new VoiceCapture((lvl) => document.documentElement.style.setProperty('--lvl', lvl.toFixed(2)));
  const live = startLive(voice, base);
  let result;
  try {
    result = await voice.start();
  } catch (err) {
    live.stopped = true;
    voice = null;
    endVoice(input);
    msgs.append(el('div', 'msg err', micErrorText(err)));
    scrollDown();
    return;
  }
  voice = null;
  live.stopped = true;
  await live.done; // lets an in-flight partial land so it can double as the final result

  if (!result.audio) {
    input.value = base; autosize();
    endVoice(input);
    if (result.reason !== 'cancel') showVoiceStatus("Didn't catch anything.", 3000);
    return;
  }

  setVoiceState('transcribing', 'Finishing…');
  let text = live.text;
  // Reuse the last partial when it already covered (nearly) everything that was said; otherwise one final pass.
  if (!text || result.voicedSamples - live.covered > 4000) {
    try {
      text = cleanTranscript(await tempo.stt.transcribe(result.audio));
    } catch (err) {
      input.value = base; autosize();
      endVoice(input);
      msgs.append(el('div', 'msg err', err.message));
      scrollDown();
      return;
    }
  }
  endVoice(input);
  if (text.length < 2) { input.value = base; autosize(); showVoiceStatus("Didn't catch that.", 3000); return; }
  showLive(base, text);
  if (autoSend && !busy) send(`${base} ${text}`.trim());
  else input.focus();
}

function endVoice(input) {
  setVoiceState('idle');
  input.readOnly = false;
  input.classList.remove('live');
}

// Hotkey / mic button: start listening, or, if already listening, stop and use what was heard.
function toggleListening() {
  if (tab !== 'chat') setTab('chat'); // voice always talks to the chat
  if (voiceState === 'listening' && voice) voice.finish();
  else startListening();
}

// ---- today tab (daily habit sheet) ---------------------------------------------------------------

const localYmd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let tab = 'chat';

function setTab(name) {
  tab = name;
  document.body.classList.toggle('tab-today', name === 'today');
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $('#today').hidden = name !== 'today';
  if (name === 'today') renderToday(); else if (open) $('#input').focus();
}

async function logHabit(id, patch) {
  try { await tempo.habits.log(localYmd(), id, patch); } catch (err) { /* shown by the main window; keep the widget quiet */ }
  renderToday();
}

async function renderToday() {
  const rows = await tempo.habits.day(localYmd());
  const s = GoalUI.summary(rows);
  $('#today-count').textContent = s.due ? `${s.done}/${s.due}` : '';
  const chip = $('#goals-chip');
  $('#goals-num').textContent = `${s.done}/${s.due}`;
  chip.className = `goals-chip ${!s.due ? 'none' : s.done === s.due ? 'all' : s.done ? 'some' : ''}`;
  chip.title = s.due ? (s.open.length ? `To go: ${s.open.join(', ')}` : 'All of today\'s goals are done') : 'No goals scheduled today';
  if (tab !== 'today') return;

  const box = $('#today');
  const scroll = box.scrollTop;
  box.replaceChildren(GoalUI.header(rows), ...(rows.length ? rows.map((r) => GoalUI.row(r, logHabit)) : [GoalUI.el('div', 'tempty', 'No habits yet. Add some in the main window (checklist icon).')]));
  box.scrollTop = scroll;
}

// ---- wiring ---------------------------------------------------------------------

let open = false;
function setOpen(v) {
  open = v;
  document.body.classList.toggle('open', v);
  if (v) { $('#input').focus(); scrollDown(); }
}

document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
$('#chat-btn').onclick = () => tempo.widget.setOpen(!open);
$('#collapse').onclick = () => { voice?.cancel(); tempo.widget.setOpen(false); };
$('#mic').onclick = toggleListening;
$('#open-main').onclick = () => tempo.widget.openMain();
$('#goals-chip').onclick = () => { tempo.widget.setOpen(true); setTab('today'); };
$('#new-chat').onclick = async () => { await tempo.chat.reset(); bot = null; showEmpty(); };
$('#composer').onsubmit = (e) => { e.preventDefault(); send($('#input').value); };
$('#input').addEventListener('input', autosize);
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#input').value); }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (voiceState === 'listening' && voice) voice.cancel(); // first Esc cancels the mic, second closes the panel
  else if (open) tempo.widget.setOpen(false);
});

tempo.widget.onOpen(setOpen);
tempo.habits.onChanged(() => { if (!document.activeElement?.matches?.('#today input')) renderToday(); });
tempo.voice.onHotkey(toggleListening);
tempo.stt.onStatus((st) => { modelStatus = st.phase === 'ready' ? null : st; if (voiceState !== 'idle') showVoiceStatus(voiceState === 'listening' ? 'Listening… say what to schedule' : 'Transcribing…'); });
tempo.events.onChanged(refreshPill);
tempo.blocker.onState((b) => { blocker = b; renderBanner(); refreshPill(); });

(async function boot() {
  showEmpty();
  renderToday();
  setInterval(renderToday, 60000); // also rolls the sheet over at midnight
  blocker = await tempo.blocker.state();
  renderBanner();
  await refreshPill();
  setInterval(() => { refreshPill(); renderBanner(); }, 15000);
})();
