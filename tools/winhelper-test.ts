/**
 * 助手脚本自测：把 winScripts 里那几段 PowerShell 真写成文件、真编译、真跑一遍。
 *
 * 为什么要单独一套：那段 C# 与三段脚本是"运行时才交给 PowerShell 编译"的字符串，
 * 类型检查看不见它们。里面写错一个词、少一个括号，其它几套自测照样全绿，
 * 用户点那一手的时候才发现点不动。这里补上这一层。
 *
 * 全程只读，不点、不挪窗口、不碰鼠标：点的那段故意给客户区外的坐标，
 * 让它在守卫上停住；真点那一下归 tools/window-accept.mjs（要有露出来的目标窗口）。
 * 由 tools/winhelper-selftest.mjs 打包后运行。
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLICK_SCRIPT, LIST_SCRIPT, WATCH_SCRIPT, writeWinScripts } from '../src/main/winScripts';

let passed = 0;
let failed = 0;
let pendingCount = 0;

function check(name: string, ok: boolean, extra = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`);
}

/** 要"屏幕上没别的东西在动"才量得准的项：这会儿量不了就记成待验，不判失败。 */
function pending(name: string, why: string): void {
  pendingCount++;
  console.log(`  待验 ${name}  ${why}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 起一段 PowerShell（跟程序里那条路一样：不走 profile、绕过执行策略、只跑文件）。 */
function psFile(file: string, args: string[] = [], timeoutMs = 20000): string {
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs
  }).trim();
}

const dir = mkdtempSync(join(tmpdir(), 'szys-winhelper-'));
const files = writeWinScripts(dir);

console.log('一、把脚本写出来');
check('三个脚本都落到磁盘上', existsSync(files.list) && existsSync(files.watch) && existsSync(files.click), dir);
{
  // 带 BOM 是有原因的：Windows PowerShell 5.1 读没有 BOM 的文件会按本地代码页解，中文注释变乱码
  const heads = [files.list, files.watch, files.click].map((f) => {
    const b = readFileSync(f);
    return b.length > 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  });
  check('三个都带 BOM', heads.every(Boolean), heads.map((v) => (v ? '有' : '没有')).join('/'));
}
check('三段正文都不是空的', [LIST_SCRIPT, WATCH_SCRIPT, CLICK_SCRIPT].every((s) => s.length > 800), `${LIST_SCRIPT.length}/${WATCH_SCRIPT.length}/${CLICK_SCRIPT.length} 字`);
check(
  '每段脚本都先把自己标成 DPI 感知',
  [LIST_SCRIPT, WATCH_SCRIPT, CLICK_SCRIPT].every((s) => s.includes('[SzysWin]::DpiAware()')),
  ''
);
{
  // 守卫必须在鼠标动作之前：顺序错了就等于"没核对就点"，这条用正文顺序盯住。
  // 找的是"调用"而不是 C# 里的定义，所以带上命名空间。
  const outside = CLICK_SCRIPT.indexOf("reason = 'outside'");
  const covered = CLICK_SCRIPT.indexOf("'covered:'");
  const focus = CLICK_SCRIPT.indexOf('[SzysWin]::Focus($h)');
  const move = CLICK_SCRIPT.indexOf('[SzysWin]::MoveTo(');
  const click = CLICK_SCRIPT.indexOf('[SzysWin]::Click()');
  check(
    '点的那段：前台、搬光标、按下都排在两道守卫之后',
    outside > 0 && covered > 0 && focus > covered && move > covered && click > move && move > outside,
    `outside@${outside} covered@${covered} 前台@${focus} 搬光标@${move} 按下@${click}`
  );
  check('点的那段：成功也把 dpi 报回来', /dpi = \$dpi/.test(CLICK_SCRIPT), '');
}

console.log('\n二、列表：能编译、能读懂');
let rows: Array<{ hwnd: number; pid: number; proc: string; title: string }> = [];
{
  const raw = psFile(files.list);
  let ok = false;
  try {
    const parsed = JSON.parse(raw) as typeof rows;
    ok = Array.isArray(parsed);
    rows = Array.isArray(parsed) ? parsed : [];
  } catch {
    ok = false;
  }
  check('C# 编译过了，回来的是一份 JSON 数组', ok, raw.slice(0, 80));
  const shaped = rows.length > 0 && rows.every((r) => Number.isFinite(r.hwnd) && r.hwnd > 0 && Number.isFinite(r.pid) && r.pid > 0 && typeof r.proc === 'string' && typeof r.title === 'string');
  check('每一行都带上句柄、进程号、进程名、标题', shaped, `${rows.length} 行`);
  check('标题都是非空的（空标题的窗口不该进列表）', rows.length > 0 && rows.every((r) => r.title.length > 0), '');
  check('没有重复的句柄', new Set(rows.map((r) => r.hwnd)).size === rows.length, `${new Set(rows.map((r) => r.hwnd)).size}/${rows.length}`);
}
{
  // 自己数一遍可见、有标题、顶层还没被别的窗口盖住的窗口，跟列表对得上的话才算它没漏没多
  const probe = `
Add-Type @'
using System;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Text;
public class N {
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr h);
  private delegate bool EnumProc(IntPtr h, IntPtr p);
  public static int Count() {
    int n = 0;
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      if (!IsWindowVisible(h)) return true;
      if (GetAncestor(h, 2).ToInt64() != h.ToInt64()) return true;
      if (GetWindowTextLength(h) <= 0) return true;
      n++;
      return true;
    }, IntPtr.Zero);
    return n;
  }
}
'@
[N]::Count()
`;
  const mine = Number(execFileSync('powershell', ['-NoProfile', '-Command', probe], { encoding: 'utf8' }).trim());
  check('窗口数跟自己另数一遍对得上（±2，中间有窗口开关就在这个数里）', Math.abs(rows.length - mine) <= 2, `列表 ${rows.length} / 另数 ${mine}`);
  if (rows.length > 0) {
    const pairs = rows.slice(0, 5).map((r) => `${r.hwnd},${r.pid}`).join(';');
    const back = execFileSync('powershell', ['-NoProfile', '-Command', `
Add-Type @'
using System;using System.Runtime.InteropServices;
public class P {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
$out = @()
foreach ($pair in '${pairs}'.Split(';')) {
  $q = $pair.Split(',')
  $owner = 0
  [void][P]::GetWindowThreadProcessId([IntPtr][long]$q[0], [ref]$owner)
  $out += ($owner.ToString() + '=' + $q[1])
}
$out -join ' '
`], { encoding: 'utf8' }).trim();
    const allMatch = back.split(' ').every((s) => s.split('=')[0] === s.split('=')[1]);
    check('前几行报的进程号，拿句柄再问一遍系统也对得上', allMatch, back);
  }
}

console.log('\n三、盯位置：只读跑一会儿');
{
  // 拿桌面窗口当靶子：它一直在、一定可见、没有标题，跟用户的桌面状态无关
  const hwnd = execFileSync('powershell', ['-NoProfile', '-Command', `
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();' -Name D2 -Namespace W
[W.D2]::GetDesktopWindow().ToInt64()
`], { encoding: 'utf8' }).trim();
  const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', files.watch, '-Hwnd', hwnd, '-Interval', '300'], { windowsHide: true });
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    buf += d;
  });
  await sleep(1600);
  child.kill();
  const lines = buf.trim().split('\n').filter(Boolean);
  let g: { hwnd?: number; win?: { x: number; y: number; w: number; h: number }; client?: { w: number; h: number }; dpi?: number } | null = null;
  try {
    g = JSON.parse(lines[lines.length - 1] ?? '') as typeof g;
  } catch {
    g = null;
  }
  check('盯位置那段跑起来并吐出了能解析的行', Boolean(g) && lines.length >= 2, `${lines.length} 行`);
  check('行里带着 DPI 感知，且是每显示器感知（2）', g?.dpi === 2, `dpi=${g?.dpi ?? null}`);
  check(
    '报的窗口矩形是个说得通的数',
    Boolean(g?.win && g.win.w > 0 && g.win.h > 0 && Number.isFinite(g.win.x) && Number.isFinite(g.win.y)),
    JSON.stringify(g?.win ?? null)
  );
  check('报的 hwnd 就是要它盯的那个', Number(g?.hwnd) === Number(hwnd), `${g?.hwnd ?? null} vs ${hwnd}`);
}

console.log('\n四、点的那段：守卫（一个鼠标动作都不该发生）');
{
  const readCursor = (): string =>
    execFileSync('powershell', ['-NoProfile', '-Command', `
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool GetCursorPos(out P p); [StructLayout(LayoutKind.Sequential)] public struct P { public int x; public int y; }' -Name C2 -Namespace W
$p = New-Object W.C2+P
[void][W.C2]::GetCursorPos([ref]$p)
"" + $p.x + "," + $p.y
`], { encoding: 'utf8' }).trim();
  // 这一项量的是"拒点的时候连光标都没被搬动"，也就是个差值。可它没法排除别人在动鼠标：
  // 用户这会儿正用着鼠标、或者远程桌面在推，前后两次读数就必然不一样，看着像功能坏了。
  // 所以先连采三次看它自己稳不稳，稳了才拿它当基准；不稳就把这一项记成待验。
  const taken: string[] = [];
  for (let i = 0; i < 3; i++) {
    if (i > 0) await sleep(150);
    taken.push(readCursor());
  }
  const stillBefore = taken.every((s) => s === taken[0]);
  const cursorBefore = taken[taken.length - 1];
  const desktop = execFileSync('powershell', ['-NoProfile', '-Command', `
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();' -Name D3 -Namespace W
[W.D3]::GetDesktopWindow().ToInt64()
`], { encoding: 'utf8' }).trim();

  const gone = JSON.parse(psFile(files.click, ['-Hwnd', '0', '-Owner', '0', '-X', '100', '-Y', '100'])) as { ok: boolean; reason?: string };
  check('句柄是 0（窗口没了）就报 gone', gone.ok === false && gone.reason === 'gone', JSON.stringify(gone));

  const outside = JSON.parse(psFile(files.click, ['-Hwnd', desktop, '-Owner', '0', '-X', '-5', '-Y', '-5'])) as { ok: boolean; reason?: string };
  check('算出来的点在客户区外面就报 outside', outside.ok === false && outside.reason === 'outside', JSON.stringify(outside));

  const cursorAfter = readCursor();
  await sleep(150);
  const cursorAfter2 = readCursor();
  const stillAfter = cursorAfter === cursorAfter2;
  if (!stillBefore || !stillAfter) {
    pending(
      '两次拒点之后光标一个像素都没动',
      `鼠标这会儿正被别的什么东西动着（${cursorBefore} -> ${cursorAfter} -> ${cursorAfter2}），手停下来再跑一遍`
    );
  } else {
    check('两次拒点之后光标一个像素都没动', cursorAfter === cursorBefore, `${cursorBefore} -> ${cursorAfter}`);
  }
}

rmSync(dir, { recursive: true, force: true });
console.log(`\n助手脚本自测：${passed} 项通过，${failed} 项失败${pendingCount ? `，${pendingCount} 项待验` : ''}`);
process.exit(failed === 0 ? 0 : 1);
