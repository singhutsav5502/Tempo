# Tempo

AI calendar for Windows: a floating always-on-top widget with a Claude chatbot, a clean week/day calendar
synced with Google Calendar, and **blocks** that close distracting apps and websites while they're active.

    npm install
    npm start          # first run: node node_modules/electron/install.js if Electron's binary is missing

Hotkeys (changeable in Settings): **Ctrl+Alt+T** opens the chat, **Ctrl+Alt+C** opens the calendar; press again to put it away. The tray icon also toggles the chat. Drag the pill to move it.

## Setup (Settings, gear icon top-right)

1. **Assistant**: by default Tempo runs your installed **Claude Code** in the background, so your Claude login is all
   you need (Sonnet by default, Opus optional). Or switch to an **Anthropic API key** in Settings.
2. **Google Calendar**: in Google Cloud Console enable the *Google Calendar API*, configure the OAuth consent
   screen (add your own account as a test user), create an **OAuth client ID of type "Desktop app"**, paste the
   client ID + secret, click *Connect Google*.
3. **Website blocking**: click *Enable website blocking* once. It shows a single UAC prompt that lets your user edit
   the hosts file; Tempo itself never runs elevated.

## How blocking works

Each calendar entry can have a **block type** (Focus, Meeting, ...). Types define apps (process names such as
`discord.exe`) and websites. While an entry with that type is active:

- Blocked apps that are running get a warning popup with a countdown, then are force-closed. **Allow N min** is the
  soft override; it is limited per block (Settings -> Enforcement; set to 0 for strict mode).
- Blocked sites are written to the hosts file between `# >>> TEMPO BLOCK` markers and removed when the block ends or
  Tempo quits. The widget's banner has a *Pause sites* button (counts against the same override budget).

Known limits: hosts-file blocking doesn't drop tabs that are already loaded, and browsers using a DNS-over-HTTPS
setup that ignores the hosts file can bypass it.

Data lives in `%APPDATA%\tempo\tempo.json`; API key and Google tokens are encrypted with Windows DPAPI.
