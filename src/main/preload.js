const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('tempo', {
  events: {
    range: (a, b) => ipcRenderer.invoke('events:range', a, b),
    create: (ev) => ipcRenderer.invoke('events:create', ev),
    update: (id, patch, scope) => ipcRenderer.invoke('events:update', id, patch, scope),
    remove: (id, scope) => ipcRenderer.invoke('events:remove', id, scope),
    now: () => ipcRenderer.invoke('events:next'),
    onChanged: on('events:changed'),
  },
  habits: {
    list: () => ipcRenderer.invoke('habits:list'),
    day: (date) => ipcRenderer.invoke('habits:day', date),
    range: (from, to) => ipcRenderer.invoke('habits:range', from, to),
    log: (date, id, patch) => ipcRenderer.invoke('habits:log', date, id, patch),
    save: (habit) => ipcRenderer.invoke('habits:save', habit),
    remove: (id) => ipcRenderer.invoke('habits:remove', id),
    reorder: (ids) => ipcRenderer.invoke('habits:reorder', ids),
    stats: (end, days) => ipcRenderer.invoke('habits:stats', end, days),
    onChanged: on('habits:changed'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  google: {
    state: () => ipcRenderer.invoke('google:state'),
    connect: () => ipcRenderer.invoke('google:connect'),
    disconnect: () => ipcRenderer.invoke('google:disconnect'),
    sync: () => ipcRenderer.invoke('google:sync'),
    ensureRange: (from, to) => ipcRenderer.invoke('google:ensure-range', from, to),
    onState: on('google:state'),
  },
  blocker: {
    state: () => ipcRenderer.invoke('blocker:state'),
    pause: () => ipcRenderer.invoke('blocker:pause'),
    enableSites: () => ipcRenderer.invoke('blocker:enable-sites'),
    onState: on('blocker:state'),
  },
  chat: {
    send: (text) => ipcRenderer.invoke('chat:send', text),
    reset: () => ipcRenderer.invoke('chat:reset'),
    onEvent: on('chat:event'),
  },
  widget: {
    setOpen: (open) => ipcRenderer.send('widget:set-open', open),
    onOpen: on('widget:open'),
    openMain: () => ipcRenderer.send('app:open-main'),
  },
  stt: {
    warm: () => ipcRenderer.send('stt:warm'),
    transcribe: (audio) => ipcRenderer.invoke('stt:transcribe', audio),
    onStatus: on('stt:status'),
  },
  voice: { onHotkey: on('voice:hotkey') },
  alert: {
    onShow: on('alert:show'),
    act: (id, action) => ipcRenderer.send('alert:action', id, action),
  },
  onError: on('app:error'),
});
