/**
 * kata-analyze 语法探针。
 * 不同版本的 KataGo 对 kata-analyze 的参数格式不一样，写错了引擎会回 '?'，
 * 而分析功能表面上是"没反应"。这个脚本把几种常见写法都试一遍，
 * 看哪一种真能持续吐 info 行，省得靠猜。
 * 用法: node tools/gtp-probe.mjs
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { GtpEngine } = require('../dist/main/gtp.js');

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

const override = [
  `logDir=${path.join(RUNTIME, 'logs')}`,
  'logToStderr=false',
  'logAllGTPCommunication=true',
  'logSearchInfo=false',
  'rules=chinese',
  'maxVisits=200',
  'numSearchThreads=2',
  'nnMaxBatchSize=8',
  'nnCacheSizePowerOfTwo=19',
  'ponderingEnabled=false'
].join(',');

const eng = new GtpEngine('probe');
eng.on('log', () => undefined);
console.log('启动引擎…');
await eng.start(exe, ['gtp', '-model', modelFile, '-config', cfg, '-override-config', override], path.join(RUNTIME, 'engine', backend));
console.log('引擎就绪');

mkdirSync(path.join(RUNTIME, 'tmp'), { recursive: true });
const sgfPath = path.join(RUNTIME, 'tmp', 'probe.sgf');
writeFileSync(sgfPath, '(;GM[1]FF[4]SZ[19]KM[7.5];B[pd];W[dp];B[pq];W[dd];B[fq])', 'utf8');

const candidates = [
  'kata-analyze 100',
  'kata-analyze 100 ownership true',
  'kata-analyze 100 rootInfo true',
  'kata-analyze 100 ownershipStdev true',
  'kata-analyze 100 moves 0 ownership true',
  'kata-analyze 100 analyzeTurns 1 ownership true'
];

for (const cmd of candidates) {
  await eng.send(`loadsgf ${sgfPath}`, 30000).catch(() => undefined);
  let infos = 0;
  let first = '';
  const st = eng.stream(cmd, (line) => {
    if (line.startsWith('info ')) {
      infos += 1;
      if (!first) first = line;
    }
  });
  let err = '';
  const raced = await Promise.race([
    st.promise.then(() => 'ended').catch((e) => 'rejected: ' + (e instanceof Error ? e.message : String(e))),
    new Promise((r) => setTimeout(() => r('running'), 4000))
  ]);
  if (typeof raced === 'string' && (raced.startsWith('rejected') || raced === 'ended')) err = raced;
  st.stop();
  await st.promise.catch(() => undefined);
  console.log(`\n${cmd}\n  info 行数: ${infos}   结局: ${err || '持续运行'}`);
  if (first) console.log('  首行:', first.slice(0, 150));
}

await eng.quit();
process.exit(0);
