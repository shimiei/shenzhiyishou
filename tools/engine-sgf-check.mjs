/**
 * 真引擎复验：把 tools/engine-sgf-cases.ts 造出来的每一份局面喂给 KataGo，问三件事：
 * loadsgf 收不收、盘面对不对、行棋方对不对。
 * 前两件是这次修 bug 的正题：KataGo 只认根节点上的摆子，而且根节点只有摆子时
 * 它按让子惯例算白走，所以送进去的 SGF 必须把摆子收进根节点、把轮次写死。
 * 用法: node tools/engine-sgf-check.mjs
 */
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';
import path from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'dist', 'engine-sgf-cases.mjs');

await build({
  entryPoints: [join(here, 'engine-sgf-cases.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  logLevel: 'warning'
});

const run = spawnSync(process.execPath, [out], { encoding: 'utf8' });
if (run.status !== 0) {
  console.error(run.stderr);
  process.exit(1);
}
const cases = JSON.parse(run.stdout);
console.log(`造出 ${cases.length} 个局面，准备问引擎`);

const APPDATA = process.env.APPDATA ?? join(os.homedir(), 'AppData', 'Roaming');
const RUNTIME = join(APPDATA, 'shenzhiyishou-runtime');
const backend = 'opencl';
const exe = join(RUNTIME, 'engine', backend, 'katago.exe');
const cfg = join(RUNTIME, 'engine', backend, 'default_gtp.cfg');
const modelDir = join(RUNTIME, 'models');
// 小网络够回答这几件事，还快
const smallDir = readdirSync(modelDir).find((d) => d.includes('b6c96') || /^b\d/.test(d));
const modelFile = smallDir
  ? join(modelDir, smallDir, 'model.txt.gz')
  : join(modelDir, readdirSync(modelDir).find((f) => f.includes('b18c384')));
if (!existsSync(modelFile)) {
  console.error('找不到网络:', modelFile);
  process.exit(1);
}

const override = [
  `logDir=${join(RUNTIME, 'logs')}`,
  'logToStderr=false',
  'logAllGTPCommunication=false',
  'logSearchInfo=false',
  'rules=chinese',
  'maxVisits=20',
  'numSearchThreads=2',
  'ponderingEnabled=false'
].join(',');

const tmp = join(RUNTIME, 'tmp');
mkdirSync(tmp, { recursive: true });

const child = spawn(exe, ['gtp', '-model', modelFile, '-config', cfg, '-override-config', override], {
  cwd: join(RUNTIME, 'engine', backend),
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
child.stderr.on('data', (d) => {
  const text = String(d).trim();
  if (text && !/Sgf has no rules/.test(text)) process.stderr.write('[stderr] ' + text.slice(0, 200) + '\n');
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (c) => child.stdin.write(c + '\n');
async function waitFor(pred, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const found = lines.find(pred);
    if (found) return found;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(120);
  }
}

/**
 * 把 showboard 的 ASCII 盘面读出来：X 黑，O 白，. 空。
 * 注意 KataGo 会把这一手的序号跟在棋子后面（"O3O1. . ."），
 * 所以不能按空格切，得一格一格地走：读到 X/O/. 就算一个点，后面跟的数字是标注。
 */
function parseShowboard(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\d{1,2})\s+([.XOxo].*)$/.exec(line);
    if (!m) continue;
    const cells = [];
    for (const ch of m[2]) {
      if (ch === ' ') continue;
      if (ch === '.' || ch === 'X' || ch === 'x') cells.push(ch === '.' ? '.' : 'X');
      else if (ch === 'O' || ch === 'o') cells.push('O');
      // 其余是棋子后面的手数标注，跳过
    }
    if (cells.length >= 19) rows.push(cells.slice(0, 19).join(''));
  }
  return rows;
}

let passed = 0;
let failed = 0;
const started = Date.now();
await sleep(18000);
send('name');
await waitFor((l) => /^=/.test(l), 30000);

for (const c of cases) {
  const file = join(tmp, 'engine-sgf-case.sgf');
  writeFileSync(file, c.sgf, 'utf8');
  lines.length = 0;
  send(`loadsgf ${file}`);
  const res = await waitFor((l) => /^[=?]/.test(l), 30000);
  if (!res || !/^=/.test(res)) {
    failed += 1;
    console.log(`  失败 ${c.name}：loadsgf 被拒 ${res ?? '(超时)'}`);
    console.log(`       ${c.sgf.replace(/\n/g, ' ').slice(0, 150)}`);
    continue;
  }
  lines.length = 0;
  send('showboard');
  await sleep(700);
  const shown = lines.join('\n');
  if (process.env.SZYS_DUMP === '1') console.log(`--- ${c.name} 的 showboard 原文 ---\n${shown}\n---`);
  const board = parseShowboard(shown);
  const turnLine = /Next player:\s*(Black|White|B|W)/i.exec(shown);
  const turn = turnLine ? (turnLine[1][0].toUpperCase() === 'B' ? 'B' : 'W') : '?';
  const problems = [];
  if (board.length !== 19) problems.push('没读到盘面');
  else {
    let diff = 0;
    for (let y = 0; y < 19; y++) {
      for (let x = 0; x < 19; x++) if (board[y][x] !== c.board[y][x]) diff += 1;
    }
    if (diff > 0) {
      problems.push(`盘面有 ${diff} 个点不一致`);
      const first = c.board.findIndex((row, y) => row !== board[y]);
      if (first >= 0) problems.push(`第一处第 ${first + 1} 行：我们 ${c.board[first]} / 引擎 ${board[first]}`);
    }
  }
  if (turn !== c.turn) problems.push(`行棋方不一致：我们希望 ${c.turn}，引擎说 ${turn}`);
  if (problems.length > 0) {
    failed += 1;
    console.log(`  失败 ${c.name}`);
    for (const p of problems) console.log(`       ${p}`);
  } else {
    passed += 1;
    console.log(`  ok   ${c.name}（盘面一致，轮到 ${c.turn}）`);
  }
}

console.log(`\n真引擎复验：${passed} 项通过，${failed} 项失败，用时 ${((Date.now() - started) / 1000).toFixed(0)}s`);
send('quit');
await sleep(700);
child.kill();
process.exit(failed === 0 ? 0 : 1);
