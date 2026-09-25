/**
 * 引擎链路自测：用应用自己的 GTP 客户端、应用生成的那套 -override-config，
 * 跑一遍启动 / loadsgf / 落子 / 分析，验证真实引擎在运行时目录里能不能工作。
 * 用法: node tools/gtp-selftest.mjs [--model <文件名>]
 */
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { GtpEngine } = require('../dist/main/gtp.js');

const APPDATA = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
const RUNTIME = path.join(APPDATA, 'shenzhiyishou-runtime');
const PROJECT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const modelArg = argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : null;

for (const d of ['engine', 'models', 'logs', 'tmp']) mkdirSync(path.join(RUNTIME, d), { recursive: true });

// 把引擎镜像到运行时目录（和 ensureRuntime 做的事一致）
const srcEngine = path.join(PROJECT, 'engine');
for (const name of readdirSync(srcEngine)) {
  const s = path.join(srcEngine, name);
  if (!statSync(s).isDirectory()) continue;
  const d = path.join(RUNTIME, 'engine', name);
  if (!existsSync(path.join(d, 'katago.exe'))) {
    console.log('[镜像] engine/' + name);
    cpSync(s, d, { recursive: true });
  }
}

const backend = process.argv.includes('--eigen') ? 'eigenavx2' : 'opencl';
const exe = path.join(RUNTIME, 'engine', backend, 'katago.exe');
const cfg = path.join(RUNTIME, 'engine', backend, 'default_gtp.cfg');

const modelDir = path.join(RUNTIME, 'models');
const cands = readdirSync(modelDir).filter((f) => f.endsWith('.bin.gz') || f.endsWith('.txt.gz'));
const modelName = modelArg ?? cands.find((f) => f.includes('b18c384')) ?? cands[0];
const modelFile = path.join(modelDir, modelName);
if (!modelFile || !existsSync(modelFile)) {
  console.error('找不到网络文件，models 目录里有:', cands);
  process.exit(1);
}

const override = [
  `logDir=${path.join(RUNTIME, 'logs')}`,
  'logToStderr=false',
  'logAllGTPCommunication=false',
  'logSearchInfo=false',
  'rules=chinese',
  'maxVisits=400',
  'numSearchThreads=2',
  'nnMaxBatchSize=8',
  'nnCacheSizePowerOfTwo=19',
  'ponderingEnabled=false',
  'allowResignation=true',
  'resignThreshold=-0.9',
  'chosenMoveTemperature=0'
].join(',');

const args = ['gtp', '-model', modelFile, '-config', cfg, '-override-config', override];

console.log('引擎:', exe);
console.log('网络:', modelName);
console.log('参数:', args.join(' ').slice(0, 220) + '…');

const eng = new GtpEngine('selftest');
eng.on('log', (t) => console.log('  [引擎]', String(t).slice(0, 200)));

const t0 = Date.now();
await eng.start(exe, args, path.join(RUNTIME, 'engine', backend));
console.log(`\n✓ 启动成功，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
console.log('  name:', (await eng.send('name')).trim());
console.log('  version:', (await eng.send('version')).trim());

const sgf = `(;GM[1]FF[4]SZ[19]KM[7.5]RU[Chinese]PB[自测]PW[引擎]DT[2026-09-25]
;B[pd];W[dp];B[pq];W[dd];B[fq];W[cn];B[jp];W[qf];B[nc];W[rd])`;
const sgfPath = path.join(RUNTIME, 'tmp', 'position.sgf');
writeFileSync(sgfPath, sgf, 'utf8');
await eng.send(`loadsgf ${sgfPath}`, 30000);
console.log('✓ loadsgf 成功（10 手的开局）');

// 让引擎落一手，同时看流式 info 能不能解析出来
let infoCount = 0;
let lastInfo = '';
const gen = eng.stream('kata-genmove_analyze b 60', (line) => {
  if (line.startsWith('info ')) {
    infoCount += 1;
    lastInfo = line;
  }
});
const genText = await gen.promise;
const move = genText.trim().split('\n').pop().trim();
console.log(`✓ 引擎落子: ${move}（收到 ${infoCount} 条实时 info）`);
if (lastInfo) console.log('  最后一条 info:', lastInfo.slice(0, 180) + '…');

// 形势分析：解析 winrate / scoreLead / pv / ownership
const lines = [];
// 注意 kata-analyze 没有颜色参数，而且这个版本的 KataGo 要求开关带值：
// 要写 "kata-analyze 60 ownership true"。少写颜色不行，少写 true 也不行，
// 两种都会被引擎以 Could not parse analyze arguments 拒掉，现象都是分析没反应。
const an = eng.stream('kata-analyze 60 ownership true', (line) => lines.push(line));
await new Promise((r) => setTimeout(r, 4000));
an.stop();
try {
  await an.promise;
} catch {
  /* stop 之后结束即可 */
}
const infos = lines.filter((l) => l.startsWith('info '));
const last = infos[infos.length - 1] ?? '';
const grab = (key) => {
  const m = last.match(new RegExp(`${key} (-?[\\d.]+)`));
  return m ? Number(m[1]) : null;
};
const own = last.includes('ownership')
  ? last.slice(last.indexOf('ownership') + 'ownership'.length).trim().split(/\s+/).filter((x) => x !== '').length
  : 0;
console.log(`✓ 形势分析: ${infos.length} 条 info`);
console.log(
  `  visits=${grab('visits')} winrate=${grab('winrate')} scoreLead=${grab('scoreLead')} ownership点数=${own}`
);
// 引擎报的坐标是 GTP 写法（大写字母加数字，如 C17），不是 SGF 的小写
const moves = [...last.matchAll(/move ([A-HJ-T]\d{1,2}|pass|resign)/g)].map((m) => m[1]);
console.log(`  候选点 ${moves.length} 个:`, moves.slice(0, 8).join(' '));

// 回归：再分析一次。stop 之后引擎会多回一条响应，客户端要是没接住，
// 之后的命令就会集体错位一条，症状是分析一条结果都不出。这条断言专门盯它。
const lines2 = [];
const an2 = eng.stream('kata-analyze 60 ownership true', (line) => lines2.push(line));
await new Promise((r) => setTimeout(r, 4000));
an2.stop();
try {
  await an2.promise;
} catch {
  /* stop 之后结束即可 */
}
const infos2 = lines2.filter((l) => l.startsWith('info '));
console.log(`\n✓ 二次分析（stop 之后再跑一轮）: ${infos2.length} 条 info`);
if (infos2.length === 0) {
  console.error('✗ 二次分析没有输出：命令队列很可能又被 stop 的额外响应带错位了。');
  process.exit(1);
}
const stray = [];
eng.on('log', (t) => stray.push(String(t)));
await eng.send('name', 10000);
await new Promise((r) => setTimeout(r, 300));
const strays = stray.filter((t) => t.startsWith('info '));
if (strays.length) {
  console.error(`✗ 有多达 ${strays.length} 条 info 行没有归到任何命令上，说明响应还是错位的。`);
  process.exit(1);
}
console.log('✓ 没有游离的 info 行，命令与响应对齐');

await eng.quit();
console.log('\n✓ 引擎已退出，链路自测通过');
process.exit(0);
