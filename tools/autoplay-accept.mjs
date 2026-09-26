/**
 * 自动落子与"AI 固定执一方"的验收：开发实例（9223）跑。
 *
 * 三件事，都是用户报的或点名要的：
 *   一、自动落子完成之后焦点跑到网页里去了（程序自己失焦，接下来打字都不进程序）；
 *   二、网页挪了位置（多一条横幅、手数栏）之后自动落子认不出棋盘，于是"下对了却说没点上"，
 *       而且一句话不说就把开关关了；
 *   三、机机对下旁边要能固定让 AI 执黑或执白。
 *
 * 头两件靠一个本地假网页板（tools/browser-board-test.html）量真像素：真点、真截、真认。
 *
 * 用法：node tools/autoplay-accept.mjs [port]
 * 装机版副本：SZYS_WIN_PATH=szys-pkg 传一份程序目录片段，用来挑窗口（别动用户自己开着的那份）。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pickAppPage } from './app-target.mjs';

const PORT = process.argv[2] ?? '9223';
const SHOT_DIR = process.env.LOCALAPPDATA + '\\Temp';
const PAGE_URL = 'file:///C:/Users/30109/Desktop/shenzhiyishou/tools/browser-board-test.html';
const results = [];
let failed = 0;

function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  if (!ok) failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? '  ' + extra : ''}`);
}

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
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(r.data, 'base64'));
  };
  return { evalIn, shot, close: () => ws.close() };
}

const resize = (w, h) => {
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
}
"@
$f = $env:SZYS_WIN_PATH
if ($f) { $p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' -and $_.Path -like ('*' + $f + '*') } | Select-Object -First 1 }
else { $p = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*devtest*' } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1 }
if ($p) { [W]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [W]::SetWindowPos($p.MainWindowHandle, [IntPtr]::Zero, 40, 30, ${w}, ${h}, 0x0040) | Out-Null; "ok:" + $p.Id } else { "none" }
`;
  return execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
};

const main = async () => {
  const app = await connect((list) => pickAppPage(list));
  const clickBtn = (text) => `(() => {
    const b = [...document.querySelectorAll('.toolbar button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
    if (!b) return false;
    b.click();
    return true;
  })()`;
  const syncText = `(() => { const s = window.__szys.getState().sync; return s ? s.text : null; })()`;
  const focusNow = `(() => {
    const a = document.activeElement;
    return { has: document.hasFocus(), active: a ? a.tagName : null };
  })()`;

  /** 等状态行冒出一句新话（比对上一条，不认旧的） */
  async function waitNew(prev, ms = 25000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const t = await app.evalIn(`return ${syncText}`);
      if (t && t !== prev) return t;
      if (Date.now() > deadline) return t;
      await sleep(250);
    }
  }

  console.log('\n准备：把窗口摆出来、分屏、打开假网页板、两边都清到空盘');
  {
    // 窗口被最小化时截网页会一直不返回，先把它恢复出来并摆成默认大小
    console.log('  ' + resize(1500, 940));
    await sleep(600);
    await app.evalIn(`return Boolean(window.api) && Boolean(document.querySelector('.toolbar'))`);
    // 分屏那一栏由 browserOpen 决定挂不挂，直接改状态比点按钮稳
    await app.evalIn(`
      const s = window.__szys.getState();
      s.setLibraryPage(false);
      s.setBrowserOpen(true);
      // 先关掉两个开关再准备，免得准备过程里就往网页上点
      await s.setLiveCapture(false);
      await s.setAutoPlay(false);
      return true;
    `);
    // 挂上去要一点时间，等它的 webview 真的出来
    let mounted = false;
    let last = null;
    for (let i = 0; i < 80; i++) {
      last = await app.evalIn(`
        const s = window.__szys.getState();
        return { open: s.browserOpen, wv: Boolean(document.querySelector('webview')), pane: document.querySelectorAll('.browser-pane').length, lib: s.libraryPage, tabs: s.tabs.length };
      `);
      if (last.wv) {
        mounted = true;
        break;
      }
      await sleep(300);
    }
    const view = mounted
      ? await app.evalIn(`const w = document.querySelector('webview'); const r = w.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) };`)
      : null;
    if (!view || view.w <= 0 || view.h <= 0) throw new Error('内置浏览器那一栏没铺开：' + JSON.stringify({ view, last }));
    const px = Math.max(200, Math.min(view.w - 30, view.h - 30));
    const url = `${PAGE_URL}?style=yike&start=empty&bare=1&px=${px}`;
    let page = await connect((list) => list.find((t) => t.url.includes('browser-board-test.html'))).catch(() => null);
    if (!page) {
      await app.evalIn(`
        const el = document.querySelector('input.browser-url');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, ${JSON.stringify(url)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const go = [...document.querySelectorAll('.browser-bar button')].find((b) => b.textContent.trim() === '前往');
        if (go) go.click();
        return true;
      `);
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        page = await connect((list) => list.find((t) => t.url.includes('browser-board-test.html'))).catch(() => null);
        if (page) break;
      }
    }
    if (!page) throw new Error('假网页板没打开');
    /*
     * 页面回到空盘：先等它真的加载好，再刷一次。上一轮可能给它加过横幅、下过子，
     * 而刷新之后的连接是旧的那条，所以刷完要重连一次。刷两三遍还不干净就直说。
     */
    let st = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      for (let i = 0; i < 40; i++) {
        const ready = await page.evalIn(`return typeof window.__state === 'function' && document.readyState === 'complete'`).catch(() => null);
        if (ready) break;
        await sleep(300);
      }
      await page.evalIn(`location.reload(); return true;`).catch(() => {});
      await sleep(1200);
      page.close();
      page = await connect((list) => list.find((t) => t.url.includes('browser-board-test.html')));
      for (let i = 0; i < 40; i++) {
        st = await page.evalIn(`return window.__state ? window.__state() : null`).catch(() => null);
        if (st && st.size === 19) break;
        await sleep(300);
      }
      if (st && st.size === 19 && st.stones.length === 0) break;
    }
    check('假网页板就绪（19 路空盘）', Boolean(st) && st.size === 19 && st.stones.length === 0, JSON.stringify(st));
    // 本地这一盘要一块干净的空盘：新开一个标签，比在一盘来路不明的棋上一直撤销可靠
    // （摆子的局面撤销是撤不掉那几颗子的，装过棋谱的配置里就会碰上）
    await app.evalIn(clickBtn('新建标签'));
    await sleep(700);
    check(
      '新建的这一盘是空盘（只剩根节点）',
      (await app.evalIn(`return document.querySelectorAll('.tree-row').length`)) === 1,
      String(await app.evalIn(`return document.querySelectorAll('.tree-row').length`))
    );
    globalThis.page = page;
  }

  let page = globalThis.page;
  const pageStones = `return window.__state().stones.map((s) => s.v).sort().join(' ')`;
  const localMoves = `return window.__szys.getState().past.length`;
  const autoOn = `return window.__szys.getState().settings.autoPlay`;

  /** 把假网页板刷回空盘。刷新之后那条调试连接就断了，要重连。 */
  async function reloadPage() {
    await page.evalIn(`location.reload(); return true;`).catch(() => {});
    await sleep(1200);
    page.close();
    page = await connect((list) => list.find((t) => t.url.includes('browser-board-test.html')));
    for (let i = 0; i < 40; i++) {
      const st = await page.evalIn(`return window.__state ? window.__state() : null`).catch(() => null);
      if (st && st.size === 19) break;
      await sleep(300);
    }
    return page;
  }

  console.log('\n一、焦点：自动落子之后，焦点不能跑到网页里去');
  {
    await app.evalIn(`
      const c = document.querySelector('canvas');
      const r = c.getBoundingClientRect();
      const opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
      c.dispatchEvent(new MouseEvent('mousedown', opts));
      c.dispatchEvent(new MouseEvent('mouseup', opts));
      return true;
    `);
    await sleep(400);
    /*
     * 要看的是"键盘会打到哪儿去"：焦点元素是不是网页那一层、网页自己是不是认为有焦点。
     * 窗口层面的 hasFocus 也会因为桌面别的东西抢了前台而变假（跑驱动时控制台窗口就会），
     * 那不是这个功能的事，所以只记下来、不拿它判成败。
     */
    const before = await app.evalIn(`return ${focusNow}`);
    const pageBefore = await page.evalIn(`return document.hasFocus()`);
    check('下棋之前焦点不在网页那一层', before.active !== 'WEBVIEW' && pageBefore === false, JSON.stringify({ ...before, pageFocus: pageBefore }));

    await app.evalIn(`await window.__szys.getState().setAutoPlay(true); return true;`);
    await sleep(400);
    const prev = await app.evalIn(`return ${syncText}`);
    await app.evalIn(`window.__szys.getState().playColor(1, 9 * 19 + 9, 'local'); return true;`);
    const said = await waitNew(prev);
    await sleep(600);
    const after = await app.evalIn(`return ${focusNow}`);
    const pageAfter = await page.evalIn(`return document.hasFocus()`);
    const stones = await page.evalIn(pageStones);
    console.log(`  状态行：${said}`);
    console.log(`  界面焦点：${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    console.log(`  网页自己认为有焦点：${pageBefore} → ${pageAfter}`);
    check('焦点没落到网页控件上', after.active !== 'WEBVIEW', JSON.stringify(after));
    check('网页那一层没拿到键盘焦点', pageAfter === false, String(pageAfter));
    check('这一手真的点到网页上了（K10）', stones.split(' ').includes('K10'), stones);
    check('状态行说的是点上了', Boolean(said) && /点到网页上/.test(said), said ?? '(空)');
    await app.shot(`${SHOT_DIR}\\szys-autoplay-focus.png`);
  }

  console.log('\n二、网页挪了位置之后，自动落子还得认得出来，且不许自己关掉');
  {
    await page.evalIn(`
      const d = document.createElement('div');
      d.id = 'shift';
      d.style.cssText = 'height:80px;background:#333;color:#fff';
      d.textContent = '横幅';
      document.body.insertBefore(d, document.body.firstChild);
      return true;
    `);
    await sleep(600);
    const before = await page.evalIn(pageStones);
    const prev = await app.evalIn(`return ${syncText}`);
    await app.evalIn(`window.__szys.getState().playColor(2, 3 * 19 + 3, 'local'); return true;`);
    const said = await waitNew(prev, 30000);
    await sleep(600);
    const after = await page.evalIn(pageStones);
    const on = await app.evalIn(autoOn);
    console.log(`  状态行：${said}`);
    console.log(`  网页上的子：${before} → ${after}`);
    check('网页上真的多了那一手（D16）', after.split(' ').includes('D16'), after);
    check('挪位之后没说"认不出"', Boolean(said) && !/认不出/.test(said), said ?? '(空)');
    check('挪位之后状态行说的是点上了', Boolean(said) && /点到网页上/.test(said), said ?? '(空)');
    check('开关还开着（不再一句话不说就自己关掉）', on === true);
    check('网页与本地手数对得上', (await app.evalIn(localMoves)) === after.split(' ').filter(Boolean).length, `${await app.evalIn(localMoves)} / ${after}`);
    await app.shot(`${SHOT_DIR}\\szys-autoplay-shift.png`);
  }

  console.log('\n三、工具条上的"AI 执黑 / AI 执白"');
  const segProbe = `
    const seg = [...document.querySelectorAll('.toolbar .seg-item')].filter((b) => /^AI 执[黑白]$/.test(b.textContent.trim()));
    return {
      texts: seg.map((b) => b.textContent.trim()),
      on: seg.filter((b) => b.className.includes('active')).map((b) => b.textContent.trim()),
      status: (document.querySelector('.statusbar .chip') ?? {}).textContent ?? '',
      mode: window.__szys.getState().game.mode,
      human: window.__szys.getState().game.humanColor
    };
  `;
  const clickSeg = (text) => `(() => {
    const b = [...document.querySelectorAll('.toolbar .seg-item')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
    if (!b) return false;
    b.click();
    return true;
  })()`;

  // 新开一盘，从空盘说这件事
  await app.evalIn(clickBtn('新建标签'));
  await sleep(600);
  {
    const idle = await app.evalIn(segProbe);
    console.log('  空盘上：', JSON.stringify(idle));
    check('工具条上有"AI 执黑""AI 执白"两颗', idle.texts.join('/') === 'AI 执黑/AI 执白', idle.texts.join(' '));
    check('一开始两颗都不亮（辅助模式）', idle.on.length === 0, idle.on.join(' '));
    check('一开始状态栏写辅助模式', idle.status.includes('辅助模式'), idle.status);

    await app.evalIn(clickSeg('AI 执白'));
    await sleep(500);
    const white = await app.evalIn(segProbe);
    console.log('  点了 AI 执白：', JSON.stringify(white));
    check('点一下就是人机对局，AI 执白', white.mode === 'vs-ai' && white.human === 1, JSON.stringify({ mode: white.mode, human: white.human }));
    check('"AI 执白"那颗亮着', white.on.join() === 'AI 执白', white.on.join(' '));
    check('状态栏说你执黑', white.status.includes('你执黑'), white.status);
    check('状态栏写的仍是人机对局', white.status.includes('人机对局'), white.status);

    await app.evalIn(clickSeg('AI 执黑'));
    await sleep(500);
    const black = await app.evalIn(segProbe);
    check('换成 AI 执黑：你执白', black.mode === 'vs-ai' && black.human === 2, JSON.stringify({ mode: black.mode, human: black.human }));
    check('亮的那颗换成"AI 执黑"', black.on.join() === 'AI 执黑', black.on.join(' '));
    check('状态栏说你执白', black.status.includes('你执白'), black.status);

    await app.evalIn(clickSeg('AI 执黑'));
    await sleep(400);
    const back = await app.evalIn(segProbe);
    check('再点同一颗就收回，回到辅助模式', back.mode === 'manual' && back.on.length === 0, JSON.stringify({ mode: back.mode, on: back.on }));
    check('状态栏回到辅助模式那句话', back.status.includes('辅助模式'), back.status);
  }

  console.log('\n四、固定执一方之后，AI 真的自己走');
  {
    // AI 执黑，空盘轮到黑：开开关关还没落的这一手应该自己落下
    await app.evalIn(clickSeg('AI 执黑'));
    const grew = await (async () => {
      const deadline = Date.now() + 25000;
      for (;;) {
        const n = await app.evalIn(localMoves);
        if (n >= 1) return n;
        if (Date.now() > deadline) return n;
        await sleep(300);
      }
    })();
    const src = await app.evalIn(`
      const s = window.__szys.getState();
      const n = s.tree.nodes[s.current];
      return { src: n && n.props && n.props.SRC ? n.props.SRC[0] : null, turn: s.tree.nodes[s.current] ? Object.keys(s.tree.nodes[s.current].props).find((k) => k === 'B' || k === 'W') : null };
    `);
    console.log('  第一手：', JSON.stringify(src));
    check('AI 执黑时空盘上它自己落了第一手', grew >= 1, `手数 ${grew}`);
    check('这一手记的来源是 AI', src.src === 'ai', JSON.stringify(src));
    check('落的是黑子', src.turn === 'B', JSON.stringify(src));

    // 人手白一手，轮到 AI（黑）自己回一手
    const n1 = await app.evalIn(localMoves);
    await app.evalIn(`
      const s = window.__szys.getState();
      const pos = s.tree.nodes[s.current];
      // 找个空点下白子：右上角那一带
      s.playColor(2, 15 * 19 + 15, 'local');
      return true;
    `);
    await sleep(300);
    const n2 = await (async () => {
      const deadline = Date.now() + 25000;
      for (;;) {
        const n = await app.evalIn(localMoves);
        if (n >= n1 + 2) return n;
        if (Date.now() > deadline) return n;
        await sleep(300);
      }
    })();
    const src2 = await app.evalIn(`
      const s = window.__szys.getState();
      const n = s.tree.nodes[s.current];
      return { src: n && n.props && n.props.SRC ? n.props.SRC[0] : null, key: n ? Object.keys(n.props).filter((k) => k === 'B' || k === 'W')[0] : null };
    `);
    console.log('  人下一手、AI 回一手之后：', JSON.stringify({ n1, n2, src2 }));
    check('人下完一手，AI 自己接着回了一手', n2 >= n1 + 2, `${n1} → ${n2}`);
    check('AI 回的那一手还是记成 AI 下的', src2.src === 'ai', JSON.stringify(src2));
    check('AI 回的是黑子（它执黑）', src2.key === 'B', JSON.stringify(src2));
    check('轮到人了（下一手该白）', (await app.evalIn(`return window.__szys.getState().game.humanColor`)) === 2);
  }

  console.log('\n五、跟"机机对下"是一套东西：过去再回来，固定执的那一方还在');
  {
    await app.evalIn(clickBtn('机机对下'));
    await sleep(500);
    const ai = await app.evalIn(segProbe);
    check('点机机对下就进机机对局', ai.mode === 'ai-vs-ai', JSON.stringify({ mode: ai.mode }));
    check('机机对局里不亮"AI 执某方"（两边都归它）', ai.on.length === 0, ai.on.join(' '));
    check('状态栏写机机对局', ai.status.includes('机机对局'), ai.status);

    await app.evalIn(clickBtn('停机机'));
    await sleep(500);
    const back = await app.evalIn(segProbe);
    check('停机机之后回到人机对局', back.mode === 'vs-ai', JSON.stringify({ mode: back.mode }));
    check('回来还是 AI 执黑', back.on.join() === 'AI 执黑', back.on.join(' '));
    check('状态栏说你执白', back.status.includes('你执白'), back.status);
    // 收干净，别把这盘的状态留给下一个驱动
    await app.evalIn(clickSeg('AI 执黑'));
    await sleep(300);
    const clean = await app.evalIn(segProbe);
    check('收回之后回到辅助模式（收拾干净）', clean.mode === 'manual', JSON.stringify({ mode: clean.mode }));
  }

  console.log('\n六、AI 自己走的那一手也会点到网页上（两件一起用）');
  {
    // 网页回到空盘，本地也开一盘空的，两边对齐
    await reloadPage();
    await app.evalIn(clickBtn('新建标签'));
    await sleep(600);
    await app.evalIn(`await window.__szys.getState().setLiveCapture(true); return true;`);
    await sleep(500);
    // 等本地把网页那张空盘认下来（实时截取会写状态行）
    await sleep(1500);
    const prev = await app.evalIn(`return ${syncText}`);
    await app.evalIn(clickSeg('AI 执黑'));
    const said = await waitNew(prev, 30000);
    await sleep(800);
    const stones = await page.evalIn(pageStones);
    console.log(`  状态行：${said}`);
    console.log(`  网页上的子：${stones || '(空)'}`);
    check('AI 自己落的那一手也点到网页上了', stones.split(' ').filter(Boolean).length === 1, stones || '(空)');
    check('两边手数一致', (await app.evalIn(localMoves)) === 1, `${await app.evalIn(localMoves)}`);
    await app.shot(`${SHOT_DIR}\\szys-autoplay-ai-side.png`);
    // 收尾：关掉两个开关，别让后面的人接手时还在往网页上点
    await app.evalIn(`
      const s = window.__szys.getState();
      await s.setAutoPlay(false);
      await s.setLiveCapture(false);
      s.setAiSide(null);
      return true;
    `);
  }

  app.close();
  page.close();
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  if (failed) {
    console.log('失败清单：');
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}${r.extra ? '  ' + r.extra : ''}`);
  }
  process.exit(failed ? 1 : 0);
};

main().catch((e) => {
  console.error('驱动出错：', e.message);
  process.exit(2);
});
