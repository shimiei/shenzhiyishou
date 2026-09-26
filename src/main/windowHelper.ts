/**
 * 程序外面那些窗口：列出来、盯住它的位置、往它上面真点一下。
 *
 * 为什么走 PowerShell 而不是原生模块：这个项目里一个原生插件都没有（装起来要编译工具链，
 * 打包也跟着麻烦），而 Win32 这几件事（读窗口矩形、查某个屏幕点归谁、搬光标点一下）
 * 用 PowerShell 里的 Add-Type 调 user32 就够，脚本还能打开看。代价是每次点都要起一个
 * powershell.exe（两三百毫秒），对"下一手棋"这种节奏完全够用；只有盯位置那件事要常驻，
 * 所以它单独一个只往外打印的进程，不接命令（PowerShell 里非阻塞读标准输入很难写，
 * 而读位置要的是连续，点一下要的是一次，分成两条路各自都简单）。
 *
 * 坐标一律用屏幕物理像素（跟 Win32 一致）；给 Electron 的 setBounds 之前由调用方换算成 DIP。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { desktopCapturer } from 'electron';
import { tmpDir } from './paths';
import type { DesktopWindow } from '../shared/protocol';
import type { PxRect } from '../shared/windowMap';

/**
 * 那段 C# 每个脚本里都要有一份（一个 powershell.exe 一个进程，类不能跨进程共享）。
 *
 * 注意是 C# 5 写法：Windows PowerShell 5.1 的 Add-Type 用老的编译器，
 * 表达式体成员、out var、字符串插值这些新语法会直接编译不过。
 */
const CSHARP = `using System;
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

  public static string Title(IntPtr h) {
    int n = GetWindowTextLength(h);
    if (n <= 0) return "";
    StringBuilder sb = new StringBuilder(n + 2);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }

  // 整窗矩形优先用 DWM 报的可见边界：GetWindowRect 会把窗口外面那圈看不见的调整边框也算进去，
  // 拿它去定位叠层会整体偏几个像素（那圈在屏幕上根本不存在）。
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

const LIST_SCRIPT = `param()
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${CSHARP}
'@
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
const WATCH_SCRIPT = `param([Parameter(Mandatory=$true)][long]$Hwnd, [int]$Interval = 400)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${CSHARP}
'@
$h = [IntPtr]$Hwnd
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
const CLICK_SCRIPT = `param([Parameter(Mandatory=$true)][long]$Hwnd, [long]$Owner = 0, [Parameter(Mandatory=$true)][int]$X, [Parameter(Mandatory=$true)][int]$Y)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
${CSHARP}
'@
function Report($o) { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress)) }
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
Report @{ ok = $true; x = $X; y = $Y; fgBefore = $fgBefore; focusBack = $focusBack }
`;

/**
 * 目标窗口的一条几何记录。跟协议里的 DesktopGeom 一致，只是主进程内部用。
 */
export interface GeomLine {
  hwnd: number;
  win: PxRect;
  client: PxRect;
  iconic: boolean;
  visible: boolean;
  foreground: boolean;
  gone: boolean;
}

export interface ClickOutcome {
  ok: boolean;
  reason?: string;
  focusBack?: boolean;
}

let scriptsDir: string | null = null;

/**
 * 把三个脚本写进运行目录。带 BOM 写：Windows PowerShell 5.1 读没有 BOM 的文件会按
 * 本地代码页解，脚本里的中文注释会变成乱码（Add-Type 那一大段是纯 ASCII 倒还好，
 * 但注释乱码之后这个文件就没法看了）。
 */
function scripts(): { list: string; watch: string; click: string } {
  const dir = path.join(tmpDir(), 'win');
  if (!scriptsDir) {
    mkdirSync(dir, { recursive: true });
    scriptsDir = dir;
  }
  const write = (name: string, body: string): string => {
    const file = path.join(dir, name);
    writeFileSync(file, '\uFEFF' + body, 'utf8');
    return file;
  };
  return {
    list: write('list.ps1', LIST_SCRIPT),
    watch: write('watch.ps1', WATCH_SCRIPT),
    click: write('click.ps1', CLICK_SCRIPT)
  };
}

function powershell(): string {
  const root = process.env.SystemRoot;
  if (root) return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return 'powershell.exe';
}

function run(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = powershell();
    const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], {
      windowsHide: true
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('powershell 超时'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      out += d;
    });
    child.stderr.on('data', (d: string) => {
      err += d;
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const line = out.trim().split(/\r?\n/).filter((l) => l.startsWith('{') || l.startsWith('[')).pop();
      if (!line) {
        reject(new Error(err.trim() || 'powershell 没给出结果'));
        return;
      }
      resolve(line);
    });
  });
}

/**
 * 屏幕上现在有哪些窗口可以盯。抓帧那头由 desktopCapturer 说了算（真正截的是它），
 * 位置与进程名那头由 PowerShell 说了算，两边按窗口句柄对起来；对不上就退回按标题找。
 */
export async function listWindows(): Promise<DesktopWindow[]> {
  const files = scripts();
  let geo: Array<{ hwnd: number; pid: number; proc: string; title: string; iconic: boolean }> = [];
  try {
    geo = JSON.parse(await run(files.list, [], 8000)) as typeof geo;
  } catch {
    geo = [];
  }
  const byHwnd = new Map<number, (typeof geo)[number]>();
  const byTitle = new Map<string, (typeof geo)[number]>();
  for (const g of geo) {
    byHwnd.set(g.hwnd, g);
    if (!byTitle.has(g.title)) byTitle.set(g.title, g);
  }
  let sources: Array<{ id: string; name: string }> = [];
  try {
    const list = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
    sources = list.map((s) => ({ id: s.id, name: s.name }));
  } catch {
    sources = [];
  }
  const out: DesktopWindow[] = [];
  const seen = new Set<number>();
  for (const s of sources) {
    // 窗口源的 id 形如 window:123456:0，中间那截就是窗口句柄
    const m = /^window:(\d+):/.exec(s.id);
    const hwnd = m ? Number(m[1]) : 0;
    const g = (hwnd ? byHwnd.get(hwnd) : undefined) ?? byTitle.get(s.name);
    const proc = g?.proc ?? '';
    // 自己程序的窗口（包括落点提示那一层）不该出现在"盯住哪个窗口"里
    if (g && g.pid === process.pid) continue;
    if (g && seen.has(g.hwnd)) continue;
    if (g) seen.add(g.hwnd);
    out.push({
      id: s.id,
      hwnd: g?.hwnd ?? hwnd,
      title: s.name,
      proc,
      iconic: g?.iconic ?? false
    });
  }
  return out;
}

/** 盯着一个窗口的位置。返回停止函数；窗口关掉时也会自己停（最后报一条 gone）。 */
export function watchWindow(hwnd: number, onGeom: (g: GeomLine) => void, onEnd?: () => void): () => void {
  const files = scripts();
  const ps = powershell();
  let child: ChildProcessWithoutNullStreams | null = null;
  let stopped = false;
  try {
    child = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', files.watch, '-Hwnd', String(hwnd)], {
      windowsHide: true
    });
  } catch {
    onEnd?.();
    return () => undefined;
  }
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    buf += d;
    let idx = buf.indexOf('\n');
    while (idx >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.startsWith('{')) {
        try {
          const g = JSON.parse(line) as GeomLine;
          onGeom(g);
        } catch {
          /* 半行或者坏行，丢掉 */
        }
      }
      idx = buf.indexOf('\n');
    }
  });
  const done = (): void => {
    if (stopped) return;
    stopped = true;
    onEnd?.();
  };
  child.on('close', done);
  child.on('error', done);
  return () => {
    stopped = true;
    child?.kill();
  };
}

/**
 * 往那个窗口的那个点真点一下。owner 是本程序主窗口的句柄：点完把前台还回来，
 * 不然用户的快捷键会打进刚被点过的那个客户端里。
 */
export async function clickAt(hwnd: number, owner: number, x: number, y: number): Promise<ClickOutcome> {
  const files = scripts();
  try {
    const raw = await run(
      files.click,
      ['-Hwnd', String(hwnd), '-Owner', String(owner), '-X', String(Math.round(x)), '-Y', String(Math.round(y))],
      9000
    );
    const res = JSON.parse(raw) as { ok: boolean; reason?: string; focusBack?: boolean };
    return { ok: res.ok, reason: res.reason, focusBack: res.focusBack };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : '点不动' };
  }
}
