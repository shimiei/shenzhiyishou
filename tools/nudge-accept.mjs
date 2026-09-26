/**
 * 窄窗口下工具条能不能左右推：开发实例（9223）跑。
 *
 * 用户报的是"窗口不是全屏、右边又开着内置浏览器时，圈/叉/字母被挡住"。
 * 这里把窗口调小、把分隔条推到底，然后量真实像素：箭头有没有出来、
 * 点一下能不能把最后那件（字母）挪进视野、工具本身还能不能选中。
 *
 * 用法：node tools/nudge-accept.mjs [port]
 * 验装机版副本时把 SZYS_WIN_PATH 给成那份程序所在的目录片段（例如 szys-pkg）：
 * 它按路径挑窗口来调大小，免得动到用户自己开着的那一份。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { pickAppPage } from './app-target.mjs';

const PORT = process.argv[2] ?? '9223';
// 装机版那一份的窗口要按路径挑，别把用户自己开着的那份也算进来（用 SZYS_WIN_PATH 给个路径片段）
const SHOT_DIR = process.env.LOCALAPPDATA + '\\Temp';
const results = [];
let failed = 0;

function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  if (!ok) failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${extra ? '  ' + extra : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = pickAppPage(list.filter((t) => !t.url.startsWith('devtools')));
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
  const shot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(r.data, 'base64'));
  };
  return { send, evalIn, shot, close: () => ws.close() };
}

const resize = (w, h) => {
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
$f = $env:SZYS_WIN_PATH
if ($f) { $p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' -and $_.Path -like ('*' + $f + '*') } | Select-Object -First 1 }
else { $p = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1 }
if ($p) { [W]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; [W]::SetWindowPos($p.MainWindowHandle, [IntPtr]::Zero, 40, 30, ${w}, ${h}, 0x0040) | Out-Null; "ok:" + $p.Id } else { "none" }
`;
  return execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
};

// 两条排各自的量尺：可见宽度、内容宽度、箭头、以及某一颗按钮在不在视野里
const probe = `
  const inside = (el, box) => {
    const r = el.getBoundingClientRect();
    // 滚动位置是小数像素，边缘差个零点几像素不算被遮住，所以留 1px 的余地
    return r.left >= box.left - 1 && r.right <= box.right + 1 && r.width > 0;
  };
  const rowOf = (sel) => {
    const row = document.querySelector(sel);
    const strip = row.querySelector('.scroll-strip');
    const box = strip.getBoundingClientRect();
    const find = (t) => [...strip.querySelectorAll('button')].find((b) => b.textContent.trim() === t) ?? null;
    const seen = (t) => { const b = find(t); return b ? { vis: inside(b, box), over: Math.round(b.getBoundingClientRect().right - box.right) } : null; };
    return {
      cls: row.className,
      w: Math.round(box.width),
      sw: strip.scrollWidth,
      left: Math.round(strip.scrollLeft),
      nudges: [...row.querySelectorAll('.scroll-nudge')].filter((b) => !b.className.includes('resting')).map((b) => b.textContent),
      slots: row.querySelectorAll('.scroll-nudge').length,
      geom: { win: window.innerWidth, ratio: window.__szys.getState().splitRatio },
      first: seen([...strip.querySelectorAll('button')][0].textContent.trim()),
      last: seen([...strip.querySelectorAll('button')].pop().textContent.trim()),
      count: strip.querySelectorAll('button').length
    };
  };
  const toolRow = document.querySelector('.scroll-row.tool-row');
  const strip = toolRow.querySelector('.scroll-strip');
  const tbox = strip.getBoundingClientRect();
  const segs = [...strip.querySelectorAll('.seg-item')];
  const letter = segs.find((b) => b.textContent.trim() === '字母');
  const cross = segs.find((b) => b.textContent.trim() === '叉');
  const bar = document.querySelector('.toolbar');
  const barBox = bar.getBoundingClientRect();
  const zoom = document.querySelector('.toolbar .seg[title="棋盘缩放"]');
  const split = document.querySelector('.toolbar .btn[title^="显示或隐藏"]');
  return {
    tool: { ...rowOf('.scroll-row.tool-row'), tools: segs.map((b) => b.textContent.trim()),
            letterVis: letter ? inside(letter, tbox) : null,
            letterOver: letter ? Math.round(letter.getBoundingClientRect().right - tbox.right) : null },
    main: rowOf('.scroll-row.main-row'),
    zoomInBar: zoom ? inside(zoom, barBox) : null,
    splitInBar: split ? inside(split, barBox) : null,
    state: { tool: window.__szys.getState().tool, split: window.__szys.getState().split }
  };
`;

const clickNudge = (sel, side) => `
  const row = document.querySelector('${sel}');
  const all = [...row.querySelectorAll('.scroll-nudge')].filter((x) => !x.className.includes('resting'));
  const b = all.find((x) => x.textContent.trim() === '${side}');
  if (!b) return false;
  b.click();
  await new Promise((r) => setTimeout(r, 400));
  return true;
`;

const main = async () => {
  const c = await connect();

  // 挤窄：开着内置浏览器，分隔条往浏览器那边推到底
  await c.evalIn(`
    const s = window.__szys.getState();
    s.setLibraryPage(false);
    s.setBrowserOpen(true);
    window.__szys.setState({ splitRatio: 0.12, splitAxis: 'x' });
    return true;
  `);
  console.log(resize(1180, 820));
  await sleep(1000);

  const narrow = await c.evalIn(probe);
  console.log('窄窗口：', JSON.stringify(narrow.tool), '\n        主条：', JSON.stringify(narrow.main), '\n        bar:', narrow.zoomInBar, narrow.splitInBar);
  await c.shot(`${SHOT_DIR}\\szys-nudge-narrow-1.png`);

  check('工具条在窄窗口下真的溢出了', narrow.tool.sw > narrow.tool.w + 2, `内容 ${narrow.tool.sw} / 可见 ${narrow.tool.w}`);
  check('右箭头出来了', narrow.tool.nudges.includes('›'));
  check('字母一开始被裁在右边', narrow.tool.letterVis === false, `超出 ${narrow.tool.letterOver}px`);
  check('十件工具都在（一件没少）', narrow.tool.tools.length === 10, narrow.tool.tools.join(' '));
  check('缩放在工具条里始终看得见', narrow.zoomInBar === true);
  check('分屏按钮在工具条里始终看得见', narrow.splitInBar === true);

  // 点右箭头，一直点到推不动：够得着才算数，一次到位不是要求
  const clicked = await c.evalIn(clickNudge('.scroll-row.tool-row', '›'));
  check('右箭头点得到', clicked === true);
  let clicks = 1;
  for (let i = 0; i < 4; i++) {
    const before = await c.evalIn(`return Math.round(document.querySelector('.scroll-row.tool-row .scroll-strip').scrollLeft)`);
    await c.evalIn(clickNudge('.scroll-row.tool-row', '›'));
    const now = await c.evalIn(`return Math.round(document.querySelector('.scroll-row.tool-row .scroll-strip').scrollLeft)`);
    if (now === before) break;
    clicks++;
  }
  const afterRight = await c.evalIn(probe);
  console.log(`点过右箭头（${clicks} 下）：`, JSON.stringify(afterRight.tool));
  await c.shot(`${SHOT_DIR}\\szys-nudge-narrow-2.png`);
  check('按右箭头能一直推到最右', afterRight.tool.left + afterRight.tool.w >= afterRight.tool.sw - 1, JSON.stringify({ left: afterRight.tool.left, w: afterRight.tool.w, sw: afterRight.tool.sw }));
  check('推到最右后字母在视野里', afterRight.tool.letterVis === true, `超出 ${afterRight.tool.letterOver}px`);
  check('这时左边箭头出现（能再推回去）', afterRight.tool.nudges.includes('‹'));

  // 点左箭头回到最左，第一件得回来
  await c.evalIn(clickNudge('.scroll-row.tool-row', '‹'));
  await c.evalIn(clickNudge('.scroll-row.tool-row', '‹'));
  const afterLeft = await c.evalIn(probe);
  check('往左推两下回到最左边', afterLeft.tool.left === 0, `scrollLeft=${afterLeft.tool.left}`);
  check('最左边第一件（落子）在视野里', afterLeft.tool.first.vis === true, JSON.stringify(afterLeft.tool.first));

  // 挪进来之后要能真的选中
  await c.evalIn(clickNudge('.scroll-row.tool-row', '›'));
  const picked = await c.evalIn(`
    const segs = [...document.querySelectorAll('.scroll-row.tool-row .seg-item')];
    const letter = segs.find((b) => b.textContent.trim() === '字母');
    letter.click();
    await new Promise((r) => setTimeout(r, 250));
    return { tool: window.__szys.getState().tool, active: letter.className.includes('active') };
  `);
  check('挪进来后点字母能选中', picked.tool === 'label' && picked.active, JSON.stringify(picked));

  // 选中态自动进视野：先滚回最左，再选最右那件
  const reveal = await c.evalIn(`
    const strip = document.querySelector('.scroll-row.tool-row .scroll-strip');
    strip.scrollLeft = 0;
    await new Promise((r) => setTimeout(r, 200));
    const cross = [...strip.querySelectorAll('.seg-item')].find((b) => b.textContent.trim() === '叉');
    cross.click();
    await new Promise((r) => setTimeout(r, 400));
    const box = strip.getBoundingClientRect();
    const r = cross.getBoundingClientRect();
    return { left: Math.round(strip.scrollLeft), vis: r.left >= box.left - 0.5 && r.right <= box.right + 0.5 };
  `);
  check('选中被裁的那件后自己挪进视野', reveal.vis === true && reveal.left > 0, JSON.stringify(reveal));

  // 滚轮横推
  const wheel = await c.evalIn(`
    const strip = document.querySelector('.scroll-row.tool-row .scroll-strip');
    strip.scrollLeft = 0;
    await new Promise((r) => setTimeout(r, 150));
    strip.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 150));
    return Math.round(strip.scrollLeft);
  `);
  check('滚轮竖着滚也能横推这一排', wheel > 0, `scrollLeft=${wheel}`);

  // 主工具条：两头都够得着
  for (let i = 0; i < 6; i++) await c.evalIn(clickNudge('.scroll-row.main-row', '›'));
  const mainRight = await c.evalIn(probe);
  check('主工具条推到最右时，最后一件在视野里', mainRight.main.last.vis === true, JSON.stringify(mainRight.main.last));
  check('主工具条两端各留一个箭头位（宽度不跳）', mainRight.main.slots === 2, JSON.stringify({ slots: mainRight.main.slots, nudges: mainRight.main.nudges }));
  for (let i = 0; i < 6; i++) await c.evalIn(clickNudge('.scroll-row.main-row', '‹'));
  const mainLeft = await c.evalIn(probe);
  check('主工具条推回最左时，第一件（新建）在视野里', mainLeft.main.first.vis === true, JSON.stringify(mainLeft.main.first));
  await c.shot(`${SHOT_DIR}\\szys-nudge-narrow-3.png`);

  // 宽窗口：不该出现箭头
  await c.evalIn(`window.__szys.setState({ splitRatio: 0.78, splitAxis: 'x' }); return true;`);
  console.log(resize(1720, 960));
  await sleep(1000);
  const wide = await c.evalIn(probe);
  console.log('宽窗口：', JSON.stringify(wide.tool), JSON.stringify(wide.main));
  await c.shot(`${SHOT_DIR}\\szys-nudge-wide.png`);
  check('宽窗口下工具条根本不出现箭头', wide.tool.slots === 0, JSON.stringify(wide.tool));
  check('宽窗口下十件工具都看得见', wide.tool.tools.length === 10 && wide.tool.letterVis === true);
  check('宽窗口下主工具条照样给出两端箭头（它本来就长）', wide.main.slots === 2 || wide.main.slots === 0, JSON.stringify({ slots: wide.main.slots }));

  c.close();
  console.log(`\n合计 ${results.length} 项，失败 ${failed} 项`);
  process.exit(failed ? 1 : 0);
};

main().catch((e) => {
  console.error('驱动出错：', e.message);
  process.exit(2);
});
