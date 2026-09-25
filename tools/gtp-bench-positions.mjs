/**
 * 局面基准测试：同一个引擎进程里依次加载多个局面，分别计时。
 * 目的是定位"某些局面下引擎像卡住一样不出结果"的原因，
 * 比如摆子（AB/AW）特别多、局面接近终局、或者某种规则组合。
 * 用法: node tools/gtp-bench-positions.mjs [--visits N]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APPDATA = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
const RUNTIME = path.join(APPDATA, 'shenzhiyishou-runtime');
const backend = 'opencl';
const exe = path.join(RUNTIME, 'engine', backend, 'katago.exe');
const cfg = path.join(RUNTIME, 'engine', backend, 'default_gtp.cfg');
const modelDir = path.join(RUNTIME, 'models');
const modelFile = path.join(modelDir, readdirSync(modelDir).find((f) => f.includes('b18c384')));
if (!existsSync(modelFile)) {
  console.error('找不到网络:', modelFile);
  process.exit(1);
}

const argv = process.argv.slice(2);
const visits = argv.includes('--visits') ? Number(argv[argv.indexOf('--visits') + 1]) : 100;

const override = [
  `logDir=${path.join(RUNTIME, 'logs')}`,
  'logToStderr=false',
  'logAllGTPCommunication=false',
  'logSearchInfo=false',
  'rules=chinese',
  `maxVisits=${visits}`,
  'numSearchThreads=2',
  'nnMaxBatchSize=8',
  'nnCacheSizePowerOfTwo=19',
  'ponderingEnabled=false'
].join(',');

// 真实验收棋谱：终局摆子局面
const ACCEPT = path.resolve(import.meta.dirname, '../../..', '围棋对局_白胜3.5子.sgf');

// 从验收棋谱里裁出一个摆子局面：只保留前 n 个 AB/AW
function cutSetup(src, n, extra = '') {
  const ab = [...src.matchAll(/AB((?:\[[a-z]{2}\])+)/g)].flatMap((m) => [...m[1].matchAll(/\[([a-z]{2})\]/g)].map((x) => x[1]));
  const aw = [...src.matchAll(/AW((?:\[[a-z]{2}\])+)/g)].flatMap((m) => [...m[1].matchAll(/\[([a-z]{2})\]/g)].map((x) => x[1]));
  const take = (arr, k) => arr.slice(0, Math.min(k, arr.length)).map((v) => `[${v}]`).join('');
  const head = src.slice(1, src.indexOf('AB['));
  const base = '(;' + head.replace(/KM\[[^\]]*\]/, 'KM[7.5]');
  return `${base}${take(ab, n)}${take(aw, n)}${extra})`;
}

const src = existsSync(ACCEPT) ? (await import('node:fs')).readFileSync(ACCEPT, 'utf8') : null;
if (!src) console.warn('没找到验收棋谱，跳过相关用例:', ACCEPT);

const cases = [
  { name: '空盘', sgf: '(;GM[1]FF[4]SZ[19]KM[7.5]RU[Chinese])' },
  { name: '开局 5 手', sgf: '(;GM[1]FF[4]SZ[19]KM[7.5]RU[Chinese];B[pd];W[dp];B[pq];W[dd];B[fq])' },
  ...(src
    ? [
        { name: '摆子 20 手', sgf: cutSetup(src, 20) },
        { name: '摆子 60 手', sgf: cutSetup(src, 60) },
        { name: '摆子 全部', sgf: src },
        { name: '摆子 全部 无注释/规则', sgf: src.replace(/C\[[\s\S]*?\]/g, '').replace(/RU\[[^\]]*\]/g, '') }
      ]
    : [])
];

mkdirSync(path.join(RUNTIME, 'tmp'), { recursive: true });

const child = spawn(exe, ['gtp', '-model', modelFile, '-config', cfg, '-override-config', override], {
  cwd: path.join(RUNTIME, 'engine', backend),
  stdio: ['pipe', 'pipe', 'pipe']
});

let buf = '';
const waiters = [];
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).replace(/\r$/, '');
    buf = buf.slice(i + 1);
    for (const w of waiters.slice()) w(line);
  }
});
child.stderr.on('data', () => undefined);

function nextLine(timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const w = (line) => {
      if (done) return;
      done = true;
      waiters.splice(waiters.indexOf(w), 1);
      clearTimeout(timer);
      resolve(line);
    };
    const timer = setTimeout(() => w('__TIMEOUT__'), timeoutMs);
    waiters.push(w);
  });
}

async function send(cmd) {
  child.stdin.write(cmd + '\n');
}

// 等引擎就绪
{
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < 90000) {
    const line = await nextLine(90000 - (Date.now() - t0));
    if (line === '__TIMEOUT__') break;
    if (line.startsWith('=') && buf.includes('')) {
      // 读到第一行 '=' 说明 version 有响应了（这里先发 name 探测）
    }
    if (line === '= KataGo' || line.startsWith('= KataGo')) {
      ready = true;
      break;
    }
  }
  if (!ready) {
    console.log('引擎没有在 90 秒内就绪（可能是首次 OpenCL 调优）');
  }
  console.log(`引擎就绪，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒\n`);
}

console.log('局面'.padEnd(24), 'loadsgf'.padStart(9), '首条info'.padStart(10), '落子'.padStart(9), '结果');
console.log('-'.repeat(78));

for (const c of cases) {
  const file = path.join(RUNTIME, 'tmp', 'bench.sgf');
  writeFileSync(file, c.sgf, 'utf8');

  const t0 = Date.now();
  await send(`loadsgf ${file}`);
  // loadsgf 的响应以空行结束
  const loadOk = await (async () => {
    const first = await nextLine(60000);
    if (first === '__TIMEOUT__') return false;
    while (true) {
      const l = await nextLine(60000);
      if (l === '' || l === '__TIMEOUT__') return l === '';
    }
  })();
  const loadMs = Date.now() - t0;

  await send('kata-genmove_analyze b 1000');
  let firstInfoMs = null;
  let moveMs = null;
  let move = '';
  while (moveMs === null) {
    const line = await nextLine(45000);
    if (line === '__TIMEOUT__') break;
    if (line.startsWith('info ') && firstInfoMs === null) firstInfoMs = Date.now() - t0;
    if (line.startsWith('play ') || line.startsWith('pass') || line.startsWith('resign')) {
      moveMs = Date.now() - t0;
      move = line;
    }
  }
  if (moveMs === null) await send('stop');
  if (moveMs === null) {
    // 收掉 stop 的响应
    while (true) {
      const l = await nextLine(5000);
      if (l === '' || l === '__TIMEOUT__') break;
    }
  }

  const fmt = (ms) => (ms === null ? '—' : (ms / 1000).toFixed(1) + 's');
  console.log(
    c.name.padEnd(24),
    (loadOk ? (loadMs / 1000).toFixed(1) + 's' : '失败').padStart(9),
    fmt(firstInfoMs).padStart(10),
    fmt(moveMs).padStart(9),
    move.slice(0, 20)
  );
}

await send('quit');
await new Promise((r) => setTimeout(r, 800));
child.kill();
process.exit(0);
