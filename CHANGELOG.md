# Changelog

## v0.2.1 (2026-09-29)

### Fixed
- **Tempo could be running but invisible after sign-in.** It launched correctly at sign-in, but the floating widget
  later disappeared (around graphics-driver resets recorded by Windows) and nothing brought it back, leaving no visible
  sign that Tempo was running. The widget now recovers on its own: a crashed widget page reloads, a closed widget window
  is recreated, and every 20 seconds (and on any monitor change) Tempo checks the widget exists and is on a real screen.
  The calendar page also reloads if it crashes.
- Moving the widget between monitors with different scaling could shrink it; it keeps its size now.

### Added
- A diagnostics log at `%APPDATA%	empo	empo.log` (start-up, window crashes and recoveries, monitor changes;
  capped at 512 KB).

## v0.2.0 (2026-09-25)

A usability release: everything from the v0.1.0 UX audit (`docs/UX_AUDIT.md`) except two small items, plus a startup fix.

### Fixed
- **Start with Windows now works.** The setting was only applied to packaged builds, so running Tempo from source
  (`npm start`) never registered it. It now registers `electron.exe "<tempo folder>" --startup`, re-applies the setting
  on every launch, and starts quietly at sign-in (widget and tray only; the calendar opens with the hotkey).
- Website-blocking permission was reported as enabled when it wasn't (Windows ignores the read-only check), causing
  repeated EPERM errors; it now checks real write access and shows one plain hint.
- The "Blocking" indicator was hidden in the default window size; top-bar buttons could fall off-screen on narrow windows.

### Goals
- Goals panel docked on wide windows and a slim strip (progress ring, tap-to-tick dots) on narrower ones; a Goals
  button with a live count; "Goals" wording everywhere.
- Unlogged past days show as missed in the 14-day grid, matching how streaks count them. Removed goals can be restored.

### Getting started
- Guided first-run setup: assistant (detects Claude Code), goals and targets, Focus apps picked from what's open,
  website blocking permission, optional Google Calendar with a `client_secret.json` loader. Re-run from Settings.
- `?` shows every shortcut; `n` creates an event.

### Calendar
- **Undo** for every change (including the assistant's) via toast, `Ctrl+Z`, or the widget; aware of Google sync.
- Opens at the next thing today, with "earlier / later" markers; short events keep their titles; labelled editor fields
  and a plain "what this blocks" line; window size and position remembered.

### Blocking
- App names instead of process names everywhere; pick apps from what's open or type a program name; websites as chips.
- The warning names the app and says "save your work"; `A` allows, `C` closes.
- Confirmation before deleting a block type that upcoming events use.

### Widget
- Show/hide setting and tray item; optional "hide while a full-screen app is in front" (off by default; ignores
  maximized windows; works on scaled displays).

### Accessibility
- WCAG AA text contrast in both themes, 12px minimum, visible focus rings, reduced-motion support.
- Events, month chips and goal buttons keyboard-operable with spoken labels; dialogs trap and return focus;
  landmarks, live regions, labelled icon buttons.

### Settings
- Four tabs (Connections, Blocking, Goals, General) with a "Saved" confirmation.

### Known limitations
- Still run from source (`npm start`); no installer yet, so notifications may be labelled "Electron".
- No "sending in..." countdown before voice auto-send; chat history isn't kept across restarts.
- Already-open browser tabs keep working until reloaded when a site is blocked; DNS-over-HTTPS can bypass the hosts file.

## v0.1.0 (2026-09-24)

First release of Tempo: an AI calendar for Windows that keeps you on your goals and enforces your focus time.

### Calendar
- Day, Week, Month, Year and Custom (any from/to range up to 14 days) views; configurable visible hours.
- Drag to create, move and resize events; month drag-to-another-day; keyboard shortcuts (`d w m y c`, arrows, `t`).
- Repeating events (daily, weekly on chosen days, monthly, yearly; end date), with "this event / all events" edits.
- Notes on every event.
- Two-way Google Calendar sync (OAuth desktop flow, offline-first cache, on-demand history/future ranges).

### Focus blocks
- Give an event a type (Focus, Meeting, ...). While it is active Tempo closes the apps and blocks the sites that
  type lists. Soft override ("Allow N minutes", limited per block; 0 = strict mode).
- App blocking by process name; website blocking through the Windows hosts file (one-time permission, no admin run).

### Assistant
- Floating always-on-top widget with chat, global hotkeys (`Ctrl+Alt+T` chat + listen, `Ctrl+Alt+C` calendar).
- Runs on your Claude Code login (no API key) or on an Anthropic API key. Can create, move, delete and search
  events, find free time, edit block lists, read and write notes, and log habits.
- Voice input with live, on-device transcription (Whisper); audio never leaves the PC.

### Daily goals
- Customisable daily habit sheet: tick/cross or numeric goals ("at least" / "at most", e.g. calories <= 1600).
- Always-visible goals panel beside the calendar, goals chip on the widget, Today tab, 14-day matrix with streaks.
- Morning and evening goal reminders as Windows notifications.

### Known limitations
- Windows only. Run with `npm start`; there is no installer or auto-start yet.
- Already-open browser tabs keep working when a site is blocked until they reload; DNS-over-HTTPS can bypass the
  hosts file.
- Repeating all-day events and changing the day of a whole series are not supported.
- Notifications and the taskbar label say "Electron" until the app is packaged.
