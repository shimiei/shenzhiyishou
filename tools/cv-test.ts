/**
 * 棋盘识别自测：自己画几张棋盘喂给识别算法，看它认出来的黑白子跟画进去的是不是一回事。
 *
 * 为什么要自己画：识别这块的错不会让程序崩，只会安静地少认一半子（最常见的白子全丢），
 * 而且只有拿真实截图才能发现；而真实截图没法进仓库。所以这里按几种真见过的渲染风格
 * 现画：亮木色配灰白球面的网页客户端、深色格线的本机页面、偏暗的照片木色、
 * 没上色的浅底棋盘，外加空盘和只有黑子的盘（专门盯误报）。
 *
 * 画的时候故意记下两点实测数据：有的客户端木色亮度 200、彩度 139，白子却是带明暗的
 * 球面，整圈取样的中位亮度只有 190 上下、彩度 10 上下，比底色还暗一点。纯按亮度
 * 找白子在这种盘上永远找不到，所以这套图里必须留一张这样的。
 *
 * 由 tools/cv-selftest.mjs 打包后运行。
 */
import { recognizeBoard, type ImageBox, type RecognizeResult } from '../src/renderer/core/cv/recognize';
import { WHITE, BLACK, STYLES, patternPoints, renderBoard, type Canvas, type Fixture } from './cv-fixtures';

const EMPTY = 0;

let passed = 0;
let failed = 0;

function ok(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  失败 ${label}`);
  }
}

function recognize(canvas: Canvas, crop: ImageBox | null = null): RecognizeResult {
  return recognizeBoard(
    { data: canvas.data, width: canvas.width, height: canvas.height } as unknown as ImageData,
    { crop, expectedSize: 0 }
  );
}

function describe(res: RecognizeResult): string {
  const d = res.diagnostics;
  const bg = d ? `底色亮度 ${d.backgroundLum.toFixed(0)} 彩度 ${d.backgroundSat.toFixed(0)}（${d.backgroundSource}）` : '没有诊断信息';
  const g = d ? `步长 ${d.grid.step.toFixed(2)} 均匀度 ${(d.grid.uniformity * 100).toFixed(0)}%` : '';
  return `${res.message} | ${g} | ${bg}`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function section(name: string): void {
  console.log(`\n${name}`);
}

function checkBoard(label: string, fixture: Fixture, size: number, expect: Array<[number, number, number]>): void {
  const canvas = renderBoard(fixture.style, size, fixture.points, 20260926 + size);
  const res = recognize(canvas);
  const want = new Array(size * size).fill(EMPTY);
  for (const [x, y, v] of expect) want[y * size + x] = v;
  const blackWant = expect.filter((p) => p[2] === BLACK).length;
  const whiteWant = expect.filter((p) => p[2] === WHITE).length;
  const stats = res.diagnostics?.pointStats ?? [];
  const d_white = expect.filter((p) => p[2] === WHITE).map((p) => stats[p[1] * size + p[0]]).filter(Boolean);
  const d_black = expect.filter((p) => p[2] === BLACK).map((p) => stats[p[1] * size + p[0]]).filter(Boolean);
  console.log(`  ${label}：${describe(res)}`);
  if (res.size !== size) {
    ok(false, `${label}：路数是 ${res.size}，画进去的是 ${size} 路`);
    return;
  }
  if (d_white.length) {
    const wl = d_white.map((p) => p.lum);
    const ws = d_white.map((p) => p.sat);
    const bgL = res.diagnostics ? res.diagnostics.backgroundLum : 0;
    const bgS = res.diagnostics ? res.diagnostics.backgroundSat : 0;
    console.log(
      `       白子取样 亮度中位 ${median(wl).toFixed(0)}（底色 ${bgL.toFixed(0)}）彩度中位 ${median(ws).toFixed(0)}（底色 ${bgS.toFixed(0)}）`
    );
  }
  const bad: string[] = [];
  for (let i = 0; i < want.length; i++) {
    if (res.stones[i] !== want[i]) {
      const name = (v: number): string => (v === EMPTY ? '空' : v === BLACK ? '黑' : '白');
      bad.push(`(${i % size},${Math.floor(i / size)}) 认成${name(res.stones[i])}，画的${name(want[i])}`);
    }
  }
  const blackGot = res.stones.filter((v) => v === BLACK).length;
  const whiteGot = res.stones.filter((v) => v === WHITE).length;
  ok(bad.length === 0 && blackGot === blackWant && whiteGot === whiteWant, `${label}：黑 ${blackGot}/${blackWant} 白 ${whiteGot}/${whiteWant}${bad.length ? '，' + bad.slice(0, 8).join('；') : ''}`);
}

section('认出棋子：几种渲染风格都要把黑白子摆对');
for (const style of STYLES) {
  const points = patternPoints(19, false);
  checkBoard(style.name, { style, points }, 19, points);
}

section('认出棋子：13 路、9 路也要认');
for (const size of [13, 9]) {
  const points = patternPoints(size, false);
  checkBoard(`${STYLES[0].name} ${size} 路`, { style: STYLES[0], points }, size, points);
}

section('边线上的棋子：贴着棋盘边的一圈也得认出来');
for (const style of STYLES) {
  const edge: Array<[number, number, number]> = [
    [0, 0, BLACK], [18, 0, WHITE], [0, 18, WHITE], [18, 18, BLACK],
    [9, 0, BLACK], [0, 9, WHITE], [18, 9, WHITE], [9, 18, BLACK],
    [2, 0, WHITE], [16, 18, WHITE], [0, 16, BLACK], [18, 2, BLACK]
  ];
  checkBoard(`${style.name} 边线`, { style, points: edge }, 19, edge);
}

section('挨着的子：一团子挤在一起也要分得清黑白');
for (const style of STYLES) {
  const cluster: Array<[number, number, number]> = [
    [9, 9, BLACK], [10, 9, BLACK], [9, 10, BLACK], [8, 10, WHITE], [10, 10, WHITE],
    [9, 11, WHITE], [8, 9, WHITE], [11, 9, WHITE], [10, 11, BLACK], [11, 10, BLACK],
    [7, 10, WHITE], [12, 10, BLACK]
  ];
  checkBoard(`${style.name} 一团子`, { style, points: cluster }, 19, cluster);
}

section('误报：空盘上不能看见棋子');
for (const style of STYLES) {
  const canvas = renderBoard(style, 19, [], 771 + style.step);
  const res = recognize(canvas);
  const count = res.stones.filter((v) => v !== EMPTY).length;
  console.log(`  ${style.name}：${describe(res)}`);
  ok(res.size === 19, `${style.name}：空盘也要认出 19 路，实际 ${res.size}`);
  ok(count === 0, `${style.name}：空盘上数出 ${count} 颗子`);
}

section('误报：整盘只有黑子时一颗白子都不许有');
for (const style of STYLES) {
  const points = patternPoints(19, true);
  checkBoard(`${style.name} 只有黑子`, { style, points }, 19, points);
}

section('手动框选：框住棋盘一角也能按框里的内容识别');
{
  const style = STYLES[0];
  const points = patternPoints(19, false);
  const canvas = renderBoard(style, 19, points, 4242);
  const res = recognize(canvas, { x: 0, y: 0, w: canvas.width, h: canvas.height });
  ok(res.size === 19, `整张图当框选：认出 ${res.size} 路`);
  ok(res.stones.filter((v) => v === WHITE).length === 12, `整张图当框选：白子 ${res.stones.filter((v) => v === WHITE).length} 颗，应为 12`);
}

console.log(`\n棋盘识别自测：${passed} 项通过，${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
