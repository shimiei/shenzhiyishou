// 把 tools/rules-test.ts 打包成一个自包含的 mjs 再运行。
// 规则代码在 renderer 里，是 TS + 相对引用，Node 直接跑不了，所以借 esbuild 过一道。
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'dist', 'rules-test.mjs');

await build({
  entryPoints: [join(here, 'rules-test.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  logLevel: 'warning'
});

const r = spawnSync(process.execPath, [out], { stdio: 'inherit' });
process.exit(r.status ?? 1);
