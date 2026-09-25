/**
 * 实机验收用的小工具：通过 CDP 在跑着的应用里求值。
 * 用法：node tools/live-probe.mjs "<表达式>"  [端口]
 * 表达式在渲染进程里求值，返回值的 JSON 会打出来。
 */
const PORT = process.argv[3] ?? process.env.CDP_PORT ?? '9223';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pick = process.env.CDP_TARGET
  ? list.find((t) => (t.url + t.title).includes(process.env.CDP_TARGET))
  : list.find((t) => t.type === 'page' && t.url.startsWith('file:'));
if (!pick) throw new Error('没找到目标，现有：' + list.map((t) => t.type + ' ' + t.url.slice(0, 60)).join(' | '));
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
const r = await send('Runtime.evaluate', { expression: process.argv[2], awaitPromise: true, returnByValue: true });
if (r.exceptionDetails) {
  console.error('求值出错：' + (r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)));
  process.exit(1);
}
console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 2));
ws.close();
