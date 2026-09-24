// Human names for Windows processes, and the list of apps that currently have a window open.
// Used wherever blocking is shown to people, so nobody has to read "steamwebhelper.exe".
const { execFile } = require('child_process');

const KNOWN = {
  'discord.exe': 'Discord', 'steam.exe': 'Steam', 'steamwebhelper.exe': 'Steam', 'epicgameslauncher.exe': 'Epic Games',
  'telegram.exe': 'Telegram', 'whatsapp.exe': 'WhatsApp', 'whatsapp.root.exe': 'WhatsApp', 'slack.exe': 'Slack', 'spotify.exe': 'Spotify',
  'chrome.exe': 'Google Chrome', 'msedge.exe': 'Microsoft Edge', 'firefox.exe': 'Firefox', 'brave.exe': 'Brave',
  'opera.exe': 'Opera', 'code.exe': 'Visual Studio Code', 'teams.exe': 'Microsoft Teams', 'ms-teams.exe': 'Microsoft Teams',
  'riotclientservices.exe': 'Riot Client', 'leagueclient.exe': 'League of Legends', 'valorant.exe': 'Valorant',
  'battle.net.exe': 'Battle.net', 'eadesktop.exe': 'EA app', 'origin.exe': 'Origin', 'ubisoftconnect.exe': 'Ubisoft Connect',
  'minecraft.exe': 'Minecraft', 'javaw.exe': 'Minecraft (Java)', 'robloxplayerbeta.exe': 'Roblox', 'vlc.exe': 'VLC',
  'netflix.exe': 'Netflix', 'primevideo.exe': 'Prime Video', 'obs64.exe': 'OBS Studio', 'notepad.exe': 'Notepad',
};

// Windows' own shell pieces that have windows but are never something you'd block.
const IGNORE = new Set(['explorer.exe', 'applicationframehost.exe', 'textinputhost.exe', 'shellexperiencehost.exe', 'searchhost.exe',
  'startmenuexperiencehost.exe', 'lockapp.exe', 'systemsettings.exe', 'electron.exe', 'tempo.exe', 'taskmgr.exe', 'widgets.exe',
  'powershell.exe', 'windowsterminal.exe', 'cmd.exe', 'conhost.exe', 'openconsole.exe', 'msedgewebview2.exe']);

const learned = new Map(); // exe -> description seen on this PC

function prettify(exe) {
  const base = exe.replace(/\.exe$/i, '');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function friendlyName(exe) {
  const key = String(exe).toLowerCase();
  return KNOWN[key] || learned.get(key) || prettify(key);
}

/** Apps with a visible window right now: [{ exe, name }], sorted by name. */
function running() {
  const script = "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { [pscustomobject]@{ exe = ($_.ProcessName + '.exe'); name = $_.Description } } | ConvertTo-Json -Compress";
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      let rows = [];
      try { rows = JSON.parse(out || '[]'); } catch { return resolve([]); }
      if (!Array.isArray(rows)) rows = [rows];
      const seen = new Map();
      for (const r of rows) {
        const exe = String(r.exe || '').toLowerCase();
        if (!exe || IGNORE.has(exe) || seen.has(exe)) continue;
        if (r.name && !KNOWN[exe]) learned.set(exe, String(r.name).trim());
        seen.set(exe, { exe, name: friendlyName(exe) });
      }
      resolve([...seen.values()].sort((a, b) => a.name.localeCompare(b.name)));
    });
  });
}

module.exports = { friendlyName, running };
