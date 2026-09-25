/**
 * 在棋盘上点一个交叉点，走真实输入管线（CDP Input.dispatchMouseEvent），
 * 用来验收"点哪个交叉点，棋子就落在哪个交叉点"。
 * 用法: node tools/probe-board-click.mjs <列> <行> [端口]     列/行从 0 起，左上角是 0 0
 */
const PORT = process.argv[4] ?? process.env.CDP_PORT ?? '9223';
const col = Number(process.argv[2] ?? 3);
const row = Number(process.argv[3] ?? 3);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pick = list.find((t) => t.type === 'page' && t.url.startsWith('file:'));
if (!pick) throw new Error('没找到应用窗口');
const ws = new WebSocket(pick.webSocketDebuggerUrl);
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
const geo = await send('Runtime.evaluate', {
  expression: `(async () => {
    const c = document.querySelector('canvas.board-canvas');
    if (!c) return { error: '没有棋盘' };
    const r = c.getBoundingClientRect();
    const st = await window.api.settings.get();
    const px = r.width;
    const size = 19;
    const pad = st.coords ? px * (size >= 19 ? 0.052 : 0.075) : px * 0.032;
    return { left: r.left, top: r.top, px, pad, step: (px - pad * 2) / (size - 1), coords: st.coords };
  })()`,
  awaitPromise: true,
  returnByValue: true
});
const g = geo.result.value;
if (!g || g.error) throw new Error(g?.error ?? '拿不到棋盘位置');
const x = Math.round(g.left + g.pad + col * g.step);
const y = Math.round(g.top + g.pad + row * g.step);
console.log(`棋盘 ${g.px.toFixed(0)}px 内边距 ${g.pad.toFixed(1)} 步长 ${g.step.toFixed(2)} 坐标显示=${g.coords}`);
console.log(`点 (${col},${row}) → 屏幕 ${x},${y}`);
for (const type of ['mousePressed', 'mouseReleased']) {
  await send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    buttons: type === 'mousePressed' ? 1 : 0,
    clickCount: 1
  });
  await new Promise((r) => setTimeout(r, 60));
}
await new Promise((r) => setTimeout(r, 400));
ws.close();
