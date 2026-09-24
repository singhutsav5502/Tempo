# Changelog

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
