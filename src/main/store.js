const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_TYPES = [
  {
    id: 'focus', name: 'Focus', color: '#7c93ff',
    apps: ['discord.exe', 'steam.exe', 'steamwebhelper.exe', 'epicgameslauncher.exe', 'telegram.exe'],
    sites: ['youtube.com', 'reddit.com', 'x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'netflix.com', 'twitch.tv'],
  },
  { id: 'meeting', name: 'Meeting', color: '#f2a65a', apps: ['steam.exe', 'epicgameslauncher.exe'], sites: [] },
  { id: 'break', name: 'Break', color: '#5cc8a1', apps: [], sites: [] },
  { id: 'personal', name: 'Personal', color: '#c58af9', apps: [], sites: [] },
];

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DEFAULT_HABITS = [
  { id: 'gym', name: 'Gym', kind: 'check', days: ALL_DAYS, color: '#f2a65a', category: 'fitness' },
  { id: 'badminton', name: 'Badminton', kind: 'check', days: ALL_DAYS, color: '#5cc8a1', category: 'fitness' },
  { id: 'leetcode', name: 'LeetCode', kind: 'number', target: 1, direction: 'atleast', unit: 'problems', days: ALL_DAYS, color: '#7c93ff', category: 'coding' },
  { id: 'hobby', name: 'Hobby', kind: 'check', days: ALL_DAYS, color: '#c58af9', category: 'hobby' },
  { id: 'calories', name: 'Calories', kind: 'number', target: 1600, direction: 'atmost', unit: 'kcal', days: ALL_DAYS, color: '#ff6b6b', category: 'nutrition' },
].map((h) => ({ ...h, created: today() }));

const DEFAULTS = {
  settings: {
    provider: 'claude-code',
    model: 'claude-opus-5',
    ccModel: 'sonnet',
    googleClientId: '',
    overridesPerBlock: 3,
    overrideMinutes: 5,
    warnSeconds: 10,
    launchAtStartup: false,
    onboarded: false,
    dayStartHour: 0,
    dayEndHour: 24,
    goalsMorning: '09:00',
    goalsEvening: '20:00',
    voiceAutoSend: true,
    hotkeyChat: 'Control+Alt+T',
    hotkeyCalendar: 'Control+Alt+C',
  },
  types: DEFAULT_TYPES,
  habits: DEFAULT_HABITS,
  habitLog: {},
  events: [],
  widget: { x: null, y: null },
  secrets: {},
};

let file;
let data;
let saveTimer = null;

function init() {
  file = path.join(app.getPath('userData'), 'tempo.json');
  let loaded = {};
  try { loaded = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  data = {
    ...DEFAULTS,
    ...loaded,
    settings: { ...DEFAULTS.settings, ...(loaded.settings || {}) },
    widget: { ...DEFAULTS.widget, ...(loaded.widget || {}) },
    secrets: loaded.secrets || {},
  };
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

function flush() {
  clearTimeout(saveTimer);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const get = () => data;

function setSecret(name, value) {
  if (!value) { delete data.secrets[name]; save(); return; }
  data.secrets[name] = safeStorage.isEncryptionAvailable()
    ? { enc: safeStorage.encryptString(value).toString('base64') }
    : { raw: value };
  save();
}

function getSecret(name) {
  const s = data.secrets[name];
  if (!s) return null;
  try { return s.enc ? safeStorage.decryptString(Buffer.from(s.enc, 'base64')) : s.raw; } catch { return null; }
}

const hasSecret = (name) => !!data.secrets[name];

module.exports = { init, get, save, flush, setSecret, getSecret, hasSecret };
