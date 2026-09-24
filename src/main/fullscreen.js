// Tells whether the foreground window covers a whole monitor (a full-screen game or video), so the floating widget
// can step aside. One long-lived PowerShell helper polls the Win32 API and prints 1/0 only when the state changes;
// it runs only while the "hide over full-screen apps" setting is on.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const bus = new EventEmitter();
let child = null;
let fullscreen = false;

const SCRIPT = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Fg {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int cb; public RECT M; public RECT W; public int F; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, int f);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref MI i);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static bool Full() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero || h == GetShellWindow() || h == GetDesktopWindow()) return false;
    var cls = new System.Text.StringBuilder(64); GetClassName(h, cls, 64);
    string c = cls.ToString(); if (c == "WorkerW" || c == "Progman") return false;
    // A maximized window can cover the monitor too (auto-hide taskbar); full-screen apps are never "maximized".
    if (IsZoomed(h)) return false;
    RECT r; if (!GetWindowRect(h, out r)) return false;
    MI mi = new MI(); mi.cb = Marshal.SizeOf(typeof(MI));
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
    const int tol = 2; // rounding on scaled displays
    return r.L <= mi.M.L + tol && r.T <= mi.M.T + tol && r.R >= mi.M.R - tol && r.B >= mi.M.B - tol;
  }
}
"@
# Real pixels: without this, scaled displays (125-200%) hand back rescaled rectangles that don't line up.
[Fg]::SetProcessDPIAware() | Out-Null
$last = ''
while ($true) {
  $v = if ([Fg]::Full()) { '1' } else { '0' }
  if ($v -ne $last) { [Console]::Out.WriteLine($v); [Console]::Out.Flush(); $last = $v }
  Start-Sleep -Milliseconds 1200
}
`;

function start() {
  if (child) return;
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.on('data', (d) => {
    const v = String(d).trim().split(/\s+/).pop();
    const next = v === '1';
    if (next !== fullscreen) { fullscreen = next; bus.emit('change', fullscreen); }
  });
  child.on('exit', () => { child = null; if (fullscreen) { fullscreen = false; bus.emit('change', false); } });
}

function stop() {
  if (child) { child.kill(); child = null; }
  if (fullscreen) { fullscreen = false; bus.emit('change', false); }
}

module.exports = { bus, start, stop, isFullscreen: () => fullscreen };
