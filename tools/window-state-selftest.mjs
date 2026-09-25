// 把 tools/window-state-test.ts 打包成一个自包含的 mjs 再运行。
// 被测试的代码是 TS，还引用了主进程的模块，Node 直接跑不了，借 esbuild 过一道。
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'dist', 'window-state-test.mjs');

await build({
  entryPoints: [join(here, 'window-state-test.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  logLevel: 'warning',
  // windowState.ts 是纯计算，不碰 electron。真引到了就在这里报错，说明有人往里面加了运行时依赖。
  external: ['electron']
});

const r = spawnSync(process.execPath, [out], { stdio: 'inherit' });
process.exit(r.status ?? 1);
