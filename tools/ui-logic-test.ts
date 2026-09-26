/**
 * 界面逻辑自测：内置浏览器的标签页规则、分栏尺寸的夹取，以及送去引擎的 SGF 形态。
 * 这几块出错不会崩，只会让界面别扭（关掉标签跳到别的页面、分隔条拖不动、
 * 某块窗口宽度下按钮被截断），或者让引擎直接拒收整盘棋。
 * 另外还盯着复盘（逐手亏损、问题手排序、胜率曲线）、棋谱树上的来源标记，
 * 以及最后一手标记的可选样式：这几块错了不会崩，只会让复盘结论或界面标签不可信。
 * 由 tools/ui-logic-selftest.mjs 打包后运行。
 */
import { BLACK, DEFAULT_SETTINGS, PASS, WHITE, type GameTree, type SgfProps } from '../src/shared/types';
import { closeTab, makeTab, openTab, stepTab, tabTitle, type BrowserTab } from '../src/renderer/core/browser/tabs';
import { normalizeUrl } from '../src/renderer/core/browser/url';
import { expectStone, isPassPoint, planMirror, pointToPage } from '../src/renderer/core/browser/mirror';
import { adviceChip, adviceLine, isPassMove, leadText } from '../src/renderer/core/advice';
import { engineSgfFor } from '../src/renderer/core/sgf/engineSgf';
import { serializeSgf } from '../src/renderer/core/sgf/serialize';
import { LAST_MOVE_MARK_OPTIONS } from '../src/renderer/core/board/marks';
import { endpointHint, parseVisionGrid } from '../src/renderer/core/vision';
import { visionBody, visionChat, visionPrompt } from '../src/main/vision';
import {
  buildReview,
  curvePoints,
  EMPTY_REVIEW_SUMMARY,
  nextProblem,
  problemMoves,
  summarize,
  toPercent,
  type ReviewPoint
} from '../src/renderer/core/review/review';
import { parseSgf } from '../src/renderer/core/sgf/parse';
import {
  addChild,
  addMoveNode,
  canSetTurn,
  colorToPlayAt,
  countNodes,
  createTree,
  endedByDoublePass,
  moveNumberAt,
  moveSourceOf,
  nodeAtPath,
  pathOf,
  positionAt,
  positionKey,
  propNum,
  setProp,
  setTurnAt
} from '../src/renderer/core/sgf/tree';
import {
  BOARD_KEYS,
  DEFAULT_GAME,
  boardBadges,
  boardTitle,
  boardTooltip,
  cloneSlice,
  closeBoard,
  copiedBoard,
  emptySlice,
  everyBoardKeyIsListed,
  freshBoard,
  gameModeText,
  hasUnsaved,
  nthBoard,
  openBoard,
  sliceFrom,
  stepBoard,
  type BoardSlice,
  type BoardTab
} from '../src/renderer/core/boards/boards';
import { SESSION_VERSION, fromSession, toSession } from '../src/renderer/core/boards/session';
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

/** 造几个棋盘标签，id 固定好断言。 */
function boards(...ids: string[]): BoardTab[] {
  return ids.map((id) => ({ id, note: '', slice: emptySlice() }));
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

section('SGF 路径：记会话时用分支路径代替节点号');
{
  const t0 = createTree(19, 7.5);
  const m1 = addMoveNode(t0, t0.root, BLACK, 3 * 19 + 3);
  const m2 = addMoveNode(m1.tree, m1.id, WHITE, 15 * 19 + 15);
  const br = addMoveNode(m2.tree, m2.id, BLACK, 5 * 19 + 5);
  // 第三手走主干时，新着法会被提到第一个孩子，刚才那一手退到第二个
  const m3 = addMoveNode(br.tree, m2.id, WHITE, 9 * 19 + 9);
  const tree = m3.tree;

  eq(pathOf(tree, tree.root).join(','), '', '根节点的路径是空的');
  eq(pathOf(tree, m1.id).join(','), '0', '第一手是第一层的第 0 个');
  eq(pathOf(tree, m3.id).join(','), '0,0,0', '主干走到底');
  eq(pathOf(tree, br.id).join(','), '0,0,1', '先进去的那一手退成了第二个孩子');
  eq(nodeAtPath(tree, pathOf(tree, br.id)), br.id, '路径能原样找回分支上的节点');
  eq(nodeAtPath(tree, []), tree.root, '空路径就是根节点');
  eq(nodeAtPath(tree, [0, 0, 1, 5]), br.id, '路径后半截对不上时停在能走到的那一层');

  const back = parseSgf(serializeSgf(tree))[0];
  eq(positionKey(back, nodeAtPath(back, pathOf(tree, m3.id))), positionKey(tree, m3.id), '存下来读回去，主干那一手的局面还在');
  eq(positionKey(back, nodeAtPath(back, pathOf(tree, br.id))), positionKey(tree, br.id), '分支那一手的局面也在');

  const empty = createTree(9, 5.5);
  eq(pathOf(empty, empty.root).join(','), '', '空盘的根节点也是空路径');
  eq(nodeAtPath(empty, [1, 2]), empty.root, '空盘上乱给一条路径也只会落到根上');
}

section('棋盘标签：开、关、轮流切换');
{
  const two = boards('b1', 'b2');
  const r1 = openBoard(two, { id: 'b3', note: '', slice: emptySlice() }, 'b1');
  eq(r1.tabs.length, 3, '多了一个棋盘');
  eq(r1.activeId, 'b3', '新建的接管当前');
  eq(r1.tabs[0].id, 'b1', '原来的还在原位');

  const r2 = openBoard(two, { id: 'b3', note: '', slice: emptySlice() }, 'b1', false);
  eq(r2.activeId, 'b1', '后台新建不抢当前');

  const three = boards('b1', 'b2', 'b3');
  const mid = closeBoard(three, 'b2', 'b2');
  eq(mid.tabs.map((t) => t.id).join(','), 'b1,b3', '关掉中间那个');
  eq(mid.activeId, 'b3', '关掉当前那个就接管右边');
  const rightEnd = closeBoard(three, 'b3', 'b3');
  eq(rightEnd.activeId, 'b2', '关掉最右边那个就回左边');
  const other = closeBoard(three, 'b1', 'b2');
  eq(other.activeId, 'b2', '关的不是当前那个时当前不动');
  eq(other.tabs.length, 2, '标签确实少了一个');
  const ghost = closeBoard(three, 'nope', 'b2');
  eq(ghost.tabs.length, 3, '关一个不存在的棋盘什么都不做');

  const lastOne = closeBoard(boards('b1'), 'b1', 'b1');
  eq(lastOne.tabs.length, 0, '关掉最后一个棋盘');
  eq(lastOne.activeId, '', '没有当前棋盘了，调用方要补一盘空的');

  eq(stepBoard(three, 'b1', 1), 'b2', '往后切');
  eq(stepBoard(three, 'b3', 1), 'b1', '最后一个往后切绕回第一个');
  eq(stepBoard(three, 'b1', -1), 'b3', '往前切绕到最后一个');
  eq(stepBoard(three, 'nope', 1), 'b1', '当前认不出来时从第一个开始');
  eq(nthBoard(three, 1), 'b1', '第一个');
  eq(nthBoard(three, 3), 'b3', '第三个');
  eq(nthBoard(three, 9), '', '没有第九个就给空串');
}

section('棋盘标签：标题、角标、提示');
{
  const plain = boards('b1')[0];
  eq(boardTitle(plain), '未命名对局', '新盘写未命名对局');
  const saved: BoardTab = { id: 'x', note: '', slice: { ...emptySlice(), filePath: 'C:\\棋谱\\对局 1.sgf' } };
  eq(boardTitle(saved), '对局 1.sgf', '存过盘就写文件名');
  const copy: BoardTab = { id: 'x', note: '副本', slice: { ...emptySlice(), dirty: true } };
  eq(boardTitle(copy), '副本', '没存过的副本写副本');
  const copySaved: BoardTab = { id: 'x', note: '副本', slice: { ...emptySlice(), filePath: 'D:\\a\\b\\新对局.sgf' } };
  eq(boardTitle(copySaved), '新对局.sgf', '副本存过盘之后就写它自己的文件名');
  const longName: BoardTab = { id: 'x', note: '', slice: { ...emptySlice(), filePath: 'C:\\' + '很长的名字'.repeat(6) + '.sgf' } };
  ok(boardTitle(longName).length <= 16, '过长的文件名截断', boardTitle(longName));

  eq(boardBadges(plain).length, 0, '空盘上没有角标');
  eq(boardBadges({ id: 'x', note: '', slice: { ...emptySlice(), analyzing: true } }).join(','), '分析', '分析中有角标');
  const busy: BoardTab = {
    id: 'x',
    note: '',
    slice: { ...emptySlice(), analyzing: true, reviewRunning: true, game: { ...DEFAULT_GAME, mode: 'ai-vs-ai' } }
  };
  eq(boardBadges(busy).join(','), '分析,复盘,机机', '三样一起跑就有三个角标');

  ok(boardTooltip(saved).includes('19 路'), '提示里有路数');
  ok(boardTooltip(saved).includes('贴 7.5 目'), '提示里有贴目');
  ok(boardTooltip(saved).includes('第 0 手'), '提示里有手数');
  ok(boardTooltip(saved).includes('对局 1.sgf'), '提示里有文件名');
  const vsAi: BoardTab = { id: 'x', note: '', slice: { ...emptySlice(), game: { ...DEFAULT_GAME, mode: 'vs-ai', humanColor: WHITE } } };
  ok(boardTooltip(vsAi).includes('人机对局'), '提示里有对弈方式');
  eq(gameModeText(vsAi.slice.game), '人机对局 · 你执白', '状态行那句话跟着执白走');
  eq(gameModeText({ ...DEFAULT_GAME, mode: 'ai-vs-ai' }), '机机对局', '机机那句话');
  eq(gameModeText(DEFAULT_GAME), '辅助模式 · AI 不自己落子', '手动那句话');

  eq(hasUnsaved(plain), false, '没动过的盘不算未保存');
  eq(hasUnsaved(copy), true, '动过的盘算未保存');
}

section('棋盘切片：哪些字段属于一盘棋');
{
  const s = emptySlice();
  eq(Object.keys(s).length, BOARD_KEYS.length, '切片的字段数正好是清单的长度');
  eq(everyBoardKeyIsListed, true, 'BOARD_KEYS 覆盖了切片里的每一个字段');
  const withGlobal = { ...s, settings: {}, toasts: [], boards: {}, activeBoard: 'x' } as unknown as BoardSlice;
  const picked = sliceFrom(withGlobal);
  eq(Object.keys(picked).length, BOARD_KEYS.length, '换出时只挑清单里的字段');
  eq('settings' in picked, false, '设置不会被卷进一盘棋');
  eq('activeBoard' in picked, false, '标签自己的字段也不会被卷进去');

  eq(propNum(s.tree, s.tree.root, 'SZ', 0), 19, '新盘默认 19 路');
  eq(propNum(s.tree, s.tree.root, 'KM', 0), 7.5, '新盘默认贴 7.5 目');
  eq(s.dirty, false, '新盘不算未保存');
  eq(s.autoReturn, 'manual', '新盘没开机机');
  eq(s.reviewSummary.moves, 0, '新盘没有复盘汇总');
  eq(s.analyzing, false, '新盘不在分析');
}

section('棋盘切片：复制一盘出来');
{
  const m = addMoveNode(emptySlice().tree, 1, BLACK, 3 * 19 + 3);
  const point: ReviewPoint = {
    nodeId: 2,
    ply: 1,
    turn: 'B',
    blackWinrate: 0.52,
    blackScoreLead: 1.5,
    visits: 120,
    bestMove: 'D16',
    candidates: []
  };
  const src: BoardSlice = {
    ...emptySlice(),
    tree: m.tree,
    current: m.id,
    filePath: 'C:\\棋谱\\原盘.sgf',
    dirty: false,
    past: [createTree(19, 7.5)],
    game: { ...DEFAULT_GAME, mode: 'ai-vs-ai', visits: 800 },
    finished: '黑中盘胜',
    reviewPoints: { 2: point },
    reviewSign: { 2: 'sign' },
    reviewMoves: [
      { nodeId: 2, ply: 1, turn: 'B', loss: 0, grade: 'best', played: 'D16', bestMove: 'D16', winrate: 0.52, bestWinrate: 0.52 }
    ],
    reviewSummary: { ...EMPTY_REVIEW_SUMMARY, moves: 1, best: 1 }
  };
  const cp = cloneSlice(src);
  eq(cp.filePath, null, '副本不指向原文件');
  eq(cp.dirty, true, '原件存过盘，副本算还没存过');
  eq(cp.game.visits, 800, '对局强度跟着过来');
  eq(cp.game.mode, 'manual', '对弈方式退回手动，副本不该一开就自己下');
  eq(cp.finished, '黑中盘胜', '结局跟着过来');
  eq(cp.current, src.current, '落点还是同一手');
  eq(cp.past.length, 0, '撤销历史不带过去');
  eq(cp.analyzing, false, '分析状态不带过去');
  ok(cp.tree !== src.tree, '棋谱是克隆出来的另一棵');
  eq(countNodes(cp.tree), countNodes(src.tree), '克隆出来的节点数一样');
  eq(Object.keys(cp.reviewPoints).length, 1, '复盘结果跟着棋谱走');
  eq(cp.reviewSummary.best, 1, '复盘汇总也跟着');
  eq(copiedBoard(src).note, '副本', '复制出来的标签写明是副本');

  const grown = addMoveNode(cp.tree, cp.current, WHITE, 15 * 19 + 15);
  eq(countNodes(grown.tree), countNodes(src.tree) + 1, '在副本上落一手，副本自己长一手');
  eq(countNodes(src.tree), 2, '原件还是两手，一点没动');
}

section('会话文件：关掉再打开还在');
{
  const one = addMoveNode(freshBoard().slice.tree, 1, BLACK, 3 * 19 + 3);
  const two = addMoveNode(one.tree, one.id, WHITE, 15 * 19 + 15);
  const mainLine: BoardTab = {
    id: 'A',
    note: '',
    slice: {
      ...emptySlice(),
      tree: two.tree,
      current: one.id,
      filePath: 'C:\\棋谱\\a.sgf',
      dirty: true,
      game: { ...DEFAULT_GAME, mode: 'vs-ai', visits: 600, timeMs: 2500 },
      finished: '白中盘胜'
    }
  };
  const duplication: BoardTab = { id: 'B', note: '副本', slice: { ...emptySlice(), dirty: false } };
  const s = toSession([mainLine, duplication], 'B');
  eq(s.version, SESSION_VERSION, '会话文件带版本号');
  eq(s.boards.length, 2, '两盘都记下来了');
  eq(s.active, 'B', '当前是哪一盘也记下来');

  const back = fromSession(s);
  ok(back !== null, '读得回来');
  const [ra, rb] = back!.tabs;
  eq(back!.activeId, 'B', '当前标签还是那一盘');
  eq(ra.id, 'A', '标签编号也留着');
  eq(boardTitle(rb), '副本', '副本的说明留着');
  eq(
    positionKey(ra.slice.tree, ra.slice.current),
    positionKey(mainLine.slice.tree, mainLine.slice.current),
    '按路径找回来了，还是同一手'
  );
  eq(moveNumberAt(ra.slice.tree, ra.slice.current), 1, '手数也对');
  eq(ra.slice.filePath, 'C:\\棋谱\\a.sgf', '文件路径留着');
  eq(ra.slice.dirty, true, '未保存标记留着');
  eq(ra.slice.finished, '白中盘胜', '结局留着');
  eq(ra.slice.game.visits, 600, '对局强度留着');
  eq(ra.slice.game.timeMs, 2500, '每步限时留着');
  eq(ra.slice.game.mode, 'vs-ai', '对弈方式留着');
  eq(ra.slice.analyzing, false, '读回来不带着分析状态，重开程序不该自己去占显卡');
  eq(ra.slice.reviewRunning, false, '也不带着复盘状态');
  eq(Object.keys(ra.slice.reviewPoints).length, 0, '复盘结果不落盘');

  eq(fromSession(null), null, '没有会话文件就老老实实开一盘空棋');
  eq(fromSession({ version: 999, active: 'A', boards: [] }), null, '版本对不上不认');
  eq(fromSession({ version: SESSION_VERSION, active: 'A', boards: [] }), null, '一盘都没有就不认');
  const halfBad = fromSession({
    version: SESSION_VERSION,
    active: 'zzz',
    boards: [
      { id: 'A', note: '', sgf: 12345, path: [], filePath: null, dirty: false, game: DEFAULT_GAME, finished: null },
      s.boards[1]
    ]
  });
  ok(halfBad !== null, '坏掉的那一盘被跳过，其余照收');
  eq(halfBad!.tabs.length, 1, '只收下能读的那一盘');
  eq(halfBad!.activeId, 'B', '当前标签对不上时落到第一盘，不会一头雾水');
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

section('实时截取：认得出网页上多的那一手，认不出就什么都不动');
{
  // 19 路空盘，轮黑
  const empty = new Int8Array(19 * 19);
  eq(planMirror(19, empty, BLACK, empty).kind, 'same', '两边都是空盘就是一致');
  const whiteAppeared = Int8Array.from(empty);
  whiteAppeared[60] = WHITE;
  eq(planMirror(19, empty, BLACK, whiteAppeared).kind, 'mismatch', '轮黑走的时候网页上冒出白子，认不出来，宁可不动');

  // 网页上多了黑棋一手
  const oneMore = Int8Array.from(empty);
  oneMore[60] = BLACK;
  const plan = planMirror(19, empty, BLACK, oneMore);
  ok(plan.kind === 'move' && plan.point === 60 && plan.color === BLACK, '刚好差一手，认出是哪一手的哪一方', plan);

  // 提子：白 1 被黑围住只剩 0 位一口气，黑下在 0 提掉它，网页上就是"黑多一颗、白少一颗"
  const surrounded = Int8Array.from(empty);
  surrounded[1] = WHITE;
  surrounded[2] = BLACK;
  surrounded[19] = BLACK;
  surrounded[20] = BLACK;
  const captured = Int8Array.from(surrounded);
  captured[0] = BLACK;
  captured[1] = 0;
  const cap = planMirror(19, surrounded, BLACK, captured);
  ok(cap.kind === 'move' && cap.point === 0 && cap.color === BLACK, '带提子的一手也认得出来', cap);

  // 打劫那种形状：本地白 1 只剩一口气，网页上白已经把 0 位提走了
  const ko = Int8Array.from(empty);
  ko[1] = WHITE;
  ko[2] = BLACK;
  ko[19] = BLACK;
  ko[20] = BLACK;
  const koTaken = Int8Array.from(ko);
  koTaken[0] = WHITE;
  const koPlan = planMirror(19, ko, BLACK, koTaken);
  ok(koPlan.kind !== 'move', '网页上多出来的是白方的子（劫材那类），不硬接', koPlan);

  // 差好几颗：报清楚多几颗少几颗
  const twoMore = Int8Array.from(empty);
  twoMore[60] = BLACK;
  twoMore[61] = WHITE;
  const far = planMirror(19, empty, BLACK, twoMore);
  ok(far.kind === 'mismatch' && far.missing === 2 && far.extra === 0, '差两颗就报差两颗，不猜是哪一手', far);

  const gone = planMirror(19, oneMore, WHITE, empty);
  ok(gone.kind === 'mismatch' && gone.missing === 0 && gone.extra === 1, '本地有网页上没有的算"本地多"', gone);

  // 路数都不一样（网页上是 9 路），直接不算
  eq(planMirror(19, empty, BLACK, new Int8Array(81)).kind, 'mismatch', '路数对不上按对不上处理，不会拿去硬套');

  eq(expectStone(19, oneMore, 60, BLACK), true, '点完核对：那颗黑子确实在');
  eq(expectStone(19, oneMore, 60, WHITE), false, '颜色不对就不算落上');
  eq(expectStone(19, oneMore, 61, BLACK), false, '旁边那点还是空的');
  ok(isPassPoint(PASS) && isPassPoint(-1) && !isPassPoint(60), '停一手不往网页上点');
}

section('自动落子：交叉点换算成网页坐标');
{
  // 截图和视口一样大：1:1，直接用网格坐标
  const grid = { originX: 40, originY: 50, step: 30, size: 19 };
  const same = pointToPage(grid, 0, { width: 640, height: 640 }, { width: 640, height: 640 });
  ok(Boolean(same) && same!.x === 40 && same!.y === 50, '左上角那个交叉点', same);
  const mid = pointToPage(grid, 9 * 19 + 9, { width: 640, height: 640 }, { width: 640, height: 640 });
  ok(Boolean(mid) && mid!.x === 40 + 9 * 30 && mid!.y === 50 + 9 * 30, '天元按行列算准', mid);
  const corner = pointToPage(grid, 18 * 19 + 18, { width: 640, height: 640 }, { width: 640, height: 640 });
  ok(Boolean(corner) && corner!.x === 40 + 18 * 30 && corner!.y === 50 + 18 * 30, '右下角那个交叉点', corner);

  // 显示器缩放：截图是视口的两倍大，坐标要缩回去一半
  const half = pointToPage(grid, 9 * 19 + 9, { width: 640, height: 640 }, { width: 1280, height: 1280 });
  ok(Boolean(half) && Math.abs(half!.x - (40 + 270) / 2) < 0.001, '截图比视口大时按比例缩回', half);

  // 分屏拖动之后截图的宽高比会变，两个方向各算各的
  const wide = pointToPage(grid, 9 * 19 + 9, { width: 320, height: 640 }, { width: 640, height: 640 });
  ok(Boolean(wide) && Math.abs(wide!.x - (40 + 270) / 2) < 0.001 && Math.abs(wide!.y - (50 + 270)) < 0.001, '宽窄和高矮分开换算', wide);

  eq(pointToPage(grid, 19 * 19, { width: 1, height: 1 }, { width: 1, height: 1 }), null, '越界的点不给坐标');
  eq(pointToPage({ ...grid, step: 0 }, 60, { width: 1, height: 1 }, { width: 1, height: 1 }), null, '网格步长不合法就不点');
}

section('复盘：从逐手分析结果算亏损');
{
  // 四个局面，胜率都是黑棋视角。第一手黑、第二手白、第三手黑。
  const pts: ReviewPoint[] = [
    { nodeId: 1, ply: 0, turn: 'B', blackWinrate: 0.5, blackScoreLead: 0, visits: 100, bestMove: 'Q16', candidates: [{ move: 'Q16', blackWinrate: 0.5, visits: 100 }, { move: 'D4', blackWinrate: 0.48, visits: 20 }] },
    { nodeId: 2, ply: 1, turn: 'W', blackWinrate: 0.42, blackScoreLead: -1.5, visits: 100, bestMove: 'D4', candidates: [{ move: 'D4', blackWinrate: 0.42, visits: 100 }] },
    { nodeId: 3, ply: 2, turn: 'B', blackWinrate: 0.5, blackScoreLead: 0.5, visits: 100, bestMove: 'Q16', candidates: [{ move: 'Q16', blackWinrate: 0.5, visits: 100 }] },
    { nodeId: 4, ply: 3, turn: 'W', blackWinrate: 0.2, blackScoreLead: -8, visits: 100, bestMove: 'K10', candidates: [{ move: 'K10', blackWinrate: 0.2, visits: 100 }, { move: 'C3', blackWinrate: 0.19, visits: 30 }] }
  ];
  const moves = [
    { nodeId: 2, color: BLACK, point: 3 * 19 + 15 },
    { nodeId: 3, color: WHITE, point: 15 * 19 + 3 },
    { nodeId: 4, color: BLACK, point: 9 * 19 + 9 }
  ];
  const rev = buildReview(moves, pts, 19);
  eq(rev.length, 3, '三手都评上了');

  // 黑走 Q16：胜率 0.5 掉到 0.42，黑方亏 8 个点，而且正是引擎候选里的第一手
  eq(toPercent(rev[0].loss), 8, '黑棋这一手亏 8 个点');
  eq(rev[0].rank, 1, '走的就是引擎候选里的第一手');
  eq(rev[0].grade, 'mistake', '8 个点算失误');
  eq(rev[0].vertex, 'Q16', '着点写成 GTP 坐标');
  eq(rev[0].bestMove, 'Q16', '引擎推荐的那一手也记下来了');

  // 白走 D4 之后黑棋胜率涨回来，说明亏的是白棋；白的胜率是 1 减黑的，符号要翻过来
  eq(toPercent(rev[1].loss), 8, '白棋这一手同样亏 8 个点');
  ok(rev[1].lossPoints > 0, '白棋目数上也是亏的（正值代表下棋那方亏）', rev[1].lossPoints);
  eq(rev[1].grade, 'mistake', '白棋这一手也是失误');

  // 黑走 K10：0.5 掉到 0.2，亏 30 个点
  eq(toPercent(rev[2].loss), 30, '黑棋这一手亏 30 个点');
  eq(rev[2].grade, 'blunder', '30 个点算恶手');
  eq(rev[2].ply, 3, '手数按顺序排');

  const sum = summarize(rev);
  eq(sum.moves, 3, '统计了 3 手');
  eq(sum.blunder, 1, '统计里有一个恶手');
  eq(sum.mistake, 2, '统计里有两个失误');
  eq(sum.best, 0, '没有最佳');
  eq(sum.worst?.ply, 3, '最坏的是第三手');
  ok(Math.abs(sum.totalLoss - 0.46) < 1e-9, '总损失是各手之和', sum.totalLoss);
}

section('复盘：不亏的手与没算完的手');
{
  const pts: ReviewPoint[] = [
    { nodeId: 1, ply: 0, turn: 'B', blackWinrate: 0.5, blackScoreLead: 0, visits: 100, bestMove: 'Q16', candidates: [{ move: 'Q16', blackWinrate: 0.5, visits: 100 }] },
    { nodeId: 2, ply: 1, turn: 'W', blackWinrate: 0.5, blackScoreLead: 0, visits: 100, bestMove: 'D4', candidates: [{ move: 'D4', blackWinrate: 0.5, visits: 100 }] }
  ];
  const rev = buildReview([{ nodeId: 2, color: BLACK, point: 3 * 19 + 15 }], pts, 19);
  eq(rev[0].grade, 'best', '胜率没掉又是引擎推荐的那一手，算最佳');
  eq(toPercent(rev[0].loss), 0, '没有损失');
  eq(problemMoves(rev).length, 0, '没有损失就不算问题手');
  eq(summarize(rev).worst?.ply, 1, '统计里最坏的那一手仍然是它（界面要显示）');

  // 引擎只算完两个局面，却有五手：对不上的部分不评，免得把没算出来当成下得差
  const short: ReviewPoint[] = [
    { nodeId: 1, ply: 0, turn: 'B', blackWinrate: 0.5, blackScoreLead: 0, visits: 100, bestMove: 'Q16', candidates: [] },
    { nodeId: 2, ply: 1, turn: 'W', blackWinrate: 0.45, blackScoreLead: -1, visits: 100, bestMove: 'D4', candidates: [] }
  ];
  const many = [1, 2, 3, 4, 5].map((i) => ({ nodeId: i, color: BLACK, point: i }));
  eq(buildReview(many, short, 19).length, 1, '只评出能对上的那一手');
  eq(buildReview(many, [], 19).length, 0, '一个结果都没有就什么都不评');
  eq(buildReview([], short, 19).length, 0, '没有着手就不评');
}

section('复盘：问题手排序与前后跳转');
{
  // 胜率按手数排：0.5 → 0.48（黑小亏）→ 0.58（白亏 10 点）→ 0.58（黑不亏）→ 0.90（白亏 32 点）
  const raw = [0.5, 0.48, 0.58, 0.58, 0.9];
  const pts: ReviewPoint[] = raw.map((wr, i) => ({
    nodeId: i + 1,
    ply: i,
    turn: (i % 2 === 0 ? 'B' : 'W') as 'B' | 'W',
    blackWinrate: wr,
    blackScoreLead: 0,
    visits: 100,
    bestMove: 'Q16',
    candidates: []
  }));
  const moves = [2, 3, 4, 5].map((nodeId, i) => ({ nodeId, color: i % 2 === 0 ? BLACK : WHITE, point: i }));
  const rev = buildReview(moves, pts, 19);
  eq(rev.length, 4, '四手都评上了');

  const probs = problemMoves(rev);
  eq(probs.length, 2, '两处值得看的地方');
  eq(probs[0].ply, 4, '亏得多的排在前面');
  eq(probs[0].grade, 'blunder', '第 4 手是恶手');
  eq(probs[1].ply, 2, '第二处是第 2 手');

  eq(nextProblem(rev, 0, 1)?.ply, 2, '从开局往后找，第一处是第 2 手');
  eq(nextProblem(rev, 2, 1)?.ply, 4, '从第 2 手往后找是第 4 手');
  eq(nextProblem(rev, 4, 1), null, '最后一处之后没有了');
  eq(nextProblem(rev, 4, -1)?.ply, 2, '从第 4 手往前找是第 2 手');
  eq(nextProblem(rev, 1, -1), null, '第一处之前没有了');
  eq(nextProblem(rev, 0, 1, 'blunder')?.ply, 4, '只看恶手时第 2 手不算');
}

section('复盘：胜率曲线');
{
  const pts: ReviewPoint[] = [
    { nodeId: 3, ply: 1, turn: 'W', blackWinrate: -0.2, blackScoreLead: 0, visits: 100, bestMove: 'D4', candidates: [] },
    { nodeId: 1, ply: 0, turn: 'B', blackWinrate: 0.5, blackScoreLead: 0, visits: 100, bestMove: 'Q16', candidates: [] },
    { nodeId: 5, ply: 2, turn: 'B', blackWinrate: 1.4, blackScoreLead: 0, visits: 100, bestMove: 'Q16', candidates: [] }
  ];
  const c = curvePoints(pts);
  eq(c.length, 3, '三个点都在');
  eq(c[0].ply, 0, '按手数排序，起点在最前面');
  eq(c[1].ply, 1, '第二个点是第 1 手');
  eq(c[1].black, 0, '小于 0 的胜率压到 0');
  eq(c[2].black, 1, '大于 1 的胜率压到 1');
}

section('棋谱树：每一手是谁下的');
{
  const t0 = createTree(19, 7.5);
  const human = addMoveNode(t0, t0.root, BLACK, 3 * 19 + 3, { mainLine: true, source: 'human' });
  const ai = addMoveNode(human.tree, human.id, WHITE, 15 * 19 + 15, { mainLine: true, source: 'ai' });
  const plain = addMoveNode(ai.tree, ai.id, BLACK, 3 * 19 + 15, { mainLine: true });
  eq(moveSourceOf(ai.tree, human.id), 'human', '人下的一手记住了');
  eq(moveSourceOf(ai.tree, ai.id), 'ai', '机器下的一手记住了');
  eq(moveSourceOf(ai.tree, plain.id), null, '没标来源的就当不知道（导入的棋谱）');
  eq(moveSourceOf(ai.tree, t0.root), null, '起始节点没有来源');

  // 存成 SGF 再读回来，标记得还在
  const text = serializeSgf(ai.tree);
  ok(text.includes('SRC[human]') && text.includes('SRC[ai]'), '棋谱文件里带着来源标记');
  const back = parseSgf(text)[0];
  const chain: number[] = [];
  let cur = back.root;
  for (;;) {
    chain.push(cur);
    const kids = back.nodes[cur]?.children ?? [];
    if (kids.length === 0) break;
    cur = kids[0];
  }
  const sources = chain.map((id) => moveSourceOf(back, id)).filter((v) => v !== null);
  eq(sources.length, 2, '读回来两手的来源都在');
  eq(sources[0], 'human', '第一手还是人下的');
  eq(sources[1], 'ai', '第二手还是机器下的');
  eq(moveSourceOf(back, chain[3]), null, '没标的那一手读回来还是不知道');

  // 送去引擎的那份要摘掉自定义属性，KataGo 不认识会当成非法属性拒收
  const sent = engineSgfFor(ai.tree, ai.id, 'B').sgf;
  ok(!sent.includes('SRC'), '送去引擎的那份没有这个自定义属性');
  ok(sent.includes('dd') && sent.includes('pp'), '两手着法本身还在');
}

section('对局到头：两边都停一手才算完');
{
  const t0 = createTree(19, 7.5);
  eq(endedByDoublePass(t0, t0.root), false, '空盘不算下完');

  const one = addMoveNode(t0, t0.root, BLACK, 3 * 19 + 3, { mainLine: true });
  eq(endedByDoublePass(one.tree, one.id), false, '只停了一手（前面没棋）不算下完');

  const bPass = addMoveNode(one.tree, one.id, WHITE, PASS, { mainLine: true });
  eq(endedByDoublePass(bPass.tree, bPass.id), false, '只有末尾这一手是停，不算下完');

  const bPass2 = addMoveNode(bPass.tree, bPass.id, BLACK, PASS, { mainLine: true });
  eq(endedByDoublePass(bPass2.tree, bPass2.id), true, '连着两手停，就是下完了');
  eq(endedByDoublePass(bPass2.tree, bPass.id), false, '回到中间那个节点上看，那时候还没完');

  // 停一手之后又落子，那是接着下，不是终局
  const again = addMoveNode(bPass.tree, bPass.id, BLACK, 15 * 19 + 15, { mainLine: true });
  eq(endedByDoublePass(again.tree, again.id), false, '停了一手又落子，还是接着下');

  // 另一边分支上的两停不影响这一条线
  const t1 = createTree(19, 7.5);
  const m1 = addMoveNode(t1, t1.root, BLACK, 3 * 19 + 3, { mainLine: true });
  const passA = addMoveNode(m1.tree, m1.id, WHITE, PASS, { mainLine: true });
  const passB = addMoveNode(passA.tree, passA.id, BLACK, PASS, { mainLine: true });
  const branch = addMoveNode(passA.tree, passA.id, BLACK, 5 * 19 + 5, { mainLine: false });
  eq(endedByDoublePass(passB.tree, passB.id), true, '主线末尾两停');
  eq(endedByDoublePass(branch.tree, branch.id), false, '同一处的另一条分支照自己的路算');

  // 摆子节点不占手数：盘上摆一片子再看末尾两手
  const t2 = createTree(19, 7.5);
  const setup = addChild(t2, t2.root, { AB: ['dd', 'pp'], AW: ['dp', 'pd'] });
  const s1 = addMoveNode(setup.tree, setup.id, BLACK, PASS, { mainLine: true });
  const s2 = addMoveNode(s1.tree, s1.id, WHITE, PASS, { mainLine: true });
  eq(endedByDoublePass(s2.tree, s2.id), true, '摆子局面下连着两手停也算下完');
  eq(endedByDoublePass(s2.tree, setup.id), false, '摆子节点本身不算一手棋');
}

section('最后一手标记：可选样式');
{
  const values = LAST_MOVE_MARK_OPTIONS.map((o) => o.value);
  eq(values.length, 6, '六个样式可选');
  eq(new Set(values).size, 6, '样式名没有重的');
  ok(values.includes(DEFAULT_SETTINGS.lastMoveMark), '默认值能在设置里选到');
  eq(DEFAULT_SETTINGS.lastMoveMark, 'dot', '默认还是原来那个异色点');
  for (const o of LAST_MOVE_MARK_OPTIONS) ok(o.label.length > 0, '每个样式都有中文名字：' + o.value);
}

section('视觉大模型：把正文读成棋盘');
{
  const blank = (n: number, fill = '.') => fill.repeat(n);
  // 一整张空盘，中间一颗黑一颗白
  const rows = [
    blank(9) + 'X' + blank(9),
    blank(19),
    blank(9) + 'O' + blank(9),
    ...new Array(16).fill(blank(19))
  ];
  eq(rows.length, 19, '拼出来正好 19 行');
  const g = parseVisionGrid(rows.join('\n'), 19);
  eq(g?.length, 361, '读出来 361 个点');
  eq(g?.[9], BLACK, '第一行中间那颗是黑子');
  eq(g?.[2 * 19 + 9], WHITE, '第三行中间那颗是白子');
  eq(g?.[0], 0, '没提到的地方是空点');

  // 模型爱加的前后缀：解释、代码围栏、行号、行尾空格，都不该把它带偏
  const noisy = ['这是一张 19 路棋盘：', '```', ...rows.map((r, i) => `${i + 1} ${r}  `), '```', '以上。'].join('\n');
  eq(parseVisionGrid(noisy, 19)?.[9], BLACK, '带解释和行号也认得出');

  // 小写 x、o 也认
  const lower = rows.map((r, i) => (i === 9 ? blank(9) + 'x' + blank(9) : r));
  eq(parseVisionGrid(lower.join('\n'), 19)?.[9], BLACK, '小写 x 也当黑子');

  // 行数不够、长短不齐、路数不对，都算它没按规矩来
  eq(parseVisionGrid(rows.slice(0, 18).join('\n'), 19), null, '少一行就不认');
  eq(parseVisionGrid([...rows.slice(0, 18), blank(18)].join('\n'), 19), null, '有一行短一个字符也不认');
  eq(parseVisionGrid(rows.join('\n'), 9), null, '按 9 路要就对不上');
  eq(parseVisionGrid('棋盘大概是空的，我没看清。', 19), null, '一句解释里没有棋盘');
  eq(parseVisionGrid('', 19), null, '空正文不认');
  eq(parseVisionGrid(rows.join('\n'), 0), null, '路数不合法不认');
}

section('视觉接口：地址写得对不对，一眼看出来');
{
  eq(endpointHint(''), null, '空地址不啰嗦');
  eq(endpointHint('https://api.deepseek.com/v1/chat/completions'), null, '标准写法没意见');
  ok(Boolean(endpointHint('api.deepseek.com/v1/chat/completions')), '少 http 的要提醒');
  ok(Boolean(endpointHint('https://api.deepseek.com/v1')), '不是 chat/completions 的要提醒');
}

section('视觉接口：请求怎么发、错怎么报');
{
  const base = { endpoint: 'https://example.com/v1/chat/completions', model: 'm1', apiKey: 'sk-x', imageDataUrl: 'data:image/png;base64,AAA', size: 19 };

  // 请求体：模型名、图、以及"只输出 N 行"的交代
  const body = visionBody(base) as { model: string; max_tokens: number; messages: Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }> };
  eq(body.model, 'm1', '带上模型名');
  eq(body.max_tokens, 4000, '给正文留够长度');
  eq(body.messages[0].content[1].image_url?.url, base.imageDataUrl, '图原样带上');
  eq(body.messages[0].content[0].text, visionPrompt(19), '提示词就是那句"只输出 19 行"');
  ok(visionPrompt(13).includes('13 行'), '13 路的提示词说的是 13 行');
  eq(body.messages[0].content.length, 2, '一条文字一条图');

  const reply = (payload: unknown, status = 200) =>
    Promise.resolve(new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status }));

  // 成功
  let seen: { url: string; init: RequestInit } | null = null;
  const okFetch = (url: string, init: RequestInit): Promise<Response> => {
    seen = { url, init };
    return reply({ choices: [{ message: { content: '  .X.\n.O.  ' } }] });
  };
  const good = await visionChat(base, { fetchImpl: okFetch });
  eq(good.ok, true, '正常返回算成功');
  eq(good.content, '.X.\n.O.', '正文两头空白去掉');
  eq(seen?.url, base.endpoint, '发到设置里那个地址');
  {
    const h = (seen?.init.headers ?? {}) as Record<string, string>;
    eq(h.Authorization, 'Bearer sk-x', '带上密钥');
    eq(h['Content-Type'], 'application/json', '声明是 JSON');
    eq(seen?.init.method, 'POST', '用 POST');
  }

  // 键和地址两头的空格要抹掉
  const trimmed = await visionChat({ ...base, endpoint: '  https://example.com/x  ', apiKey: '  sk-y  ' }, { fetchImpl: okFetch });
  eq(trimmed.ok, true, '前后带空格的地址和密钥照样能发');
  eq(seen?.url, 'https://example.com/x', '地址两端空格去掉');
  eq((seen?.init.headers as Record<string, string>).Authorization, 'Bearer sk-y', '密钥两端空格去掉');

  // 没填全
  const noEndpoint = await visionChat({ ...base, endpoint: '  ' }, { fetchImpl: okFetch });
  eq(noEndpoint.ok, false, '地址空的直接不发');
  ok(String(noEndpoint.error).includes('地址'), '说清楚是地址的问题', noEndpoint.error);
  const noKey = await visionChat({ ...base, apiKey: '' }, { fetchImpl: okFetch });
  ok(String(noKey.error).includes('密钥'), '说清楚是密钥的问题', noKey.error);
  const noImage = await visionChat({ ...base, imageDataUrl: '' }, { fetchImpl: okFetch });
  ok(String(noImage.error).includes('图片'), '说清楚是没有图片', noImage.error);

  // 连不上、超时、401、不是 JSON、没有正文，各是各的说法
  const boom = (e: unknown) => (): Promise<Response> => Promise.reject(e);
  const netErr = await visionChat(base, { fetchImpl: boom(new TypeError('fetch failed')) });
  eq(netErr.ok, false, '连不上算失败');
  ok(String(netErr.error).includes('fetch failed'), '把网络层的原话带出来', netErr.error);
  const aborted = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  const timedOut = await visionChat(base, { fetchImpl: boom(aborted), timeoutMs: 9000 });
  ok(String(timedOut.error).includes('9 秒'), '超时说的是等了多少秒', timedOut.error);

  const unauth = await visionChat(base, { fetchImpl: () => reply({ error: { message: 'Authentication Fails' } }, 401) });
  eq(unauth.ok, false, '401 算失败');
  eq(unauth.status, 401, '状态码带回来');
  ok(String(unauth.body).includes('Authentication Fails'), '服务端原话带回来', unauth.body);

  const html = await visionChat(base, { fetchImpl: () => reply('<html>网关错误</html>') });
  ok(String(html.error).includes('不是 JSON'), '返回网页而不是 JSON 时说得明白', html.error);
  ok(String(html.body).includes('网关错误'), '顺手把原文前几个字带上', html.body);

  const empty = await visionChat(base, { fetchImpl: () => reply({ choices: [{ message: { content: '   ' }, finish_reason: 'length' }] }) });
  ok(String(empty.error).includes('截断'), '被截断时说清是被截断了', empty.error);
  const silent = await visionChat(base, { fetchImpl: () => reply({ choices: [{ message: {} }] }) });
  ok(String(silent.error).includes('没有返回正文'), '没正文时说不清就直说', silent.error);
  const noChoice = await visionChat(base, { fetchImpl: () => reply({}) });
  eq(noChoice.ok, false, '连 choices 都没有也算失败');
}

console.log(`\n界面逻辑自测：${passed} 项通过，${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
