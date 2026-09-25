/**
 * 预加载脚本的打包自检。
 * 沙箱环境里 require 不了相对模块，只要 dist/preload.js 里残留相对 require，
 * 界面就会以"预加载脚本没有加载成功"的白屏收场，而且这个错误只在运行期才暴露。
 * 所以每次打包都当场断言一次。
 */
import { readFileSync } from 'node:fs';

const file = 'dist/preload.js';
const code = readFileSync(file, 'utf8');
const leak = code.match(/require\(\s*["']\.\.?\//g);

if (leak) {
  console.error(`[自检失败] ${file} 里还有 ${leak.length} 处相对 require，说明没有打成单文件。`);
  console.error('沙箱化的预加载脚本无法加载相对模块，界面会白屏。请检查 esbuild 是否真的跑了。');
  process.exit(1);
}

console.log(`[自检通过] ${file} 是单文件，${(code.length / 1024).toFixed(1)} KB`);
