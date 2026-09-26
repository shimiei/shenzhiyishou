/**
 * 界面逻辑自测：内置浏览器的标签页规则、分栏尺寸的夹取，以及送去引擎的 SGF 形态。
 * 这几块出错不会崩，只会让界面别扭（关掉标签跳到别的页面、分隔条拖不动、
 * 某块窗口宽度下按钮被截断），或者让引擎直接拒收整盘棋。
 * 由 tools/ui-logic-selftest.mjs 打包后运行。
 */
import { BLACK, WHITE, type GameTree, type SgfProps } from '../src/shared/types';
import { closeTab, makeTab, openTab, stepTab, tabTitle, type BrowserTab } from '../src/renderer/core/browser/tabs';
import { normalizeUrl } from '../src/renderer/core/browser/url';
import { adviceChip, adviceLine, isPassMove, leadText } from '../src/renderer/core/advice';
import { engineSgfFor } from '../src/renderer/core/sgf/engineSgf';
import { parseSgf } from '../src/renderer/core/sgf/parse';
import {
  addChild,
  addMoveNode,
  canSetTurn,
  colorToPlayAt,
  createTree,
  positionAt,
  positionKey,
  setProp,
  setTurnAt
} from '../src/renderer/core/sgf/tree';
import {
  DEFAULT_LEFT,
  DEFAULT_RIGHT,
  MIN_BOARD_H_PX,
  MIN_BOARD_PX,
  MIN_BROWSER_H_PX,
  MIN_BROWSER_PX,
  SPLIT_MAX,
  SPLIT_MAX_Y,
  SPLIT_MIN,
  fitPanelWidth,
  fitSplit,
  LEFT_MIN,
  pickAxis,
  RIGHT_MIN,
  SPLITTER_PX,
  splitSidesHint,
  toAxisChoice
} from '../src/renderer/core/layout/panes';

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

/** 造几个标签，id 固定好断言。 */
function tabs(...urls: string[]): BrowserTab[] {
  return urls.map((u, i) => ({ id: 't' + (i + 1), url: u, title: '' }));
}

section('标签：新建');
{
  const a = tabs('https://a.com');
  const r1 = openTab(a, { id: 'new', url: 'https://b.com', title: '' }, 't1');
  eq(r1.tabs.length, 2, '多了一个标签');
  eq(r1.activeId, 'new', '新建的标签接管当前');
  eq(r1.tabs[0].id, 't1', '原来的标签还在原位');

  const r2 = openTab(a, { id: 'new', url: 'https://b.com', title: '' }, 't1', false);
  eq(r2.activeId, 't1', '后台新建不抢当前标签');

  const r3 = openTab([], { id: 'new', url: 'about:blank', title: '' }, null, false);
  eq(r3.activeId, 'new', '一个标签都没有时，后台新建也得接管，否则页面没地方显示');
}

section('标签：关闭');
{
  const three = tabs('a', 'b', 'c');
  const mid = closeTab(three, 't2', 't2');
  eq(mid.tabs.map((t) => t.id).join(','), 't1,t3', '关闭中间的标签');
  eq(mid.activeId, 't3', '关掉当前标签后接管右边那个');

  const last = closeTab(three, 't3', 't3');
  eq(last.activeId, 't2', '关掉最后一个标签就回到左边那个');

  const other = closeTab(three, 't1', 't2');
  eq(other.activeId, 't2', '关的不是当前标签时当前标签不动');
  eq(other.tabs.length, 2, '标签确实少了一个');

  const only = closeTab(tabs('a'), 't1', 't1');
  eq(only.tabs.length, 0, '关掉唯一的标签');
  eq(only.activeId, null, '没有标签就没有当前标签');

  const ghost = closeTab(three, 'nope', 't2');
  eq(ghost.tabs.length, 3, '关一个不存在的标签什么都不做');
}

section('标签：轮流切换');
{
  const three = tabs('a', 'b', 'c');
  eq(stepTab(three, 't1', 1), 't2', '往后切');
  eq(stepTab(three, 't3', 1), 't1', '最后一个往后切绕回第一个');
  eq(stepTab(three, 't1', -1), 't3', '往前切绕到最后一个');
  eq(stepTab(three, 'nope', 1), 't1', '当前标签认不出来时从第一个开始');
  eq(stepTab([], null, 1), null, '没有标签时没有可切的');
}

section('标签：标题');
{
  eq(tabTitle({ id: 'x', url: 'https://online-go.com/game/123', title: '对局 123' }), '对局 123', '优先用页面标题');
  eq(tabTitle({ id: 'x', url: 'https://online-go.com/', title: '' }), 'online-go.com', '没标题时退回主机名');
  eq(tabTitle({ id: 'x', url: 'https://www.foxwq.com/play', title: '' }), 'www.foxwq.com/play', '主机名带路径，好辨认');
  eq(tabTitle({ id: 'x', url: 'about:blank', title: '' }), '新标签页', '空白页给个中文名');
  ok(tabTitle({ id: 'x', url: 'https://a.com', title: '这是一个特别特别长的标题超过限制了' }).length <= 18, '过长的标题被截断');
  eq(tabTitle({ id: 'x', url: '不是网址', title: '' }), '不是网址', '解析不了就原样显示');
}

section('地址栏：输入理解');
{
  eq(normalizeUrl('online-go.com'), 'http://online-go.com', '看着像域名就补 http');
  eq(normalizeUrl('  220.205.16.22:39681/  '), 'http://220.205.16.22:39681/', '带端口和路径的也要认（自己的服务器）');
  eq(normalizeUrl('https://www.foxwq.com/play'), 'https://www.foxwq.com/play', '已经有协议的原样放行');
  eq(normalizeUrl('about:blank'), 'about:blank', 'about: 不该被当成搜索词');
  eq(normalizeUrl('file:///C:/a.sgf'), 'file:///C:/a.sgf', '本地文件原样放行');
  eq(normalizeUrl('localhost:5199'), 'http://localhost:5199', 'localhost 加端口');
  eq(normalizeUrl('围棋 定式'), 'https://www.bing.com/search?q=' + encodeURIComponent('围棋 定式'), '不像地址就当搜索词');
  eq(normalizeUrl(''), '', '空输入不跳转');
}

section('引擎局面：摆子收进根节点');
{
  // KataGo 的 loadsgf 只认根节点上的摆子，第二个节点往后出现 AB/AW/AE 就整谱拒收：
  // "Found stone placements after the root"。摆子工具和"导入到当前棋谱"都会写出这种局面，
  // 所以这一段钉住送进引擎的那份 SGF。真引擎那边由 tools/engine-sgf-check.mjs 复核。
  const nodesOf = (sgf: string): GameTree => parseSgf(sgf)[0];
  const countOf = (sgf: string): number => Object.keys(nodesOf(sgf).nodes).length;
  const rootOf = (sgf: string): SgfProps => nodesOf(sgf).nodes[nodesOf(sgf).root].props;
  const lineEnd = (tree: GameTree): number => {
    let cur = tree.root;
    for (;;) {
      const next = tree.nodes[cur]?.children ?? [];
      if (next.length === 0) return cur;
      cur = next[0];
    }
  };
  const boardOf = (tree: GameTree, id: number): string => Array.from(positionAt(tree, id).cells).join(',');
  const setupAfterRoot = (sgf: string): number => {
    const t = nodesOf(sgf);
    let n = 0;
    for (const k of Object.keys(t.nodes)) {
      if (Number(k) === t.root) continue;
      const p = t.nodes[Number(k)].props;
      for (const key of ['AB', 'AW', 'AE']) n += (p[key] ?? []).length;
    }
    return n;
  };
  const turnOf = (tree: GameTree, id: number): 'B' | 'W' => (colorToPlayAt(tree, id) === BLACK ? 'B' : 'W');
  const forEngine = (tree: GameTree, id: number): string => engineSgfFor(tree, id, turnOf(tree, id)).sgf;
  const blank = (): GameTree => createTree(19, 7.5, 0, 'Chinese');

  // 一、摆子落在根节点：空谱上直接用摆子工具，或者导入时选"新建棋谱"
  {
    const withAb = setProp(blank(), 1, 'AB', ['dd']);
    const t = setProp(withAb, 1, 'AW', ['pp']);
    const out = forEngine(t, 1);
    eq(countOf(out), 1, '只有一个节点');
    eq(setupAfterRoot(out), 0, '根节点之外没有摆子');
    eq((rootOf(out).AB ?? []).join(''), 'dd', '黑子还在根节点');
    eq((rootOf(out).AW ?? []).join(''), 'pp', '白子还在根节点');
    eq((rootOf(out).PL ?? [])[0], 'B', '轮次写在根节点上：只有摆子时 KataGo 默认算白走，不写就反了');
    eq(boardOf(nodesOf(out), 1), boardOf(t, 1), '盘面一致');
  }

  // 二、用户遇到的那个局面：图导进来落在第二个节点上
  {
    const first = addChild(blank(), 1, { AB: ['dd'], AW: ['pp'] });
    const t = first.tree;
    const out = engineSgfFor(t, first.id, turnOf(t, first.id));
    eq(out.positionOnly, false, '能收拢就不退化成纯局面');
    eq(setupAfterRoot(out.sgf), 0, '第二节点上的摆子被收进根节点');
    eq((rootOf(out.sgf).AB ?? []).join(''), 'dd', '黑子挪到了根节点');
    eq((rootOf(out.sgf).AW ?? []).join(''), 'pp', '白子挪到了根节点');
    eq(countOf(out.sgf), 1, '只剩根节点：那个节点本来就只装了摆子');
    eq(boardOf(nodesOf(out.sgf), lineEnd(nodesOf(out.sgf))), boardOf(t, first.id), '收拢后盘面没变');
  }

  // 三、手数之后摆子（摆子工具停在某一手后面接着摆）
  {
    const m1 = addMoveNode(blank(), 1, BLACK, 3 * 19 + 3);
    const m2 = addMoveNode(m1.tree, m1.id, WHITE, 15 * 19 + 15);
    const setup = addChild(m2.tree, m2.id, { AB: ['qq'], AW: ['cc'] });
    const t = setup.tree;
    const out = forEngine(t, setup.id);
    eq(setupAfterRoot(out), 0, '摆子收进根节点');
    eq(countOf(out), 3, '两手棋还在');
    ok(out.includes('B[dd]') && out.includes('W[pp]'), '手数原样保留');
    eq(boardOf(nodesOf(out), lineEnd(nodesOf(out))), boardOf(t, setup.id), '盘面一致');
    eq((rootOf(out).PL ?? [])[0], 'B', '最后一手是白，轮到黑');
  }

  // 四、摆子和手数写在同一个节点上
  {
    const m1 = addMoveNode(blank(), 1, BLACK, 3 * 19 + 3);
    const t = setProp(m1.tree, m1.id, 'AW', ['pp']);
    const out = forEngine(t, m1.id);
    eq(setupAfterRoot(out), 0, '摆子收进根节点');
    eq(countOf(out), 2, '那个节点留下了，因为上面还有一手棋');
    ok(out.includes('B[dd]'), '同一节点上的手数没被丢掉');
    eq(boardOf(nodesOf(out), lineEnd(nodesOf(out))), boardOf(t, m1.id), '盘面一致');
  }

  // 五、两个节点摆同一个点，后摆的赢
  {
    const first = setProp(blank(), 1, 'AB', ['dd']);
    const second = addChild(first, 1, { AW: ['dd'] });
    const t = second.tree;
    const out = forEngine(t, second.id);
    eq((rootOf(out).AW ?? []).join(''), 'dd', '后摆的白子留下');
    eq((rootOf(out).AB ?? []).length, 0, '先摆的黑子被顶掉，两个列表里不能同时出现同一个点');
    eq(boardOf(nodesOf(out), lineEnd(nodesOf(out))), boardOf(t, second.id), '盘面一致');
  }

  // 六、AE 提掉的是前面某一手下的子：收不进根节点，只能退成纯局面
  {
    const m1 = addMoveNode(blank(), 1, BLACK, 3 * 19 + 3);
    const clear = addChild(m1.tree, m1.id, { AE: ['dd'] });
    const t = clear.tree;
    const out = engineSgfFor(t, clear.id, turnOf(t, clear.id));
    eq(out.positionOnly, true, '收不干净就发纯局面，而不是发一份盘面对不上的 SGF');
    eq(countOf(out.sgf), 1, '纯局面只有根节点');
    eq(setupAfterRoot(out.sgf), 0, '根节点之外没有摆子');
    eq((rootOf(out.sgf).AB ?? []).length, 0, '那一手被提掉了，根节点里不该再有这颗黑子');
    eq(boardOf(nodesOf(out.sgf), lineEnd(nodesOf(out.sgf))), boardOf(t, clear.id), '盘面一致');
  }

  // 七、根节点上 AB 和 AE 写着同一个点：KataGo 见到这种写法会当成非法盘面拒收
  {
    const withAb = setProp(blank(), 1, 'AB', ['dd']);
    const t = setProp(withAb, 1, 'AE', ['dd']);
    const out = forEngine(t, 1);
    eq((rootOf(out).AB ?? []).length, 0, 'AE 说清空，AB 里就不该还留着这个点');
    eq(boardOf(nodesOf(out), lineEnd(nodesOf(out))), boardOf(t, 1), '盘面一致');
  }

  // 八、让子谱：界面按惯例算白走，引擎那边也得是白走
  {
    const t = createTree(19, 0.5, 2, 'Chinese');
    const out = forEngine(t, t.root);
    eq(turnOf(t, t.root), 'W', '让子局面轮白');
    eq((rootOf(out).PL ?? [])[0], 'W', '引擎那份也写白：KataGo 对着根节点摆子会按让子惯例算白走，写死更稳');
    eq(boardOf(nodesOf(out), lineEnd(nodesOf(out))), boardOf(t, t.root), '盘面一致');
  }

  // 九、普通对局照旧：不收拢、不退化，只补一句轮次
  {
    let t = blank();
    let id = t.root;
    for (const [color, point] of [
      [BLACK, 3 * 19 + 15],
      [WHITE, 15 * 19 + 3],
      [BLACK, 15 * 19 + 15],
      [WHITE, 3 * 19 + 3],
      [BLACK, 15 * 19 + 6]
    ] as Array<[1 | 2, number]>) {
      const r = addMoveNode(t, id, color, point);
      t = r.tree;
      id = r.id;
    }
    const out = engineSgfFor(t, id, turnOf(t, id));
    eq(out.positionOnly, false, '普通对局不做任何转换');
    eq(countOf(out.sgf), 6, '六个节点：根加五手');
    eq(setupAfterRoot(out.sgf), 0, '没有摆子');
    eq((rootOf(out.sgf).PL ?? [])[0], 'W', '最后一手是黑，轮到白');
    eq((out.sgf.match(/\(/g) ?? []).length, 1, '只有一条主线，变着不进引擎');
  }

  // 十、变着不进引擎
  {
    const m1 = addMoveNode(blank(), 1, BLACK, 3 * 19 + 3);
    const main = addMoveNode(m1.tree, m1.id, WHITE, 15 * 19 + 15);
    const branch = addMoveNode(main.tree, m1.id, WHITE, 15 * 19 + 3, { mainLine: false });
    const out = forEngine(branch.tree, branch.id);
    eq(countOf(out), 3, '只走当前这条线');
    eq((out.match(/\(/g) ?? []).length, 1, '没有变着括号');
  }
}

section('分栏：侧栏宽度夹取');
{
  const wide = 2560;
  eq(fitPanelWidth(DEFAULT_LEFT, LEFT_MIN, 420, wide, DEFAULT_RIGHT + 420), DEFAULT_LEFT, '大窗口下用户拖出来的宽度原样保留');
  eq(fitPanelWidth(9999, LEFT_MIN, 420, wide, DEFAULT_RIGHT + 420), 420, '超过上限就压到上限');
  eq(fitPanelWidth(50, LEFT_MIN, 420, wide, DEFAULT_RIGHT + 420), LEFT_MIN, '低于下限就抬到下限');

  // 960 宽的窗口：右栏 240，中间至少 420，那么左栏最多 960-240-420-5 = 295
  const narrow = fitPanelWidth(400, LEFT_MIN, 420, 960, RIGHT_MIN + 420);
  eq(narrow, 960 - RIGHT_MIN - 420 - SPLITTER_PX, '窗口窄的时候按剩余空间压下来');
  ok(narrow >= LEFT_MIN, '压下来也不会低于左栏可用下限', narrow);

  // 700 宽：扣掉预留之后还能放下 275，比下限宽，就听空间的
  eq(fitPanelWidth(300, LEFT_MIN, 420, 700, 420), 275, '有空间时按空间给');
  // 再窄下去算出来的上限会低于下限，这时必须保住下限
  eq(fitPanelWidth(300, LEFT_MIN, 420, 500, 420), LEFT_MIN, '空间实在不够时保住下限');
}

section('分栏：棋盘与浏览器的比例');
{
  eq(fitSplit(0.5, 1200), 0.5, '宽窗口下 50% 原样用');

  // 可用宽度 1195：棋盘保底 300 → 比例至少 300/1195 ≈ 0.251
  const floor = 300 / 1195;
  const nearMin = fitSplit(0.05, 1200);
  ok(Math.abs(nearMin - floor) < 1e-9, '比例被棋盘保底托住，正好是 300 像素', nearMin);
  eq(Math.round(nearMin * 1195), 300, '换回像素就是棋盘保底的 300');
  const nearMax = fitSplit(0.95, 1200);
  ok(Math.abs(nearMax - (1 - MIN_BROWSER_PX / 1195)) < 1e-9, '太靠边的比例被浏览器保底压回来', nearMax);
  eq(Math.round((1 - nearMax) * 1195), MIN_BROWSER_PX, '浏览器那侧正好守住它自己的像素保底');

  // 大屏上想给浏览器尽量多的宽度：2560 宽的窗口下范围上限先到场，棋盘还剩 383 像素
  eq(fitSplit(0.95, 2560), SPLIT_MAX, '2560 宽的窗口下拖到头，比例顶到上限');
  eq(Math.round((1 - SPLIT_MAX) * (2560 - SPLITTER_PX)), 383, '剩下的 15% 给棋盘，还有 383 像素');
  eq(fitSplit(0.02, 2560), SPLIT_MIN, '拖到另一头时比例停在下限上');
  // 窗口没那么宽的时候，先顶到的是棋盘那 300 像素的保底，不是比例下限
  eq(Math.round(fitSplit(0.02, 1500) * 1495), 300, '1500 宽的窗口下先顶到棋盘的 300 像素保底');

  // 中间只剩五百像素，两边保底加起来都放不下，这时不该乱夹，按比例来
  eq(fitSplit(0.5, 500), 0.5, '地方本来就不够时按比例来，不做无意义的夹取');
  eq(fitSplit(0.5, 560), 0.5, '刚好卡在保底之和以下也一样');

  // 保底真的起作用的边界：可用宽度刚好够两边保底之和（300 + 320 + 分隔条）
  const tight = fitSplit(0.9, MIN_BOARD_PX + MIN_BROWSER_PX + SPLITTER_PX);
  eq(
    Math.round((1 - tight) * (MIN_BOARD_PX + MIN_BROWSER_PX)),
    MIN_BROWSER_PX,
    '刚好够保底时，浏览器那侧正好守住自己的保底'
  );
  eq(fitSplit(0.95, 1200, 'x'), fitSplit(0.95, 1200), '不写方向时就是左右分栏，原来的调用点不受影响');
}

/*
 * 上下分栏是为了让浏览器横过来：中间那块宽度有限而浏览器是满高的，
 * 只做左右分栏时窗口不宽就永远是一条竖着的窄缝。这里量的是上下分栏时
 * 两头的高度保底有没有守住。
 */
section('分栏：上下分栏（浏览器横过来放）');
{
  const h = 838;
  const usable = h - SPLITTER_PX; // 833
  eq(fitSplit(0.55, h, 'y'), 0.55, '默认的 55% 在正常窗口高度下原样用');
  eq(fitSplit(0.05, h, 'y'), MIN_BOARD_H_PX / usable, '比例再小也被棋盘的 320 像素高度保底托住');
  eq(Math.round(fitSplit(0.05, h, 'y') * usable), MIN_BOARD_H_PX, '换算成像素正好是 320');
  eq(
    fitSplit(0.99, h, 'y'),
    Math.min(SPLIT_MAX_Y, 1 - MIN_BROWSER_H_PX / usable),
    '比例再大也被浏览器的高度保底压回来'
  );
  eq(Math.round((1 - fitSplit(0.99, h, 'y')) * usable), MIN_BROWSER_H_PX, '浏览器那块换算成像素正好是保底值');
  // 上下分栏的比例上限比左右分栏低：高度上两头都更容易被挤没
  ok(fitSplit(0.99, h, 'y') < fitSplit(0.99, 1200, 'x'), '上下分栏能到的高度比例确实更小');
  // 中间那块本来就不够高时，别硬夹，按比例来
  eq(fitSplit(0.5, 400, 'y'), 0.5, '高度不够放两边保底时按比例来');
  eq(toAxisChoice('y'), 'y', '认出上下分栏');
  eq(toAxisChoice('x'), 'x', '认出左右分栏');
  eq(toAxisChoice(undefined), 'auto', '老配置里没有这一项时算还没选过');
  eq(toAxisChoice('别的东西'), 'auto', '存了认不出来的值也算还没选过');
}

/*
 * 没选过方向时替用户挑一个。挑错的后果就是"一打开浏览器还是竖着的一条"，
 * 所以这里量的是：窗口不够宽就挑上下分栏，够宽才留在左右分栏。
 */
section('分栏：没选过时按窗口挑方向');
{
  // 1500 宽的窗口：中间 846，左右分栏 50/50 时浏览器只有 420 宽、却有 838 高
  eq(pickAxis(0.5, 846, 838), 'y', '窄窗口下浏览器会竖着，挑上下分栏');

  // 2560 的屏幕：中间 1986，50/50 时浏览器 990 宽，还是比 1290 的高矮一头
  eq(pickAxis(0.5, 1986, 1290), 'y', '2560 屏上 50/50 也还是竖的，照样挑上下分栏');
  // 但同一块屏，用户把浏览器拖宽到只剩棋盘保底时，左右分栏就够了
  eq(pickAxis(0.15, 1986, 1290), 'x', '中间够宽时左右分栏更合适，浏览器不会被压成竖条');

  // 超宽屏：50/50 就已经是横的了
  eq(pickAxis(0.5, 3000, 838), 'x', '超宽屏上左右分栏本来就横着，不用改');
  eq(pickAxis(0.5, 846, 0), 'x', '还没量出高度时别乱改，先按左右分栏');
}

section('分栏：拖动时显示的两块尺寸');
{
  eq(splitSidesHint(0.5, 1346, 'x'), '棋盘宽 671 px · 浏览器宽 670 px', '左右分栏报的是宽度');
  eq(splitSidesHint(0.55, 838, 'y'), '棋盘高 458 px · 浏览器高 375 px', '上下分栏报的是高度');
  // 两块加起来必须正好是可用尺寸，不然拖动时显示的数字会和眼睛看到的不一致
  const usable = 1346 - SPLITTER_PX;
  const hint = splitSidesHint(0.37, 1346, 'x');
  const nums = hint.match(/\d+/g)!.map(Number);
  eq(nums[0] + nums[1], usable, '提示里两块像素加起来等于可用的那一整块');
}

section('建议：每一句都要说清是给哪一方的');
{
  eq(
    adviceLine({ color: BLACK, move: 'D16', winrate: 0.523, scoreLead: 1.04 }),
    '黑棋推荐 D16 · 黑方胜率 52.3% · 领先 1.0 目',
    '黑方的推荐写清黑方'
  );
  eq(
    adviceLine({ color: WHITE, move: 'Q16', winrate: 0.38, scoreLead: -1.02 }),
    '白棋推荐 Q16 · 白方胜率 38.0% · 落后 1.0 目',
    '白方的推荐写清白方，落后也直说'
  );
  eq(
    adviceLine({ color: BLACK, move: 'pass', winrate: 0.502, scoreLead: 0.02 }),
    '黑棋推荐 停一手 · 黑方胜率 50.2% · 形势两分',
    '停一手与两分局面'
  );
  ok(isPassMove('pass') && isPassMove('tt') && isPassMove('PASS') && !isPassMove('D16'), '停一手的几种写法都认');
  eq(leadText(0.02), '形势两分', '零点几目不说领先落后');
  eq(adviceChip({ color: WHITE, move: 'Q16', winrate: 0.616, scoreLead: 3 }), '白棋推荐 Q16 62%', '状态条那一条短一些');
}

section('轮次：摆子局面能改，有手数就改不了');
{
  const setup = (ab: string[], aw: string[]): GameTree => {
    let t = createTree(19, 7.5, 0, 'Chinese');
    t = setProp(t, t.root, 'AB', ab.length ? ab : null);
    t = setProp(t, t.root, 'AW', aw.length ? aw : null);
    return t;
  };

  const t = setup(['dd', 'pp'], ['pd']);
  eq(colorToPlayAt(t, t.root), BLACK, '没有手数时按惯例算黑先');
  ok(canSetTurn(t, t.root).ok, '摆子的局面可以改轮次');
  const w = setTurnAt(t, t.root, WHITE);
  eq(colorToPlayAt(w, w.root), WHITE, '改完就轮到白方');
  eq(positionKey(w, w.root), positionKey(t, t.root), '改轮次不动盘面');
  ok(engineSgfFor(w, w.root, 'W').sgf.includes('PL[W]'), '送去引擎的局面也写着轮白，引擎不会再按惯例猜黑先');

  // 61 是空点（60 已经被 AB[dd] 占了），落子必须落在空点上，指纹才会变
  const moved = addMoveNode(t, t.root, BLACK, 61, { mainLine: true });
  ok(!canSetTurn(moved.tree, moved.id).ok, '有手数以后不给改');
  ok((canSetTurn(moved.tree, moved.id).reason ?? '').includes('手数'), '并且说明原因');
  eq(colorToPlayAt(moved.tree, moved.id), WHITE, '有手数时轮次由手数定');

  const ha = createTree(19, 7.5, 4, 'Chinese');
  eq(colorToPlayAt(ha, ha.root), WHITE, '让子局面按惯例白先');
  eq(colorToPlayAt(setTurnAt(ha, ha.root, BLACK), ha.root), BLACK, '写死 PL 之后听 PL 的');
}

section('推荐作废：盘面一变，旧提示不能再留着');
{
  const t = setProp(setProp(createTree(19, 7.5), 1, 'AB', ['dd']), 1, 'AW', ['pp']);
  const key = positionKey(t, t.root);
  eq(positionKey(setProp(t, t.root, 'C', ['随手写点注释']), t.root), key, '只改注释，指纹不变，提示还能留着');
  eq(positionKey(setProp(t, t.root, 'TR', ['dd']), t.root), key, '只加标记也一样，盘面没变');
  const moved = addMoveNode(t, t.root, BLACK, 61, { mainLine: true });
  ok(positionKey(moved.tree, moved.id) !== key, '落子之后指纹变了，提示作废');
  ok(positionKey(setProp(t, t.root, 'AW', ['pp', 'qq']), t.root) !== key, '加摆子也变了');
  const withChild = addChild(t, t.root, { AB: ['jj'] });
  ok(positionKey(withChild.tree, withChild.id) !== key, '摆子写到子节点里同样算变');
  eq(positionAt(t, t.root).cells[60], BLACK, '顺带确认 dd 落在 60，坐标没再错位');
}

console.log(`\n界面逻辑自测：${passed} 项通过，${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
