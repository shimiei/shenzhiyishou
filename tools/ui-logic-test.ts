/**
 * 界面逻辑自测：内置浏览器的标签页规则、分栏尺寸的夹取，以及送去引擎的 SGF 形态。
 * 这几块出错不会崩，只会让界面别扭（关掉标签跳到别的页面、分隔条拖不动、
 * 某块窗口宽度下按钮被截断），或者让引擎直接拒收整盘棋。
 * 由 tools/ui-logic-selftest.mjs 打包后运行。
 */
import { BLACK, WHITE, type GameTree, type SgfProps } from '../src/shared/types';
import { closeTab, makeTab, openTab, stepTab, tabTitle, type BrowserTab } from '../src/renderer/core/browser/tabs';
import { normalizeUrl } from '../src/renderer/core/browser/url';
import { engineSgfFor } from '../src/renderer/core/sgf/engineSgf';
import { parseSgf } from '../src/renderer/core/sgf/parse';
import { addChild, addMoveNode, colorToPlayAt, createTree, positionAt, setProp } from '../src/renderer/core/sgf/tree';
import {
  DEFAULT_LEFT,
  DEFAULT_RIGHT,
  fitPanelWidth,
  fitSplit,
  LEFT_MIN,
  RIGHT_MIN,
  SPLITTER_PX
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
  eq(fitSplit(0.95, 1200), 0.75, '超过上限压到 75%');
  eq(fitSplit(0.05, 2000), 0.25, '低于下限抬到 25%（这时像素保底没到 25%）');

  // 可用宽度 1195：棋盘保底 300 → 比例至少 300/1195 ≈ 0.251，比 25% 还高一点
  const floor = 300 / 1195;
  const nearMin = fitSplit(0.05, 1200);
  ok(Math.abs(nearMin - floor) < 1e-9, '比例被棋盘保底托住，正好是 300 像素', nearMin);
  eq(Math.round(nearMin * 1195), 300, '换回像素就是棋盘保底的 300');
  const nearMax = fitSplit(0.95, 1200);
  ok(nearMax <= 1 - 260 / 1195 && nearMax <= 0.75, '太靠边的比例被浏览器保底压回来', nearMax);
  eq(Math.round((1 - nearMax) * 1195) >= 260, true, '浏览器那侧至少留 260 像素');

  // 中间只剩五百像素，两边保底加起来都放不下，这时不该乱夹，按比例来
  eq(fitSplit(0.5, 500), 0.5, '地方本来就不够时按比例来，不做无意义的夹取');
  eq(fitSplit(0.5, 560), 0.5, '刚好卡在保底之和以下也一样');

  // 保底真的起作用的边界：可用宽度刚好 565
  const tight = fitSplit(0.9, 570);
  eq(Math.round((1 - tight) * 565) >= 260, true, '刚好够保底时，浏览器那侧还是留出 260');
}

console.log(`\n界面逻辑自测：${passed} 项通过，${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
