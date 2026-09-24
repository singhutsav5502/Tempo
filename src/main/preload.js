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
    update: (id, patch) => ipcRenderer.invoke('events:update', id, patch),
    remove: (id) => ipcRenderer.invoke('events:remove', id),
    now: () => ipcRenderer.invoke('events:next'),
    onChanged: on('events:changed'),
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
