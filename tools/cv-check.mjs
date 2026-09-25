// 开发用验收脚本：把 PNG 转成裸 RGBA，跑识别算法，与标准答案比对。
// 用法：node tools/cv-check.mjs <图片路径> [--crop x,y,w,h] [--size 19]
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const args = process.argv.slice(2);
const imagePath = args[0];
if (!imagePath) {
  console.error('用法: node tools/cv-check.mjs <图片路径> [--crop x,y,w,h] [--size 19] [--answer x.sgf]');
  process.exit(2);
}
let crop = null;
let expected = 0;
let answer = null;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--crop') {
    const [x, y, w, h] = args[++i].split(',').map(Number);
    crop = { x, y, w, h };
  } else if (args[i] === '--size') {
    expected = parseInt(args[++i], 10);
  } else if (args[i] === '--answer') {
    answer = args[++i];
  }
}

const rawPath = path.join(root, 'tools', '.tmp-raw.bin');
const script = `
from PIL import Image
import sys, json
im = Image.open(sys.argv[1]).convert('RGBA')
open(sys.argv[2], 'wb').write(im.tobytes())
print(json.dumps({'width': im.size[0], 'height': im.size[1]}))
`;
const metaJson = execFileSync('python', ['-c', script, imagePath, rawPath], { encoding: 'utf8' });
const meta = JSON.parse(metaJson.trim());

const buf = readFileSync(rawPath);
const data = new Uint8ClampedArray(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const mod = await import(new URL('../src/renderer/core/cv/recognize.ts', import.meta.url).href);
const t0 = Date.now();
const res = mod.recognizeBoard({ data, width: meta.width, height: meta.height }, { expectedSize: expected, crop });
const ms = Date.now() - t0;

console.log(`图片 ${meta.width}x${meta.height}  用时 ${ms}ms`);
console.log(`结果 ok=${res.ok} size=${res.size} 置信度=${(res.confidence * 100).toFixed(1)}% 可疑点=${res.suspects.length}`);
console.log(`说明：${res.message}`);
if (res.diagnostics) {
  const g = res.diagnostics.grid;
  console.log(
    `网格 原点=(${g.originX.toFixed(1)}, ${g.originY.toFixed(1)}) 步长=${g.step.toFixed(2)} 均匀度=${(g.uniformity * 100).toFixed(0)}% 策略=${g.strategy}`
  );
  console.log(`棋盘区域 ${JSON.stringify(res.diagnostics.boardRect)} 手动框选=${res.diagnostics.usedCrop}`);
}
if (res.size) {
  const grid = [];
  for (let y = 0; y < res.size; y++) {
    let row = '';
    for (let x = 0; x < res.size; x++) {
      const v = res.stones[y * res.size + x];
      row += v === 0 ? '.' : v === 1 ? 'X' : 'O';
    }
    grid.push(row);
  }
  console.log(grid.join('\n'));
  const black = res.stones.filter((v) => v === 1).length;
  const white = res.stones.filter((v) => v === 2).length;
  console.log(`黑 ${black} 白 ${white}`);
  writeFileSync(path.join(root, 'tools', '.tmp-result.json'), JSON.stringify({ size: res.size, stones: res.stones }));
}

if (answer) {
  const cmp = `
import json, re, sys
sgf = open(sys.argv[1], encoding='utf-8').read()
size = int(re.search(r'SZ\\[(\\d+)\\]', sgf).group(1))
ab = re.search(r'AB((?:\\[[a-z]{2}\\])+)', sgf)
aw = re.search(r'AW((?:\\[[a-z]{2}\\])+)', sgf)
exp = [0] * (size * size)
for m, val in ((ab, 1), (aw, 2)):
    if not m: continue
    for pt in re.findall(r'\\[([a-z]{2})\\]', m.group(1)):
        x = ord(pt[0]) - 97; y = ord(pt[1]) - 97
        if x < size and y < size: exp[y * size + x] = val
got = json.load(open(sys.argv[2]))
if got['size'] != size:
    print('路数不一致: 识别 %d 答案 %d' % (got['size'], size)); sys.exit(1)
stones = got['stones']
bad = [(i % size, i // size, stones[i], exp[i]) for i in range(size * size) if stones[i] != exp[i]]
print('与标准答案比对：黑 %d 白 %d  不一致 %d 处' % (exp.count(1), exp.count(2), len(bad)))
for x, y, g, e in bad[:40]:
    print('   (%2d,%2d) 识别 %d 应为 %d' % (x, y, g, e))
sys.exit(1 if bad else 0)
`;
  const out = execFileSync('python', ['-c', cmp, answer, path.join(root, 'tools', '.tmp-result.json')], { encoding: 'utf8' });
  process.stdout.write(out);
  const badCount = /不一致 (\d+) 处/.exec(out);
  if (badCount && badCount[1] !== '0') process.exitCode = 1;
}
