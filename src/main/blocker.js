// Enforces the profile of whatever block is currently on the calendar:
//  - apps: watched by process name; warn, then close (soft override = "allow N minutes")
//  - sites: written into the Windows hosts file between marker lines
const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const events = require('./events');

const HOSTS = process.env.TEMPO_HOSTS_FILE || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
const BEGIN = '# >>> TEMPO BLOCK (managed automatically, do not edit) >>>';
const END = '# <<< TEMPO BLOCK <<<';
const TICK_MS = 3000;

const bus = new EventEmitter();
let timer = null;
let sig = '';
let overridesUsed = 0;
const allow = new Map();      // key -> expiry ms. keys: app:<exe>, sites
const pending = new Map();    // exe -> { id, exe, deadline, blockName }
let appliedSites = '';
let current = { active: [], apps: [], sites: [] };
let alertSeq = 0;

const cfg = () => store.get().settings;
const overridesLeft = () => Math.max(0, cfg().overridesPerBlock - overridesUsed);

function compute(now) {
  const active = events.activeAt(now).filter((e) => e.type);
  const apps = new Map();
  const sites = new Set();
  for (const e of active) {
    const t = events.typeOf(e.type);
    if (!t) continue;
    for (const a of t.apps) apps.set(a.toLowerCase(), t.name);
    for (const s of t.sites) sites.add(s.toLowerCase());
  }
  return { active, apps, sites };
}

function isAllowed(key, now) {
  const exp = allow.get(key);
  if (exp && exp > now) return true;
  if (exp) allow.delete(key);
  return false;
}

function listProcesses() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve(new Set());
      const names = new Set();
      for (const line of out.split('\n')) {
        const m = /^"([^"]+)"/.exec(line);
        if (m) names.add(m[1].toLowerCase());
      }
      resolve(names);
    });
  });
}

const kill = (exe) => execFile('taskkill', ['/IM', exe, '/F'], { windowsHide: true }, () => {});

// ---- hosts file -----------------------------------------------------------

function hostsWritable() {
  try { fs.accessSync(HOSTS, fs.constants.W_OK); return true; } catch { return false; }
}

function hostLines(sites) {
  const out = [];
  for (const raw of sites) {
    const d = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    if (!d) continue;
    for (const h of [d, `www.${d}`, `m.${d}`]) out.push(`0.0.0.0 ${h}`, `:: ${h}`);
  }
  return out;
}

function applyHosts(sites) {
  const key = [...sites].sort().join(',');
  if (key === appliedSites) return;
  if (!hostsWritable()) return;
  try {
    const body = fs.readFileSync(HOSTS, 'utf8');
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\r?\\n?${esc(BEGIN)}[\\s\\S]*?${esc(END)}\\r?\\n?`, 'g');
    let next = body.replace(re, '\r\n').replace(/\s+$/, '\r\n');
    if (sites.size) next += `${BEGIN}\r\n${hostLines(sites).join('\r\n')}\r\n${END}\r\n`;
    if (next !== body) {
      fs.writeFileSync(HOSTS, next);
      execFile('ipconfig', ['/flushdns'], { windowsHide: true }, () => {});
    }
    appliedSites = key;
  } catch (err) {
    bus.emit('error', `Could not update hosts file: ${err.message}`);
  }
}

// One-time UAC prompt that lets the current user edit the hosts file, so Tempo itself can run unelevated.
function enableSiteBlocking() {
  return new Promise((resolve, reject) => {
    const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
    const inner = `icacls "${HOSTS}" /grant "${user}:(M)"`;
    const encoded = Buffer.from(inner, 'utf16le').toString('base64');
    execFile('powershell.exe', [
      '-NoProfile', '-Command',
      `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`,
    ], { windowsHide: true }, (err) => {
      if (err) return reject(new Error('Permission prompt was cancelled.'));
      if (!hostsWritable()) return reject(new Error('Permission was not granted.'));
      tick();
      resolve();
    });
  });
}

// ---- main loop ------------------------------------------------------------

function snapshot(now = Date.now()) {
  return {
    active: current.active.map((e) => ({ id: e.id, title: e.title, type: e.type, end: e.end })),
    apps: [...current.apps.keys()],
    sites: [...current.sites],
    overridesLeft: overridesLeft(),
    strict: cfg().overridesPerBlock === 0,
    pausedUntil: (allow.get('sites') || 0) > now ? allow.get('sites') : null,
    sitesReady: hostsWritable(),
    overrideMinutes: cfg().overrideMinutes,
    now,
  };
}

async function tick() {
  const now = Date.now();
  const { active, apps, sites } = compute(now);
  current = { active, apps, sites };

  const nextSig = JSON.stringify([active.map((e) => e.id).sort(), [...apps.keys()].sort(), [...sites].sort()]);
  if (nextSig !== sig) {
    sig = nextSig;
    overridesUsed = 0;
    allow.clear();
    for (const p of pending.values()) bus.emit('alert-close', p.id);
    pending.clear();
    bus.emit('state', snapshot(now));
  }

  applyHosts(isAllowed('sites', now) ? new Set() : sites);

  if (apps.size) {
    const running = await listProcesses();
    for (const [exe, blockName] of apps) {
      if (!running.has(exe)) {
        const p = pending.get(exe);
        if (p) { bus.emit('alert-close', p.id); pending.delete(exe); }
        continue;
      }
      if (isAllowed(`app:${exe}`, now)) continue;
      let p = pending.get(exe);
      if (!p) {
        p = { id: ++alertSeq, exe, blockName, deadline: now + cfg().warnSeconds * 1000 };
        pending.set(exe, p);
        bus.emit('alert', alertPayload(p));
      } else if (now >= p.deadline) {
        kill(exe);
        pending.delete(exe);
        bus.emit('alert-close', p.id);
      }
    }
  }
  // Drop alerts whose block has ended.
  for (const [exe, p] of pending) {
    if (!apps.has(exe)) { bus.emit('alert-close', p.id); pending.delete(exe); }
  }
}

function alertPayload(p) {
  return {
    id: p.id,
    exe: p.exe,
    label: p.exe.replace(/\.exe$/i, ''),
    blockName: p.blockName,
    deadline: p.deadline,
    canOverride: overridesLeft() > 0,
    overridesLeft: overridesLeft(),
    minutes: cfg().overrideMinutes,
  };
}

function resolveAlert(id, action) {
  const p = [...pending.values()].find((x) => x.id === id);
  if (!p) return;
  if (action === 'allow' && overridesLeft() > 0) {
    overridesUsed++;
    allow.set(`app:${p.exe}`, Date.now() + cfg().overrideMinutes * 60000);
    pending.delete(p.exe);
    bus.emit('alert-close', p.id);
    bus.emit('state', snapshot());
  } else {
    kill(p.exe);
    pending.delete(p.exe);
    bus.emit('alert-close', p.id);
  }
}

// Soft override for websites: lift all site blocking for N minutes.
function pauseSites() {
  if (overridesLeft() <= 0) return false;
  overridesUsed++;
  allow.set('sites', Date.now() + cfg().overrideMinutes * 60000);
  tick();
  bus.emit('state', snapshot());
  return true;
}

function start() {
  tick();
  timer = setInterval(tick, TICK_MS);
  events.bus.on('changed', tick);
}

function stop() {
  clearInterval(timer);
  applyHosts(new Set());
}

module.exports = { bus, start, stop, snapshot, resolveAlert, pauseSites, enableSiteBlocking, hostsWritable, applyHosts };
