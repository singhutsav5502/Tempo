# Tempo

AI calendar for Windows: a floating always-on-top widget with a Claude chatbot, a clean week/day calendar
synced with Google Calendar, and **blocks** that close distracting apps and websites while they're active.

    npm install
    npm start          # first run: node node_modules/electron/install.js if Electron's binary is missing

Hotkeys (changeable in Settings): **Ctrl+Alt+T** opens the chat and starts **listening**, **Ctrl+Alt+C** toggles the calendar. The tray icon toggles the chat. Drag the pill to move it.

## Setup (Settings, gear icon top-right)

1. **Assistant**: by default Tempo runs your installed **Claude Code** in the background, so your Claude login is all
   you need (Sonnet by default, Opus optional). Or switch to an **Anthropic API key** in Settings.
2. **Google Calendar**: in Google Cloud Console enable the *Google Calendar API*, configure the OAuth consent
   screen (add your own account as a test user), create an **OAuth client ID of type "Desktop app"**, paste the
   client ID + secret, click *Connect Google*.
3. **Website blocking**: click *Enable website blocking* once. It shows a single UAC prompt that lets your user edit
   the hosts file; Tempo itself never runs elevated.

## Repeating events

Pick **Repeat** when creating an event (every day / weekday / week / month / year, optional end date), or just say
"gym every Monday, Wednesday and Friday at 6pm". Editing or deleting one occurrence asks whether it applies to
**this event** or **all events**; "all" can change title, block type and time of day (not the day). Series sync to
Google Calendar as real recurring events, and repeating events created in Google show up with a ↻ marker.

## Voice

Press **Ctrl+Alt+T** (or the mic button) and just talk: your words appear in the chat box live as you speak, and are
sent when you stop (or press the hotkey again to send immediately; Esc cancels). Speech is recognised **locally** with
Whisper (`whisper-base.en`), so audio never leaves your PC. The model (~80 MB) downloads once on first use.
Turn auto-send off in Settings to review the text before sending.

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
