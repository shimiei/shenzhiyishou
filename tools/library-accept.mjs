/**
 * 棋谱馆的验收：整页界面、多选、⋯ 菜单、导出、删除、扫描、换目录、保存与另存为。
 *
 * 走的都是真界面点击（CDP 的鼠标事件，不动真实鼠标），落盘的东西回到磁盘上核对。
 * 原生"选文件 / 选文件夹"对话框只有真人点得动，所以起实例时塞了 SZYS_TEST_PICK，
 * 让那几处直接用给好的路径（见主进程里的 testPick）。装机版跑的时候不带这个变量的话，
 * 导出与换目录那几段会被跳过，其余照跑。
 *
 * 用法:
 *   node tools/library-accept.mjs [port]                         跑开发实例（自己起、自己重启）
 *   node tools/library-accept.mjs 9444 --exe=<装机版exe> --seam   跑装机版验收副本
 * --seam 表示那份程序起的时候带了 SZYS_TEST_PICK（"另存为 / 导出 / 换目录"要用）；
 * --exe 给的是重新拉起程序时用的可执行文件，重启那两段才验得了。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.argv[2] ?? '9223';
const EXE = (process.argv.find((a) => a.startsWith('--exe=')) ?? '').slice(6);
const SEAM = process.argv.includes('--seam') || !EXE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = process.env.LOCALAPPDATA + '/Temp';
const LIB = TMP + '/szys-lib-accept';
const LIB2 = TMP + '/szys-lib-accept-2';
const OUT = TMP + '/szys-lib-export';
const IN = TMP + '/szys-lib-import';
const DROP = IN + '/手drop的棋谱.sgf';

let passed = 0;
let failed = 0;
let rec0 = null;
const failures = [];
function ok(cond, name, extra) {
  if (cond) {
    passed++;
    console.log('  ok   ' + name);
  } else {
    failed++;
    failures.push(name);
    console.log('  失败 ' + name + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra)));
  }
}
function eq(a, b, name) {
  ok(typeof a === typeof b && a === b, name, { 实际: a, 期望: b });
}
const filesIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.sgf')) : []);

const pickEnv = JSON.stringify({
  libraryDir: LIB2,
  export: OUT,
  save: OUT + '/另存的一份.sgf',
  openSgf: DROP
});

/** 起一份程序：给了 --exe 就用装机版那份，否则用开发实例。 */
function launch() {
  const child = EXE
    ? spawn(EXE, [`--remote-debugging-port=${PORT}`, '--disable-features=CalculateNativeWinOcclusion'], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, SZYS_TEST_PICK: pickEnv }
      })
    : spawn(
        process.execPath,
        [join(ROOT, 'tools', 'devtest.mjs'), `--remote-debugging-port=${PORT}`, '--disable-features=CalculateNativeWinOcclusion'],
        { cwd: ROOT, detached: true, stdio: 'ignore', env: { ...process.env, SZYS_TEST_PICK: pickEnv } }
      );
  child.unref();
}

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('没找到页面目标：' + list.map((t) => `${t.type} ${t.url}`).join(' | '));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { resolve: res, reject: rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
  const evalIn = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails)
      throw new Error('页面里报错：' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  };
  // 取值一律套一层 async：这样写表达式时里面可以直接 await
  const st = async (expr) =>
    JSON.parse(await evalIn(`(async () => { const s = window.__szys.getState(); return JSON.stringify(${expr} ?? null); })()`));
  /** 真点一下：先量位置再发鼠标事件，走的是页面里那套事件。 */
  const click = async (selector, nth = 0) => {
    const box = await evalIn(`(() => {
      const els = document.querySelectorAll(${JSON.stringify(selector)});
      const el = els[${nth}];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, n: els.length, text: el.textContent });
    })()`);
    if (!box) throw new Error('点不到：' + selector + ' 第 ' + nth + ' 个');
    const b = JSON.parse(box);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type,
        x: Math.round(b.x),
        y: Math.round(b.y),
        button: 'left',
        clickCount: 1,
        buttons: type === 'mousePressed' ? 1 : 0
      });
    }
    return b;
  };
  const type = async (selector, text) => {
    await click(selector);
    await send('Input.insertText', { text });
  };
  /**
   * 把输入框里的字换成 text：先全选再输入。
   * 直接改 el.value 再派发 input 事件是不行的，React 手里那份值不会跟着变，
   * 于是框里看着是新词、列表还按旧词筛。走真按键就没这问题。
   */
  const fill = async (selector, text) => {
    await click(selector);
    const key = (t) => ({ type: t, modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
    await send('Input.dispatchKeyEvent', key('keyDown'));
    await send('Input.dispatchKeyEvent', key('keyUp'));
    await send('Input.insertText', { text });
  };
  return { send, evalIn, st, click, type, fill, close: () => ws.close() };
}

/* --- 一、把旧实例关掉，起一个新的 --- */
console.log('== 一、重启验收实例 ==');
{
  try {
    const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try {
        await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(800) });
      } catch {
        break;
      }
    }
  } catch {
    /* 本来就没开着 */
  }
  for (const d of [LIB, LIB2, OUT, IN]) rmSync(d, { recursive: true, force: true });
  mkdirSync(IN, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  // 手动丢一份棋谱进"导入"文件夹，另外的复制一份到棋谱馆目录里给"扫描"用
  const sample = '(;GM[1]FF[4]CA[UTF-8]AP[szys]SZ[19]PB[手动丢的]PW[扫描收编]DT[2025-01-02]RE[W+R];B[pd];W[dp];B[pp];W[dd];B[fq];W[cn])';
  writeFileSync(DROP, sample, 'utf8');

  launch();
  console.log(EXE ? '  起装机版验收副本' : '  起开发验收实例（棋谱馆取巧口子已设）');
  let up = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(800) });
      up = true;
      break;
    } catch {
      /* 还没起来 */
    }
  }
  ok(up, '实例起来了');
}
await sleep(1500);

const cdp = await connect();
const { evalIn, st, click } = cdp;
for (let i = 0; i < 40; i++) {
  if (await st('s.ready')) break;
  await sleep(500);
}
ok(await st('s.ready'), '界面就绪');

/* --- 二、动手之前先把棋谱馆指到一个空目录 --- */
console.log('== 二、棋谱馆指到临时目录 ==');
{
  const r = await evalIn(
    `(async () => { const s = window.__szys.getState(); return JSON.stringify(await window.api.library.setDir(${JSON.stringify(LIB)}, false)); })()`
  );
  const got = JSON.parse(r);
  eq(got.dir, LIB, '目录换过去了');
  const info = await st('(await window.api.library.list())');
  eq(info.records.length, 0, '新目录是空的');
  eq((await st('s.libraryPage')), false, '这时还在棋盘那页');
}

/* --- 三、保存：进馆、再保存更新同一条 --- */
console.log('== 三、保存进棋谱馆 ==');
{
  // 先在一盘空棋上落几手
  await st('(s.newGame({ size: 19, komi: 7.5, mode: "manual", humanColor: 1, visits: 50, timeMs: 1000, temperature: 0, allowResign: true }), 1)');
  await sleep(300);
  await st('(s.updateGameInfo({ blackName: "我", whiteName: "神之一手", date: "2026-09-26" }), 1)');
  await sleep(300);
  for (const p of [3 * 19 + 3, 15 * 19 + 15, 3 * 19 + 15, 15 * 19 + 3]) {
    await st(`(s.play(${p}), 1)`);
  }
  await sleep(200);
  eq(await st('Object.keys(s.tree.nodes).length >= 5 ? 1 : 0'), 1, '落子之后棋谱有内容');

  const before = await st('s.dirty');
  eq(before, true, '手上有没存过的改动');

  await click("button[title^='保存进棋谱馆']");
  await sleep(1200);
  const toast = await st('s.toasts.map(t => t.text)');
  ok(
    toast.some((t) => t.includes('已存入棋谱馆')),
    '点保存的提示是"已存入棋谱馆"',
    toast
  );
  ok(
    !(await st('Boolean(document.querySelector(".overlay"))')),
    '没有弹出系统存盘对话框（页面里也没有遮罩）'
  );

  const info = await st('(await window.api.library.list())');
  eq(info.records.length, 1, '馆里多了一条');
  const title = info.records[0].title;
  ok(title.includes('我 对 神之一手'), '标题按双方起', title);
  eq(info.records[0].moves, 4, '手数记的是 4 手');
  eq(await st('s.dirty'), false, '存完就不算有改动了');
  const rec = await st('s.record');
  ok(rec && rec.id === info.records[0].id, '这一盘记着馆里的编号', rec);
  rec0 = info.records[0].id;

  // 再落一手、再保存：更新原来那条
  await st('(s.play(9 * 19 + 3), 1)');
  await sleep(200);
  await click("button[title^='保存进棋谱馆']");
  await sleep(1200);
  const info2 = await st('(await window.api.library.list())');
  eq(info2.records.length, 1, '第二次保存还是那一条，没有越存越多');
  eq(info2.records[0].id, info.records[0].id, '编号没变');
  eq(info2.records[0].moves, 5, '手数跟着更新了');
  eq(filesIn(LIB).length, 1, '磁盘上也只有一份棋谱');
}

/* --- 四、另存为：散装 .sgf 落到指定的地方 --- */
console.log('== 四、另存为 ==');
{
  if (!SEAM) {
    console.log('  这份程序起的时候没带取巧口子，这一段跳过');
  } else {
    await click("button[title^='另存为']");
    await sleep(1200);
    ok(existsSync(OUT + '/另存的一份.sgf'), '散装棋谱真的写到磁盘上了', filesIn(OUT));
    const text = readFileSync(OUT + '/另存的一份.sgf', 'utf8');
    ok(text.includes('(;') && text.includes(';B['), '写出来的是像样的 SGF', text.slice(0, 60));
    const toast = await st('s.toasts.map(t => t.text)');
    ok(
      toast.some((t) => t.includes('已另存为')),
      '另存为有自己的提示',
      toast
    );
    // 另存为只多了一份散装文件，不碰"这一盘是馆里哪一条"
    eq(await st('s.record.id'), rec0, '另存为不改这一盘在馆里的编号');
    eq(await st('(await window.api.library.list()).records.length'), 1, '另存为不会往馆里再添一份');
  }
}

/* --- 五、导入 SGF：收进棋谱馆 --- */
console.log('== 五、导入 SGF ==');
{
  if (!SEAM) {
    console.log('  这份程序起的时候没带取巧口子，这一段跳过');
  } else {
    await click("button[title^='棋谱馆']");
    await sleep(600);
    eq(await st('s.libraryPage'), true, '棋谱馆整页开起来了');
    eq(await evalIn('document.querySelectorAll(".lib-row").length'), 1, '列表里先是那一盘');

    await click("button[title^='把别处的']");
    await sleep(1500);
    const rows = await evalIn('document.querySelectorAll(".lib-row").length');
    eq(rows, 2, '导入之后列表里有两盘');
    const titles = await evalIn('[...document.querySelectorAll(".lib-row-title")].map(e => e.textContent)');
    ok(
      titles.some((t) => t.includes('手动丢的')),
      '导进来的那份按双方起了标题',
      titles
    );
    // 回棋盘：再进馆时会重新读一遍目录，列表不是手里这份旧账
    await click("button[title^='回棋盘']");
    await sleep(600);
    eq(await st('s.libraryPage'), false, '点返回就回棋盘那页了');
  }
}

/* --- 六、列表：缩略图、搜索、排序、筛选 --- */
console.log('== 六、列表怎么摆的 ==');
{
  // 再补两份进来，好让搜索、排序、筛选看得出区别
  const mk = async (title, black, white, date, result, size, moves, tags) => {
    const sgf = `(;GM[1]FF[4]CA[UTF-8]SZ[${size}]PB[${black}]PW[${white}]DT[${date}]RE[${result}];B[dd];W[pp];B[dp];W[pd])`;
    const r = JSON.parse(
      await evalIn(
        `(async () => JSON.stringify(await window.api.library.save({ meta: ${JSON.stringify({ title, blackName: black, whiteName: white, date, result, size, moves })}, content: ${JSON.stringify(sgf)} })))()`
      )
    );
    if (tags.length) {
      await evalIn(`(async () => { await window.api.library.update(${JSON.stringify(r.id)}, { tags: ${JSON.stringify(tags)} }); return '1'; })()`);
    }
    return r.id;
  };
  const idA = await mk('柯洁 对 朴廷桓 2024-03-05', '柯洁', '朴廷桓', '2024-03-05', 'B+R', 19, 154, ['名人局', '中盘胜']);
  await mk('十三路练习 2026-09-20', '我', '让先', '2026-09-20', '', 13, 88, ['练习']);

  await click("button[title^='棋谱馆']");
  await sleep(1200);
  eq(await st('s.libraryPage'), true, '棋盘上那个入口能把棋谱馆打开');
  await sleep(400);

  const rows = await evalIn('document.querySelectorAll(".lib-row").length');
  eq(rows, 4, '四盘都在列表里');

  // 缩略图：出现在视野里的行要有画布，而且不是一张空白的
  const thumb = JSON.parse(
    await evalIn(`(() => {
      const c = document.querySelector('.lib-row .lib-thumb canvas');
      if (!c) return JSON.stringify({ has: false });
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 37) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
      return JSON.stringify({ has: true, colors: seen.size, w: c.width });
    })()`)
  );
  ok(thumb.has, '行里有缩略棋盘');
  ok(thumb.colors > 3, '缩略图上画了东西（不是一块纯色）', thumb);

  // 搜索：标题、双方、标签都该命中
  await cdp.fill('.lib-search', '柯洁');
  await sleep(500);
  eq(await evalIn('document.querySelectorAll(".lib-row").length'), 1, '搜"柯洁"只剩一盘');
  await cdp.fill('.lib-search', '练习');
  await sleep(500);
  eq(await evalIn('document.querySelectorAll(".lib-row").length'), 1, '搜"练习"也能命中标签');
  await cdp.fill('.lib-search', '');
  await sleep(400);
  eq(await evalIn('document.querySelectorAll(".lib-row").length'), 4, '清掉搜索词四盘都回来');

  // 排序：按手数，最多的排最前
  await evalIn(`(() => {
    const el = document.querySelector('.lib-sort');
    el.value = 'moves';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 1;
  })()`);
  await sleep(400);
  const byMoves = await evalIn('[...document.querySelectorAll(".lib-row-title")].map(e => e.textContent)');
  ok(byMoves[0].includes('柯洁'), '按手数排序，154 手那盘在最上面', byMoves);
  await evalIn(`(() => {
    const el = document.querySelector('.lib-sort');
    el.value = 'savedAt';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 1;
  })()`);
  await sleep(300);

  // 筛选：按结果、按路数、按标签
  await click('.lib-rail .chip', 1); // 白胜
  await sleep(400);
  const whiteOnly = await evalIn('[...document.querySelectorAll(".lib-row-title")].map(e => e.textContent)');
  ok(
    whiteOnly.every((t) => t.includes('手动丢的')),
    '只看白胜时只剩那一盘',
    whiteOnly
  );
  await click('.lib-rail .chip', 1);
  await sleep(300);
  const chips = await evalIn('[...document.querySelectorAll(".lib-rail .chip")].map(e => e.textContent)');
  const tagChip = chips.findIndex((t) => t && t.includes('名人局'));
  ok(tagChip >= 0, '标签栏里出现了"名人局"', chips);
  if (tagChip >= 0) {
    await click('.lib-rail .chip', tagChip);
    await sleep(400);
    const tagged = await evalIn('[...document.querySelectorAll(".lib-row-title")].map(e => e.textContent)');
    eq(tagged.length, 1, '按标签筛只剩一盘');
    ok(tagged[0].includes('柯洁'), '就是打了那个标签的那盘', tagged);
    await click('.lib-rail .chip', tagChip);
    await sleep(300);
  }

  /* --- 七、⋯ 菜单：重命名、加标签、复制 SGF --- */
  console.log('== 七、行尾那个 ⋯ 菜单 ==');
  const keIdx = await evalIn(
    `[...document.querySelectorAll('.lib-row')].findIndex(r => r.querySelector('.lib-row-title').textContent.includes('柯洁'))`
  );
  ok(keIdx >= 0, '列表里找得到柯洁那盘', keIdx);
  await click('.lib-more', keIdx);
  await sleep(400);
  const menuItems = await evalIn('[...document.querySelectorAll(".lib-menu button")].map(e => e.textContent)');
  ok(
    menuItems.length >= 6 && menuItems.includes('导出到…') && menuItems.includes('重命名'),
    '菜单里该有的都在',
    menuItems
  );
  await evalIn(`(() => {
    const b = [...document.querySelectorAll('.lib-menu button')].find(x => x.textContent === '重命名');
    b.click();
    return 1;
  })()`);
  await sleep(400);
  await cdp.fill('.lib-mini .lib-input', '改过名的柯洁那盘');
  await sleep(300);
  await evalIn(`(() => {
    const b = [...document.querySelectorAll('.lib-mini-foot button')].find(x => x.textContent === '改好');
    b.click();
    return 1;
  })()`);
  await sleep(900);
  const renamed = await st('(await window.api.library.list())');
  ok(
    renamed.records.some((r) => r.title === '改过名的柯洁那盘'),
    '重命名进了索引',
    renamed.records.map((r) => r.title)
  );
  ok(
    filesIn(LIB).some((f) => f.includes('柯洁')),
    '磁盘上的文件名没跟着改（免得动到别人正占着的文件）',
    filesIn(LIB)
  );
  eq(renamed.records.find((r) => r.title === '改过名的柯洁那盘').id, idA, '还是同一条索引');

  // 加标签：挑一盘没标签的
  const noTagIdx = await evalIn(
    `(() => {
      const rows = [...document.querySelectorAll('.lib-row')];
      return rows.findIndex((r) => !r.querySelector('.lib-tag'));
    })()`
  );
  if (noTagIdx >= 0) {
    await click('.lib-more', noTagIdx);
    await sleep(300);
    await evalIn(`(() => {
      const b = [...document.querySelectorAll('.lib-menu button')].find(x => x.textContent === '加标签');
      b.click();
      return 1;
    })()`);
    await sleep(400);
    await cdp.fill('.lib-mini .lib-input', '待整理');
    await sleep(300);
    await evalIn(`(() => {
      const i = document.querySelector('.lib-mini .lib-input');
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return 1;
    })()`);
    await sleep(900);
    const after = await st('(await window.api.library.list())');
    ok(
      after.records.some((r) => (r.tags ?? []).includes('待整理')),
      '打上的标签进了索引',
      after.records.map((r) => r.tags)
    );
    const rail = await evalIn('[...document.querySelectorAll(".lib-rail .chip")].map(e => e.textContent)');
    ok(
      rail.some((t) => t.includes('待整理')),
      '左边标签栏跟着出来了',
      rail
    );
  } else {
    ok(false, '没找到没标签的那一盘，加标签这一段没法验');
  }
}

/* --- 八、导出：单份与批量，回到磁盘上核对 --- */
console.log('== 八、导出 ==');
if (!SEAM) {
  console.log('  这份程序起的时候没带取巧口子，这一段跳过');
} else {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  await click('.lib-more', 0);
  await sleep(300);
  await evalIn(`(() => {
    const b = [...document.querySelectorAll('.lib-menu button')].find(x => x.textContent === '导出到…');
    b.click();
    return 1;
  })()`);
  await sleep(1500);
  eq(filesIn(OUT).length, 1, '单份导出真的写了一个文件出来', filesIn(OUT));
  const one = filesIn(OUT)[0] ?? '';
  ok(/\.sgf$/i.test(one), '写出来的是 .sgf', one);

  // 批量：多选 → 全选 → 导出到…
  await click("button[title^='多选']");
  await sleep(400);
  const barText0 = await evalIn('document.querySelector(".lib-bar") ? document.querySelector(".lib-bar").textContent : ""');
  ok(barText0.includes('已选 0 盘'), '开了多选就浮出批量条，并写着还没选', barText0);
  await evalIn(`(() => {
    const rows = [...document.querySelectorAll('.lib-row')];
    rows[0].querySelector('.lib-check').click();
    return 1;
  })()`);
  await sleep(400);
  const barText1 = await evalIn('document.querySelector(".lib-bar").textContent');
  ok(barText1.includes('已选 1 盘'), '点一下行首的勾，数字跟着变', barText1);
  await evalIn(`(() => {
    const b = [...document.querySelectorAll('.lib-bar button')].find(x => x.textContent === '取消选择');
    b.click();
    return 1;
  })()`);
  await sleep(300);
  await evalIn(`(() => {
    const b = [...document.querySelectorAll('.lib-bar button')].find(x => x.textContent === '全选');
    b.click();
    return 1;
  })()`);
  await sleep(500);
  const pickedText = await evalIn('document.querySelector(".lib-bar span").textContent');
  ok(/已选 [1-9]/.test(pickedText), '批量条上写着选了几盘', pickedText);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  await evalIn(`(() => {
    const b = [...document.querySelectorAll('.lib-bar button')].find(x => x.textContent === '导出到…');
    b.click();
    return 1;
  })()`);
  await sleep(2500);
  const n = filesIn(OUT).length;
  ok(n >= 4, '批量导出的文件都在磁盘上', filesIn(OUT));
  const names = filesIn(OUT);
  eq(new Set(names.map((x) => x.toLowerCase())).size, names.length, '导出时没有互相覆盖（同名的都加了序号）');

  // 删除：确认框里说清条数
  const before = (await st('(await window.api.library.list())')).records.length;
  await click('.lib-bar .btn.danger');
  await sleep(400);
  const confirmText = await evalIn('document.querySelector(".lib-mini-body").textContent');
  ok(/要删掉 \d+ 份/.test(confirmText), '删除确认框里说清了删几份', confirmText);
  await evalIn(`(() => {
    const b = [...document.querySelectorAll('.lib-mini-foot button')].find(x => x.textContent === '删掉');
    b.click();
    return 1;
  })()`);
  await sleep(1500);
  const after = (await st('(await window.api.library.list())')).records.length;
  eq(after, 0, '全选删掉之后馆里空了', { before });
  eq(filesIn(LIB).length, 0, '磁盘上的棋谱文件也跟着删了', filesIn(LIB));
  await evalIn(`(() => {
    const b = [...document.querySelectorAll('.lib-head button')].find(x => x.textContent === '多选');
    if (b) b.click();
    return 1;
  })()`);
  await sleep(300);
}

/* --- 九、扫描：把手动丢进目录的 .sgf 收编 --- */
console.log('== 九、扫描 ==');
{
  const dir = (await st('(await window.api.library.list())')).dir;
  const manual = '(;GM[1]FF[4]CA[UTF-8]SZ[19]PB[丢进来的]PW[黑]DT[2025-05-06]RE[B+2.5];B[pd];W[dp];B[pp])';
  writeFileSync(join(dir, '手动丢进来的.sgf'), manual, 'utf8');

  await evalIn(`(() => {
    const b = [...document.querySelectorAll('.lib-head button')].find(x => x.textContent === '扫描');
    b.click();
    return 1;
  })()`);
  await sleep(1800);
  const body = await evalIn('document.querySelector(".lib-mini-body") ? document.querySelector(".lib-mini-body").textContent : ""');
  ok(body.includes('手动丢进来的.sgf'), '扫描结果里列出了那份没进馆的棋谱', body.slice(0, 200));
  await evalIn(`(() => {
    const b = [...document.querySelectorAll('.lib-mini-foot button')].find(x => x.textContent.startsWith('收编'));
    b.click();
    return 1;
  })()`);
  await sleep(1500);
  const listed = await st('(await window.api.library.list())');
  eq(listed.records.length, 1, '收编之后馆里有一份');
  const meta = listed.records[0];
  eq(meta.blackName, '丢进来的', '从文件头里读出了黑方');
  eq(meta.result, 'B+2.5', '读出了结果');
  eq(meta.moves, 3, '数出了 3 手');

  // 文件不在了的那一条：删掉磁盘文件再扫，应该报"索引里有、文件没了"，可以清掉索引
  rmSync(join(dir, manual.replace(/.*/, '手动丢进来的.sgf')), { force: true });
  await evalIn(`(() => {
    const b = [...document.querySelectorAll('.lib-head button')].find(x => x.textContent === '扫描');
    b.click();
    return 1;
  })()`);
  await sleep(1800);
  const body2 = await evalIn('document.querySelector(".lib-mini-body") ? document.querySelector(".lib-mini-body").textContent : ""');
  ok(body2.includes('已经不在'), '文件没了的那条被点了出来', body2.slice(0, 200));
  await evalIn(`(() => {
    const b = [...document.querySelectorAll('.lib-mini-foot button')].find(x => x.textContent.startsWith('清掉'));
    b.click();
    return 1;
  })()`);
  await sleep(1200);
  eq((await st('(await window.api.library.list())')).records.length, 0, '清掉索引之后列表里也不再挂着它');
}

/* --- 十、换目录：搬到新文件夹 --- */
console.log('== 十、换目录 ==');
if (!SEAM) {
  console.log('  这份程序起的时候没带取巧口子，这一段跳过');
} else {
  // 先放两份进去
  for (const t of ['第一份', '第二份']) {
    await evalIn(
      `(async () => JSON.stringify(await window.api.library.save({ meta: { title: ${JSON.stringify(t)}, blackName: '黑', whiteName: '白', size: 19, moves: 2 }, content: '(;GM[1]FF[4]CA[UTF-8]SZ[19];B[dd];W[pp])' })))()`
    );
  }
  await sleep(500);
  await evalIn(`(() => {
    const b = [...document.querySelectorAll('.lib-head button')].find(x => x.textContent === '更换目录');
    b.click();
    return 1;
  })()`);
  await sleep(1200);
  const text = await evalIn('document.querySelector(".lib-mini-body") ? document.querySelector(".lib-mini-body").textContent : ""');
  ok(text.includes(LIB2), '换目录前问了一句，并把新目录写出来了', text.slice(0, 200));
  await evalIn(`(() => {
    const b = [...document.querySelectorAll('.lib-mini-foot button')].find(x => x.textContent === '一起搬过去');
    b.click();
    return 1;
  })()`);
  await sleep(2500);
  eq(filesIn(LIB2).length, 2, '两份棋谱都搬到新目录了', filesIn(LIB2));
  eq(filesIn(LIB).length, 0, '老目录里的原件删掉了', filesIn(LIB));
  const now = await st('(await window.api.library.list())');
  eq(now.dir, LIB2, '棋谱馆现在指着新目录');
  eq(now.records.length, 2, '索引也跟着过去了');
  ok(
    existsSync(LIB2 + '/library.json'),
    '索引写在棋谱馆目录里（目录拷走索引也跟着走）',
    readdirSync(LIB2)
  );
}

/* --- 十一、关掉再开：标签与"这一盘属于哪条"都要回来 --- */
console.log('== 十一、关了再开 ==');
{
  // 从馆里打开一盘，确认打开之后记着它是哪条
  const first = (await st('(await window.api.library.list())')).records[0];
  if (first) {
    await st(`(s.openRecord(${JSON.stringify(first.id)}), 1)`);
    await sleep(1200);
    eq(await st('s.libraryPage'), false, '打开之后回到棋盘那页');
    const rec = await st('s.record');
    ok(rec && rec.id === first.id, '这一盘记着是从馆里哪一条打开的', rec);
    const same = await st('(await window.api.library.list())');
    eq(same.records.length, 2, '打开不会又存出一份');
  } else {
    ok(false, '馆里没有棋谱，这一段验不了');
  }

  // 给那一份打个标签，重启后要还在
  const target = (await st('(await window.api.library.list())')).records[0];
  await evalIn(
    `(async () => JSON.stringify(await window.api.library.update(${JSON.stringify(target.id)}, { tags: ['留下来的'] })))()`
  );
  await sleep(300);
  ok(await st('s.record !== null'), '重启前手里这盘记着馆里的编号');

  // 顺手验一件老毛病：写会话时当前那盘要取顶层这一份，不然关掉再开，正看着的这盘会落后一截
  await st('(s.play(11 * 19 + 11), 1)');
  await sleep(1500); // 会话是攒一会儿再写的，等它落盘
  const nodesBefore = await st('Object.keys(s.tree.nodes).length');

  {
    const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await sleep(3000);
    launch();
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try {
        await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(800) });
        break;
      } catch {
        /* 还在起 */
      }
    }
    cdp.close();
    const cdp2 = await connect();
    const { st: st2, evalIn: eval2 } = cdp2;
    for (let i = 0; i < 40; i++) {
      if (await st2('s.ready')) break;
      await sleep(500);
    }
    ok(await st2('s.ready'), '重开之后界面就绪');
    const rec = await st2('s.record');
    ok(rec && rec.id === target.id, '重开之后手里这盘记着的还是馆里那条', rec);
    eq(await st2('Object.keys(s.tree.nodes).length'), nodesBefore, '重开之后当前这盘的棋一手不少');
    const info = await st2('(await window.api.library.list())');
    eq(info.dir, LIB2, '棋谱馆目录也回来了');
    ok(
      info.records.some((r) => (r.tags ?? []).includes('留下来的')),
      '标签还在',
      info.records.map((r) => r.tags)
    );
    await eval2(`(window.__szys.getState().setLibraryPage(true), 1)`);
    await sleep(900);
    eq(await eval2('document.querySelectorAll(".lib-row").length'), 2, '重开之后棋谱馆里还是那两份');

    // 收尾：把程序关掉
    const v2 = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const ws2 = new WebSocket(v2.webSocketDebuggerUrl);
    await new Promise((r) => ws2.addEventListener('open', r));
    ws2.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  }
}

console.log('');
console.log(`棋谱馆验收：${passed} 项通过，${failed} 项失败`);
if (failed) console.log('失败项：' + failures.join(' / '));
process.exit(failed ? 1 : 0);
