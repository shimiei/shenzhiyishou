/**
 * 极简 CDP 客户端，用来给跑起来的应用截图、在页面里求值。
 * 用法:
 *   node tools/cdp.mjs shot <输出.png>
 *   node tools/cdp.mjs eval "<表达式>"
 *   node tools/cdp.mjs click "<CSS 选择器>" [序号]
 *   node tools/cdp.mjs watch <毫秒>   监听控制台报错
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchTargets, pickAppPage } from './app-target.mjs';

const PORT = process.env.CDP_PORT ?? '9222';

/** 挑主页面（叠层那个 overlay.html 也是 file: 页面目标，不能按"第一个"挑）。 */
async function pickPage() {
  return pickAppPage((await fetchTargets(PORT)).filter((t) => !t.url.startsWith('devtools://')));
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: r, reject: j } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) j(new Error(msg.error.message));
        else r(msg.result);
      } else if (msg.method) {
        for (const l of listeners) l(msg);
      }
    });
    ws.addEventListener('error', (e) => reject(new Error('ws 错误: ' + e.message)));
    ws.addEventListener('open', () =>
      resolve({
        send(method, params = {}) {
          return new Promise((r, j) => {
            const mid = ++id;
            pending.set(mid, { resolve: r, reject: j });
            ws.send(JSON.stringify({ id: mid, method, params }));
          });
        },
        on(fn) {
          listeners.push(fn);
        },
        close: () => ws.close()
      })
    );
  });
}

const [cmd, arg1, arg2] = process.argv.slice(2);
const page = await pickPage();
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');

if (cmd === 'shot') {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg1, Buffer.from(data, 'base64'));
  console.log('已保存截图', arg1);
} else if (cmd === 'eval') {
  const r = await cdp.send('Runtime.evaluate', { expression: arg1, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) console.error('页面报错:', JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails));
  else console.log(JSON.stringify(r.result.value, null, 2));
} else if (cmd === 'click') {
  const idx = Number(arg2 ?? 0);
  const expr = `(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(arg1)})];
    if (!els.length) return { ok: false, count: 0 };
    const el = els[${idx}];
    const label = (el.textContent || '').trim().slice(0, 30);
    el.click();
    return { ok: true, count: els.length, label };
  })()`;
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(JSON.stringify(r.result.value));
} else if (cmd === 'load-sgf') {
  // 把磁盘上的 SGF 灌进界面，省去点原生文件对话框
  const text = readFileSync(arg1, 'utf8');
  const expr = `__szys.getState().loadSgf(${JSON.stringify(text)}, ${JSON.stringify(arg1)})`;
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) console.error('页面报错:', r.exceptionDetails.exception?.description);
  else console.log('已载入', arg1);
} else if (cmd === 'dump-image') {
  // 把界面里当前那张待识别图片存到磁盘，方便用 cv-check 复现
  const r = await cdp.send('Runtime.evaluate', {
    expression: "(window.__szys && __szys.getState().image) ? __szys.getState().image.dataUrl : ''",
    returnByValue: true
  });
  const url = r.result.value ?? '';
  if (!url.startsWith('data:')) {
    console.error('界面里没有图片');
    process.exit(1);
  }
  writeFileSync(arg1, Buffer.from(url.split(',')[1], 'base64'));
  console.log('已保存', arg1);
} else if (cmd === 'click-at') {
  const x = Number(arg1);
  const y = Number(arg2);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      clickCount: type === 'mouseMoved' ? 0 : 1,
      buttons: type === 'mousePressed' ? 1 : 0
    });
  }
  console.log(`已点击 (${x}, ${y})`);
} else if (cmd === 'key') {
  const key = arg1;
  const map = { ' ': { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' } };
  const info = map[key] ?? { key, code: 'Key' + key.toUpperCase(), windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0), text: key };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...info });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...info });
  console.log('已按键', key);
} else if (cmd === 'watch') {
  const ms = Number(arg1 ?? 5000);
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      console.log(`[控制台 ${msg.params.type}]`, String(text).slice(0, 400));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      console.log('[页面异常]', String(msg.params.exceptionDetails.exception?.description ?? '').slice(0, 400));
    }
  });
  await new Promise((r) => setTimeout(r, ms));
  console.log('监听结束');
} else {
  console.error('未知命令');
}

cdp.close();
process.exit(0);
