// Speech-to-text manager: owns the Whisper worker, reports model progress, frees memory when idle.
const { app } = require('electron');
const { Worker } = require('worker_threads');
const path = require('path');

const IDLE_MS = 10 * 60 * 1000;

let worker = null;
let idleTimer = null;
let nextId = 1;
let onStatus = () => {};
const waiting = new Map();
const files = {};

const cacheDir = () => process.env.TEMPO_MODEL_DIR || path.join(app.getPath('userData'), 'models');

function failAll(err) {
  for (const w of waiting.values()) w.reject(err);
  waiting.clear();
}

function ensureWorker() {
  if (worker) return worker;
  const w = new Worker(path.join(__dirname, 'sttWorker.js'), { workerData: { cacheDir: cacheDir() } });
  worker = w;
  w.on('message', (m) => {
    if (m.type === 'progress') {
      const p = m.p;
      if (p.file && p.total) files[p.file] = { loaded: p.status === 'done' ? p.total : p.loaded || 0, total: p.total };
      const all = Object.values(files);
      const total = all.reduce((a, f) => a + f.total, 0);
      const loaded = all.reduce((a, f) => a + f.loaded, 0);
      if (total) onStatus({ phase: 'loading', percent: Math.min(99, Math.round((loaded / total) * 100)) });
    } else if (m.type === 'ready') {
      onStatus({ phase: 'ready' });
    } else if (m.type === 'result' || m.type === 'error') {
      const pending = waiting.get(m.id);
      if (!pending) return;
      waiting.delete(m.id);
      if (m.type === 'result') pending.resolve(m.text); else pending.reject(new Error(friendly(m.message)));
    }
  });
  w.on('error', (err) => { if (worker === w) worker = null; failAll(new Error(friendly(err.message))); });
  w.on('exit', () => { if (worker === w) worker = null; failAll(new Error('Speech engine stopped.')); });
  return w;
}

function friendly(msg) {
  if (/fetch|network|ENOTFOUND|ECONN|getaddrinfo/i.test(msg)) return "Couldn't download the speech model. It needs an internet connection once; try again when you're online.";
  return msg;
}

function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(stop, IDLE_MS);
  idleTimer.unref?.();
}

/** Start loading the model in the background (called when the mic opens, so it is ready by the time you finish speaking). */
function warm() {
  ensureWorker().postMessage({ type: 'warm' });
  touch();
}

function transcribe(audio) {
  const w = ensureWorker();
  touch();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    w.postMessage({ type: 'transcribe', id, audio });
  });
}

function stop() {
  clearTimeout(idleTimer);
  if (worker) { worker.terminate(); worker = null; }
}

module.exports = { warm, transcribe, stop, setStatusHandler: (fn) => { onStatus = fn; } };
