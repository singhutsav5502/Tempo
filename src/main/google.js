// Google Calendar: OAuth (loopback + PKCE) and two-way sync against the primary calendar.
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const { EventEmitter } = require('events');
const store = require('./store');
const events = require('./events');

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary';
const SYNC_PAST_DAYS = 30;
const SYNC_FUTURE_DAYS = 120;

const status = new EventEmitter();
let state = { connected: false, syncing: false, lastSync: null, error: null };
let syncTimer = null;
let syncing = false;

function setState(patch) {
  state = { ...state, ...patch };
  status.emit('change', state);
}

const getState = () => ({ ...state, connected: store.hasSecret('googleTokens'), hasClient: !!(store.get().settings.googleClientId && store.hasSecret('googleClientSecret')) });

const b64url = (buf) => buf.toString('base64url');

function tokens() {
  const raw = store.getSecret('googleTokens');
  return raw ? JSON.parse(raw) : null;
}
const saveTokens = (t) => store.setSecret('googleTokens', JSON.stringify(t));

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: store.get().settings.googleClientId,
      client_secret: store.getSecret('googleClientSecret') || '',
      ...params,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || `Token request failed (${res.status})`);
  return json;
}

function connect() {
  const clientId = store.get().settings.googleClientId;
  if (!clientId || !store.hasSecret('googleClientSecret')) {
    return Promise.reject(new Error('Add your Google client ID and secret first.'));
  }
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const stateParam = b64url(crypto.randomBytes(16));

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const finish = (ok, msg) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<meta charset="utf-8"><body style="font:16px system-ui;background:#0f1014;color:#e8e9ee;display:grid;place-items:center;height:100vh;margin:0"><div>${ok ? '✓ Tempo is connected. You can close this tab.' : msg}</div></body>`);
        server.close();
      };
      try {
        if (url.searchParams.get('state') !== stateParam) throw new Error('State mismatch');
        if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error'));
        const t = await tokenRequest({
          code: url.searchParams.get('code'),
          code_verifier: verifier,
          grant_type: 'authorization_code',
          redirect_uri: `http://127.0.0.1:${server.address().port}/callback`,
        });
        saveTokens({ access_token: t.access_token, refresh_token: t.refresh_token, expiry: Date.now() + t.expires_in * 1000 - 60000 });
        finish(true);
        setState({ error: null });
        sync();
        resolve();
      } catch (err) {
        finish(false, `Sign-in failed: ${err.message}`);
        reject(err);
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const redirect = `http://127.0.0.1:${server.address().port}/callback`;
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({
        client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
        code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state: stateParam,
      }).toString();
      shell.openExternal(auth.toString());
    });
    setTimeout(() => { server.close(); reject(new Error('Sign-in timed out')); }, 5 * 60 * 1000).unref();
  });
}

function disconnect() {
  store.setSecret('googleTokens', null);
  // Drop the synced copies; a later reconnect re-pulls them. Local-only events stay.
  const s = store.get();
  s.events = s.events.filter((e) => !e.gid);
  events.changed(false);
  setState({ connected: false, lastSync: null, error: null });
}

async function accessToken() {
  let t = tokens();
  if (!t) throw new Error('Not connected to Google');
  if (Date.now() >= t.expiry) {
    const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
    t = { ...t, access_token: r.access_token, expiry: Date.now() + r.expires_in * 1000 - 60000 };
    saveTokens(t);
  }
  return t.access_token;
}

async function api(path, { method = 'GET', body, query } = {}) {
  const url = new URL(API + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  if (res.status === 404 || res.status === 410) return { gone: true };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Google API error ${res.status}`);
  return json;
}

const toGoogle = (e) => ({
  summary: e.title,
  description: e.description || undefined,
  start: e.allDay ? { date: e.start } : { dateTime: e.start },
  end: e.allDay ? { date: e.end } : { dateTime: e.end },
  extendedProperties: { private: { tempoType: e.type || '' } },
});

function fromGoogle(g, existing) {
  const allDay = !!g.start.date;
  return {
    id: existing?.id || crypto.randomUUID(),
    gid: g.id,
    etag: g.etag,
    recurring: !!g.recurringEventId,
    seriesGid: g.recurringEventId || undefined,
    title: g.summary || '(No title)',
    description: g.description || '',
    allDay,
    start: allDay ? g.start.date : new Date(g.start.dateTime).toISOString(),
    end: allDay ? g.end.date : new Date(g.end.dateTime).toISOString(),
    type: events.typeOf(g.extendedProperties?.private?.tempoType) ? g.extendedProperties.private.tempoType : (existing?.type || null),
  };
}

const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Skipped days are stored as dates; Google wants the excluded occurrence's full start (that day at the series' time).
function exdate(sr, day, tz) {
  const t = new Date(sr.start);
  const hms = `${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}`;
  return `EXDATE;TZID=${tz}:${day.replace(/-/g, '')}T${hms}`;
}

function seriesToGoogle(sr) {
  const tz = localTz();
  return {
    summary: sr.title,
    description: sr.description || undefined,
    start: { dateTime: sr.start, timeZone: tz },
    end: { dateTime: sr.end, timeZone: tz },
    recurrence: [events.rruleString(sr.rule), ...(sr.exdates || []).map((day) => exdate(sr, day, tz))],
    extendedProperties: { private: { tempoType: sr.type || '' } },
  };
}

// Whole-series edits/deletes queued while offline, applied to the recurring master event.
async function pushOps() {
  const ops = events.opsList();
  while (ops.length) {
    const op = ops[0];
    if (op.type === 'series-delete') {
      await api(`/events/${op.gid}`, { method: 'DELETE' });
    } else if (op.type === 'series-update') {
      const m = await api(`/events/${op.gid}`);
      if (!m.gone) {
        const body = { summary: op.patch.title, extendedProperties: { private: { ...(m.extendedProperties?.private || {}), tempoType: op.patch.type || '' } } };
        if (op.patch.dStart || op.patch.dEnd) {
          body.start = { dateTime: new Date(Date.parse(m.start.dateTime) + op.patch.dStart).toISOString(), timeZone: m.start.timeZone || localTz() };
          body.end = { dateTime: new Date(Date.parse(m.end.dateTime) + op.patch.dEnd).toISOString(), timeZone: m.end.timeZone || localTz() };
        }
        await api(`/events/${op.gid}`, { method: 'PATCH', body });
      }
    }
    ops.shift();
  }
}

async function pushSeries() {
  const list = events.seriesList();
  for (const sr of [...list]) {
    if (sr.pending === 'create' && !sr.gid) {
      const g = await api('/events', { method: 'POST', body: seriesToGoogle(sr) });
      sr.gid = g.id;
      delete sr.pending;
    }
  }
}

async function push() {
  await pushOps();
  await pushSeries();
  const all = store.get().events;
  for (const e of [...all]) {
    if (!e.pending) continue;
    if (e.pending === 'create') {
      const g = await api('/events', { method: 'POST', body: toGoogle(e) });
      e.gid = g.id; e.etag = g.etag;
    } else if (e.pending === 'update' && e.gid) {
      const g = await api(`/events/${e.gid}`, { method: 'PATCH', body: toGoogle(e) });
      if (g?.gone) { all.splice(all.indexOf(e), 1); continue; }
      e.etag = g.etag;
    } else if (e.pending === 'delete') {
      await api(`/events/${e.gid}`, { method: 'DELETE' });
      all.splice(all.indexOf(e), 1);
      continue;
    }
    delete e.pending;
  }
}

async function pull() {
  const min = Date.now() - SYNC_PAST_DAYS * 86400000;
  const max = Date.now() + SYNC_FUTURE_DAYS * 86400000;
  const remote = [];
  let pageToken;
  do {
    const r = await api('/events', {
      query: { singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', timeMin: new Date(min).toISOString(), timeMax: new Date(max).toISOString(), pageToken },
    });
    remote.push(...(r.items || []).filter((g) => g.status !== 'cancelled' && (g.start?.dateTime || g.start?.date)));
    pageToken = r.nextPageToken;
  } while (pageToken);

  const all = store.get().events;
  const seen = new Set();
  for (const g of remote) {
    seen.add(g.id);
    const cur = all.find((e) => e.gid === g.id);
    if (cur?.pending) continue; // local edit wins until pushed
    const next = fromGoogle(g, cur);
    if (cur) Object.assign(cur, next); else all.push(next);
  }
  // Series that Google now owns come back as expanded instances above; the local definition is no longer needed.
  events.seriesList().splice(0, Infinity, ...events.seriesList().filter((sr) => !sr.gid));
  // Synced events inside the window that no longer exist upstream were deleted in Google.
  store.get().events = all.filter((e) => {
    if (!e.gid || e.pending || seen.has(e.gid)) return true;
    const t = e.allDay ? Date.parse(e.start) : Date.parse(e.end);
    return t < min || t > max;
  });
}

async function sync() {
  if (!store.hasSecret('googleTokens') || syncing) return;
  syncing = true;
  setState({ syncing: true });
  try {
    await push();
    await pull();
    events.changed(false);
    setState({ syncing: false, lastSync: Date.now(), error: null });
  } catch (err) {
    setState({ syncing: false, error: err.message });
  } finally {
    syncing = false;
  }
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 1500);
}

function start() {
  events.setSyncHook(scheduleSync);
  setInterval(sync, 2 * 60 * 1000).unref();
  sync();
}

module.exports = { start, connect, disconnect, sync, getState, status };
