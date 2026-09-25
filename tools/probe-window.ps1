# Probe top-level windows: class, style bits, rect, DPI, maximized flag.
# ASCII only on purpose: PowerShell 5.1 reads .ps1 as ANSI when there is no BOM,
# so Chinese comments in this file would corrupt the parser.
# WS_THICKFRAME=0x00040000 lets the user drag edges. WS_MAXIMIZE=0x01000000 means maximized.
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public class WinProbe {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtrW(IntPtr h, int i);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  public struct RECT { public int L, T, R, B; }

  // Pretend the user dragged the window: SWP_NOZORDER=0x0004.
  public static string Move(string hwndStr, string rectStr) {
    long hwnd = long.Parse(hwndStr);
    var p = rectStr.Split(',');
    int x = int.Parse(p[0]), y = int.Parse(p[1]), w = int.Parse(p[2]), h = int.Parse(p[3]);
    bool okMove = SetWindowPos((IntPtr)hwnd, IntPtr.Zero, x, y, w, h, 0x0004);
    RECT r; GetWindowRect((IntPtr)hwnd, out r);
    return string.Format("set={0} now={1},{2} {3}x{4}", okMove, r.L, r.T, r.R - r.L, r.B - r.T);
  }

  // Maximize / restore through WM_SYSCOMMAND: SC_MAXIMIZE=0xF030, SC_RESTORE=0xF120.
  public static string SysCommand(string hwndStr, string what) {
    long hwnd = long.Parse(hwndStr);
    uint cmd = what == "max" ? 0xF030u : 0xF120u;
    SendMessage((IntPtr)hwnd, 0x0112, (IntPtr)cmd, IntPtr.Zero);
    return "sent " + what + " zoom=" + (IsZoomed((IntPtr)hwnd) ? 1 : 0);
  }

  // WM_NCHITTEST: ask Windows what a press at a screen point means for this window.
  // 1=HTCLIENT (goes to the page, no resize), 2=HTCAPTION (drag), 10..17=resize borders.
  public static string HitTest(string hwndStr, string rectStr) {
    long hwnd = long.Parse(hwndStr);
    var parts = rectStr.Split(',');
    int L = int.Parse(parts[0]), T = int.Parse(parts[1]), R = int.Parse(parts[2]), B = int.Parse(parts[3]);
    int cx = (L + R) / 2, cy = (T + B) / 2;
    var pts = new List<string>();
    string[] names = { "left", "right", "top", "bottom", "topleft", "topright", "bottomleft", "bottomright" };
    int[][] at = {
      new[]{L + 1, cy}, new[]{R - 2, cy}, new[]{cx, T + 1}, new[]{cx, B - 2},
      new[]{L + 1, T + 1}, new[]{R - 2, T + 1}, new[]{L + 1, B - 2}, new[]{R - 2, B - 2}
    };
    string[] code = { "HTLEFT", "HTRIGHT", "HTTOP", "HTBOTTOM", "HTTOPLEFT", "HTTOPRIGHT", "HTBOTTOMLEFT", "HTBOTTOMRIGHT" };
    for (int i = 0; i < at.Length; i++) {
      long lp = (long)(((at[i][1] & 0xFFFF) << 16) | (at[i][0] & 0xFFFF));
      IntPtr r = SendMessage((IntPtr)hwnd, 0x0084, IntPtr.Zero, (IntPtr)lp);
      int v = (int)r;
      string label = v == 1 ? "HTCLIENT" : v == 2 ? "HTCAPTION" : (v >= 10 && v <= 17) ? code[v - 10] : ("code=" + v);
      pts.Add(names[i] + "(" + at[i][0] + "," + at[i][1] + ")=" + label);
    }
    // 中间点应该是客户区，用来对照
    long lpMid = (long)(((cy & 0xFFFF) << 16) | (cx & 0xFFFF));
    pts.Add("center=" + (int)SendMessage((IntPtr)hwnd, 0x0084, IntPtr.Zero, (IntPtr)lpMid));
    return string.Join(" ", pts.ToArray());
  }

  public static List<string> Rows = new List<string>();

  public static string Dump(string filter) {
    Rows.Clear();
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256);
      GetClassNameW(h, sb, 256);
      string cls = sb.ToString();
      uint pid; GetWindowThreadProcessId(h, out pid);
      string name = "?";
      try { name = Process.GetProcessById((int)pid).ProcessName; } catch {}
      if (filter != "" && name.ToLower().IndexOf(filter.ToLower()) < 0) return true;
      RECT r; GetWindowRect(h, out r);
      long style = (long)GetWindowLongPtrW(h, -16);
      long ex = (long)GetWindowLongPtrW(h, -20);
      Rows.Add(string.Format(
        "{0}|pid={1}|{2}|{3}|style=0x{4:X8}|ex=0x{5:X8}|rect={6},{7},{8},{9}|size={10}x{11}|dpi={12}|zoom={13}|iconic={14}",
        h, pid, name, cls, style, ex, r.L, r.T, r.R, r.B, r.R - r.L, r.B - r.T,
        GetDpiForWindow(h), IsZoomed(h) ? 1 : 0, IsIconic(h) ? 1 : 0));
      return true;
    }, IntPtr.Zero);
    return string.Join("\n", Rows);
  }
}
'@ -ErrorAction Stop

if ($args.Count -ge 1 -and $args[0] -eq 'hittest') {
  Write-Output ([WinProbe]::HitTest($args[1], $args[2]))
  exit 0
}
if ($args.Count -ge 1 -and $args[0] -eq 'move') {
  Write-Output ([WinProbe]::Move($args[1], $args[2]))
  exit 0
}
if ($args.Count -ge 1 -and $args[0] -eq 'syscmd') {
  Write-Output ([WinProbe]::SysCommand($args[1], $args[2]))
  exit 0
}
if ($args.Count -ge 1) { $f = $args[0] } else { $f = '' }
$out = [WinProbe]::Dump($f)
if ($out -ne '') { $out } else { Write-Output '(no window matched)' }
Write-Output ("SCREEN_METRICS_DPI_UNAWARE={0}x{1}" -f [WinProbe]::GetSystemMetrics(0), [WinProbe]::GetSystemMetrics(1))
