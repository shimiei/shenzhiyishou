/**
 * loadsgf 兼容性探针：一次启动，逐个变体问引擎。
 * 要弄清两件事：KataGo 到底接受哪几种摆子写法，以及加载完之后它认为轮谁走。
 * 轮次直接读 showboard 里的 "Next player:"，别拿 kata-analyze 的胜率去推，
 * 同一个局面摆子写法稍微一变，胜率会跟着行棋方翻个面，读起来容易反。
 * 用法: node tools/sgf-load-probe.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APPDATA = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
const RUNTIME = path.join(APPDATA, 'shenzhiyishou-runtime');
const backend = 'opencl';
const exe = path.join(RUNTIME, 'engine', backend, 'katago.exe');
const cfg = path.join(RUNTIME, 'engine', backend, 'default_gtp.cfg');
const modelDir = path.join(RUNTIME, 'models');
// 小网络足够回答"能不能加载、轮到谁"，还快得多
const smallDir = readdirSync(modelDir).find((d) => /^b\d/.test(d) || d.includes('b6c96'));
const modelFile = smallDir
  ? path.join(modelDir, smallDir, 'model.txt.gz')
  : path.join(modelDir, readdirSync(modelDir).find((f) => f.includes('b18c384')));
if (!existsSync(modelFile)) {
  console.error('找不到网络:', modelFile);
  process.exit(1);
}

const override = [
  `logDir=${path.join(RUNTIME, 'logs')}`,
  'logToStderr=false',
  'logAllGTPCommunication=false',
  'logSearchInfo=false',
  'rules=chinese',
  'maxVisits=200',
  'numSearchThreads=2',
  'ponderingEnabled=false'
].join(',');

const tmp = path.join(RUNTIME, 'tmp');
mkdirSync(tmp, { recursive: true });

// 黑八个星位，白一子没有：黑大优，用来读胜率的正负（也就是轮谁走）
const STARS = 'AB[dd][pp][dp][pj][jj][dj][jd][jp]';
const variants = [
  ['A 根节点无摆子，第二个节点摆子（用户遇到的报错）', `(;GM[1]FF[4]SZ[19]KM[7.5];${STARS})`],
  ['B 摆子全在根节点', `(;GM[1]FF[4]SZ[19]KM[7.5]${STARS})`],
  ['C 根节点摆子 + PL[B]', `(;GM[1]FF[4]SZ[19]KM[7.5]${STARS}PL[B])`],
  ['D 根节点摆子 + PL[W]', `(;GM[1]FF[4]SZ[19]KM[7.5]${STARS}PL[W])`],
  ['E 空棋盘 + PL[W]', '(;GM[1]FF[4]SZ[19]KM[7.5]PL[W])'],
  ['F 根节点摆子 + 两手棋（黑先）', `(;GM[1]FF[4]SZ[19]KM[7.5]${STARS};B[cc];W[dc])`],
  ['G 摆子挪到根、后面还有手数', `(;GM[1]FF[4]SZ[19]KM[7.5]${STARS};B[cc];W[dc])`],
  ['H 根节点有 AE', '(;GM[1]FF[4]SZ[19]KM[7.5]AE[dd])'],
  ['I 先手棋再 AE 提掉它', '(;GM[1]FF[4]SZ[19]KM[7.5];B[dd];AE[dd])'],
  ['J 根节点 AB + AE 同点', '(;GM[1]FF[4]SZ[19]KM[7.5]AB[dd]AE[dd])'],
  ['K 两手棋后摆子（摆子在手数之后）', `(;GM[1]FF[4]SZ[19]KM[7.5];B[cc];W[dc];${STARS})`],
  ['L 根节点写 PL 又跟着手数', '(;GM[1]FF[4]SZ[19]KM[7.5]PL[B];B[cc];W[dc])'],
  ['M AE 在根、手数落在同一个点', '(;GM[1]FF[4]SZ[19]KM[7.5]AE[dd];B[dd])']
];

const child = spawn(exe, ['gtp', '-model', modelFile, '-config', cfg, '-override-config', override], {
  cwd: path.join(RUNTIME, 'engine', backend),
  stdio: ['pipe', 'pipe', 'pipe']
});

let buf = '';
const lines = [];
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    lines.push(buf.slice(0, i).replace(/\r$/, ''));
    buf = buf.slice(i + 1);
  }
});
child.stderr.on('data', (d) => process.stderr.write('[stderr] ' + String(d).slice(0, 200)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let waiters = [];
child.stdout.on('data', () => {
  for (const w of waiters) w();
});
function waitFor(pred, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const check = () => {
      const found = lines.find(pred);
      if (found) {
        cleanup();
        resolve(found);
      } else if (Date.now() - t0 > timeoutMs) {
        cleanup();
        resolve(null);
      }
    };
    const cleanup = () => {
      waiters = waiters.filter((w) => w !== check);
      clearInterval(timer);
    };
    const timer = setInterval(check, 120);
    waiters.push(check);
    check();
  });
}
const send = (c) => child.stdin.write(c + '\n');

let ok = 0;
let fail = 0;
const started = Date.now();
await sleep(18000);
send('name');
const nameLine = await waitFor((l) => /^=\s/.test(l), 30000);
console.log(`引擎: ${nameLine ?? '(没回应)'}  网络: ${path.basename(path.dirname(modelFile))}/${path.basename(modelFile)}`);

for (const [label, sgf] of variants) {
  const file = path.join(tmp, 'probe.sgf');
  writeFileSync(file, sgf, 'utf8');
  console.log(`\n=== ${label}`);
  console.log(`    ${sgf}`);
  lines.length = 0;
  send(`loadsgf ${file}`);
  const res = await waitFor((l) => /^[=?]/.test(l), 30000);
  const good = res && /^=\s/.test(res);
  console.log(`    loadsgf: ${res ?? '(超时)'}`);
  if (!good) {
    fail += 1;
    continue;
  }
  ok += 1;

  lines.length = 0;
  send('showboard');
  await sleep(600);
  const shown = lines.join('\n');
  const turnLine = shown.split('\n').find((l) => /next player/i.test(l));
  console.log(`    行棋方: ${turnLine ? turnLine.replace(/^=?\s*/, '').trim() : '(showboard 没说)'}`);

  lines.length = 0;
  send('kata-analyze 60');
  await sleep(2500);
  send('stop');
  await sleep(600);
  const info = lines.filter((l) => l.startsWith('info ')).pop() ?? '';
  const wr = /winrate ([\d.]+)/.exec(info);
  const move = /^\s*info move (\S+)/.exec(info);
  console.log(`    分析: ${wr ? `胜率 ${(Number(wr[1]) * 100).toFixed(1)}%` : '(没有 info 行)'}${move ? `，首选 ${move[1]}` : ''}`);
}

// hint 走的是 kata-genmove_analyze <color>：看看它认不认"和加载局面不同色"的落子请求
console.log('\n=== N 加载白走的局面，然后让引擎替黑落子');
{
  const file = path.join(tmp, 'probe-genmove.sgf');
  writeFileSync(file, `(;GM[1]FF[4]SZ[19]KM[7.5]${STARS}PL[W])`, 'utf8');
  lines.length = 0;
  send(`loadsgf ${file}`);
  const res = await waitFor((l) => /^[=?]/.test(l), 30000);
  console.log(`    loadsgf: ${res ?? '(超时)'}`);
  lines.length = 0;
  send('kata-genmove_analyze b 60');
  await sleep(2500);
  send('stop');
  await sleep(600);
  const play = lines.find((l) => /^(play|pass|resign)\b/i.test(l)) ?? lines.filter((l) => l.startsWith('info ')).pop() ?? '';
  console.log(`    回应: ${play || '(空)'}`);
}

console.log(`\n合计：能加载 ${ok} 个，被拒 ${fail} 个，用时 ${((Date.now() - started) / 1000).toFixed(0)}s`);
send('quit');
await sleep(700);
child.kill();
process.exit(0);
