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

## Daily sheet (habits)

Press `s` (or **Open full sheet** in the goals panel) for the full goals sheet. It ships with Gym, Badminton, LeetCode,
Hobby and Calories; **Edit goals** lets you rename, recolor, reorder, add and remove them.

- **Tick / cross** habits are simply done or not.
- **Number** habits have a goal: *at least* (LeetCode ≥ 1 problem) or *at most* (Calories ≤ 1600 kcal). Type the
  actual number (or use −/+) and the tick or cross is worked out for you. You can still override it by hand; click
  the button again to go back to automatic.
- Each habit can be limited to certain weekdays (rest days don't count), has a category (fitness, coding, hobby,
  nutrition, ...) and takes an optional note (✎).
- The sheet shows a 14-day matrix with streaks, best streak and 30-day completion. Use ◀ ▶ to fill in past days.
- The widget has a **Today** tab for one-click check-offs, and the chat understands it: *"did gym, ate 1450 calories,
  skipped badminton"* or *"start tracking reading, at least 20 pages a day"*.

Goals are kept in front of you on purpose:

- A **Goals** panel is docked beside the calendar on wide windows (1360px and up) and becomes a slim strip (progress
  ring + one dot per goal) on narrower ones; the **Goals** button or `g` collapses/expands it, and the button always shows
  today's count.
  The icon carries a dot while goals are open.
- The floating widget's pill shows a goals chip (`3/5`, green when done); click it to jump to the Today tab.
- **Reminders**: a morning list of today's goals (default 9:00) and an evening notice if some are still open
  (default 20:00). Times are in Settings; clear one to turn it off. Clicking a notification opens the sheet.

Data lives in `tempo.json` as `habits` (definitions) and `habitLog` (`date -> habitId -> {status, value, note}`);
removing a habit only archives it, so history stays available for analytics.

## Views

**Day, Week, Month, Year and Custom** (top bar, or press `d` `w` `m` `y` `c`; `←` `→` navigate, `t` jumps to today).

- **Month**: every event as a chip with its time; "+N more" opens that day; drag a chip to another day to move it.
- **Year**: twelve mini-months shaded by how busy each day is; click a day or a month name to drill in.
- **Custom**: pick any from/to dates (up to 14 days) shown as a time grid.
- **Visible hours**: Settings → General trims the time grid, e.g. 8 AM to 8 PM.

Month and year can look far beyond the default sync window, so Tempo pulls extra ranges from Google on demand
(up to 3 years either side of today).

## Event notes

Every event has a **Notes** box (agenda, links, anything). Notes sync with Google Calendar's description field
(Google's rich text is shown as plain text, and notes you haven't edited are never overwritten). Events with notes
show a ≡ marker, tall ones preview the first line, and the assistant can read and write them
(*"add the agenda to my design review"*).

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
