/**
 * 把刚打出来的包解一份到验收目录，只改用户目录那一行的名字，
 * 于是它和用户正在用的那份互不干扰（单实例锁在用户目录里）。
 * 用法: node tools/pkgtest-refresh.mjs
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const asar = join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
const unpacked = join(root, 'release', 'win-unpacked');
const dest = join(process.env.LOCALAPPDATA ?? '', 'Temp', 'szys-pkg');
const stage = join(process.env.LOCALAPPDATA ?? '', 'Temp', 'szys-pkg-stage');

if (!existsSync(asar)) {
  console.error('先跑 npm run dist');
  process.exit(1);
}

// 验收目录第一次用（或者整份被删掉）时，先把打好的这份原样搬过去；之后只换 app 与引擎、网络
if (!existsSync(join(dest, '神之一手.exe'))) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(unpacked, dest, { recursive: true });
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
// Windows 上 .cmd 不能直接 execFile，得经 cmd.exe；asar 的 bin 是 node 脚本
execFileSync(
  process.platform === 'win32' ? 'cmd.exe' : join(root, 'node_modules', '.bin', 'asar'),
  process.platform === 'win32' ? ['/c', join(root, 'node_modules', '.bin', 'asar.cmd'), 'extract', asar, stage] : ['extract', asar, stage],
  { stdio: 'inherit' }
);

// asar 里只有 dist 与 package.json，引擎、网络、dll 都在 asar 外面，一起搬过去
const main = join(stage, 'dist', 'main', 'index.js');
const src = readFileSync(main, 'utf8');
const patched = src.replace(
  /(setPath\(\s*'userData'\s*,\s*[^;]*?')(shenzhiyishou)(')/,
  '$1shenzhiyishou-pkgtest$3'
);
if (patched === src) {
  console.error('没找到 userData 那一行，主进程结构可能变了');
  process.exit(1);
}
writeFileSync(main, patched, 'utf8');

// 只换 app 目录，外面的 exe、dll、引擎、网络原样不动
rmSync(join(dest, 'resources', 'app'), { recursive: true, force: true });
cpSync(stage, join(dest, 'resources', 'app'), { recursive: true });

// Electron 先认 app.asar、其次才认 app 目录，所以那份旧的 asar 必须挪走，
// 否则上面改过的 main 根本没被加载：用户目录还是正式那一个（单实例锁会踢人），
// 跑起来的是上一版的代码。第一次踩到就是验收跑完才发现量的全是旧版本。
for (const stale of ['app.asar', 'app.asar.unpacked']) {
  rmSync(join(dest, 'resources', stale), { recursive: true, force: true });
}
if (existsSync(join(dest, 'resources', 'app.asar'))) {
  console.error('resources/app.asar 还在，副本会去加载旧代码，别再往下跑');
  process.exit(1);
}

// 引擎、网络、许可声明这三样都在 asar 外面，一起搬过去，让副本的目录样子跟装出来的那份一样
for (const dir of ['engine', 'models', 'licenses']) {
  const from = join(unpacked, 'resources', dir);
  if (existsSync(from)) {
    rmSync(join(dest, 'resources', dir), { recursive: true, force: true });
    cpSync(from, join(dest, 'resources', dir), { recursive: true });
  }
}
// exe 本身也带着版本号与图标，顺手换成刚打出来的那份；副本正开着时换不动，说一声就行
try {
  cpSync(join(unpacked, '神之一手.exe'), join(dest, '神之一手.exe'));
} catch {
  console.warn('副本正开着，exe 没能换（程序代码已经是最新的，只是文件属性里那份版本号还旧）');
}

rmSync(stage, { recursive: true, force: true });
console.log('验收副本已更新：' + dest);
