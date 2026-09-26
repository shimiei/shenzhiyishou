// 把 tools/winhelper-test.ts 打包成一个自包含的 mjs 再运行。
// 被自测的是主进程里那几段 PowerShell（winScripts.ts），Node 直接跑不了 TS，借 esbuild 过一道。
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'dist', 'winhelper-test.mjs');

await build({
  entryPoints: [join(here, 'winhelper-test.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  logLevel: 'warning'
});

const r = spawnSync(process.execPath, [out], { stdio: 'inherit' });
process.exit(r.status ?? 1);
