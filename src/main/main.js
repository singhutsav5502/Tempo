const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, globalShortcut, ipcMain, screen, shell, session, Notification } = require('electron');
const path = require('path');
const store = require('./store');
const events = require('./events');
const google = require('./google');
const blocker = require('./blocker');
const ai = require('./ai');
const stt = require('./stt');
const habits = require('./habits');
const reminders = require('./reminders');

const R = (...p) => path.join(__dirname, '..', 'renderer', ...p);
const PRELOAD = path.join(__dirname, 'preload.js');

const WIDGET_COLLAPSED = { w: 400, h: 76 };
const WIDGET_EXPANDED = { w: 400, h: 600 };

let mainWin = null;
let widgetWin = null;
let alertWin = null;
let tray = null;
let widgetOpen = false;
const alertQueue = [];
let alertShowing = null;

app.setAppUserModelId('com.tempo.app'); // Windows needs this for toast notifications
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showMain());

const dark = () => nativeTheme.shouldUseDarkColors;
const overlay = () => ({ color: dark() ? '#0e0f13' : '#f6f6f8', symbolColor: dark() ? '#a3a8b6' : '#4a4d58', height: 44 });
const send = (win, ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
const broadcast = (ch, payload) => [mainWin, widgetWin].forEach((w) => send(w, ch, payload));

// ---- windows --------------------------------------------------------------

function createMain() {
  mainWin = new BrowserWindow({
    width: 1180, height: 780, minWidth: 820, minHeight: 560,
    show: false, backgroundColor: dark() ? '#0e0f13' : '#f6f6f8',
    titleBarStyle: 'hidden', titleBarOverlay: overlay(),
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  mainWin.setMenuBarVisibility(false);
  mainWin.loadFile(R('main', 'index.html'));
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('closed', () => { mainWin = null; });
  mainWin.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function showMain() {
  if (!mainWin) createMain();
  else { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); }
}

function widgetBounds(open) {
  const size = open ? WIDGET_EXPANDED : WIDGET_COLLAPSED;
  const b = widgetWin ? widgetWin.getBounds() : null;
  const wa = screen.getPrimaryDisplay().workArea;
  const saved = store.get().widget;
  // Anchor the bottom-right corner so the panel grows up and to the left of the pill.
  let right = b ? b.x + b.width : (saved.x != null ? saved.x + WIDGET_COLLAPSED.w : wa.x + wa.width - 16);
  let bottom = b ? b.y + b.height : (saved.y != null ? saved.y + WIDGET_COLLAPSED.h : wa.y + wa.height - 12);
  const disp = screen.getDisplayMatching({ x: right - 10, y: bottom - 10, width: 10, height: 10 }).workArea;
  right = Math.min(Math.max(right, disp.x + size.w), disp.x + disp.width);
  bottom = Math.min(Math.max(bottom, disp.y + size.h), disp.y + disp.height);
  return { x: right - size.w, y: bottom - size.h, width: size.w, height: size.h };
}

function createWidget() {
  widgetWin = new BrowserWindow({
    ...widgetBounds(false),
    frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  widgetWin.setAlwaysOnTop(true, 'screen-saver');
  widgetWin.setVisibleOnAllWorkspaces(true);
  widgetWin.loadFile(R('widget', 'index.html'));
  widgetWin.once('ready-to-show', () => widgetWin.showInactive());
  widgetWin.on('moved', () => {
    const b = widgetWin.getBounds();
    const s = store.get().widget;
    // Persist the collapsed-size origin so restarts always come back as the pill.
    s.x = b.x + b.width - WIDGET_COLLAPSED.w;
    s.y = b.y + b.height - WIDGET_COLLAPSED.h;
    store.save();
  });
  widgetWin.on('closed', () => { widgetWin = null; });
}

function setWidgetOpen(open) {
  widgetOpen = open;
  if (!widgetWin) return;
  widgetWin.setBounds(widgetBounds(open));
  send(widgetWin, 'widget:open', open);
  if (open) widgetWin.focus();
}

function toggleWidget() {
  if (!widgetWin) return;
  if (!widgetWin.isVisible()) widgetWin.showInactive();
  setWidgetOpen(!widgetOpen);
}

// ---- soft-override alert window -------------------------------------------

function showNextAlert() {
  if (alertShowing || !alertQueue.length) return;
  alertShowing = alertQueue.shift();
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 380; const h = 176;
  if (!alertWin) {
    alertWin = new BrowserWindow({
      width: w, height: h, x: wa.x + wa.width - w - 16, y: wa.y + 16,
      frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, focusable: true,
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
    });
    alertWin.setAlwaysOnTop(true, 'screen-saver');
    alertWin.loadFile(R('alert', 'index.html'));
    alertWin.on('closed', () => { alertWin = null; alertShowing = null; });
    alertWin.webContents.once('did-finish-load', () => { send(alertWin, 'alert:show', alertShowing); alertWin.showInactive(); });
  } else {
    alertWin.setBounds({ width: w, height: h, x: wa.x + wa.width - w - 16, y: wa.y + 16 });
    send(alertWin, 'alert:show', alertShowing);
    alertWin.showInactive();
  }
}

blocker.bus.on('alert', (a) => { alertQueue.push(a); showNextAlert(); });
blocker.bus.on('alert-close', (id) => {
  const i = alertQueue.findIndex((a) => a.id === id);
  if (i >= 0) alertQueue.splice(i, 1);
  if (alertShowing && alertShowing.id === id) {
    alertShowing = null;
    if (alertQueue.length) showNextAlert(); else if (alertWin) alertWin.hide();
  }
});
blocker.bus.on('state', (s) => broadcast('blocker:state', s));
blocker.bus.on('error', (msg) => broadcast('app:error', msg));

// ---- goal reminders -------------------------------------------------------

function notifyGoals({ title, body }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  n.on('click', () => {
    showMain();
    const open = () => send(mainWin, 'app:open-sheet');
    if (mainWin.webContents.isLoading()) mainWin.webContents.once('did-finish-load', open); else open();
  });
  n.show();
}

// ---- tray -----------------------------------------------------------------

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray.png')));
  tray.setToolTip('Tempo');
  tray.on('click', toggleWidget);
  buildTrayMenu();
}

function buildTrayMenu() {
  const { hotkeyChat, hotkeyCalendar } = store.get().settings;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ask Tempo', accelerator: hotkeyChat || undefined, registerAccelerator: false, click: openChat },
    { label: 'Open calendar', accelerator: hotkeyCalendar || undefined, registerAccelerator: false, click: showMain },
    { type: 'separator' },
    { label: 'Quit Tempo', click: () => app.quit() },
  ]));
}

// ---- global hotkeys ---------------------------------------------------------

function openChat() {
  if (!widgetWin) return;
  if (!widgetWin.isVisible()) widgetWin.showInactive();
  setWidgetOpen(true);
}

// Opens the chat and starts listening; pressing it again while listening stops and sends what was said.
function onChatKey() {
  openChat();
  send(widgetWin, 'voice:hotkey');
}

function onCalendarKey() {
  if (mainWin && mainWin.isVisible() && mainWin.isFocused()) mainWin.minimize(); else showMain();
}

/** (Re)registers both hotkeys from settings. Returns the accelerators that could not be claimed. */
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const { hotkeyChat, hotkeyCalendar } = store.get().settings;
  const failed = [];
  for (const [key, fn] of [[hotkeyChat, onChatKey], [hotkeyCalendar, onCalendarKey]]) {
    if (!key) continue;
    let ok = false;
    try { ok = globalShortcut.register(key, fn); } catch { /* invalid accelerator */ }
    if (!ok) failed.push(key);
  }
  if (tray) buildTrayMenu();
  return failed;
}

// ---- IPC ------------------------------------------------------------------

let hotkeyErrors = [];

function publicSettings() {
  const s = store.get();
  return {
    ...s.settings,
    types: s.types,
    hasAnthropicKey: store.hasSecret('anthropicKey'),
    hasGoogleSecret: store.hasSecret('googleClientSecret'),
    hotkeyErrors: hotkeyErrors,
  };
}

function registerIpc() {
  ipcMain.handle('events:range', (_e, a, b) => events.range(a, b));
  ipcMain.handle('events:create', (_e, ev) => events.create(ev));
  ipcMain.handle('events:update', (_e, id, patch, scope) => events.update(id, patch, scope));
  ipcMain.handle('events:remove', (_e, id, scope) => events.remove(id, scope));
  ipcMain.handle('events:next', () => ({ active: events.activeAt(), next: events.nextAfter() }));

  ipcMain.handle('habits:list', () => habits.list());
  ipcMain.handle('habits:day', (_e, date) => habits.day(date));
  ipcMain.handle('habits:range', (_e, from, to) => habits.range(from, to));
  ipcMain.handle('habits:log', (_e, date, id, patch) => habits.logEntry(date, id, patch));
  ipcMain.handle('habits:save', (_e, habit) => habits.save(habit));
  ipcMain.handle('habits:remove', (_e, id) => habits.remove(id));
  ipcMain.handle('habits:reorder', (_e, ids) => habits.reorder(ids));
  ipcMain.handle('habits:stats', (_e, end, days) => habits.stats(end, days));

  ipcMain.handle('settings:get', publicSettings);
  ipcMain.handle('settings:set', (_e, patch) => {
    const s = store.get();
    const { anthropicKey, googleClientSecret, types, ...rest } = patch;
    Object.assign(s.settings, rest);
    if (anthropicKey !== undefined) store.setSecret('anthropicKey', anthropicKey);
    if (googleClientSecret !== undefined) store.setSecret('googleClientSecret', googleClientSecret);
    if (types) s.types = types;
    store.save();
    if ('provider' in patch || 'ccModel' in patch) ai.reset(); // new backend/model starts a fresh conversation
    if ('hotkeyChat' in patch || 'hotkeyCalendar' in patch) hotkeyErrors = registerHotkeys();
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!s.settings.launchAtStartup });
    events.changed(false); // re-evaluates blocking and refreshes both windows
    return publicSettings();
  });

  ipcMain.handle('google:state', () => google.getState());
  ipcMain.handle('google:connect', async () => { await google.connect(); return google.getState(); });
  ipcMain.handle('google:disconnect', () => { google.disconnect(); return google.getState(); });
  ipcMain.handle('google:sync', () => google.sync());
  ipcMain.handle('google:ensure-range', (_e, from, to) => google.ensureRange(from, to));
  google.status.on('change', () => broadcast('google:state', google.getState()));

  ipcMain.handle('blocker:state', () => blocker.snapshot());
  ipcMain.handle('blocker:pause', () => blocker.pauseSites());
  ipcMain.handle('blocker:enable-sites', async () => { await blocker.enableSiteBlocking(); return blocker.snapshot(); });
  ipcMain.on('alert:action', (_e, id, action) => blocker.resolveAlert(id, action));

  ipcMain.handle('chat:send', async (_e, text) => {
    try { await ai.chat(text, (m) => send(widgetWin, 'chat:event', m)); } catch (err) { send(widgetWin, 'chat:event', { type: 'error', message: err.message }); }
  });
  ipcMain.handle('chat:reset', () => ai.reset());

  ipcMain.on('stt:warm', () => stt.warm());
  ipcMain.handle('stt:transcribe', (_e, audio) => stt.transcribe(audio));
  stt.setStatusHandler((st) => send(widgetWin, 'stt:status', st));

  ipcMain.on('widget:set-open', (_e, open) => setWidgetOpen(open));
  ipcMain.on('app:open-main', () => showMain());
}

events.bus.on('changed', () => broadcast('events:changed'));
habits.bus.on('changed', () => broadcast('habits:changed'));
nativeTheme.on('updated', () => { if (mainWin) mainWin.setTitleBarOverlay(overlay()); });

// ---- lifecycle ------------------------------------------------------------

// Only the widget may use the microphone (for voice commands).
function allowMicForWidget() {
  const isWidget = (wc) => !!wc && !!widgetWin && wc === widgetWin.webContents;
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' && isWidget(wc)));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media' && isWidget(wc));
}

app.whenReady().then(() => {
  store.init();
  registerIpc();
  google.start();
  blocker.start();
  createMain();
  createWidget();
  allowMicForWidget();
  createTray();
  reminders.start(notifyGoals);
  hotkeyErrors = registerHotkeys();
  if (hotkeyErrors.length) {
    mainWin.webContents.once('did-finish-load', () => send(mainWin, 'app:error', `Couldn't claim ${hotkeyErrors.join(' and ')}: another app is using it. Pick a different one in Settings.`));
  }
});

app.on('window-all-closed', (e) => e.preventDefault()); // keep running in the tray
app.on('will-quit', () => { globalShortcut.unregisterAll(); blocker.stop(); reminders.stop(); ai.stop(); stt.stop(); store.flush(); });
