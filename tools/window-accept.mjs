/**
 * 固定窗口那一档的验收：认盘、挪窗、遮挡、落点提示对位、真点落子。
 *
 * 假客户端（tools/fake-client）由这个脚本自己起：独立进程、独立窗口，里面装着
 * tools/browser-board-test.html 那张假棋盘页。它自报几何、自报收到的点击，
 * 拿它跟应用读到的 Win32 读数、认出来的棋盘互相对照。
 *
 * 有一类验收必须有"看得见的目标窗口"才能做：窗口被完全挡住的时候，系统给抓帧的
 * 就是一张黑图（Windows 那边就是这脾气），认盘和真点都无从验起。所以脚本先探一下
 * 目标窗口在最上层是不是它自己：不是的话，这几项标成"待验"而不是判失败，
 * 等屏幕空出来（用户那个窗口不在最前面）再跑一遍就能全绿。
 *
 * 用法：node tools/window-accept.mjs [port]
 *   默认端口 9223（开发实例）。先起实例：
 *     node tools/devtest.mjs --remote-debugging-port=9223 --disable-features=CalculateNativeWinOcclusion
 */
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.argv[2] ?? '9223';
const FAKE_PORT = process.env.FAKE_CDP_PORT ?? '9333';
const SHOT_DIR = process.env.LOCALAPPDATA + '\\Temp';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

const results = [];
let failed = 0;
let pendingCount = 0;
/** 这一轮有没有动过验收实例自己的窗口（动过就在收尾时收回去） */
let touchedAppWindow = false;

function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  if (!ok) failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? '  ' + extra : ''}`);
}

/** 需要"目标窗口露在外面"才能验的项：屏幕被别的窗口占着的时候记成待验，不算失败。 */
function pending(name, why) {
  pendingCount++;
  results.push({ name, ok: true, extra: '待验：' + why });
  console.log(`  待验 ${name}  ${why}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 每次起 PowerShell 都在前面加这段：把自己标成每显示器 DPI 感知。
 *
 * powershell.exe 默认"不感知 DPI"，缩放不是 100% 的机器上，GetWindowRect、SetWindowPos、
 * GetCursorPos 这一套给的是按缩放折过的虚拟像素。应用那边（windowHelper）已经标过了，
 * 驱动这边要是按默认来，两边量的就不是同一套坐标，±2 像素的对照会平白无故地失败，
 * 真点也会点歪。坐标一律按物理像素量，跟应用一致。
 */
const DPI_PRELUDE = `
Add-Type @'
using System;using System.Runtime.InteropServices;
public class D {
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int a);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static void Go() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
    catch { try { SetProcessDpiAwareness(2); } catch { try { SetProcessDPIAware(); } catch {} } }
  }
}
'@
[D]::Go()
`;

/** 跑一段 PowerShell，回它吐出来的字。 */
function ps(script) {
  return execFileSync('powershell', ['-NoProfile', '-Command', DPI_PRELUDE + script], { encoding: 'utf8' }).trim();
}

/** 屏幕上那一点最上面是哪个窗口，属于哪个进程。 */
function rootPidAt(x, y) {
  const out = ps(`
Add-Type @'
using System;using System.Runtime.InteropServices;
public class Q {
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(T pt);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct T { public int x; public int y; }
}
'@
$p = New-Object Q+T
$p.x = ${Math.round(x)}
$p.y = ${Math.round(y)}
$h = [Q]::GetAncestor([Q]::WindowFromPoint($p), 2)
$owner = 0
[void][Q]::GetWindowThreadProcessId($h, [ref]$owner)
$name = (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName
$owner.ToString() + ' ' + $name
`);
  const [pid, proc] = out.split(' ');
  return { pid: Number(pid), proc: proc ?? '' };
}

/** 鼠标现在停在哪儿。 */
function cursorPos() {
  const out = ps(`
Add-Type @'
using System;using System.Runtime.InteropServices;
public class C {
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);
  [StructLayout(LayoutKind.Sequential)] public struct P { public int x; public int y; }
}
'@
$p = New-Object C+P
[void][C]::GetCursorPos([ref]$p)
"" + $p.x + " " + $p.y
`);
  const [x, y] = out.split(' ').map(Number);
  return { x, y };
}

/** 前台窗口是谁。 */
function foreground() {
  const out = ps(`
Add-Type @'
using System;using System.Runtime.InteropServices;
public class F {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
$h = [F]::GetForegroundWindow()
$owner = 0
[void][F]::GetWindowThreadProcessId($h, [ref]$owner)
$owner.ToString() + ' ' + $h.ToInt64()
`);
  const [pid, hwnd] = out.split(' ');
  return { pid: Number(pid), hwnd: Number(hwnd) };
}

/** 某个窗口句柄属于哪个进程。 */
function pidOfWindow(hwnd) {
  const out = ps(`
Add-Type @'
using System;using System.Runtime.InteropServices;
public class P {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
$owner = 0
[void][P]::GetWindowThreadProcessId([IntPtr]${Math.round(hwnd)}, [ref]$owner)
$owner.ToString()
`);
  return Number(out);
}

/** 把某个进程的主窗口摆到指定位置。用来看住自己那个实例的窗口，不碰别人的。 */
function placeWindow(matchCmdLine, x, y, w, h) {
  const out = ps(`
Add-Type @'
using System;using System.Runtime.InteropServices;
public class S {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
}
'@
$p = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${matchCmdLine}*' } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1
if (-not $p) { 'none' } else {
  # 最小化的窗口要先把 ShowWindow(h,9) 调出来，不然后面那步只改"恢复后"的位置，窗口还是缩着的
  [void][S]::ShowWindow($p.MainWindowHandle, 9)
  [void][S]::SetWindowPos($p.MainWindowHandle, [IntPtr]::Zero, ${x}, ${y}, ${w}, ${h}, 0x0040)
  'ok ' + $p.Id
}
`);
  return out;
}

/** 按 pid 读出那个窗口的窗口矩形与客户区矩形（物理像素）。跟应用那套读数互相对照用。 */
function winGeom(pid) {
  const out = ps(`
Add-Type @'
using System;using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref P p);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L,T,Rr,B; }
  [StructLayout(LayoutKind.Sequential)] public struct P { public int x,y; }
}
'@
$p = Get-Process -Id ${Math.round(pid)} -ErrorAction SilentlyContinue
if (-not $p -or $p.MainWindowHandle -eq 0) { 'none' } else {
  $h = $p.MainWindowHandle
  $r = New-Object W+R
  [void][W]::GetWindowRect($h, [ref]$r)
  $c = New-Object W+R
  [void][W]::GetClientRect($h, [ref]$c)
  $pt = New-Object W+P
  [void][W]::ClientToScreen($h, [ref]$pt)
  "" + $r.L + " " + $r.T + " " + ($r.Rr-$r.L) + " " + ($r.B-$r.T) + " " + $pt.x + " " + $pt.y + " " + $c.Rr + " " + $c.B
}
`);
  if (out === 'none') return null;
  const [x, y, w, h, cx, cy, cw, ch] = out.split(' ').map(Number);
  return { win: { x, y, w, h }, client: { x: cx, y: cy, w: cw, h: ch } };
}

/** 把一个窗口提到最上面。只有明确说了"目标窗口得露出来"才会用到（见下面那面旗）。 */
function raiseWindowByPid(pid) {
  return ps(`
Add-Type @'
using System;using System.Runtime.InteropServices;
public class R2 {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
}
'@
$p = Get-Process -Id ${Math.round(pid)} -ErrorAction SilentlyContinue
if (-not $p -or $p.MainWindowHandle -eq 0) { 'none' } else {
  # 不提位置、不改大小、不抢前台，只换 z 序：插到 HWND_TOP（0x0053 = 不改位置/不改大小/不激活/显示）
  if ([R2]::SetWindowPos($p.MainWindowHandle, [IntPtr]::Zero, 0, 0, 0, 0, 0x0053)) { 'ok' } else { 'fail' }
}
`);
}

/** 摆一个窗口（按 pid 找它的主窗口）。假客户端收不到标准输入，所以挪窗、改大小都走 Win32。 */
function moveWindowByPid(pid, x, y, w, h) {
  return ps(`
Add-Type @'
using System;using System.Runtime.InteropServices;
public class S {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
}
'@
$p = Get-Process -Id ${Math.round(pid)} -ErrorAction SilentlyContinue
if (-not $p -or $p.MainWindowHandle -eq 0) { 'none' } else {
  # 0x0044 = 不改 Z 序 + 显示：挪窗不该把目标窗口提到用户那个窗口上面去
  [void][S]::SetWindowPos($p.MainWindowHandle, [IntPtr]::Zero, ${Math.round(x)}, ${Math.round(y)}, ${Math.round(w)}, ${Math.round(h)}, 0x0044)
  'ok'
}
`);
}

/** 连一个 CDP 目标。 */
async function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const { res, rej } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      waiting.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const evalIn = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description ?? ''));
    }
    return r.result.value ?? null;
  };
  return { evalIn, close: () => ws.close() };
}

async function targets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

async function findAppPage() {
  const list = await targets(PORT);
  const page = list.find((t) => t.type === 'page' && t.url.startsWith('file:') && t.url.includes('index.html'));
  if (!page) {
    throw new Error('没找到应用页面，先起实例：node tools/devtest.mjs --remote-debugging-port=' + PORT);
  }
  return page;
}

/** 假客户端：起进程、读它吐的 JSON 行、通过标准输入给它下命令。 */
async function startFake() {
  const child = spawn(
    electron,
    [
      `--remote-debugging-port=${FAKE_PORT}`,
      // 被挡住的时候也要接着画，不然抓到的就是黑图（验收经常在别的窗口后面跑）
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows',
      join('tools', 'fake-client', 'main.js'),
      '--quiet',
      '--title=SZYS假客户端',
      '--bounds=1280,200,900,780',
      '--query=start=empty&bare=1&px=560'
    ],
    { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const lines = [];
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += String(d);
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        lines.push(JSON.parse(line));
      } catch {
        lines.push({ raw: line });
      }
    }
  });
  child.stderr.on('data', () => {});
  const waitFor = async (type, ms = 15000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = lines.filter((l) => l.type === type).pop();
      if (hit) return hit;
      if (Date.now() > deadline) return null;
      await sleep(200);
    }
  };
  const ready = await waitFor('ready');
  if (!ready) throw new Error('假客户端没起来');
  await waitFor('loaded');
  await sleep(900);
  // 它自己吐出来的那些行留一份在 lines 里，几何与挪窗另走 Win32（它收不到标准输入）
  return { pid: ready.pid, lines, kill: () => execFileSync('taskkill', ['/PID', String(ready.pid), '/T', '/F'], { stdio: 'ignore' }) };
}

const main = async () => {
  const app = await connect(await findAppPage());
  console.log('\n准备');
  /*
   * 先把上一轮留下的"记住那个窗口"清干净再开始。
   * 上一次这里踩过坑：设置里还记着用户自己那个窗口，脚本照着记忆把它接了回来，
   * 后面"点一下看看"就点到用户窗口里去了。所以动手前一律归零，只从列表里现选，
   * 而且选完要按窗口句柄核对是不是假客户端那个进程，不是就整个停下。
   */
  await app.evalIn(`
    const s = window.__szys.getState();
    await s.setLiveCapture(false);
    await s.setAutoPlay(false);
    await s.setWindowCrop(null);
    await window.api.desktop.clearMark();
    await window.api.desktop.pick(null);
    await s.setCaptureSource('browser');
    await s.setSettings({ captureWindowTitle: '', captureWindowProc: '' });
    return true;
  `);
  await sleep(500);

  const fake = await startFake();
  console.log(`  假客户端 pid=${fake.pid}`);
  await sleep(1200);

  // 界面切到"固定窗口"那一档，再从列表里把假客户端选上（走真界面）
  const switched = await app.evalIn(`
    const btn = [...document.querySelectorAll('.browser-presets .seg-item')].find((b) => b.textContent.trim() === '固定窗口');
    if (!btn) return { ok: false, why: '没找到"固定窗口"那一档' };
    btn.click();
    return { ok: true };
  `);
  check('界面上切到"固定窗口"这一档', switched.ok === true, switched.why ?? '');
  await sleep(600);

  const openList = await app.evalIn(`
    const b = [...document.querySelectorAll('.win-src-bar button')].find((x) => x.textContent.includes('窗口…'));
    if (!b) return { ok: false, why: '没找到选窗口那个按钮' };
    b.click();
    return { ok: true, label: b.textContent.trim() };
  `);
  check('点开选窗口那个按钮能列出窗口', openList.ok === true, openList.why ?? openList.label ?? '');
  await sleep(900);

  const listed = await app.evalIn(`
    const items = [...document.querySelectorAll('.win-src-item')].map((x) => x.textContent);
    return { n: items.length, items };
  `);
  check('列表里有窗口', listed.n >= 1, `列了 ${listed.n} 个`);

  const picked = await app.evalIn(`
    const items = [...document.querySelectorAll('.win-src-item')];
    const hit = items.find((x) => x.textContent.includes('SZYS假客户端') || x.textContent.includes('识别测试页'));
    if (!hit) return { ok: false, why: '列表里没看到假客户端' };
    hit.click();
    return { ok: true, text: hit.textContent, all: items.map((x) => x.textContent) };
  `);
  check('从列表里选中假客户端', picked.ok === true, picked.why ?? picked.text ?? '');
  await sleep(2600);

  const base = await app.evalIn(`
    const s = window.__szys.getState();
    const v = document.querySelector('.win-src-video');
    return {
      src: s.settings.captureSource,
      title: s.settings.captureWindowTitle,
      proc: s.settings.captureWindowProc,
      geom: s.desktopGeom,
      video: v ? { w: v.videoWidth, h: v.videoHeight, ready: v.readyState } : null
    };
  `);
  const win = base.geom ?? {};
  /*
   * 最要紧的一道闸：盯住的必须是假客户端那个进程。
   * 万一选错了窗口（记忆串了、列表点了别的），后面的"认一下""标一下""点一下"
   * 就可能落到用户自己开着的程序上，那是不行的，这里直接停。
   */
  const targetPid = win.hwnd ? pidOfWindow(win.hwnd) : 0;
  if (targetPid !== fake.pid) {
    console.error(`\n停：盯住的窗口属于进程 ${targetPid}，不是假客户端（${fake.pid}），后面的验证一项都不做`);
    await app.evalIn(`
      const s = window.__szys.getState();
      await s.setWindowCrop(null);
      await s.setLiveCapture(false);
      await s.setAutoPlay(false);
      await window.api.desktop.clearMark();
      await window.api.desktop.pick(null);
      await s.setCaptureSource('browser');
      await s.setSettings({ captureWindowTitle: '', captureWindowProc: '' });
      return true;
    `);
    app.close();
    fake.kill();
    process.exit(3);
  }

  // 目标窗口的几何：这边另取一次 Win32 读数，跟应用读到的那份对照
  const self = winGeom(fake.pid);
  console.log(`  窗口：应用读到 ${JSON.stringify(win.win ?? null)} 客户端区 ${JSON.stringify(win.client ?? null)}`);
  console.log(`  窗口：这边另读一遍 ${JSON.stringify(self?.win ?? null)} 客户端区 ${JSON.stringify(self?.client ?? null)}`);

  /*
   * 真点那几项要目标窗口露在最上面。默认不碰 z 序：假客户端自己起的时候是"不打扰"的摆法
   * （压到最底层），屏幕上有别人的窗口时，这几项就标成待验。要是屏幕空着、或者明知道
   * 自己这台机器上没人在用，设 SZYS_TARGET_ON_TOP=1，这一步会把假客户端提到最上面，
   * 让那几项真跑起来。提的是我起的那个假客户端，不是别人的窗口。
   */
  const wantOnTop = process.env.SZYS_TARGET_ON_TOP === '1';
  if (wantOnTop) {
    const raised = raiseWindowByPid(fake.pid);
    await sleep(600);
    console.log(`  按 SZYS_TARGET_ON_TOP=1 把假客户端提到最上面：${raised}`);
  }

  check('画面来源是"固定窗口"', base.src === 'window', `actual=${base.src}`);
  check('记住的是那个窗口', base.proc !== '' || base.title !== '', `proc=${base.proc} title=${base.title}`);
  check('读到目标窗口的位置', Boolean(win.win), JSON.stringify(win.win ?? null));
  check(
    '读窗口那个助手进程是每显示器 DPI 感知（坐标才不会混两套）',
    win.dpi === 2,
    `dpi=${win.dpi ?? null}`
  );
  check(
    '客户区跟另读的那份对得上（±2 像素）',
    Boolean(win.client && self?.client) &&
      Math.abs(win.client.x - self.client.x) <= 2 &&
      Math.abs(win.client.y - self.client.y) <= 2 &&
      Math.abs(win.client.w - self.client.w) <= 2 &&
      Math.abs(win.client.h - self.client.h) <= 2,
    `应用 ${JSON.stringify(win.client ?? null)} vs 另读 ${JSON.stringify(self?.client ?? null)}`
  );
  check('视频流起来了', Boolean(base.video && base.video.w > 0), JSON.stringify(base.video ?? null));

  // 目标窗口露没露在最上面：真点那一项需要它露着，认盘那几项不需要
  const probe = win.client
    ? { x: win.client.x + win.client.w / 2, y: win.client.y + win.client.h / 2 }
    : { x: 1700, y: 590 };
  const top = rootPidAt(probe.x, probe.y);
  const visible = top.pid === fake.pid;
  console.log(`  目标窗口在 (${Math.round(probe.x)},${Math.round(probe.y)}) 最上面的是 ${top.proc}(${top.pid})，${visible ? '看得见' : '被挡住了'}`);

  console.log('\n一、认盘');
  const fx = await connect((await targets(FAKE_PORT)).find((t) => t.type === 'page'));
  const pageState = () => fx.evalIn(`return window.__state();`);
  const before = await pageState();
  check('假棋盘页报的是 19 路空盘', before.size === 19 && before.moveNo === 0, JSON.stringify({ size: before.size, moveNo: before.moveNo }));

  // 先看一眼抓到的是不是有内容的画面：被完全挡住的目标窗口，有的程序会停画，
  // 那时候抓到的是一张黑图。黑图认不出来是正常的，不算这一档的毛病，但要如实记下来。
  const frameInfo = await app.evalIn(`
    const v = document.querySelector('.win-src-video');
    if (!v || !v.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const g = c.getContext('2d');
    g.drawImage(v, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4000) {
      sum += d[i];
      n++;
    }
    return { w: c.width, h: c.height, avg: Math.round(sum / n) };
  `);
  const hasPicture = Boolean(frameInfo && frameInfo.avg > 20);
  check('抓到的是有内容的画面，不是一张黑图', hasPicture, JSON.stringify(frameInfo ?? null));

  const shot1 = await app.evalIn(`
    const s = window.__szys.getState();
    const ok = await s.checkSource(true);
    const st = window.__szys.getState();
    return { ok, sync: st.sync ? st.sync.text : null, shot: st.sourceShot };
  `);
  if (hasPicture) {
    check('认得出窗口里的棋盘', shot1.ok === true, shot1.sync ?? '');
    check('认出来的路数跟页面自报的一致', shot1.shot?.size === 19, `认到 ${shot1.shot?.size ?? null} 路`);
    check('空盘上没有多余的子', shot1.shot?.stones?.filter((v) => v !== 0).length === 0, `数到 ${shot1.shot?.stones?.filter((v) => v !== 0).length ?? null} 颗`);
  } else {
    check('黑图不硬认：认盘如实报失败', shot1.ok === false, `ok=${shot1.ok} ${shot1.sync ?? ''}`);
    pending('认得出窗口里的棋盘并对上路数', '目标窗口被挡住之后自己停了绘制，抓到的是一张黑图');
    pending('认出来的路数跟页面自报的一致', '同上');
    pending('空盘上没有多余的子', '同上');
  }

  console.log('\n二、挪窗与改大小');
  if (hasPicture) {
    moveWindowByPid(fake.pid, 900, 260, 780, 700);
    await sleep(1600);
    const moved = await app.evalIn(`
      const g = window.__szys.getState().desktopGeom;
      return g ? { client: g.client, win: g.win } : null;
    `);
    const selfMoved = winGeom(fake.pid);
    check(
      '窗口挪了、改了大小，读到的客户区跟着变（±3 像素）',
      Boolean(moved?.client && selfMoved?.client) &&
        Math.abs(moved.client.x - selfMoved.client.x) <= 3 &&
        Math.abs(moved.client.y - selfMoved.client.y) <= 3 &&
        Math.abs(moved.client.w - selfMoved.client.w) <= 3 &&
        Math.abs(moved.client.h - selfMoved.client.h) <= 3,
      `应用 ${JSON.stringify(moved?.client ?? null)} vs 另读 ${JSON.stringify(selfMoved?.client ?? null)}`
    );
    const shot2 = await app.evalIn(`
      const s = window.__szys.getState();
      const ok = await s.checkSource(true);
      const st = window.__szys.getState();
      return { ok, size: st.sourceShot?.size ?? null };
    `);
    check('窗口挪了、改了大小还认得出 19 路', shot2.ok === true && shot2.size === 19, JSON.stringify(shot2));
    moveWindowByPid(fake.pid, 1280, 200, 900, 780);
    await sleep(1600);
  } else {
    pending('窗口挪了、改了大小，读到的客户区跟着变', '抓到的是一张黑图');
    pending('窗口挪了、改了大小还认得出 19 路', '同上');
  }

  console.log('\n三、框选之后按框认');
  if (hasPicture) {
    const cropShot = await app.evalIn(`
      const s = window.__szys.getState();
      await s.setWindowCrop({ x: 0.12, y: 0.1, w: 0.76, h: 0.8 });
      const ok = await s.checkSource(true);
      const st = window.__szys.getState();
      return { ok, size: st.sourceShot?.size ?? null, crop: st.settings.captureCrop };
    `);
    check('框住棋盘那一块之后还认得出 19 路', cropShot.ok === true && cropShot.size === 19, JSON.stringify(cropShot));
    const cleared = await app.evalIn(`
      const s = window.__szys.getState();
      await s.setWindowCrop(null);
      return window.__szys.getState().settings.captureCrop;
    `);
    check('清除框选之后设置里不留东西', cleared === null, JSON.stringify(cleared));
  } else {
    pending('框住棋盘那一块之后还认得出 19 路', '抓到的是一张黑图');
  }

  console.log('\n四、被挡住的点不点');
  {
    // 目标窗口没露在最上面的时候，"那一点上盖着别的窗口"这条守卫会拦下来。
    // 真点那一项要等屏幕空出来，这一项恰恰相反：专挑被挡着的时候验。
    const cursorBefore = cursorPos();
    const clicksBefore = (await pageState()).clicks.length;
    const point = shot1.shot?.grid
      ? { x: shot1.shot.grid.originX + 9 * shot1.shot.grid.step, y: shot1.shot.grid.originY + 9 * shot1.shot.grid.step }
      : { x: (win.client?.w ?? 800) / 2, y: (win.client?.h ?? 700) / 2 };
    const frame = shot1.shot?.frame ?? { width: win.win?.w ?? 886, height: win.win?.h ?? 772 };
    const attempted = await app.evalIn(`
      const r = await window.api.desktop.clickAt({ frame: ${JSON.stringify(frame)}, point: ${JSON.stringify(point)} });
      return r;
    `);
    if (!visible) {
      check('目标被挡住时拒点，理由说得清', attempted.ok === false && /盖着别的窗口/.test(attempted.reason ?? ''), JSON.stringify(attempted.reason ?? attempted));
      check('拒点的时候页面没收到任何点击', (await pageState()).clicks.length === clicksBefore, `${clicksBefore} -> ${(await pageState()).clicks.length}`);
      const cursorAfter = cursorPos();
      check('拒点不动鼠标', cursorBefore.x === cursorAfter.x && cursorBefore.y === cursorAfter.y, `${JSON.stringify(cursorBefore)} -> ${JSON.stringify(cursorAfter)}`);
    } else {
      // 屏幕空着的时候，先自己盖上去，再点，一样要拦下来
      touchedAppWindow = true;
      placeWindow('devtest', 1280, 200, 900, 780);
      await sleep(900);
      const covered = await app.evalIn(`
        const r = await window.api.desktop.clickAt({ frame: ${JSON.stringify(frame)}, point: ${JSON.stringify(point)} });
        return r;
      `);
      check('自己的窗口盖上去之后也拒点', covered.ok === false && /盖着别的窗口/.test(covered.reason ?? ''), JSON.stringify(covered.reason ?? covered));
      check('拒点的时候页面没收到任何点击', (await pageState()).clicks.length === clicksBefore, `-> ${(await pageState()).clicks.length}`);
      const cur2 = cursorPos();
      check('拒点不动鼠标', cursorBefore.x === cur2.x && cursorBefore.y === cur2.y, `${JSON.stringify(cursorBefore)} -> ${JSON.stringify(cur2)}`);
      touchedAppWindow = true;
      placeWindow('devtest', 30, 40, 1180, 900);
      await sleep(900);
    }

    // 画面比跟窗口对不上（窗口刚改过大小、画面还没跟上）时也要拦下来：
    // 这时候按比例算出来的点会偏，点出去才发现就晚了
    const squashed = await app.evalIn(`
      const r = await window.api.desktop.clickAt({ frame: { width: 400, height: 400 }, point: { x: 200, y: 200 } });
      return r;
    `);
    check(
      '画面比跟窗口对不上时不点（窗口刚改过大小）',
      squashed.ok === false && /改了大小/.test(squashed.reason ?? ''),
      JSON.stringify(squashed.reason ?? squashed)
    );
  }

  console.log('\n五、落点提示对位');
  {
    const before = await app.evalIn(`
      const s = window.__szys.getState();
      const shot = s.sourceShot;
      const frame = shot ? shot.frame : { width: 886, height: 772 };
      const pt = shot ? { x: shot.grid.originX + 9 * shot.grid.step, y: shot.grid.originY + 9 * shot.grid.step } : { x: 400, y: 380 };
      const ok = await window.api.desktop.mark({ frame, point: pt, color: 1, ttlMs: 800 });
      return { ok, frame, pt };
    `);
    await sleep(400);
    const ov = await overlayState();
    if (ov) {
      const wantX = before.frame.width > 0 ? before.pt.x / before.frame.width : 0;
      const wantY = before.frame.height > 0 ? before.pt.y / before.frame.height : 0;
      check('叠层画出来了', before.ok === true, `mark=${before.ok}`);
      check(
        '环画在算出来的那个比例上（±0.01）',
        Boolean(ov.mark) && Math.abs(ov.mark.fx - wantX) <= 0.01 && Math.abs(ov.mark.fy - wantY) <= 0.01,
        `叠层 ${JSON.stringify(ov.mark)} 期望 ${wantX.toFixed(3)},${wantY.toFixed(3)}`
      );
      check('叠层的画布铺满目标那块矩形（比例对得上）', ov.w > 0 && ov.h > 0, `${ov.w}x${ov.h}`);
      if (visible) {
        // 屏幕上真取一次色：环的位置应该是亮的（白圈），旁边不是
        const rect = win.client ?? { x: 1280, y: 230, w: 880, h: 740 };
        const sx = Math.round(rect.x + wantX * rect.w);
        const sy = Math.round(rect.y + wantY * rect.h);
        const pixel = ps(`
Add-Type @'
using System;using System.Runtime.InteropServices;
public class G {
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr h);
  [DllImport("gdi32.dll")] public static extern uint GetPixel(IntPtr dc, int x, int y);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);
}
'@
$dc = [G]::GetDC([IntPtr]::Zero)
$c = [G]::GetPixel($dc, ${sx}, ${sy})
[void][G]::ReleaseDC([IntPtr]::Zero, $dc)
"" + ($c -band 0xFFFFFF)
`);
        const value = Number(pixel);
        const r = value & 0xff;
        const g = (value >> 8) & 0xff;
        const b = (value >> 16) & 0xff;
        writeFileSync(`${SHOT_DIR}\\szys-window-mark.txt`, `(${sx},${sy}) rgb(${r},${g},${b})\n`);
        // 白环：三个通道都高；深色底：都很低。判"亮"就够，具体颜色不苛求
        check('屏幕上那一点真的画着环（像素够亮）', r > 180 && g > 180 && b > 180, `(${sx},${sy}) rgb(${r},${g},${b})`);
      } else {
        pending('屏幕上那一点真画着环', '目标窗口被挡住，取色取不到环');
      }
    } else {
      check('叠层画出来了', before.ok === true, '连不上叠层那一页');
    }
    await app.evalIn(`await window.api.desktop.clearMark(); return true;`);
    await sleep(300);
    const cleared = await overlayState();
    check('清除之后环就没了', !cleared || cleared.mark === null, JSON.stringify(cleared?.mark ?? null));
  }

  console.log('\n六、真点落子');
  if (!visible) {
    pending('真的点进那个窗口，页面收到点击', '目标窗口被别的窗口全挡住，系统不允许往被挡住的窗口点（守卫也拦）');
    pending('点到的交叉点跟想点的一致', '同上');
    pending('点完光标回原位', '同上');
    pending('点完焦点还回程序窗口', '同上');
  } else {
    const grid = shot1.shot?.grid;
    const frame = shot1.shot?.frame;
    if (!grid || !frame) {
      check('真点落子', false, '没认到棋盘，取不到交叉点');
    } else {
      const target = { x: grid.originX + 9 * grid.step, y: grid.originY + 9 * grid.step };
      const clicksBefore = (await pageState()).clicks.length;
      const cursorBefore = cursorPos();
      const fgBefore = foreground();
      const clicked = await app.evalIn(`
        const r = await window.api.desktop.clickAt({ frame: ${JSON.stringify(frame)}, point: ${JSON.stringify(target)} });
        return r;
      `);
      await sleep(600);
      const after = await pageState();
      const last = after.clicks[after.clicks.length - 1];
      check('真的点进那个窗口了', clicked.ok === true, JSON.stringify(clicked.reason ?? clicked));
      check('页面收到了点击', after.clicks.length === clicksBefore + 1, `${clicksBefore} -> ${after.clicks.length}`);
      check('点到的交叉点就是天元 K10', last?.vertex === 'K10', `页面认成 ${last?.vertex ?? null}（画面像素 ${last?.px ?? '?'},${last?.py ?? '?'}）`);
      check('页面上真的落了子', after.stones.some((s) => s.v === 'K10' && s.c === 'b'), JSON.stringify(after.stones));
      const cursorAfter = cursorPos();
      check(
        '点完光标回原位（±2 像素）',
        Math.abs(cursorBefore.x - cursorAfter.x) <= 2 && Math.abs(cursorBefore.y - cursorAfter.y) <= 2,
        `${JSON.stringify(cursorBefore)} -> ${JSON.stringify(cursorAfter)}`
      );
      check('点完焦点还回目标/程序窗口，没留在别处', clicked.focusBack === true, `focusBack=${clicked.focusBack}`);
      const fgAfter = foreground();
      check(
        '前台没有被丢在第三方窗口上',
        fgAfter.pid === fgBefore.pid || fgAfter.hwnd === fgBefore.hwnd || fgAfter.pid === fake.pid,
        `${JSON.stringify(fgBefore)} -> ${JSON.stringify(fgAfter)}`
      );
    }
  }

  // 收尾：把这一档收干净，别让后面接手的人以为程序在盯着什么窗口
  await app.evalIn(`
    const s = window.__szys.getState();
    await s.setWindowCrop(null);
    await s.setLiveCapture(false);
    await s.setAutoPlay(false);
    await window.api.desktop.clearMark();
    await window.api.desktop.pick(null);
    await s.setCaptureSource('browser');
    await s.setSettings({ captureWindowTitle: '', captureWindowProc: '' });
    return true;
  `);
  // 这一轮把验收实例的窗口摆出来过，就把它收回最小化，桌面恢复原样
  if (touchedAppWindow) {
    ps(`
Add-Type @'
using System;using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
'@
$p = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*devtest*' } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1
if ($p) { [void][M]::ShowWindow($p.MainWindowHandle, 6) }
'ok'
`);
  }
  app.close();
  fx.close();
  fake.kill();

  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项${pendingCount ? `，待验 ${pendingCount} 项` : ''}`);
  if (failed) {
    console.log('失败清单：');
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}${r.extra ? '  ' + r.extra : ''}`);
  }
  process.exit(failed ? 1 : 0);
};

/** 叠层那一页现在画着什么。它是个独立窗口，CDP 里能单独连上。 */
async function overlayState() {
  const list = await targets(PORT);
  const ov = list.find((t) => t.url.includes('overlay.html'));
  if (!ov) return null;
  const conn = await connect(ov);
  const st = await conn.evalIn('return window.__state();');
  conn.close();
  return st;
}

main().catch((e) => {
  console.error('驱动出错：', e.message);
  process.exit(2);
});
