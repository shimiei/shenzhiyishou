/**
 * 给 Win32 助手用的那几段脚本：一段 C#（每个脚本里都内联一份）加三段 PowerShell。
 *
 * 单独一个文件、不 import electron，是为了能自测：自测脚本会拿这里的字符串真写成文件、
 * 真编译、真跑一遍。不然 C# 里写错一个词、PowerShell 里少一个括号，类型检查与四套自测
 * 都看不见，要等用户点那一手才知道点不动。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 那段 C# 每个脚本里都要有一份（一个 powershell.exe 一个进程，类不能跨进程共享）。
 *
 * 注意是 C# 5 写法：Windows PowerShell 5.1 的 Add-Type 用老的编译器，
 * 表达式体成员、out var、字符串插值这些新语法会直接编译不过。
 */
export const CSHARP = `using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class SzysWin {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] private static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr extra);
  [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", SetLastError = true)] private static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("shcore.dll")] private static extern int SetProcessDpiAwareness(int a);
  [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
  [DllImport("shcore.dll")] private static extern int GetProcessDpiAwareness(IntPtr p, out int a);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr p);
  private delegate bool EnumProc(IntPtr h, IntPtr p);

  public static bool Alive(IntPtr h) { return IsWindow(h); }
  public static bool Visible(IntPtr h) { return IsWindowVisible(h); }
  public static bool Minimized(IntPtr h) { return IsIconic(h); }
  public static long Foreground() { return GetForegroundWindow().ToInt64(); }
  public static long PidOf(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); return (long)pid; }

  /*
   * 这个进程报出来的坐标是哪一套，全看它的 DPI 感知，而 powershell.exe 默认是"不感知"。
   * 不感知的时候，GetWindowRect、GetCursorPos、SetCursorPos 这一套走的是按缩放折过的虚拟像素，
   * 只有 DWM 报的窗口边界永远是物理像素：屏幕上缩放不是 100% 的时候，这两套差着一个倍数，
   * 混着算出来的点会偏出老远（叠层照物理像素画、鼠标照虚拟像素搬，两边各按各的）。
   * 所以每段脚本一开始就把自己标成每显示器感知，往后全是同一个物理像素。
   * 返回值是设完之后的实际感知，2 才对得上；老系统上退到系统感知（1）也还能用。
   */
  public static int DpiAware() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
    catch {
      try { SetProcessDpiAwareness(2); }
      catch { try { SetProcessDPIAware(); } catch {} }
    }
    int a = -1;
    try { GetProcessDpiAwareness(IntPtr.Zero, out a); } catch { a = -1; }
    return a;
  }

  public static string Title(IntPtr h) {
    int n = GetWindowTextLength(h);
    if (n <= 0) return "";
    StringBuilder sb = new StringBuilder(n + 2);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }

  // 整窗矩形优先用 DWM 报的可见边界：GetWindowRect 会把窗口外面那圈看不见的调整边框也算进去，
  // 拿它去定位叠层会整体偏几个像素（那圈在屏幕上根本不存在）。DWM 报的是物理像素，
  // 跟 DpiAware 之后 user32 那一套一致，所以这两个可以放在一起比。
  public static RECT Frame(IntPtr h) {
    RECT r;
    int ok = DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT)));
    if (ok == 0) return r;
    GetWindowRect(h, out r);
    return r;
  }

  public static RECT ClientOnScreen(IntPtr h) {
    RECT c;
    GetClientRect(h, out c);
    POINT p = new POINT();
    p.X = 0; p.Y = 0;
    ClientToScreen(h, ref p);
    RECT o = new RECT();
    o.Left = p.X; o.Top = p.Y;
    o.Right = p.X + (c.Right - c.Left);
    o.Bottom = p.Y + (c.Bottom - c.Top);
    return o;
  }

  // 拿到前台。AttachThreadInput 是必须的：Windows 只让"正在前台的那个进程"抢前台，
  // 而点完一手之后前台就是目标窗口了，下一手再想拿回来单靠 SetForegroundWindow 会被无视。
  public static void Focus(IntPtr h) {
    if (GetForegroundWindow().ToInt64() == h.ToInt64()) return;
    IntPtr fg = GetForegroundWindow();
    uint mine = GetCurrentThreadId();
    uint other = 0;
    if (fg.ToInt64() != 0) other = GetWindowThreadProcessId(fg, out other);
    if (other != 0) AttachThreadInput(mine, other, true);
    SetForegroundWindow(h);
    if (other != 0) AttachThreadInput(mine, other, false);
  }

  /// 屏幕上这个点最上面那个窗口属于哪个进程（顶层窗口的 pid）。点之前用它确认"这一下真能点着目标"。
  public static long RootPidAt(int x, int y) {
    POINT p = new POINT();
    p.X = x; p.Y = y;
    IntPtr h = WindowFromPoint(p);
    if (h.ToInt64() == 0) return -1;
    IntPtr root = GetAncestor(h, 2);
    if (root.ToInt64() == 0) root = h;
    return PidOf(root);
  }

  public static long CursorX() { POINT p; GetCursorPos(out p); return p.X; }
  public static long CursorY() { POINT p; GetCursorPos(out p); return p.Y; }
  public static void MoveTo(int x, int y) { SetCursorPos(x, y); }
  public static void Click() {
    mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(40);
    mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
  }

  /// 可见的、有标题的顶层窗口，一行一个：句柄 \t 进程号 \t 进程名 \t 标题
  public static string[] List() {
    List<string> rows = new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      if (!IsWindowVisible(h)) return true;
      if (GetAncestor(h, 2).ToInt64() != h.ToInt64()) return true;
      string t = Title(h);
      if (t.Length == 0) return true;
      long pid = PidOf(h);
      string proc = "";
      try { proc = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
      rows.Add(h.ToInt64().ToString() + "\\t" + pid.ToString() + "\\t" + proc + "\\t" + t);
      return true;
    }, IntPtr.Zero);
    return rows.ToArray();
  }
}`;

export const LIST_SCRIPT = `param()
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${CSHARP}
'@
# 这段只列窗口、不算坐标，但规矩一样：每个助手进程先把自己那套坐标空间定下来再干活
[void][SzysWin]::DpiAware()
$rows = @()
foreach ($line in [SzysWin]::List()) {
  $p = $line -split "\`t", 4
  $rows += [ordered]@{
    hwnd = [long]$p[0]
    pid = [int]$p[1]
    proc = $p[2]
    title = $p[3]
    iconic = [SzysWin]::Minimized([IntPtr][long]$p[0])
  }
}
[Console]::Out.WriteLine((ConvertTo-Json -InputObject @($rows) -Compress))
`;

/** 一直盯着一个窗口的位置往外报，直到它没了或者被叫停。 */
export const WATCH_SCRIPT = `param([Parameter(Mandatory=$true)][long]$Hwnd, [int]$Interval = 400)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${CSHARP}
'@
$h = [IntPtr]$Hwnd
$dpi = [SzysWin]::DpiAware()
while ($true) {
  if (-not [SzysWin]::Alive($h)) {
    [Console]::Out.WriteLine('{"hwnd":' + $Hwnd + ',"gone":true}')
    break
  }
  $w = [SzysWin]::Frame($h)
  $c = [SzysWin]::ClientOnScreen($h)
  $o = [ordered]@{
    hwnd = $Hwnd
    win = [ordered]@{ x = $w.Left; y = $w.Top; w = ($w.Right - $w.Left); h = ($w.Bottom - $w.Top) }
    client = [ordered]@{ x = $c.Left; y = $c.Top; w = ($c.Right - $c.Left); h = ($c.Bottom - $c.Top) }
    iconic = [SzysWin]::Minimized($h)
    visible = [SzysWin]::Visible($h)
    foreground = ([SzysWin]::Foreground() -eq $Hwnd)
    dpi = $dpi
    gone = $false
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress))
  Start-Sleep -Milliseconds $Interval
}
`;

/**
 * 真点一下。点的每一步都可能出岔子，所以脚本自己先把关，把"为什么没点"原样报回来：
 * 窗口没了、最小化了、这个点不在客户区里、这个点上最上面的窗口不是它（被别的窗口盖住了）。
 * 最后一条是这里最要紧的一条：坐标是从画面算出来的，可要是有什么东西盖在上面，
 * 这一下点到的就是别的程序，那是真的会闯祸。
 */
export const CLICK_SCRIPT = `param([Parameter(Mandatory=$true)][long]$Hwnd, [long]$Owner = 0, [Parameter(Mandatory=$true)][int]$X, [Parameter(Mandatory=$true)][int]$Y)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${CSHARP}
'@
function Report($o) { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress)) }
$dpi = [SzysWin]::DpiAware()
$h = [IntPtr]$Hwnd
$target = [SzysWin]::PidOf($h)
if (-not [SzysWin]::Alive($h)) { Report @{ ok = $false; reason = 'gone' }; exit 0 }
if ([SzysWin]::Minimized($h)) { Report @{ ok = $false; reason = 'minimized' }; exit 0 }
if (-not [SzysWin]::Visible($h)) { Report @{ ok = $false; reason = 'hidden' }; exit 0 }
$c = [SzysWin]::ClientOnScreen($h)
if ($X -lt $c.Left -or $X -ge $c.Right -or $Y -lt $c.Top -or $Y -ge $c.Bottom) { Report @{ ok = $false; reason = 'outside' }; exit 0 }
$rootPid = [SzysWin]::RootPidAt($X, $Y)
if ($rootPid -ne $target) { Report @{ ok = $false; reason = ('covered:' + $rootPid + ':' + $target) }; exit 0 }
$cx = [SzysWin]::CursorX()
$cy = [SzysWin]::CursorY()
$fgBefore = ([SzysWin]::Foreground() -eq $Hwnd)
[SzysWin]::Focus($h)
Start-Sleep -Milliseconds 50
[SzysWin]::MoveTo($X, $Y)
Start-Sleep -Milliseconds 60
[SzysWin]::Click()
Start-Sleep -Milliseconds 60
[SzysWin]::MoveTo([int]$cx, [int]$cy)
$focusBack = $false
if ($Owner -ne 0) {
  [SzysWin]::Focus([IntPtr]$Owner)
  $focusBack = ([SzysWin]::Foreground() -eq $Owner)
}
Report @{ ok = $true; x = $X; y = $Y; fgBefore = $fgBefore; focusBack = $focusBack; dpi = $dpi }
`;

/** 把三个脚本写进某个目录，带 BOM。 */
export function writeWinScripts(dir: string): { list: string; watch: string; click: string } {
  mkdirSync(dir, { recursive: true });
  const write = (name: string, body: string): string => {
    const file = path.join(dir, name);
    writeFileSync(file, '﻿' + body, 'utf8');
    return file;
  };
  return {
    list: write('list.ps1', LIST_SCRIPT),
    watch: write('watch.ps1', WATCH_SCRIPT),
    click: write('click.ps1', CLICK_SCRIPT)
  };
}
