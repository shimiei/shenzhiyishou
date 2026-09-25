/**
 * 起第二个实例做验收用。
 *
 * 正式程序把 userData 钉死在 %APPDATA%\shenzhiyishou，而单实例锁就在 userData 里，
 * 所以用户开着程序的时候，开发实例会被自己踢掉。这个脚本把编译产物复制一份，
 * 只改 userData 那一行的目录名，其余代码一字不差，于是两个实例可以同时开着。
 *
 * 用法：node tools/devtest.mjs [额外参数…]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'dist', 'main', 'index.js');
const dst = join(root, 'dist', 'main', 'index.devtest.js');

if (!existsSync(src)) {
  console.error('先跑 npm run build');
  process.exit(1);
}

const original = readFileSync(src, 'utf8');
// 只替换 setPath('userData', ... 'shenzhiyishou') 里那个目录名，别动路径里的其它 shenzhiyishou。
const patched = original.replace(
  /(setPath\(\s*'userData'\s*,\s*[^;]*?')(shenzhiyishou)(')/,
  '$1shenzhiyishou-devtest$3'
);
if (patched === original) {
  console.error('没找到 userData 那一行，主进程结构可能变了，请更新这个脚本');
  process.exit(1);
}
writeFileSync(dst, patched, 'utf8');

const dir = join(root, 'tools', 'devtest-app');
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, 'package.json'),
  JSON.stringify({ name: 'shenzhiyishou-devtest', version: '1.0.0', main: '../../dist/main/index.devtest.js' }, null, 2),
  'utf8'
);

// 验收实例有自己的 settings.json，默认会被写成大网络；大网络在小机器上加载慢，
// 布局验收用不上它，所以第一次跑的时候先塞一个小网络进去。
const profile = join(process.env.APPDATA ?? '', 'shenzhiyishou-devtest');
const settings = join(profile, 'settings.json');
if (!existsSync(settings)) {
  mkdirSync(profile, { recursive: true });
  writeFileSync(settings, JSON.stringify({ modelId: 'b6c96', fastModelId: 'b6c96' }, null, 2), 'utf8');
}

const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const args = [dir, ...process.argv.slice(2)];
console.log('启动验收实例：' + args.join(' '));
const child = spawn(electron, args, { stdio: 'inherit', cwd: root });
child.on('exit', (code) => process.exit(code ?? 0));
