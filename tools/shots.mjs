/**
 * 给 README 拍界面截图，产出 docs/shots/*.png。
 *
 * 要一份开着 CDP 的实例：
 *   node tools/devtest.mjs --remote-debugging-port=9223 --disable-features=CalculateNativeWinOcclusion --disable-gpu
 *   node tools/shots.mjs 9223
 * 装机版副本：SZYS_WIN_PATH=szys-pkg node tools/shots.mjs 9444
 *
 * --disable-gpu 别省：这台机器上走显卡合成时，画面这一路会一直没有帧，
 * Page.captureScreenshot 就永远不返回（窗口明明摆着、页面也答得上话，就是拍不出来），
 * 拍出来的图与显卡无关，软件渲染就够了。脚本开头会把窗口摆出来，
 * 每一张还带超时重试，真拍不出来会明说，不会闷在那里。
 *
 * 画面里的东西都是真跑出来的，不是拼的：演示棋局由引擎自己下（机机对局），
 * 棋谱馆那几盘是真存进去的，实时截取那张是程序真的在往网页上点。
 * 换界面之后重跑一次就能把截图刷新，别让 README 上挂着旧版的样子。
 *
 * 参数：端口、输出目录（默认 docs/shots）。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pickAppPage } from './app-target.mjs';

const PORT = process.argv[2] ?? '9223';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[3] ?? join(HERE, '..', 'docs', 'shots');
const BOARD_PAGE = 'file:///' + join(HERE, 'browser-board-test.html').replace(/\\/g, '/') + '?start=empty';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(pick) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = pick(list);
  if (!target) throw new Error('没找到目标：' + list.map((t) => `${t.type} ${t.url.slice(0, 60)}`).join(' | '));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description ?? ''));
    return r.result.value ?? null;
  };
  const shot = async (file) => {
    // 画面那一路没出帧时，captureScreenshot 会一直挂着不返回，得自己掐表
    const r = await Promise.race([
      send('Page.captureScreenshot', { format: 'png' }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('截图 20 秒没返回，这一路画面没出帧（实例要加 --disable-gpu 再跑）')), 20000)
      )
    ]);
    writeFileSync(file, Buffer.from(r.data, 'base64'));
  };
  return { evalIn, shot, close: () => ws.close() };
}

/**
 * 把窗口恢复出来并摆成指定大小。
 *
 * 不能按 MainWindowTitle 找窗口：Electron 主进程的窗口在 Win32 那边取不到标题
 * （Get-Process 给的 MainWindowTitle 是空串），按标题筛会一个都找不到，
 * 于是窗口一直藏着不显示、截图跟着卡住。这里改成按进程号枚举顶层窗口，
 * 挑面积最大的那个（就是主窗口），ShowWindow + SetWindowPos 摆出来。
 * 用 SW_SHOW 而不是 SW_SHOWNOACTIVATE：这个窗口上后者不生效，窗口照样是不显示。
 */
const resize = (w, h) => {
  const ps = `
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class SZ {
  public delegate bool Proc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Proc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static IntPtr Biggest(int[] want) {
    IntPtr best = IntPtr.Zero; long area = 0;
    EnumWindows((h, l) => {
      int pid; GetWindowThreadProcessId(h, out pid);
      if (Array.IndexOf(want, pid) < 0) return true;
      RECT r; GetWindowRect(h, out r);
      long a = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
      if (a > area) { area = a; best = h; }
      return true;
    }, IntPtr.Zero);
    return best;
  }
}
"@
$f = $env:SZYS_WIN_PATH
if ($f) { $pids = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ('*' + $f + '*') } | ForEach-Object { $_.Id }) }
else { $pids = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*devtest*' } | ForEach-Object { $_.ProcessId }) }
$h = [SZ]::Biggest($pids)
if ($h -ne [IntPtr]::Zero) {
  [void][SZ]::ShowWindow($h, 5)
  [void][SZ]::SetWindowPos($h, [IntPtr]::Zero, 40, 30, ${w}, ${h}, 0x0040)
  Start-Sleep -Milliseconds 300
  $r = New-Object SZ+RECT; [void][SZ]::GetWindowRect($h, [ref]$r)
  "ok hwnd=$h " + ($r.Right - $r.Left) + "x" + ($r.Bottom - $r.Top)
} else { "none" }
`;
  return execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
};

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const app = await connect((list) => pickAppPage(list));
  const { evalIn } = app;
  /** 读状态里的一个字段。返回 JSON，取不到就是 null。 */
  const st = async (expr) =>
    JSON.parse(await evalIn(`const s = window.__szys.getState(); return JSON.stringify((${expr}) ?? null);`));
  let taken = 0;
  let winSize = [1500, 940];
  const shot = async (name, why) => {
    // 提示条会挂在右下角，等它自己飘走再拍
    for (let i = 0; i < 30; i += 1) {
      if (!(await st('s.toasts.length > 0'))) break;
      await sleep(500);
    }
    try {
      await app.shot(join(OUT, name));
    } catch (e) {
      // 窗口要是被藏起来或者显卡那一路没出帧，先把窗口重新摆出来再试一次
      console.warn(`  ${name}：头一下没拍成（${e.message}），把窗口重摆一次再拍`);
      console.log('  ' + resize(winSize[0], winSize[1]));
      await sleep(1500);
      await app.shot(join(OUT, name));
    }
    taken += 1;
    console.log(`  ${name}：${why}`);
  };
  /** 等一句条件成立，等不到就把现场打出来。 */
  const waitFor = async (what, expr, ms = 60000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (await st(expr)) return true;
      if (Date.now() > deadline) throw new Error(`等不到：${what}（${expr}）`);
      await sleep(500);
    }
  };

  console.log('\n准备：窗口摆出来、引擎拉起来、棋盘收拾干净');
  winSize = [1500, 940];
  console.log('  ' + resize(winSize[0], winSize[1]));
  await sleep(800);
  await evalIn(`
    const s = window.__szys.getState();
    s.setLibraryPage(false);
    s.setDialog(null);
    s.setBrowserOpen(false);
    s.setLeftWidth(237);
    s.setRightWidth(430);
    // 手里的棋盘先只留一盘空的
    for (const b of [...s.boards]) if (b.id !== s.activeBoard) s.closeBoardTab(b.id, true);
    s.newGame({ size: 19 });
    return true;
  `);
  await waitFor('界面就绪', 's.ready', 120000);
  await evalIn(`
    await window.__szys.getState().setSettings({
      theme: 'dark',
      coords: true,
      moveNumbers: false,
      lastMoveMark: 'redDot',
      playVisits: 20,
      playTimeMs: 1500,
      reviewVisits: 150
    });
    return true;
  `);
  await waitFor('引擎就绪', '(await window.api.engine.status()).ready', 180000);
  console.log('  引擎就绪');

  /* --- 一、主界面：引擎自己下的一盘棋 + 实时分析 --- */
  console.log('\n一、主界面');
  const mainBoard = await st('s.activeBoard');
  await evalIn(`window.__szys.getState().toggleAiVsAi(); return true;`);
  for (let i = 0; i < 400; i += 1) {
    const moves = await st('s.past.length');
    if (moves >= 30 || (await st("s.game.mode !== 'ai-vs-ai'"))) break;
    await sleep(500);
  }
  await evalIn(`const s = window.__szys.getState(); if (s.game.mode === 'ai-vs-ai') s.toggleAiVsAi(); return true;`);
  await evalIn(`
    const s = window.__szys.getState();
    s.gotoEnd();
    await s.startAnalysis(true);
    return true;
  `);
  await waitFor('分析出第一条结论', 's.analysis && s.analysis.winrate != null', 60000);
  await sleep(2500);
  const shown = await st('({ moves: s.past.length, winrate: s.analysis?.winrate, cands: s.analysis?.lines?.length })');
  const mainMoves = shown.moves;
  console.log(`  盘上 ${shown.moves} 手，胜率 ${(shown.winrate * 100).toFixed(1)}%，候选点 ${shown.cands} 个`);
  await shot('01-main.png', '棋盘、右栏实时分析、左栏工具');

  /* --- 二、复盘：这一局的胜率曲线与逐手清单 --- */
  console.log('\n二、复盘');
  await evalIn(`
    const s = window.__szys.getState();
    await s.stopAnalysis();
    // 在一份副本上接着下到中后盘。20 次访问的对局，开局那几十手谁都下得差不多，
    // 要走到中盘才有真亏的地方，复盘那张图才看得出曲线上的起伏。
    s.duplicateBoard();
    await new Promise((r) => setTimeout(r, 700));
    await s.setSettings({ playTimeMs: 400 });
    s.toggleAiVsAi();
    return true;
  `);
  for (let i = 0; i < 900; i += 1) {
    const moves = await st('s.past.length');
    if (moves >= 90 || (await st("s.game.mode !== 'ai-vs-ai'"))) break;
    await sleep(500);
  }
  console.log(`  这一盘又下了 ${await st('s.past.length')} 手`);
  await evalIn(`
    const s = window.__szys.getState();
    if (s.game.mode === 'ai-vs-ai') s.toggleAiVsAi();
    await s.setSettings({ playTimeMs: 1500 });
    s.setDialog('review');
    await s.startReview();
    return true;
  `);
  await waitFor('复测算完', 's.reviewRunning === false && s.reviewDone > 0', 300000);
  await sleep(1200);
  await evalIn(`
    const all = [...document.querySelectorAll('.seg-item')].find((b) => b.textContent.includes('所有着手'));
    if (all) all.click();
    await new Promise((r) => setTimeout(r, 400));
    // 挑一手亏得明显的看细节：先找恶手，再找失误，都没才退回中间那行
    const rows = [...document.querySelectorAll('.rev-row')];
    const bad = rows.find((r) => r.textContent.includes('恶手'))
      ?? rows.find((r) => r.textContent.includes('失误'))
      ?? rows[Math.floor(rows.length * 0.6)];
    if (bad) bad.click();
    return true;
  `);
  await sleep(900);
  const review = await st('({ done: s.reviewDone, total: s.reviewTotal, moves: s.reviewMoves?.length, blunder: s.reviewSummary?.blunder ?? 0, mistake: s.reviewSummary?.mistake ?? 0, rows: document.querySelectorAll(".rev-row").length })');
  console.log(`  算了 ${review.done}/${review.total} 个局面，评点 ${review.moves} 手（列了 ${review.rows} 行，恶手 ${review.blunder} 处、失误 ${review.mistake} 处）`);
  await shot('04-review.png', '胜率曲线、逐手清单、问题手');
  await evalIn(`window.__szys.getState().setDialog(null); return true;`);

  /* --- 三、实时截取与自动落子：往网页上真点 --- */
  console.log('\n三、实时截取与自动落子');
  // 分屏里要同时摆得下两块棋盘：窗口拉宽一点，两栏收窄，中间那块给浏览器多留些
  winSize = [1760, 980];
  console.log('  ' + resize(winSize[0], winSize[1]));
  await sleep(700);
  await evalIn(`
    const s = window.__szys.getState();
    s.newGame({ size: 19 });
    s.setLeftWidth(214);
    s.setRightWidth(340);
    s.setSplitAxis('x');
    s.setBrowserOpen(true);
    s.setSplit(0.45, 'x');
    return true;
  `);
  await waitFor('内置浏览器挂上', 'Boolean(document.querySelector("webview"))', 30000);
  const captureBoard = await st('s.activeBoard');
  await evalIn(`
    const s = window.__szys.getState();
    s.openBrowserTab(${JSON.stringify(BOARD_PAGE)});
    return true;
  `);
  // 等假网页板真的画出来（页面自己说过 readyState 完了、__state 在），不然前面几手往空处点
  const board = await connect((list) => list.find((t) => t.url.includes('browser-board-test.html')));
  for (let i = 0; i < 60; i += 1) {
    const ok = await board.evalIn(`return typeof window.__state === 'function' && document.readyState === 'complete';`).catch(() => false);
    if (ok) break;
    await sleep(400);
  }
  await sleep(1200);
  await evalIn(`
    const s = window.__szys.getState();
    await s.setLiveCapture(true);
    await s.setAutoPlay(true);
    return true;
  `);
  /*
   * 一手一手来，别开机机对局。机机对局是一手接着一手往下走的，而自动落子点一手要
   * 截一张、点一下、再核几拍，核对没完的时候再来一手只会被"先把上一手办完"挡住，
   * 于是二十几手里能点出去四五手。这里改成：引擎走一手、等它点到网页上、两边对上，
   * 再走下一手，拍出来才是"两边是同盘棋"。
   */
  const wantMoves = 16;
  while ((await st('s.past.length')) < wantMoves) {
    const before = await st('s.past.length');
    await evalIn(`await window.__szys.getState().aiMoveNow(); return true;`);
    for (let i = 0; i < 80 && (await st('s.past.length')) === before; i += 1) await sleep(500);
    if ((await st('s.past.length')) === before) break;
    await waitFor('这一手落到网页上', 's.sync ? /点到网页上|和网页一致/.test(s.sync.text) : false', 45000).catch(() => {});
    await sleep(500);
  }
  await evalIn(`const s = window.__szys.getState(); if (s.game.mode === 'ai-vs-ai') s.toggleAiVsAi(); return true;`);
  // 等它把最后一手也点过去、两边对上
  for (let i = 0; i < 80; i += 1) {
    const text = await st('s.sync ? s.sync.text : ""');
    if (typeof text === 'string' && (text.includes('一致') || text.includes('点到网页上'))) break;
    await sleep(1000);
  }
  await sleep(1500);
  const syncText = await st('s.sync ? s.sync.text : ""');
  const both = await board.evalIn(`return window.__state().stones.length;`).catch(() => null);
  const localStones = await st('s.past.length');
  console.log(`  状态行：${syncText}`);
  console.log(`  网页那边 ${both} 颗子，本地走过 ${localStones} 手`);
  if (both !== localStones) {
    // 两边对不上就说明点出去的手没落全，这张图会写着"一致"却是两盘棋，不能进 README
    throw new Error(`两边对不上（网页 ${both} 颗、本地 ${localStones} 手），这张图不能用。先看状态行说的是什么`);
  }
  await shot('02-live-capture.png', '分屏里网页同上的一盘棋、状态行说两边一致');

  /* --- 四、棋谱馆：把这几盘真存进去，再拍列表 --- */
  console.log('\n四、棋谱馆');
  await evalIn(`
    const s = window.__szys.getState();
    await s.setAutoPlay(false);
    await s.setLiveCapture(false);
    s.setBrowserOpen(false);
    s.activateBoard(${JSON.stringify(mainBoard)});
    await new Promise((r) => setTimeout(r, 800));
    await s.saveToLibrary();
    return true;
  `);
  await sleep(1200);
  await evalIn(`
    const s = window.__szys.getState();
    s.activateBoard(${JSON.stringify(captureBoard)});
    await new Promise((r) => setTimeout(r, 800));
    await s.saveToLibrary();
    return true;
  `);
  await sleep(1200);
  await evalIn(`
    const s = window.__szys.getState();
    s.newGame({ size: 9 });
    await new Promise((r) => setTimeout(r, 400));
    s.toggleAiVsAi();
    return true;
  `);
  for (let i = 0; i < 200; i += 1) {
    const moves = await st('s.past.length');
    if (moves >= 26 || (await st("s.game.mode !== 'ai-vs-ai'"))) break;
    await sleep(500);
  }
  await evalIn(`
    const s = window.__szys.getState();
    if (s.game.mode === 'ai-vs-ai') s.toggleAiVsAi();
    await new Promise((r) => setTimeout(r, 600));
    await s.saveToLibrary();
    return true;
  `);
  await sleep(1500);
  // 标题与标签：存下来的默认标题是"黑 对 白 日期"，这里按存的顺序改成说得清的说法
  const titled = await evalIn(`
    const list = (await window.api.library.list()).records;
    const names = [
      { title: '示例 · 九路快棋', tags: ['示例', '短局'] },
      { title: ${JSON.stringify('示例 · 十九路 ' + localStones + ' 手')}, tags: ['示例', '实时截取'] },
      { title: ${JSON.stringify('示例 · 机机对局 ' + mainMoves + ' 手')}, tags: ['示例', '机机'] }
    ];
    const order = [...list].sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    for (let i = 0; i < names.length && i < order.length; i += 1) {
      const meta = await window.api.library.update(order[i].id, names[i]);
      if (meta && meta.error) throw new Error('改标题失败了：' + JSON.stringify(meta));
    }
    return order.length;
  `);
  console.log(`  馆里 ${titled} 盘，标题与标签都改好了`);
  await evalIn(`
    const s = window.__szys.getState();
    s.setLibraryPage(true);
    await new Promise((r) => setTimeout(r, 1500));
    return true;
  `);
  await sleep(2000);
  const rows = await st('document.querySelectorAll(".lib-row").length');
  await evalIn(`
    const first = document.querySelector('.lib-row');
    if (first) first.click();
    return true;
  `);
  await sleep(1500);
  console.log(`  列表 ${rows} 行`);
  await shot('03-library.png', '列表、缩略图、标签，右栏是选中那盘的预览');
  await evalIn(`window.__szys.getState().setLibraryPage(false); return true;`);
  await sleep(800);

  /* --- 五、设置与引擎、网络 --- */
  console.log('\n五、设置');
  await evalIn(`window.__szys.getState().setDialog('settings'); return true;`);
  await sleep(1200);
  await shot('05-settings.png', '设置：外观、对局、引擎与网络');
  await evalIn(`
    const s = window.__szys.getState();
    s.setDialog(null);
    await new Promise((r) => setTimeout(r, 400));
    s.setDialog('models');
    return true;
  `);
  await sleep(1500);
  await shot('06-models.png', '引擎与网络：随包的小网络与可以在程序里下载的大网络');
  await evalIn(`window.__szys.getState().setDialog(null); return true;`);

  console.log(`\n共拍下 ${taken} 张，都在 ${OUT}`);
  app.close();
};

main().catch((e) => {
  console.error('\n拍截图的时候出错了：' + (e instanceof Error ? e.stack ?? e.message : String(e)));
  process.exit(1);
});
