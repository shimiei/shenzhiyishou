/**
 * 窗口位置与尺寸的自测。这类代码平时看不出毛病，只有在换屏幕、拔副屏、
 * 或者手改过 settings.json 之后才会表现成"窗口打不开／拖不回来"，
 * 所以把边界情况都在这儿钉住。由 tools/window-state-selftest.mjs 打包后运行。
 */
import { fitWindow, type Box, type FitOptions } from '../src/main/windowState';

let failed = 0;
let passed = 0;

function ok(cond: boolean, name: string, extra?: unknown): void {
  if (cond) {
    passed++;
    console.log('  ok   ' + name);
  } else {
    failed++;
    console.log('  失败 ' + name + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra)));
  }
}

function eq(actual: unknown, expected: unknown, name: string): void {
  ok(actual === expected, name, { 实际: actual, 期望: expected });
}

function section(title: string): void {
  console.log('\n' + title);
}

eq(typeof fitWindow, 'function', 'fitWindow 能导入');

/** 窗口和某块屏幕实际交叠出来多少。用来断言"至少露出够用户点得到的一块"。 */
function visiblePart(b: Box, area: Box): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(b.x + b.width, area.x + area.width) - Math.max(b.x, area.x)),
    y: Math.max(0, Math.min(b.y + b.height, area.y + area.height) - Math.max(b.y, area.y))
  };
}

const BASE: FitOptions = {
  minWidth: 960,
  minHeight: 620,
  defaultWidth: 1500,
  defaultHeight: 950,
  workAreas: [{ x: 0, y: 0, width: 2560, height: 1392 }]
};

const SHORT: Box = { x: 0, y: 0, width: 1280, height: 672 };

section('第一次启动：没有记录过位置');
{
  const r = fitWindow({ width: 1500, height: 950, maximized: false }, BASE);
  eq(r.bounds.width, 1500, '用记录的尺寸');
  eq(r.bounds.height, 950, '用记录的高度');
  eq(r.bounds.x, Math.round((2560 - 1500) / 2), '横向居中');
  eq(r.bounds.y, Math.round((1392 - 950) / 2), '纵向居中');
  eq(r.maximized, false, '不最大化');

  const fresh = fitWindow({}, BASE);
  eq(fresh.bounds.width, 1500, '完全没有记录时用默认尺寸');
  eq(fresh.bounds.height, 950, '完全没有记录时用默认高度');
  eq(fresh.bounds.x, 530, '默认尺寸也居中');
}

section('尺寸不会超过工作区');
{
  const r = fitWindow({ x: 0, y: 0, width: 3000, height: 2000, maximized: false }, BASE);
  eq(r.bounds.width, 2560, '宽度被压到工作区宽度');
  eq(r.bounds.height, 1392, '高度被压到工作区高度');
  ok(r.bounds.x >= 0 && r.bounds.x + r.bounds.width <= 2560, '横向没出屏', r.bounds);
  ok(r.bounds.y >= 0 && r.bounds.y + r.bounds.height <= 1392, '纵向没出屏', r.bounds);

  const small = fitWindow({ x: 100, y: 100, width: 200, height: 150, maximized: false }, BASE);
  eq(small.bounds.width, 960, '比最小尺寸还小就抬到最小宽度');
  eq(small.bounds.height, 620, '比最小尺寸还小就抬到最小高度');
}

section('记录的位置已经看不见了');
{
  // 上次在副屏（x 从 2560 开始）退出，这次副屏拔了，只剩主屏。
  const gone = fitWindow({ x: 3000, y: 200, width: 1400, height: 900, maximized: false }, BASE);
  eq(gone.bounds.x, 580, '位置全在屏幕外就回到主屏居中');
  eq(gone.bounds.y, 246, '纵向也居中');

  // 只露一角的：位置还留着，但必须保证够得着，也就是至少露出 120×120。
  const halfOut = fitWindow({ x: 2400, y: 1200, width: 1400, height: 900, maximized: false }, BASE);
  ok(visiblePart(halfOut.bounds, BASE.workAreas[0]).x >= 120, '只露一角时横向至少露出 120', halfOut.bounds);
  ok(visiblePart(halfOut.bounds, BASE.workAreas[0]).y >= 120, '只露一角时纵向至少露出 120', halfOut.bounds);
  eq(halfOut.bounds.x, 2400, '露得够多就不动用户的位置');
}

section('位置还在屏幕上就保持不动');
{
  const same = fitWindow({ x: 300, y: 160, width: 1200, height: 800, maximized: false }, BASE);
  eq(same.bounds.x, 300, '横向位置不动');
  eq(same.bounds.y, 160, '纵向位置不动');

  // 标题栏被拖到屏幕上方之外，只留一条边，这种要拉回来。
  const above = fitWindow({ x: 300, y: -200, width: 1200, height: 800, maximized: false }, BASE);
  eq(above.bounds.y, 0, '标题栏跑到屏幕上方外就贴到顶边');
  eq(above.bounds.x, 300, '横向不动');
}

section('小屏笔记本：默认尺寸装不下');
{
  const r = fitWindow({ width: 1500, height: 950, maximized: false }, { ...BASE, workAreas: [SHORT] });
  eq(r.bounds.width, 1280, '宽度压到小屏宽度');
  eq(r.bounds.height, 672, '高度压到小屏高度');
  eq(r.bounds.x, 0, '贴左边');
  eq(r.bounds.y, 0, '贴顶边');
}

section('最大化状态');
{
  const max = fitWindow({ x: 40, y: 40, width: 1600, height: 900, maximized: true }, BASE);
  eq(max.maximized, true, '上次最大化过的就继续最大化');
  const no = fitWindow({ x: 40, y: 40, width: 1600, height: 900, maximized: false }, BASE);
  eq(no.maximized, false, '上次不是最大化就不最大化');
  eq(fitWindow({ maximized: true }, BASE).maximized, true, '最大化状态和位置是两回事，缺位置也照样最大化');
}

section('双屏：副屏在右边且更矮');
{
  const dual: FitOptions = {
    ...BASE,
    workAreas: [
      { x: 0, y: 0, width: 1920, height: 1040 },
      { x: 1920, y: 0, width: 1280, height: 720 }
    ]
  };
  const onSecond = fitWindow({ x: 2000, y: 60, width: 1200, height: 900, maximized: false }, dual);
  eq(onSecond.bounds.x, 2000, '记在副屏上就还开在副屏');
  eq(onSecond.bounds.height, 720, '高度按副屏压缩');
  const backToMain = fitWindow({ x: 100, y: 80, width: 1600, height: 1000, maximized: false }, dual);
  eq(backToMain.bounds.x, 100, '记在主屏上就还开在主屏');
}

section('拿不到任何工作区时也不崩');
{
  const none = fitWindow({ x: 10, y: 10, width: 1000, height: 700, maximized: true }, { ...BASE, workAreas: [] });
  eq(none.bounds.width, 1000, '尺寸照旧');
  eq(none.bounds.x, 0, '退到原点');
  eq(none.maximized, false, '拿不到屏幕就不最大化');
}

console.log(`\n窗口自测：${passed} 项通过，${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
