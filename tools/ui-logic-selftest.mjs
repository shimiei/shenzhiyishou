// 把 tools/ui-logic-test.ts 打包成一个自包含的 mjs 再运行。
// 被测试的代码是渲染进程的 TS，Node 直接跑不了，借 esbuild 过一道。
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'dist', 'ui-logic-test.mjs');

await build({
  entryPoints: [join(here, 'ui-logic-test.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  logLevel: 'warning'
});

const r = spawnSync(process.execPath, [out], { stdio: 'inherit' });
process.exit(r.status ?? 1);
