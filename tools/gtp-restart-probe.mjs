/**
 * 复现应用的"重新分析"时序：kata-analyze → stop → kata-set-param → kata-analyze。
 * 用来判断第二次分析不出结果到底是引擎的行为，还是客户端队列的问题。
 * 用法: node tools/gtp-restart-probe.mjs
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
const modelFile = path.join(RUNTIME, 'models', readdirSync(path.join(RUNTIME, 'models')).find((f) => f.includes('b18c384')));
if (!existsSync(modelFile)) { console.error('找不到网络'); process.exit(1); }

const override = [
  `logDir=${path.join(RUNTIME, 'logs')}`,
  'logToStderr=false', 'logAllGTPCommunication=false', 'logSearchInfo=false',
  'rules=chinese', 'maxVisits=300', 'numSearchThreads=2', 'nnMaxBatchSize=8',
  'nnCacheSizePowerOfTwo=19', 'ponderingEnabled=false', 'allowResignation=true',
  'resignThreshold=-0.9', 'chosenMoveTemperature=0'
].join(',');

mkdirSync(path.join(RUNTIME, 'tmp'), { recursive: true });
const sgf = path.join(RUNTIME, 'tmp', 'restart.sgf');
writeFileSync(sgf, '(;GM[1]FF[4]SZ[19]KM[7.5]RU[Chinese])', 'utf8');

const child = spawn(exe, ['gtp', '-model', modelFile, '-config', cfg, '-override-config', override], {
  cwd: path.join(RUNTIME, 'engine', backend), stdio: ['pipe', 'pipe', 'pipe']
});
child.stderr.on('data', () => undefined);

const t0 = Date.now();
const st = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5) + 's';
const send = (c) => { console.log(`${st()} >>> ${c}`); child.stdin.write(c + '\n'); };

let phase = '启动';
let buf = '';
let lastVisits = 0;
child.stdout.setEncoding('utf8');
child.stdout.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).replace(/\r$/, '');
    buf = buf.slice(i + 1);
    if (line.startsWith('info ')) {
      const m = line.match(/move ([A-Z]\d{1,2}) visits (\d+)/);
      const n = Number(m ? m[2] : 0);
      if (n !== lastVisits || n === 1) {
        console.log(`${st()} [${phase}] ${m ? m[1] : '?'} visits ${n}`);
        lastVisits = n;
      }
    } else if (line.trim()) {
      console.log(`${st()} [${phase}] ${line.slice(0, 90)}`);
    }
  }
});

// 等引擎就绪：靠 version 的响应来判断
await new Promise((r) => setTimeout(r, 25000));
const ready = new Promise((resolve) => {
  const onData = (c) => { if (String(c).includes('1.18')) { child.stdout.off('data', onData); resolve(); } };
  child.stdout.on('data', onData);
});
send('version');
await Promise.race([ready, new Promise((r) => setTimeout(r, 60000))]);
console.log('--- 引擎应已就绪 ---');

send(`loadsgf ${sgf}`);
await new Promise((r) => setTimeout(r, 1200));
send('kata-set-param maxVisits 300');
await new Promise((r) => setTimeout(r, 200));

phase = 'A 第一次分析';
send('kata-analyze 60 ownership true');
await new Promise((r) => setTimeout(r, 4000));

console.log('--- 模拟应用重新分析 ---');
send('stop');
await new Promise((r) => setTimeout(r, 1000));
send('kata-set-param maxVisits 300');
await new Promise((r) => setTimeout(r, 200));
lastVisits = 0;
phase = 'B 第二次分析';
send('kata-analyze 60 ownership true');
await new Promise((r) => setTimeout(r, 8000));

send('stop');
await new Promise((r) => setTimeout(r, 600));
send('quit');
await new Promise((r) => setTimeout(r, 600));
child.kill();
process.exit(0);
