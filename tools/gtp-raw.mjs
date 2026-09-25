/**
 * 裸探针：直接跟 katago.exe 说话，原样打印 stdout。
 * 用来确认 kata-analyze 到底接不接受某个参数、又会吐什么，
 * 绕开应用自己的 GTP 客户端，避免把客户端的解析行为当成引擎行为。
 * 用法: node tools/gtp-raw.mjs "kata-analyze 60 ownership true" [等待秒数]
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
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

const cmd = process.argv[2] ?? 'kata-analyze 60 ownership true';
const waitSec = Number(process.argv[3] ?? 12);
// 可选第四个参数：要加载的 SGF 文件，用来复现某个具体局面下的行为
const sgfArg = process.argv[4];

const override = [
  `logDir=${path.join(RUNTIME, 'logs')}`,
  'logToStderr=false',
  'logAllGTPCommunication=false',
  process.env.LOG_SEARCH ? 'logSearchInfo=true' : 'logSearchInfo=false',
  'rules=chinese',
  'maxVisits=300',
  'numSearchThreads=2',
  'nnMaxBatchSize=8',
  'nnCacheSizePowerOfTwo=19',
  'ponderingEnabled=false'
].join(',');

mkdirSync(path.join(RUNTIME, 'tmp'), { recursive: true });
const sgfPath = path.join(RUNTIME, 'tmp', 'raw.sgf');
if (sgfArg) cpSync(sgfArg, sgfPath);
else writeFileSync(sgfPath, '(;GM[1]FF[4]SZ[19]KM[7.5];B[pd];W[dp];B[pq];W[dd];B[fq])', 'utf8');

const child = spawn(exe, ['gtp', '-model', modelFile, '-config', cfg, '-override-config', override], {
  cwd: path.join(RUNTIME, 'engine', backend),
  stdio: ['pipe', 'pipe', 'pipe']
});

const t0 = Date.now();
let buf = '';
let infoCount = 0;
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;

child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).replace(/\r$/, '');
    buf = buf.slice(i + 1);
    if (line.startsWith('info ')) {
      infoCount += 1;
      {
        console.log(`${stamp()} [info #${infoCount}] ${line.slice(0, 88)}`);
      }
    } else {
      console.log(`${stamp()} [引擎] ${line.slice(0, 200) || '(空行)'}`);
    }
  }
});
child.stderr.on('data', (d) => console.log(`${stamp()} [stderr] ${String(d).slice(0, 160)}`));

const send = (c) => {
  console.log(`${stamp()} >>> ${c}`);
  child.stdin.write(c + '\n');
};

console.log('等引擎就绪（读到 GTP ready 再发命令）…');
child.stdout.on('data', function waiter() {
  // 就绪后发命令
  if (buf.includes('beginning main protocol loop') || buf.includes('GTP ready')) {
    child.stdout.off('data', waiter);
  }
});

// 简化：直接等固定时间再发，加载网络大约需要十几秒
await new Promise((r) => setTimeout(r, 22000));
send('name');
await new Promise((r) => setTimeout(r, 500));
send(`loadsgf ${sgfPath}`);
await new Promise((r) => setTimeout(r, 1500));
send(cmd);
await new Promise((r) => setTimeout(r, waitSec * 1000));
console.log(`\n合计收到 info 行 ${infoCount} 条（等待 ${waitSec} 秒）`);
send('stop');
await new Promise((r) => setTimeout(r, 1000));
send('quit');
await new Promise((r) => setTimeout(r, 800));
child.kill();
process.exit(0);
