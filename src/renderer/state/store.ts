import { create } from 'zustand';
import {
  BLACK,
  DEFAULT_SETTINGS,
  PASS,
  WHITE,
  type AnalysisSnapshot,
  type AppSettings,
  type EngineStatus,
  type GameInfo,
  type GameTree,
  type Stone
} from '../../shared/types';
import type { AppInfo } from '../../shared/protocol';
import {
  addChild,
  addMoveNode,
  canSetTurn,
  colorToPlayAt,
  createTree,
  deleteSubtree,
  endedByDoublePass,
  infoFromTree,
  mainLineEnd,
  makeMainLine,
  marksAt,
  moveAtSized,
  moveNumberAt,
  pathTo,
  positionAt,
  positionKey,
  propNum,
  setProp,
  setTurnAt,
  turnWithOverride,
  type Mark,
  type MarkType
} from '../core/sgf/tree';
import { labelValue, nextLabel, parseLabel } from '../core/sgf/codec';
import { adviceLine, colorName, isPassMove, type Advice } from '../core/advice';
import {
  buildReview,
  nextProblem,
  problemMoves,
  summarize,
  type ReviewMove,
  type ReviewPoint,
  type ReviewSummary
} from '../core/review/review';
import { cloneTree, serializeSgf } from '../core/sgf/serialize';
import { engineSgfFor } from '../core/sgf/engineSgf';
import { parseSgf } from '../core/sgf/parse';
import {
  DEFAULT_GAME,
  boardTitle,
  closeBoard,
  copiedBoard,
  freshBoard,
  nthBoard,
  openBoard,
  sliceFrom,
  stepBoard,
  type BoardSlice,
  type BoardTab,
  type GameConfig
} from '../core/boards/boards';
import { fromSession, toSession } from '../core/boards/session';
import { Position } from '../core/go/position';
import { closeTab, makeTab, openTab, stepTab, type BrowserTab } from '../core/browser/tabs';
import { expectStone, isPassPoint, planMirror, pointToPage } from '../core/browser/mirror';
import { imageDataFromUrl } from '../core/cv/image';
import { recognizeBoard, type GridFit, type ImageBox } from '../core/cv/recognize';
import {
  DEFAULT_LEFT,
  DEFAULT_RIGHT,
  DEFAULT_SPLIT,
  DEFAULT_SPLIT_Y,
  LEFT_MAX,
  LEFT_MIN,
  RIGHT_MAX,
  RIGHT_MIN,
  SPLIT_MAX,
  SPLIT_MIN,
  SPLIT_MAX_Y,
  SPLIT_MIN_Y,
  axisSpec,
  toAxisChoice,
  type AxisChoice,
  type SplitAxis
} from '../core/layout/panes';

export type Tool =
  | 'play'
  | 'free'
  | 'black'
  | 'white'
  | 'erase'
  | 'triangle'
  | 'square'
  | 'circle'
  | 'cross'
  | 'label';
export type DialogName =
  | 'settings'
  | 'about'
  | 'models'
  | 'library'
  | 'score'
  | 'image'
  | 'gameinfo'
  | 'shortcuts'
  | 'newgame'
  | 'review'
  | 'closetab'
  | null;

/**
 * 对局设置就那么几项，定义在 core/boards 里（它跟着一盘棋走），这里转出去给组件用。
 */
export type { GameConfig };

export interface Toast {
  text: string;
  kind: 'info' | 'error' | 'success';
  id: number;
}

interface AppStore {
  ready: boolean;
  settings: AppSettings;
  info: AppInfo | null;
  theme: 'dark' | 'light';

  tree: GameTree;
  current: number;
  past: GameTree[];
  future: GameTree[];
  filePath: string | null;
  dirty: boolean;
  /** 这一盘手动指定的行棋方（跟着这一盘走，见 core/boards 的 BoardSlice）。 */
  turnOverride: 1 | 2 | null;

  /**
   * 打开着的几盘棋，像浏览器的标签页。顺序就是标签条上的顺序。
   *
   * 当前那一盘摊在 store 顶层（tree、current、analysis… 这些字段），其余的存在各自
   * 的 slice 里：那几十个动作全是照着顶层字段写的，切标签时换进换出，动作和组件
   * 就都不用改。哪一块属于一盘棋，只由 core/boards 里的 BOARD_KEYS 说了算。
   */
  boards: BoardTab[];
  activeBoard: string;
  /** 刚关掉的那几个标签，Ctrl+Shift+T 按顺序开回来，最多留十个。 */
  closedBoards: BoardTab[];

  tool: Tool;
  /** "自由落子"用哪个颜色落。跟着工具走的一件小事，不属于某一盘棋。 */
  freeColor: 1 | 2;
  hover: number | null;
  cursor: number | null;
  /** 是否在棋盘上铺形势判断的热力块，默认关，免得挡住棋子。 */
  showOwnership: boolean;

  engineStatus: EngineStatus;
  analysis: AnalysisSnapshot | null;
  analyzing: boolean;
  /** 分析引擎正在起步（拉起进程、换网络都要十几秒）。界面靠它显示"启动中"。 */
  analyzeStarting: boolean;
  /**
   * 对局引擎正为哪一盘算棋。不止一盘时"引擎在想"这句话得说清是想哪一盘，
   * 界面上只有它算的那一盘才转圈。
   */
  thinkingBoard: string | null;
  /** 手里这条推荐，带颜色。盘面一变就作废，不会留在旧局面的点上。 */
  hint: Advice | null;
  engineLogs: string[];

  game: GameConfig;
  /**
   * 开"机机对局"之前是哪一档，关掉时回到这一档。不落盘：本来的对弈方式也不落盘。
   */
  autoReturn: 'manual' | 'vs-ai';
  finished: string | null;
  deadStones: number[];

  dialog: DialogName;
  image: { dataUrl: string; name: string } | null;
  browserOpen: boolean;
  /** 棋盘占中间那块的比例，分两个方向各记一份：左右分栏那份是宽度比例，上下分栏是高度比例。 */
  splitRatio: number;
  splitRatioY: number;
  /** 用户选的分栏方向，auto 是还没选过（这时界面按窗口自己挑，见 App 里的 layoutAxis）。 */
  splitAxis: AxisChoice;
  /** 左右两栏的像素宽度，拖动分隔条时改。 */
  leftWidth: number;
  rightWidth: number;
  /** 内置浏览器的标签页，一个标签一份 webview。 */
  tabs: BrowserTab[];
  activeTabId: string | null;
  zoom: number;
  toasts: Toast[];

  /** 实时截取与自动落子的最后一条状态，显示在浏览器栏上。 */
  sync: { text: string; at: number; ok: boolean } | null;

  /** 复盘：引擎逐手算出来的原始结果，按节点存，整局跑完要好久，中途停下也留着。 */
  reviewPoints: Record<number, ReviewPoint>;
  /**
   * 每份结果对应的局面长什么样（节点号 → 这一手或这个局面的特征）。
   * 退到开局重下一盘时，新着法又会拿到 2、3、4 这些节点号，
   * 只认节点号的话上一盘的评点会扣到这一盘上。
   */
  reviewSign: Record<number, string>;
  /** 复盘整理出来的评点，跟着棋谱走，落一手就重算一遍。 */
  reviewMoves: ReviewMove[];
  reviewSummary: ReviewSummary;
  reviewRunning: boolean;
  /** 这一轮复盘算完了几个局面、一共几个。 */
  reviewDone: number;
  reviewTotal: number;
  /** 上一轮是怎么结束的，界面据此提示一句。 */
  reviewStopped: 'done' | 'cancelled' | 'replaced' | 'error' | null;
  reviewError: string | null;

  // 动作
  boot: () => Promise<void>;
  setSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setInfo: (info: AppInfo) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;

  commit: (tree: GameTree, current?: number) => void;
  undo: () => void;
  redo: () => void;
  goto: (id: number) => void;
  gotoStep: (delta: number) => void;
  gotoStart: () => void;
  gotoEnd: () => void;

  play: (point: number) => void;
  playColor: (color: 1 | 2, point: number, from?: 'local' | 'remote') => void;
  pass: () => void;
  /** board 缺省是当前那盘；后台跑着机机的那盘会带自己的编号进来。 */
  playAiMove: (force?: boolean, board?: string) => Promise<string | null>;
  maybeAiTurn: (board?: string) => Promise<void>;
  /**
   * 机机对局随时开、随时停：开了双方都由 AI 自动走，从当前局面接着下，
   * 停了就回到开之前那一档。生成棋谱来复盘，或者想看引擎自己怎么下，用它。
   */
  toggleAiVsAi: () => void;
  /** 关掉机机对局并回到原来那一档。reason 是给提示用的说法，"下完了"不再多说一句。 */
  stopAiVsAi: (reason: '已停' | '下完了', board?: string) => void;
  /** 让引擎按当前行棋方走一手，走完就停，不接着自动走。 */
  aiMoveNow: () => Promise<void>;
  doHint: () => Promise<void>;
  setHint: (advice: Advice | null) => void;
  /** 候选点面板点一下，把它当推荐画到棋盘上。 */
  pickCandidate: (move: string, winrate: number, scoreLead: number) => void;
  setTurn: (color: 1 | 2) => void;
  /** 状态栏那颗"轮到谁"：点一下改成对方先走，再点一下回到按棋谱走。 */
  toggleTurn: () => void;
  resign: () => void;

  newGame: (opts: Partial<GameConfig> & { size?: number; komi?: number; handicap?: number; rules?: string }) => void;
  loadSgf: (content: string, path?: string) => void;
  importPosition: (stones: number[], size: number, asNew: boolean) => void;
  setTool: (t: Tool) => void;
  setFreeColor: (color: 1 | 2) => void;
  setShowOwnership: (v: boolean) => void;
  setHover: (p: number | null) => void;
  setSetupStone: (point: number, color: Stone) => void;
  toggleMark: (type: MarkType, point: number) => void;
  setComment: (text: string) => void;
  updateGameInfo: (patch: Partial<GameInfo>) => void;
  deleteCurrentNode: () => void;
  promoteCurrent: () => void;
  swapColors: () => void;
  clearBoard: () => void;

  startAnalysis: (force?: boolean) => Promise<void>;
  stopAnalysis: () => Promise<void>;
  toggleAnalysis: () => Promise<void>;
  setAnalysis: (s: AnalysisSnapshot | null) => void;
  /** 引擎送来一份快照，按盘落到它该去的那一盘上；不是当前盘就只存进它的切片。 */
  applySnapshot: (board: string, s: AnalysisSnapshot) => void;
  /** 某一盘的分析被别的盘顶掉了：把那盘的状态收干净。 */
  analysisReplaced: (board: string) => void;
  setThinking: (v: boolean, board?: string) => void;

  /** 某个标签上开着的一盘棋。当前那盘就是顶层那份。 */
  boardSliceOf: (id: string) => BoardSlice | null;
  /** 往某一盘上写几个字段。当前盘写顶层，后台盘写进它的切片。 */
  patchBoard: (id: string, patch: Partial<BoardSlice>) => void;
  /** 开一个空的棋盘标签，返回它的编号。 */
  openBoardTab: (opts?: { activate?: boolean; note?: string }) => string;
  /** 把当前这一盘整棵复制到新标签里，用来互相对照着研究。 */
  duplicateBoard: () => string;
  activateBoard: (id: string) => void;
  /** 关一个标签。这一盘有改动没保存时先问一句（force 是真的关，确认走完才用）。 */
  closeBoardTab: (id: string, force?: boolean) => void;
  closeOtherBoards: (force?: boolean) => void;
  closeAllBoards: (force?: boolean) => void;
  /** 关闭前的确认：要关的是哪几个标签、是关一个还是关一片。 */
  pendingClose: { ids: string[]; scope: 'one' | 'others' | 'all' } | null;
  confirmClose: (mode: 'save' | 'discard') => Promise<void>;
  cancelClose: () => void;
  stepBoardTab: (dir: 1 | -1) => void;
  nthBoardTab: (n: number) => void;
  /** 把刚关掉的那一盘开回来。 */
  reopenBoard: () => void;
  /** 这一盘是不是全新空盘（可以就地装新开的棋，不必再开标签）。 */
  activeIsEmpty: () => boolean;
  setEngineStatus: (s: EngineStatus) => void;
  pushLog: (t: string) => void;
  setDialog: (d: DialogName) => void;
  openImage: (img: { dataUrl: string; name: string } | null) => void;
  setBrowserOpen: (v: boolean) => void;
  /** 拖分隔条：按这次生效的方向写对应的那份比例。 */
  setSplit: (v: number, axis: SplitAxis) => void;
  /** 切换中间那块的排布方向，传的就是要切到的方向；切过一次就不再算"没选过"了。 */
  setSplitAxis: (v: SplitAxis) => void;
  setLeftWidth: (v: number) => void;
  setRightWidth: (v: number) => void;
  openBrowserTab: (url: string, activate?: boolean) => string;
  closeBrowserTab: (id: string) => void;
  activateTab: (id: string) => void;
  stepBrowserTab: (dir: 1 | -1) => void;
  updateTab: (id: string, patch: Partial<Pick<BrowserTab, 'url' | 'title'>>) => void;
  setZoom: (v: number) => void;
  setDeadStones: (v: number[]) => void;
  setFinished: (v: string | null) => void;
  /** 实时截取开关：开着的时候每隔几秒截一次网页，把网页上多出来的那一手接到谱上。 */
  setLiveCapture: (v: boolean) => Promise<void>;
  /** 自动落子开关：本程序里落的子，同步点到网页棋盘上。 */
  setAutoPlay: (v: boolean) => Promise<void>;
  /** 实时截取的一拍：截图、识别、跟本地局面比，刚好差一手就接上。定时器在 App 里。 */
  pollBrowser: () => Promise<void>;
  /** 把一手棋点到网页棋盘上，点完再截一次核对。parentId 是这一手接在哪个节点后面。 */
  forwardMoveToBrowser: (point: number, color: 1 | 2, parentId: number) => Promise<boolean>;

  /** 复盘：把整局（主线）逐手算一遍。已经算过的那一段会跳过，接着算剩下的。 */
  startReview: () => Promise<void>;
  stopReview: () => Promise<void>;
  /** 主进程算完一个局面，结果记进来（可能是后台那一盘的）。 */
  addReviewPoint: (p: ReviewPoint, board?: string) => void;
  endReview: (reason: 'done' | 'cancelled' | 'replaced' | 'error', error?: string, board?: string) => void;
  /** 清掉复盘结果。新开一局、导入棋谱、换访问量时调。 */
  clearReview: () => void;
  /** 跳到下一处（dir 为 1）或上一处（-1）问题手。 */
  gotoProblem: (dir: 1 | -1) => void;
}

const emptyStatus: EngineStatus = {
  running: false,
  starting: false,
  ready: false,
  backend: null,
  modelFile: null,
  modelName: null,
  error: null,
  gtpVersion: null,
  name: null
};

/** 引擎要的局面：摆子得收进根节点、轮次要写死，见 core/sgf/engineSgf.ts。 */
function sgfFor(tree: GameTree, node: number, override: 1 | 2 | null = null): string {
  const color = turnWithOverride(tree, node, override) === BLACK ? 'B' : 'W';
  return engineSgfFor(tree, node, color).sgf;
}

/**
 * 这一盘此刻轮到谁：手动指定过就按指定的，否则按棋谱数。
 * 传整份状态或者某个切片都行，两边的字段名一样。
 */
function effColor(src: { tree: GameTree; current: number; turnOverride: 1 | 2 | null }): 1 | 2 {
  return turnWithOverride(src.tree, src.current, src.turnOverride);
}

const emptyReviewSummary: ReviewSummary = {
  moves: 0,
  best: 0,
  good: 0,
  inaccuracy: 0,
  mistake: 0,
  blunder: 0,
  worst: null,
  totalLoss: 0
};

/**
 * 把引擎逐局面的结果整理成评点。
 *
 * 棋谱可以在复盘之后继续往下走，也可以在分支里拐弯，所以每次都要照现在的树重算一遍：
 * 主线路径变了，哪些手有结果、相邻两手的先后关系都可能变。
 * 只有从起始局面开始连续算完的那一段能评：中间缺一份结果就断在那儿，
 * 硬把断口两侧接起来会算出一个假的损失。
 */
function deriveReview(
  tree: GameTree,
  points: Record<number, ReviewPoint>,
  signs: Record<number, string>
): { moves: ReviewMove[]; summary: ReviewSummary } {
  const size = propNum(tree, tree.root, 'SZ', 19);
  const path = pathTo(tree, mainLineEnd(tree));
  const playMoves: Array<{ nodeId: number; color: Stone; point: number }> = [];
  const line: ReviewPoint[] = [];
  for (let i = 0; i < path.length; i++) {
    const id = path[i];
    const p = points[id];
    if (!p || p.ply !== i) break;
    // 还要确认这个节点上现在摆的就是当时算的那个局面，见 reviewSign 的说明
    if (signs[id] !== positionSign(tree, id)) break;
    const mv = moveAtSized(tree, id);
    line.push(p);
    if (mv) playMoves.push({ nodeId: id, color: mv.color as Stone, point: mv.point });
  }
  const moves = buildReview(playMoves, line, size);
  return { moves, summary: moves.length ? summarize(moves) : emptyReviewSummary };
}

/** 一个节点的局面特征：有着法就记着法，没有（开局那一手之前）就记盘面。 */
function positionSign(tree: GameTree, id: number): string {
  const mv = moveAtSized(tree, id);
  return mv ? `${mv.color}:${mv.point}` : 'pos:' + positionKey(tree, id);
}

/**
 * 换一棵新棋谱要写的那几项。commit 的动作和"后台那一盘自己落子"共用它。
 *
 * 盘面变了（落了子、摆了子、提了子）推荐就作废；只改注释标记时留着，那条推荐
 * 还是这个局面的。棋谱变了，复盘评点得跟着重算：多了一手就可能多出一处问题手，
 * 在分支里拐弯也会让"后面那一手"变成另一手（原始结果按节点存着，重算的只是整理这一步）。
 */
function commitPatch(slice: BoardSlice, tree: GameTree, current?: number): Partial<BoardSlice> {
  const cur = slice.current;
  const nextCurrent = current ?? (tree.nodes[cur] ? cur : tree.root);
  const sameBoard = slice.hint !== null && positionKey(tree, nextCurrent) === positionKey(slice.tree, cur);
  const derived =
    Object.keys(slice.reviewPoints).length > 0 ? deriveReview(tree, slice.reviewPoints, slice.reviewSign) : null;
  return {
    tree,
    current: nextCurrent,
    past: [...slice.past.slice(-120), slice.tree],
    future: [],
    dirty: true,
    hint: sameBoard ? slice.hint : null,
    ...(derived ? { reviewMoves: derived.moves, reviewSummary: derived.summary } : {})
  };
}

function clampRange(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 实时分析的代号，每次发起和每次停下都加一。引擎那头回话晚一步时用它分辨
 * "这次回话还算不算数"，见 startAnalysis 与 stopAnalysis。
 */
let analyzeRun = 0;

/** 一盘棋作用域的字段打哪几个地方看。换进换出、按盘改都走它。 */
function sliceOf(st: AppStore, id: string): BoardSlice | null {
  if (id === st.activeBoard) return sliceFrom(st);
  return st.boards.find((t) => t.id === id)?.slice ?? null;
}

/**
 * 换标签要写的那几项：把当前这盘收进 boards，把目标那盘摊到顶层。
 *
 * 只在切标签、开关标签时用，而且换出去的那盘必须写回 boards 里存住：
 * 当前盘的改动平时是写在顶层的，切走的时候不收回切片，它就跟着顶层字段
 * 被下一盘继承了。
 */
function activatePartial(st: AppStore, boards: BoardTab[], id: string): Partial<AppStore> | null {
  const stash = sliceFrom(st);
  const list = boards.map((t) => (t.id === st.activeBoard ? { ...t, slice: stash } : t));
  const target = list.find((t) => t.id === id);
  if (!target) return null;
  return { boards: list, activeBoard: id, ...sliceFrom(target.slice) };
}

/** 切换标签时该跟着关掉的对话框：里面显示的都是一盘棋的事。 */
const BOARD_DIALOGS: DialogName[] = ['newgame', 'image', 'library', 'score', 'gameinfo', 'review'];

/** 刚关掉的标签记着，好开回来。留着超过十个就丢掉最早那个。 */
function rememberClosed(list: BoardTab[], tab: BoardTab): BoardTab[] {
  return [tab, ...list].slice(0, 10);
}

/**
 * 拖分隔条时每一帧都写盘太凶，攒一会儿再写。
 * 只存布局这几项，别的字段交给主进程合并，免得把窗口位置之类的覆盖掉。
 */
let layoutTimer: ReturnType<typeof setTimeout> | null = null;
function persistLayout(s: {
  leftWidth: number;
  rightWidth: number;
  splitRatio: number;
  splitRatioY: number;
  splitAxis: AxisChoice;
  browserOpen: boolean;
}): void {
  const layout: AppSettings['layout'] = {
    leftWidth: Math.round(s.leftWidth),
    rightWidth: Math.round(s.rightWidth),
    splitRatio: s.splitRatio,
    splitRatioY: s.splitRatioY,
    splitAxis: s.splitAxis,
    browserOpen: s.browserOpen
  };
  if (layoutTimer) clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    layoutTimer = null;
    void window.api.settings.set({ layout });
  }, 400);
}

/** 起手那一盘。会话文件里读得回来就换成会话那几盘，见 boot()。 */
const firstTab = freshBoard();

/**
 * 会话没读回来之前不写盘：boot() 里那几下 set 会把上次的几盘棋覆盖成空的。
 */
let sessionReady = false;
let sessionTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 把现在这几盘写进会话文件，关掉程序下次还在这。
 *
 * 只存棋谱本身（局面、看到哪一手、文件路径、对局设置），分析结论和复盘结果不存：
 * 那些是动手才算的东西，重开程序不该自己去占显卡。
 */
async function writeSession(): Promise<void> {
  const st = useStore.getState();
  if (!sessionReady || st.boards.length === 0) return;
  try {
    await window.api.session.set(toSession(st.boards, st.activeBoard));
  } catch {
    // 存不上不影响下棋，下一次改动还会再试一遍
  }
}

/** 改动攒一会儿再写：落一手、翻一页都写盘太凶。 */
function writeSessionSoon(): void {
  if (!sessionReady) return;
  if (sessionTimer) clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    sessionTimer = null;
    void writeSession();
  }, 600);
}

export const useStore = create<AppStore>((set, get) => ({
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  info: null,
  theme: 'dark',

  // 一盘棋的全部状态都从切片里摊开，见 AppStore 里 boards 的说明
  ...sliceFrom(firstTab.slice),
  boards: [firstTab],
  activeBoard: firstTab.id,
  closedBoards: [],
  pendingClose: null,

  tool: 'play',
  freeColor: BLACK,
  hover: null,
  cursor: null,

  engineStatus: emptyStatus,
  analyzeStarting: false,
  thinkingBoard: null,
  engineLogs: [],

  dialog: null,
  image: null,
  browserOpen: false,
  splitRatio: DEFAULT_SPLIT,
  splitRatioY: DEFAULT_SPLIT_Y,
  splitAxis: 'auto',
  leftWidth: DEFAULT_LEFT,
  rightWidth: DEFAULT_RIGHT,
  tabs: [],
  activeTabId: null,
  zoom: 1,
  showOwnership: false,
  toasts: [],
  sync: null,

  async boot() {
    const [settings, info] = await Promise.all([window.api.settings.get(), window.api.app.info()]);
    const st = await window.api.engine.status().catch(() => null);
    const theme: 'dark' | 'light' =
      settings.theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : settings.theme;
    document.documentElement.dataset.theme = theme;
    const layout = settings.layout ?? DEFAULT_SETTINGS.layout;
    set({
      settings,
      info,
      theme,
      ready: true,
      leftWidth: clampRange(layout.leftWidth, LEFT_MIN, LEFT_MAX),
      rightWidth: clampRange(layout.rightWidth, RIGHT_MIN, RIGHT_MAX),
      splitRatio: clampRange(layout.splitRatio, SPLIT_MIN, SPLIT_MAX),
      // 老配置里没有这两项，也可能存的是别方向的值，各按各的范围收一遍
      splitRatioY: clampRange(layout.splitRatioY ?? DEFAULT_SPLIT_Y, SPLIT_MIN_Y, SPLIT_MAX_Y),
      splitAxis: toAxisChoice(layout.splitAxis),
      browserOpen: layout.browserOpen,
      // 重启后浏览器留一个空白标签，用户直接就能输地址，不用先点新建
      tabs: layout.browserOpen ? [makeTab('about:blank')] : [],
      activeTabId: null,
      // 界面刷新时引擎可能还在跑，状态要以主进程为准，别显示成没启动
      engineStatus: st ?? get().engineStatus,
      game: { ...get().game, visits: settings.playVisits, timeMs: settings.playTimeMs }
    });
    /*
     * 把上次那几盘棋读回来。读不出来就照常开一盘空的：会话文件坏了、版本不对
     * （换过存法），都不该让人打不开程序。
     */
    const saved = await window.api.session.get().catch(() => null);
    const restored = fromSession(saved);
    if (restored) {
      const first = restored.tabs.find((t) => t.id === restored.activeId) ?? restored.tabs[0];
      set({ boards: restored.tabs, activeBoard: first.id, ...sliceFrom(first.slice) });
    } else {
      const tab = get().boards[0] ?? freshBoard();
      const game = { ...tab.slice.game, visits: settings.playVisits, timeMs: settings.playTimeMs };
      set({ boards: [{ ...tab, slice: { ...tab.slice, game } }], activeBoard: tab.id, game });
    }
    sessionReady = true;
    if (layout.browserOpen) {
      const first = get().tabs[0];
      if (first) set({ activeTabId: first.id });
    }
    // 开机就把引擎拉起来，不等到用户点了"让引擎落一手"才在背后偷偷启动：
    // 首次运行要针对显卡做 OpenCL 调优，可能十几分钟，这段等待必须看得见
    //（面板上显示启动中，引擎日志里滚出调优进度）。已经跑着就别重复启动。
    if (!get().engineStatus.running && !get().engineStatus.starting) {
      set({ engineStatus: { ...get().engineStatus, starting: true } });
      void (async () => {
        try {
          const started = await window.api.engine.start();
          set({ engineStatus: started });
          if (started.ready) get().toast(`引擎就绪：${started.modelName}（${started.backend}）`, 'success');
        } catch (e) {
          set({ engineStatus: { ...get().engineStatus, starting: false } });
          get().toast('引擎启动失败：' + (e instanceof Error ? e.message : String(e)), 'error');
        }
      })();
    }
  },

  async setSettings(patch) {
    /*
     * 换了复盘访问量就把旧结果清掉。同一个局面用 100 次访问和 500 次访问算出来的
     * 胜率不是一回事，两份混在一张曲线里，看着像是棋走坏了，其实是算得糙。
     */
    if (patch.reviewVisits !== undefined && patch.reviewVisits !== get().settings.reviewVisits) get().clearReview();
    const next = await window.api.settings.set(patch);
    const theme: 'dark' | 'light' =
      next.theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : next.theme;
    document.documentElement.dataset.theme = theme;
    set({ settings: next, theme });
  },

  setInfo(info) {
    set({ info });
  },

  boardSliceOf(id) {
    return sliceOf(get(), id);
  },

  /**
   * 往某一盘上写几个字段。
   *
   * 当前那盘就写顶层（等于所有动作照旧），后台那盘写进它的切片：这一条是"多盘"的
   * 关键，引擎送回来的东西、后台机机自己落的子，都靠它落到对的那盘上。
   */
  patchBoard(id, patch) {
    const st = get();
    if (id === st.activeBoard || !st.boards.some((t) => t.id === id)) {
      // 认不出的编号（比如引擎报了个早就不在的盘）就当成当前盘，不要凭空造一盘出来
      set(patch);
      writeSessionSoon();
      return;
    }
    set({ boards: st.boards.map((t) => (t.id === id ? { ...t, slice: { ...t.slice, ...patch } } : t)) });
    writeSessionSoon();
  },

  openBoardTab(opts) {
    const activate = opts?.activate ?? true;
    const settings = get().settings;
    const tab = freshBoard({
      game: { ...DEFAULT_GAME, visits: settings.playVisits, timeMs: settings.playTimeMs }
    });
    if (opts?.note) tab.note = opts.note;
    const next = activate ? activatePartial(get(), [...get().boards, tab], tab.id) : null;
    if (next) set({ ...next, dialog: null });
    else set({ boards: [...get().boards, tab] });
    writeSessionSoon();
    return tab.id;
  },

  duplicateBoard() {
    const st = get();
    const src = sliceOf(st, st.activeBoard);
    if (!src) return '';
    const copy = copiedBoard(src);
    const next = activatePartial(get(), [...get().boards, copy], copy.id);
    if (next) set({ ...next, dialog: null });
    else set({ boards: [...get().boards, copy] });
    get().toast('已复制一份到新标签：两边互不影响，改哪边都不动另一边', 'success');
    writeSessionSoon();
    return copy.id;
  },

  activateBoard(id) {
    if (id === get().activeBoard) return;
    const next = activatePartial(get(), get().boards, id);
    if (!next) return;
    // 对话框里显示的都是一盘棋的事，换盘就关掉，免得对着 A 盘的面板改 B 盘
    const dialog = get().dialog;
    set({ ...next, dialog: dialog && BOARD_DIALOGS.includes(dialog) ? null : dialog });
    writeSessionSoon();
  },

  closeBoardTab(id, force = false) {
    const st = get();
    if (st.boards.length <= 1) {
      get().toast('留一盘在手上：关掉最后一盘之前，先新建一盘', 'info');
      return;
    }
    const tab = st.boards.find((t) => t.id === id);
    if (!tab) return;
    // 当前那盘的改动写在顶层，切片里那份可能是换出去时留下的旧值
    if (!force && (id === st.activeBoard ? st.dirty : tab.slice.dirty)) {
      set({ pendingClose: { ids: [id], scope: 'one' }, dialog: 'closetab' });
      return;
    }
    /*
     * 关掉的正是当前那盘时，它的改动还在顶层，得先收进切片再关：
     * 收下来既是为了重开（Ctrl+Shift+T），也是为了让下一个标签拿到干净的状态。
     */
    const kept = { ...tab, slice: id === st.activeBoard ? sliceFrom(st) : tab.slice };
    const close = closeBoard(st.boards, id, st.activeBoard);
    const swap = activatePartial(st, close.tabs, close.activeId);
    if (swap) set({ ...swap, dialog: null });
    else set({ boards: close.tabs, activeBoard: close.activeId });
    set({ closedBoards: rememberClosed(get().closedBoards, kept) });
    writeSessionSoon();
  },

  closeOtherBoards(force = false) {
    const st = get();
    if (st.boards.length <= 1) return;
    const others = st.boards.filter((t) => t.id !== st.activeBoard);
    const dirty = others.filter((t) => t.slice.dirty);
    if (!force && (dirty.length > 0 || st.dirty)) {
      set({ pendingClose: { ids: others.map((t) => t.id), scope: 'others' }, dialog: 'closetab' });
      return;
    }
    const stash = sliceFrom(st);
    const kept = st.boards.map((t) => (t.id === st.activeBoard ? { ...t, slice: stash } : t));
    const mine = kept.find((t) => t.id === st.activeBoard);
    if (!mine) return;
    set({
      boards: [mine],
      closedBoards: others.reduce((acc, t) => rememberClosed(acc, t), get().closedBoards),
      dialog: null
    });
    get().toast(`关掉了另外 ${others.length} 盘，当前这盘留着`, 'info');
    writeSessionSoon();
  },

  closeAllBoards(force = false) {
    const st = get();
    const dirty = st.boards.filter((t) => (t.id === st.activeBoard ? st.dirty : t.slice.dirty));
    if (!force && dirty.length > 0) {
      set({ pendingClose: { ids: dirty.map((t) => t.id), scope: 'all' }, dialog: 'closetab' });
      return;
    }
    /*
     * 全都关掉在棋盘上没有意义（总得有一盘），所以先把旧的都收起来，再开一盘干净的。
     * 会话也跟着清掉，下次打开是一块空棋盘。
     */
    const stash = sliceFrom(st);
    const kept = st.boards.map((t) => (t.id === st.activeBoard ? { ...t, slice: stash } : t));
    const tab = freshBoard({
      game: { ...DEFAULT_GAME, visits: st.settings.playVisits, timeMs: st.settings.playTimeMs }
    });
    set({
      boards: [tab],
      activeBoard: tab.id,
      closedBoards: kept.reduce((acc, t) => rememberClosed(acc, t), get().closedBoards),
      dialog: null,
      ...sliceFrom(tab.slice)
    });
    writeSessionSoon();
  },

  async confirmClose(mode) {
    const p = get().pendingClose;
    if (!p) return;
    if (mode === 'save' && p.scope === 'one') {
      const id = p.ids[0];
      const slice = sliceOf(get(), id);
      if (!slice) return;
      const info = infoFromTree(slice.tree);
      const name = `${info.blackName || '黑'}对${info.whiteName || '白'}.sgf`;
      const saved = await window.api.files.saveSgf(slice.filePath ?? name, serializeSgf(slice.tree));
      // 存盘对话框被取消了：别顺手把这一盘关掉，让用户自己再选一次
      if (!saved) return;
      get().patchBoard(id, { filePath: saved, dirty: false });
      get().toast('已保存到 ' + saved, 'success');
    }
    set({ pendingClose: null, dialog: null });
    if (p.scope === 'one') get().closeBoardTab(p.ids[0], true);
    else if (p.scope === 'others') get().closeOtherBoards(true);
    else get().closeAllBoards(true);
  },

  cancelClose() {
    set({ pendingClose: null, dialog: null });
  },

  stepBoardTab(dir) {
    get().activateBoard(stepBoard(get().boards, get().activeBoard, dir));
  },

  nthBoardTab(n) {
    const id = nthBoard(get().boards, n);
    if (id) get().activateBoard(id);
  },

  reopenBoard() {
    const st = get();
    const tab = st.closedBoards[0];
    if (!tab) {
      get().toast('没有刚关掉的棋盘可以开回来', 'info');
      return;
    }
    const next = openBoard(get().boards, tab, st.activeBoard, true);
    const swap = activatePartial(st, next.tabs, tab.id);
    set({
      ...(swap ?? { boards: next.tabs, activeBoard: tab.id }),
      closedBoards: st.closedBoards.slice(1),
      dialog: null
    });
    writeSessionSoon();
  },

  activeIsEmpty() {
    const st = get();
    const slice = sliceOf(st, st.activeBoard);
    if (!slice) return false;
    return !slice.dirty && slice.filePath === null && Object.keys(slice.tree.nodes).length === 1 && slice.current === slice.tree.root;
  },

  toast(text, kind = 'info') {
    const id = Date.now() + Math.random();
    set({ toasts: [...get().toasts, { text, kind, id }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3200);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  commit(tree, current) {
    set(commitPatch(sliceFrom(get()), tree, current));
  },

  undo() {
    const { past, tree, game } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    // 人机对局时一次退两步，回到自己该下的时候
    let target = past.length - 1;
    let chosen = prev;
    if (game.mode === 'vs-ai' && past.length >= 2) {
      const two = past[past.length - 2];
      const aiColor = (3 - game.humanColor) as 1 | 2;
      const mainLen = (t: GameTree): number => {
        let cur = t.root;
        let last: number = t.root;
        while (t.nodes[cur]) {
          last = cur;
          const kids = t.nodes[cur].children;
          if (kids.length === 0) break;
          cur = kids[0];
        }
        return last;
      };
      const prevLast = mainLen(prev);
      const mv = moveAtSized(prev, prevLast);
      if (mv && mv.color === aiColor) {
        target = past.length - 2;
        chosen = two;
      }
    }
    void tree;
    const past2 = past.slice(0, target);
    let endNode: number = chosen.root;
    let cur = chosen.root;
    while (chosen.nodes[cur]) {
      endNode = cur;
      const kids = chosen.nodes[cur].children;
      if (kids.length === 0) break;
      cur = kids[0];
    }
    set({
      tree: chosen,
      current: endNode,
      past: past2,
      future: [get().tree, ...get().future].slice(0, 120),
      dirty: true,
      hint: null
    });
  },

  redo() {
    const { future, tree } = get();
    if (future.length === 0) return;
    const next = future[0];
    let endNode: number = next.root;
    let cur = next.root;
    while (next.nodes[cur]) {
      endNode = cur;
      const kids = next.nodes[cur].children;
      if (kids.length === 0) break;
      cur = kids[0];
    }
    set({
      tree: next,
      current: endNode,
      past: [...get().past, tree],
      future: future.slice(1),
      dirty: true,
      hint: null
    });
  },

  goto(id) {
    if (!get().tree.nodes[id]) return;
    set({ current: id, hint: null });
  },

  gotoStep(delta) {
    const { tree, current } = get();
    if (delta < 0) {
      const parent = tree.nodes[current]?.parent;
      if (parent !== null && parent !== undefined) get().goto(parent);
      return;
    }
    let cur = current;
    for (let i = 0; i < delta; i++) {
      const kids = tree.nodes[cur]?.children ?? [];
      if (kids.length === 0) break;
      cur = kids[0];
    }
    get().goto(cur);
  },

  gotoStart() {
    get().goto(get().tree.root);
  },

  gotoEnd() {
    const tree = get().tree;
    let cur = tree.root;
    while (tree.nodes[cur]?.children.length) cur = tree.nodes[cur].children[0];
    get().goto(cur);
  },

  play(point) {
    // 手动指定过轮次就按指定的颜色落，不再按棋谱交替
    get().playColor(effColor(get()), point);
  },

  playColor(color, point, from = 'local') {
    const { tree, current, finished } = get();
    if (finished) return;
    const pos = positionAt(tree, current);
    if (point !== PASS) {
      const check = pos.check(color, point);
      if (!check.ok) {
        get().toast(check.reason ?? '这一手不能下', 'error');
        return;
      }
    }
    /*
     * 来源都记成"人"：本地点击是人下的，实时截取接回来的那一手也是人在网页上下的。
     * 光看 from 分不出这一点，但棋谱树上"这一手是谁下的"要的是这个区分，不是"从哪来的"。
     */
    const res = addMoveNode(tree, current, color, point, { mainLine: true, source: 'human' });
    get().commit(res.tree, res.id);
    /*
     * 实时分析开着的时候先别清这条结论：新的一手要一两百毫秒才算出来，
     * 中间这段时间让上一个局面的胜率、目差和形势块留在屏幕上，新的数据一到就顶替掉，
     * 比整块闪一下更像回事。分析关着就得清，不然那些数字会一直挂在旧局面上。
     */
    if (!get().analyzing) get().setAnalysis(null);
    // 只有本程序里落的子才往网页上点。实时截取接回来的那一手是从网页上读来的，
    // 再点回去等于自己跟自己下。
    if (from === 'local') void get().forwardMoveToBrowser(point, color, current);
    void get().maybeAiTurn();
  },

  pass() {
    const { tree, current } = get();
    const color = effColor(get());
    const res = addMoveNode(tree, current, color, PASS, { mainLine: true, source: 'human' });
    get().commit(res.tree, res.id);
    // 连续两停，终局
    if (endedByDoublePass(res.tree, res.id)) {
      get().setDialog('score');
    } else {
      void get().maybeAiTurn();
    }
  },

  /**
   * 让引擎按某一盘的行棋方走一手。默认是当前那盘，后台跑着的机机也会传自己那一盘进来，
   * 这样切到别的盘上看着的时候它照样走，落下的子回它自己的棋谱。
   */
  async playAiMove(force = false, board = ''): Promise<string | null> {
    const st = get();
    const id = board || st.activeBoard;
    const slice = sliceOf(st, id);
    if (!slice) return null;
    const { tree, current, game, finished } = slice;
    if (finished || get().thinkingBoard === id) return null;
    const busy = get().thinkingBoard;
    if (busy && busy !== id) {
      get().toast('引擎正为另一盘算棋，等它算完这一手再说', 'info');
      return null;
    }
    const color = effColor(slice);
    const aiColor = (3 - game.humanColor) as 1 | 2;
    if (!force && color !== aiColor && game.mode !== 'ai-vs-ai') return null;
    const nodeAtRequest = current;
    get().setThinking(true, id);
    try {
      const res = await window.api.engine.genMove({
        board: id,
        sgf: sgfFor(tree, current, slice.turnOverride),
        color: color === BLACK ? 'B' : 'W',
        maxVisits: game.visits,
        maxTimeMs: game.timeMs,
        allowResign: game.allowResign,
        temperature: game.temperature
      });
      // 算这一手的工夫里，这一盘可能已经被改过（自己又落了一手）、或者翻到别的局面去了
      const now = sliceOf(get(), id);
      if (!now || now.current !== nodeAtRequest || now.tree !== tree) return null;
      if (res.error) {
        get().toast('引擎出错：' + res.error, 'error');
        return null;
      }
      if (res.resigned) {
        const winner = color === BLACK ? '白' : '黑';
        const t = now.tree;
        const withRe = setProp(t, t.root, 'RE', [`${winner === '黑' ? 'B' : 'W'}+R`]);
        get().patchBoard(id, { ...commitPatch(now, withRe, now.current), finished: `${winner}中盘胜` });
        get().toast(`${color === BLACK ? '黑方' : '白方'}认输，${winner}中盘胜`, 'success');
        // 这盘到此为止，机机档就没必要再亮着了（认输的提示刚说过，不用再说一遍）
        if (now.game.mode === 'ai-vs-ai') get().stopAiVsAi('下完了', id);
        return null;
      }
      const size = propNum(tree, tree.root, 'SZ', 19);
      const point = Position.parseVertex(res.move, size);
      const r2 = addMoveNode(now.tree, now.current, color, point, { mainLine: true, source: 'ai' });
      get().patchBoard(id, commitPatch(now, r2.tree, r2.id));
      if (id === get().activeBoard) void get().forwardMoveToBrowser(point, color, nodeAtRequest);
      // 引擎替人停的那一手也算：两边连续停一手就是对局到头，接着自动走会一直停下去
      if (endedByDoublePass(r2.tree, r2.id)) {
        if (now.game.mode === 'ai-vs-ai') get().stopAiVsAi('下完了', id);
        get().toast('双方连续停一手，这一局下完了，打开形势判断看看结果', 'success');
        if (id === get().activeBoard) get().setDialog('score');
        return res.move;
      }
      if (now.game.mode === 'ai-vs-ai') setTimeout(() => void get().maybeAiTurn(id), 400);
      return res.move;
    } catch (e) {
      get().toast('引擎出错：' + (e instanceof Error ? e.message : String(e)), 'error');
      return null;
    } finally {
      get().setThinking(false, id);
    }
  },

  async aiMoveNow() {
    const { finished } = get();
    if (finished) {
      get().toast('这盘已经结束了', 'info');
      return;
    }
    const color = effColor(get());
    if (get().thinkingBoard === get().activeBoard) return;
    set({ hint: null });
    const move = await get().playAiMove(true);
    if (move !== null) {
      get().toast(`${colorName(color)}方 AI 走了 ${isPassMove(move) ? '停一手' : move}`, 'info');
    }
  },

  toggleAiVsAi() {
    const board = get().activeBoard;
    const slice = sliceOf(get(), board);
    if (!slice) return;
    const { game, finished, tree, current } = slice;
    if (game.mode === 'ai-vs-ai') {
      get().stopAiVsAi('已停');
      return;
    }
    if (finished) {
      get().toast('这一局已经结束了，先新建一盘或者打开一份棋谱', 'info');
      return;
    }
    // 双方都停过一手就是对局到头，开了也不会再走，不如把话说明白
    if (endedByDoublePass(tree, current)) {
      get().toast('这一局已经下完了（双方都停了手），要再下就新建一盘或者接着摆', 'info');
      return;
    }
    get().patchBoard(board, { game: { ...game, mode: 'ai-vs-ai' }, autoReturn: game.mode, hint: null });
    get().toast(
      slice.reviewRunning
        ? '机机对局：轮到谁谁自动走，再点一下"停机机"就停。复盘正在算，两个引擎抢显卡，都会慢一些'
        : '机机对局：轮到谁谁自动走，再点一下"停机机"就停。切到别的棋盘它就转后台接着走',
      'info'
    );
    void get().maybeAiTurn(board);
  },

  stopAiVsAi(reason, board = '') {
    const id = board || get().activeBoard;
    const slice = sliceOf(get(), id);
    if (!slice || slice.game.mode !== 'ai-vs-ai') return;
    const { game, autoReturn } = slice;
    // 正在算的那一手是这一盘自己的才算数：别的盘在算跟这句提示没关系
    const thinking = get().thinkingBoard === id;
    get().patchBoard(id, { game: { ...game, mode: autoReturn } });
    if (reason === '下完了') return; // 终局、认输那两条提示自己会交代，别刷两条
    /*
     * 正算着的这一手没法半路收回（引擎是按局面问一次算一次），会照常落下，
     * 所以把话说清楚，免得看着像"按了停还在走"。
     */
    const tail = thinking ? '，正在算的这一手还会落下，之后不再自动走' : '';
    get().toast(
      autoReturn === 'vs-ai' ? `机机对局${reason}${tail}，接着还是 AI 走你对手那一方` : `机机对局${reason}${tail}，接下来自己下`,
      'info'
    );
  },

  /**
   * 轮到 AI 的时候让它走一手。默认管当前那盘，后台跑着机机的那盘会带自己的编号进来，
   * 这样它切走之后接着走，落的子还在自己的谱上。
   */
  async maybeAiTurn(board = '') {
    const st = get();
    const id = board || st.activeBoard;
    const slice = sliceOf(st, id);
    if (!slice) return;
    const { game, tree, current, finished } = slice;
    if (finished) return;
    if (game.mode === 'manual') return;
    // 两边都停过一手就是对局到头了，别再往下走
    if (endedByDoublePass(tree, current)) return;
    /*
     * 对局引擎一次只算一盘。别的盘正算着就等一等，别把两边的请求挤在一起；
     * 等的时候模式可能已经被关掉，每次醒来都重新读一遍。
     */
    const busy = get().thinkingBoard;
    if (busy !== null && busy !== id) {
      setTimeout(() => void get().maybeAiTurn(id), 400);
      return;
    }
    /*
     * 引擎正忙（刚按过提示、上一手还没算完）时按下"机机对下"，这一按不能白按：
     * 等它收尾再接上。
     */
    if (busy === id) {
      setTimeout(() => void get().maybeAiTurn(id), 300);
      return;
    }
    if (game.mode === 'ai-vs-ai') {
      void get().playAiMove(false, id);
      return;
    }
    const color = effColor(slice);
    const aiColor = (3 - game.humanColor) as 1 | 2;
    if (color === aiColor) void get().playAiMove(false, id);
  },

  /**
   * 提示只是给建议，绝不落子：落子要么用户自己点棋盘，要么点"AI 走一手"。
   * 计算期间占住 thinking，连点不会排出一串引擎请求，也不会刷出一串重复提示。
   */
  async doHint() {
    const board = get().activeBoard;
    const slice = sliceOf(get(), board);
    if (!slice) return;
    const { tree, current } = slice;
    if (get().thinkingBoard === board) return;
    if (get().thinkingBoard) {
      get().toast('引擎正为另一盘算棋，等它算完这一手再说', 'info');
      return;
    }
    const color = effColor(slice);
    get().setThinking(true, board);
    try {
      const { settings } = get();
      const res = await window.api.engine.hint(
        sgfFor(tree, current, slice.turnOverride),
        settings.analyzeVisits,
        color === BLACK ? 'B' : 'W',
        // 提示也要带时限：大网络上一手提示跑几十秒会让人以为卡住。用每步限时那一档。
        settings.playTimeMs,
        board
      );

      const now = sliceOf(get(), board);
      if (!now || now.current !== current || now.tree !== tree) return; // 用户已经翻到别的局面、或者又落了一手
      if (res.error) {
        get().toast('引擎出错：' + res.error, 'error');
        return;
      }
      const advice: Advice = { color, move: res.move, winrate: res.winrate, scoreLead: res.scoreLead };
      get().patchBoard(board, { hint: advice });
      get().toast(adviceLine(advice));
    } catch (e) {
      get().toast('引擎出错：' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      get().setThinking(false, board);
      /*
       * 引擎算这一手之前会把实时分析停掉，给搜索腾机器（这一步是 genMove 里做的）。
       * 提示不落子，没人触发界面里那条"局面变了就重连分析"，所以要在这里把它接回去：
       * 不接的话面板还写着"分析中"，候选点却停在上一手那几个上，看的人会以为分析坏了。
       */
      if (get().activeBoard === board && sliceOf(get(), board)?.analyzing) void get().startAnalysis(true);
    }
  },

  setHint(advice) {
    set({ hint: advice });
  },

  pickCandidate(move, winrate, scoreLead) {
    const { current, analysis } = get();
    /*
     * 面板上那几行可能还是上一个局面的（刚落下新的一手、新的还没算出来）。
     * 那上面推荐的点在这个局面上未必成立，索性不接这一下，免得画个错的推荐圈。
     */
    if (analysis && analysis.nodeId >= 0 && analysis.nodeId !== current) return;
    set({ hint: { color: effColor(get()), move, winrate, scoreLead } });
  },

  /** 导入的图、自己摆的局面，程序不知道轮到谁，这里手改。有手数时改不了，会说明原因。 */
  setTurn(color) {
    const { tree, current } = get();
    const ready = canSetTurn(tree, current);
    if (!ready.ok) {
      get().toast(ready.reason ?? '现在改不了轮次', 'info');
      return;
    }
    if (colorToPlayAt(tree, current) === color) return;
    get().commit(setTurnAt(tree, current, color), current);
    set({ hint: null });
    get().toast(`已改为${colorName(color)}方先行`, 'success');
  },

  /**
   * 状态栏那颗"轮到谁"。两种情形两条路：
   * 还没有手数的局面（导入的图、自己摆的开局）轮次本来就没定，直接写进棋谱里的 PL，
   * 存盘和送引擎都认它；已经有手数的局面改不到棋谱里（那个节点自己的着手会盖过 PL），
   * 就退成这一盘界面上的手动指定，只在这盘有效。
   */
  toggleTurn() {
    const { tree, current } = get();
    const record = colorToPlayAt(tree, current);
    const other = (3 - record) as 1 | 2;
    if (get().turnOverride === null) {
      if (canSetTurn(tree, current).ok) {
        get().setTurn(other);
        return;
      }
      get().patchBoard(get().activeBoard, { turnOverride: other, hint: null });
      get().toast(`这一盘改由${colorName(other)}方走。只在这盘有效，不写进棋谱`, 'success');
      return;
    }
    get().patchBoard(get().activeBoard, { turnOverride: null, hint: null });
    get().toast(`轮次回到按棋谱走：${colorName(record)}方`, 'info');
  },

  resign() {
    const { tree, current, game } = get();
    const color = effColor(get());
    void game;
    const winner = color === BLACK ? 'W' : 'B';
    const winnerName = winner === 'B' ? '黑' : '白';
    get().commit(setProp(tree, tree.root, 'RE', [`${winner}+R`]), current);
    get().setFinished(`${winnerName}中盘胜（对方认输）`);
    get().toast(`${color === BLACK ? '黑方' : '白方'}认输，${winnerName}中盘胜`, 'success');
  },

  newGame(opts) {
    const size = opts.size ?? 19;
    const komi = opts.komi ?? (size === 19 ? 7.5 : size === 13 ? 7.5 : 7.5);
    const handicap = opts.handicap ?? 0;
    const tree = createTree(size, komi, handicap, opts.rules ?? 'Chinese');
    const humanColor = opts.humanColor ?? (handicap > 1 ? WHITE : BLACK);
    /*
     * 新的一局开在哪个标签上：眼前还是一张没动过的空盘，就地开（不然连点两次新建
     * 会攒出一排空标签）；已经摆着棋了，就另开一个标签，原来那盘留着。
     */
    const board = get().activeIsEmpty() ? get().activeBoard : get().openBoardTab();
    get().patchBoard(board, {
      tree,
      current: tree.root,
      past: [],
      future: [],
      filePath: null,
      dirty: false,
      analysis: null,
      analyzing: false,
      finished: null,
      deadStones: [],
      hint: null,
      // 换了一盘棋，上一盘手动指定的轮次不能跟过来
      turnOverride: null,
      game: { ...get().game, ...opts, humanColor },
      autoReturn: 'manual'
    });
    get().clearReview();
    void get().maybeAiTurn(board);
  },

  loadSgf(content, path) {
    try {
      const trees = parseSgf(content);
      const tree = trees[0];
      let cur = tree.root;
      while (tree.nodes[cur]?.children.length) cur = tree.nodes[cur].children[0];
      // 手里这盘没动过就装进它，动过就新开一个标签：打开棋谱不该把那盘棋冲掉
      const board = get().activeIsEmpty() ? get().activeBoard : get().openBoardTab();
      get().patchBoard(board, {
        tree,
        current: cur,
        past: [],
        future: [],
        filePath: path ?? null,
        dirty: false,
        analysis: null,
        analyzing: false,
        finished: null,
        deadStones: [],
        turnOverride: null,
        game: { ...get().game, mode: 'manual' },
        autoReturn: 'manual'
      });
      // 换了一盘棋，上一盘的复盘结果留着只会张冠李戴
      get().clearReview();
      const info = infoFromTree(tree);
      get().toast(`已载入棋谱：${info.blackName || '黑'} 对 ${info.whiteName || '白'}`, 'success');
    } catch (e) {
      get().toast('棋谱解析失败：' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  },

  importPosition(stones, size, asNew) {
    const sgfChar = (n: number): string => String.fromCharCode(97 + n);
    const ab: string[] = [];
    const aw: string[] = [];
    for (let i = 0; i < stones.length; i++) {
      const x = i % size;
      const y = Math.floor(i / size);
      if (stones[i] === BLACK) ab.push(sgfChar(x) + sgfChar(y));
      else if (stones[i] === WHITE) aw.push(sgfChar(x) + sgfChar(y));
    }
    if (asNew) {
      const base = createTree(size, 7.5, 0, 'Chinese');
      let t = setProp(base, base.root, 'AB', ab.length ? ab : null);
      t = setProp(t, t.root, 'AW', aw.length ? aw : null);
      // 认出来的是新的一盘，装进空盘或者新开一个标签，别冲掉手里这盘
      const board = get().activeIsEmpty() ? get().activeBoard : get().openBoardTab();
      get().patchBoard(board, {
        tree: t,
        current: t.root,
        past: [],
        future: [],
        filePath: null,
        dirty: true,
        analysis: null,
        analyzing: false,
        finished: null,
        deadStones: [],
        turnOverride: null,
        game: { ...get().game, mode: 'manual' },
        autoReturn: 'manual'
      });
      get().toast(`已导入局面：黑 ${ab.length} 白 ${aw.length}`, 'success');
      // 摆出来的新局面上没有可复盘的手顺，旧结果一并清掉
      get().clearReview();
      return;
    }
    const { tree, current } = get();
    if (current === tree.root && Object.keys(tree.nodes).length === 1) {
      // 空谱上导入，这盘棋本身就是这张图，直接写进根节点。
      // 另起一个只有摆子的子节点看着一样（手数还是 0），但多出一个节点，
      // 而且 KataGo 的 loadsgf 只认根节点上的摆子，写进子节点它整谱拒收。
      let t = setProp(tree, tree.root, 'AB', ab.length ? ab : null);
      t = setProp(t, tree.root, 'AW', aw.length ? aw : null);
      get().commit(t, tree.root);
      get().toast(`已导入局面：黑 ${ab.length} 白 ${aw.length}`, 'success');
      return;
    }
    const props: Record<string, string[]> = {};
    if (ab.length) props.AB = ab;
    if (aw.length) props.AW = aw;
    const withSetup = addChild(tree, current, props);
    const final = makeMainLine(withSetup.tree, withSetup.id);
    set({
      tree: final,
      current: withSetup.id,
      past: [...get().past, tree],
      future: [],
      dirty: true,
      analysis: null
    });
    get().toast(`已把局面接到当前谱后面：黑 ${ab.length} 白 ${aw.length}`, 'success');
  },

  setTool(t) {
    /*
     * 每次拿起"自由落子"，颜色先跟着当前轮到的那一方：这样它一上来跟"落子"一模一样，
     * 想改再改颜色。否则手里拿着黑子、盘上轮到白，点下去落一颗黑子太容易没注意。
     */
    set(t === 'free' ? { tool: t, freeColor: effColor(get()) } : { tool: t });
  },

  setFreeColor(color) {
    set({ freeColor: color });
  },

  setShowOwnership(v) {
    set({ showOwnership: v });
  },

  setHover(p) {
    set({ hover: p });
  },

  /** 手工摆子：改当前节点的 AB / AW / AE。 */
  setSetupStone(point, color) {
    const { tree, current } = get();
    const size = propNum(tree, tree.root, 'SZ', 19);
    const x = point % size;
    const y = Math.floor(point / size);
    const value = String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
    const node = tree.nodes[current];
    const strip = (list: string[] | undefined): string[] => (list ?? []).filter((v) => v !== value);
    const ab = strip(node.props.AB);
    const aw = strip(node.props.AW);
    let ae = strip(node.props.AE);
    if (color === BLACK) ab.push(value);
    else if (color === WHITE) aw.push(value);
    else {
      const parent = node.parent;
      const hadStone = parent !== null ? positionAt(tree, parent).cells[point] !== 0 : false;
      if (hadStone) ae = [...ae, value];
    }
    let out = tree;
    out = setProp(out, current, 'AB', ab.length ? ab : null);
    out = setProp(out, current, 'AW', aw.length ? aw : null);
    out = setProp(out, current, 'AE', ae.length ? ae : null);
    get().commit(out, current);
  },

  toggleMark(type, point) {
    const { tree, current } = get();
    const size = propNum(tree, tree.root, 'SZ', 19);
    const key =
      type === 'triangle'
        ? 'TR'
        : type === 'square'
          ? 'SQ'
          : type === 'circle'
            ? 'CR'
            : type === 'cross'
              ? 'MA'
              : type === 'dim'
                ? 'SL'
                : 'LB';
    const x = point % size;
    const y = Math.floor(point / size);
    const value = String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
    const node = tree.nodes[current];
    const cur = node.props[key] ?? [];
    /*
     * 字母标记的值里带着文字（"dd:A"），所以它得按坐标判断有没有：
     * 直接拿整串比会把同一个点上的 "dd:A" 和 "dd" 当成两回事。
     * 没冒号的那种（老版本存下来的）也认，读出来文字是空的。
     */
    const next =
      key === 'LB'
        ? cur.some((v) => parseLabel(v).point === value)
          ? cur.filter((v) => parseLabel(v).point !== value)
          : [...cur, labelValue(value, nextLabel(cur))]
        : cur.includes(value)
          ? cur.filter((v) => v !== value)
          : [...cur, value];
    get().commit(setProp(tree, current, key, next.length ? next : null), current);
  },

  setComment(text) {
    const { tree, current } = get();
    get().commit(setProp(tree, current, 'C', text ? [text] : null), current);
  },

  updateGameInfo(patch) {
    const { tree } = get();
    let out = tree;
    const set = (key: string, value: string | number | undefined): void => {
      if (value === undefined) return;
      out = setProp(out, out.root, key, value === '' ? null : [String(value)]);
    };
    if (patch.size !== undefined) set('SZ', patch.size);
    if (patch.komi !== undefined) set('KM', patch.komi);
    if (patch.handicap !== undefined) set('HA', patch.handicap > 1 ? patch.handicap : '');
    if (patch.rules !== undefined) set('RU', patch.rules);
    if (patch.blackName !== undefined) set('PB', patch.blackName);
    if (patch.whiteName !== undefined) set('PW', patch.whiteName);
    if (patch.blackRank !== undefined) set('BR', patch.blackRank);
    if (patch.whiteRank !== undefined) set('WR', patch.whiteRank);
    if (patch.result !== undefined) set('RE', patch.result);
    if (patch.date !== undefined) set('DT', patch.date);
    if (patch.event !== undefined) set('EV', patch.event);
    if (patch.place !== undefined) set('PC', patch.place);
    if (patch.gameName !== undefined) set('GN', patch.gameName);
    get().commit(out, get().current);
  },

  deleteCurrentNode() {
    const { tree, current } = get();
    if (current === tree.root) {
      get().toast('根节点不能删除', 'error');
      return;
    }
    const parent = tree.nodes[current]?.parent ?? tree.root;
    get().commit(deleteSubtree(tree, current), parent);
  },

  promoteCurrent() {
    const { tree, current } = get();
    get().commit(makeMainLine(tree, current), current);
    get().toast('已把这条分支设为主线');
  },

  swapColors() {
    const { tree } = get();
    const swap = (tree: GameTree): GameTree => {
      const nodes: typeof tree.nodes = {};
      for (const k of Object.keys(tree.nodes)) {
        const n = tree.nodes[Number(k)];
        const props = { ...n.props };
        if (props.B) {
          props.W = props.B;
          delete props.B;
        } else if (props.W) {
          props.B = props.W;
          delete props.W;
        }
        const ab = props.AB;
        const aw = props.AW;
        if (ab || aw) {
          if (ab) props.AW = ab;
          else delete props.AW;
          if (aw) props.AB = aw;
          else delete props.AB;
        }
        nodes[n.id] = {
          ...n,
          props,
          children: n.children.slice(),
          parent: n.parent
        };
      }
      return { ...tree, nodes };
    };
    get().commit(swap(tree), get().current);
    get().toast('已交换黑白');
  },

  clearBoard() {
    const { tree, current } = get();
    let out = setProp(tree, current, 'AB', null);
    out = setProp(out, current, 'AW', null);
    get().commit(out, current);
  },

  async startAnalysis(force = false) {
    const { tree, current, settings, analyzing } = get();
    // 已经在跑、或者上一次刚发出去还没回来（冷启动那十几秒里连点两下），就别再发一次
    if ((analyzing || get().analyzeStarting) && !force) return;
    // 分析只给当前这一盘开，所以手动指定的轮次（也是当前这盘的）直接用
    const color = effColor(get());
    /*
     * 记下这是给哪一盘要的分析：算出来的时候用户可能已经切到别的盘上去了，
     * 结论要落回它自己那一盘，不能画到当前这盘上。
     */
    const board = get().activeBoard;
    /*
     * 代号：每次发起、每次停下都加一。引擎那头回话晚一步的时候，只有代号还对的
     * 那一次才算数。否则会是"用户已经点暂停了，回话一到又把 analyzing 点亮"，
     * 徽章写着分析中、流却是断的。
     */
    const run = ++analyzeRun;
    // 第一次分析要先把分析引擎拉起来：核显上开 OpenCL 上下文加大网络要十几秒，
    // 这段时间界面上什么都不显示的话，用户只会觉得点下去卡死了。
    set({ analyzeStarting: true });
    try {
      if (!get().engineStatus.running) {
        const st = await window.api.engine.start();
        get().setEngineStatus(st);
        if (!st.ready) {
          get().toast(st.error ?? '引擎没有启动', 'error');
          return;
        }
      }
      const res = await window.api.engine.analyzeStart({
        board,
        sgf: sgfFor(tree, current, get().turnOverride),
        visits: settings.analyzeVisits,
        maxTimeMs: 0,
        ownership: true,
        lines: 8,
        nodeId: current,
        turn: color === BLACK ? 'B' : 'W'
      });
      if (!res.ok) {
        get().toast('分析启动失败：' + (res.error ?? ''), 'error');
        return;
      }
      if (run !== analyzeRun) return;
      /*
       * 这里不清 analysis：上一条结论是上一个局面的，留着它顶到新数据来为止。
       * 下了一手或者翻了一手之后整块先空掉再填满，看着像卡了一下；引擎第一条
       * 结论来得很快（几十毫秒就有胜率，慢慢才准），续着显示更跟手。
       */
      get().patchBoard(board, { analyzing: true });
    } finally {
      if (run === analyzeRun) set({ analyzeStarting: false });
    }
  },

  async stopAnalysis() {
    /*
     * 顺序是"先把状态落下来，再去等引擎"：
     * 一、analyzing 立刻置回 false，App 里那个"局面一变就重开分析"的防抖就不会
     *     再把分析拉起来。反过来的顺序有个真实的坏结局：刚落一手的两百毫秒内点暂停，
     *     防抖把分析重新拉起来，紧接着 analyzeStop 的回话才到，结果是流断了、
     *     面板空了，徽章还写着"分析中"。
     * 二、点暂停就该立刻清空，不用等引擎回话。
     * 代号加一是让还在路上的 analyzeStart 回话作废，它回来时不要再把 analyzing 点亮。
     */
    const board = get().activeBoard;
    analyzeRun++;
    get().patchBoard(board, { analyzing: false, analysis: null });
    set({ analyzeStarting: false });
    await window.api.engine.analyzeStop(board);
  },

  async toggleAnalysis() {
    if (get().analyzing) await get().stopAnalysis();
    else await get().startAnalysis();
  },

  setAnalysis(s) {
    set({ analysis: s });
  },

  /**
   * 引擎送来一份快照，落到它归属的那一盘上。
   *
   * 这里也管着"这一份还算不算数"：分析快照带着它算的是哪个节点，跟那盘现在停的地方
   * 对不上就丢掉（用户已经翻走了）；分析关掉了的盘，也不该再冒出结论来。
   * nodeId 为 -1 的是对局引擎正在想棋的实时战报，那是最新的，直接收。
   */
  applySnapshot(board, s) {
    const st = get();
    const id = board || st.activeBoard;
    const slice = sliceOf(st, id);
    if (!slice) return;
    if (s.nodeId >= 0) {
      if (!slice.analyzing) return;
      if (s.nodeId !== slice.current) return;
    }
    get().patchBoard(id, { analysis: s });
  },

  /** 这一盘的分析被别的盘顶掉了（分析引擎一次只服务一盘）。 */
  analysisReplaced(board) {
    const st = get();
    const id = board || st.activeBoard;
    const slice = sliceOf(st, id);
    if (!slice || !slice.analyzing) return;
    get().patchBoard(id, { analyzing: false, analysis: null });
    const tab = st.boards.find((t) => t.id === id);
    const who = tab ? boardTitle(tab) : '另一盘';
    get().toast(`“${who}”这一盘的实时分析停下了：分析引擎被别的棋盘占住了`, 'info');
  },

  async startReview() {
    const st = get();
    const board = st.activeBoard;
    const { tree, reviewPoints, reviewSign, reviewRunning } = sliceOf(st, board) ?? sliceFrom(st);
    if (reviewRunning) return;
    /*
     * 复盘的对象是主线那一局棋，不是"当前翻到哪儿"。
     * 从根节点沿着每层的第一个子节点走到底，就是这盘棋本身；
     * 用户在分支里试的着法不参与复盘，免得把没下过的变化算进去。
     */
    const path = pathTo(tree, mainLineEnd(tree));
    if (path.length < 2) {
      get().toast('这局还没有着手可复盘', 'info');
      return;
    }
    const positions: Array<{ nodeId: number; sgf: string; turn: 'B' | 'W'; ply: number }> = [];
    for (let i = 0; i < path.length; i++) {
      const id = path[i];
      /*
       * 复盘看的是这盘棋本身，一手一手按棋谱数轮次：手动指定的轮次不能进来，
       * 否则从根上换一次颜色，整局的评点会全部颠倒。
       */
      const turn = colorToPlayAt(tree, id) === BLACK ? 'B' : 'W';
      const { sgf } = engineSgfFor(tree, id, turn);
      positions.push({ nodeId: id, sgf, turn, ply: i });
    }
    /*
     * 接着上次算：只有节点 id、手数、局面三者都对得上的那一段才算数，
     * 复盘是照顺序算的，中间缺一个就没法比"这一手亏了多少"，
     * 所以从第一个没算过的局面开始，前面那一整段必须已经算完。
     * 局面那一项是关键：退到开局重下一盘时，节点号又会从 2 开始排。
     */
    let cover = 0;
    while (cover + 1 < positions.length) {
      const p = positions[cover];
      const saved = reviewPoints[p.nodeId];
      if (!saved || saved.ply !== p.ply) break;
      if (reviewSign[p.nodeId] !== positionSign(tree, p.nodeId)) break;
      cover += 1;
    }
    const todo = positions.slice(cover);
    if (todo.length < 2) {
      get().toast('这一局已经复盘完了', 'info');
      return;
    }
    get().patchBoard(board, { reviewRunning: true, reviewDone: 0, reviewTotal: todo.length, reviewStopped: null, reviewError: null });
    get().toast(`开始复盘：从第 ${cover} 手之后算起，共 ${todo.length} 个局面`, 'info');
    const res = await window.api.engine.reviewStart({
      board,
      positions: todo,
      visits: st.settings.reviewVisits,
      maxTimeMs: 0,
      lines: 8
    });
    if (!res.ok) {
      get().patchBoard(board, { reviewRunning: false, reviewError: res.error ?? '复盘没能开始' });
      get().toast('复盘没能开始：' + (res.error ?? ''), 'error');
    }
  },

  async stopReview() {
    const board = get().activeBoard;
    await window.api.engine.reviewStop(board);
    // 结果不清：已经算出来的那一半照样有用
    get().patchBoard(board, { reviewRunning: false });
  },

  addReviewPoint(p, board = '') {
    const st = get();
    const id = board || st.activeBoard;
    const slice = sliceOf(st, id);
    if (!slice) return;
    const points = { ...slice.reviewPoints, [p.nodeId]: p };
    const signs = { ...slice.reviewSign, [p.nodeId]: positionSign(slice.tree, p.nodeId) };
    const derived = deriveReview(slice.tree, points, signs);
    get().patchBoard(id, { reviewPoints: points, reviewSign: signs, reviewMoves: derived.moves, reviewSummary: derived.summary });
  },

  endReview(reason, error, board = '') {
    const st = get();
    const id = board || st.activeBoard;
    const slice = sliceOf(st, id);
    if (!slice) return;
    get().patchBoard(id, { reviewRunning: false, reviewStopped: reason, reviewError: error ?? null });
    // 后台那一盘的复盘也会报告结果，说清楚是哪一盘，别让人以为说的是眼前这盘
    const tab = st.boards.find((t) => t.id === id);
    const mine = id === st.activeBoard;
    const who = mine || !tab ? '' : `“${boardTitle(tab)}”这一盘：`;
    const { reviewMoves } = sliceOf(get(), id) ?? slice;
    if (reason === 'cancelled' || reason === 'replaced') {
      get().toast(
        who + (reason === 'replaced' ? '复盘被实时分析顶掉了，已经算完的部分留着' : `复盘停下了，已经算完 ${reviewMoves.length} 手`),
        'info'
      );
      return;
    }
    if (reason === 'error') {
      get().toast(who + '复盘出错：' + (error ?? ''), 'error');
      return;
    }
    const s = (sliceOf(get(), id) ?? slice).reviewSummary;
    get().toast(
      who +
        (s.worst && s.worst.loss > 0
          ? `复盘完了：${reviewMoves.length} 手，恶手 ${s.blunder} 处、失误 ${s.mistake} 处，最大的一手是第 ${s.worst.ply} 手`
          : `复盘完了：${reviewMoves.length} 手`),
      'success'
    );
    // 复盘完顺手停在第一处问题手上，省得自己去找（跳转只对眼前这盘有意义）
    const first = mine ? problemMoves(reviewMoves)[0] : null;
    if (first) get().goto(first.nodeId);
  },

  clearReview() {
    set({
      reviewPoints: {},
      reviewSign: {},
      reviewMoves: [],
      reviewSummary: { moves: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, worst: null, totalLoss: 0 },
      reviewRunning: false,
      reviewDone: 0,
      reviewTotal: 0,
      reviewStopped: null,
      reviewError: null
    });
  },

  gotoProblem(dir) {
    const { tree, current, reviewMoves } = get();
    if (reviewMoves.length === 0) {
      get().toast('先跑一遍复盘', 'info');
      return;
    }
    /*
     * 当前这一手在复盘里的手数就是它在路径上的位置。用户可能正停在分支上，
     * 那就按"从根走到当前节点数了几手"来找，找不到就从头开始找。
     */
    const ply = pathTo(tree, current).filter((id) => moveAtSized(tree, id)).length;
    const hit = nextProblem(reviewMoves, ply, dir);
    if (!hit) {
      get().toast(dir > 0 ? '后面没有别的问题手了' : '前面没有别的问题手了', 'info');
      return;
    }
    get().goto(hit.nodeId);
  },

  /**
   * 引擎在想哪一盘的棋。传 board 就是替某一盘占位；放下来的时候只有还占着的那一盘
   * 才清得掉（同一盘连着两次调用不会互相踩）。
   */
  setThinking(v, board = '') {
    const id = board || get().activeBoard;
    if (v) set({ thinkingBoard: id });
    else if (get().thinkingBoard === id) set({ thinkingBoard: null });
  },

  setEngineStatus(s) {
    set({ engineStatus: s });
  },

  pushLog(t) {
    const logs = [...get().engineLogs, t];
    set({ engineLogs: logs.slice(-400) });
  },

  setDialog(d) {
    set({ dialog: d });
  },

  openImage(img) {
    set({ image: img, dialog: img ? 'image' : null });
  },

  setBrowserOpen(v) {
    set({ browserOpen: v });
    // 第一次打开时先把标签建起来，否则浏览器栏是空的，用户还得再点一次新建
    if (v && get().tabs.length === 0) set(openTab(get().tabs, makeTab('about:blank'), get().activeTabId));
    persistLayout(get());
  },

  setSplit(v, axis) {
    // 两个方向的范围不一样，写的是哪个方向的数就按哪个方向收
    const spec = axisSpec(axis);
    if (axis === 'y') set({ splitRatioY: clampRange(v, spec.min, spec.max) });
    else set({ splitRatio: clampRange(v, spec.min, spec.max) });
    persistLayout(get());
  },

  setSplitAxis(v) {
    if (v === get().splitAxis) return;
    set({ splitAxis: v });
    persistLayout(get());
  },

  setLeftWidth(v) {
    set({ leftWidth: clampRange(Math.round(v), LEFT_MIN, LEFT_MAX) });
    persistLayout(get());
  },

  setRightWidth(v) {
    set({ rightWidth: clampRange(Math.round(v), RIGHT_MIN, RIGHT_MAX) });
    persistLayout(get());
  },

  openBrowserTab(url, activate = true) {
    const tab = makeTab(url);
    const next = openTab(get().tabs, tab, get().activeTabId, activate);
    set({ tabs: next.tabs, activeTabId: next.activeId, browserOpen: true });
    persistLayout(get());
    return tab.id;
  },

  closeBrowserTab(id) {
    const next = closeTab(get().tabs, id, get().activeTabId);
    set({ tabs: next.tabs, activeTabId: next.activeId });
    persistLayout(get());
  },

  activateTab(id) {
    if (!get().tabs.some((t) => t.id === id)) return;
    set({ activeTabId: id });
  },

  stepBrowserTab(dir) {
    set({ activeTabId: stepTab(get().tabs, get().activeTabId, dir) });
  },

  updateTab(id, patch) {
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  },

  setZoom(v) {
    set({ zoom: Math.max(0.6, Math.min(1.8, Number(v.toFixed(2)))) });
  },

  setDeadStones(v) {
    set({ deadStones: v });
  },

  setFinished(v) {
    set({ finished: v });
  },

  async setLiveCapture(v) {
    if (v && !get().browserOpen) {
      // 没浏览器就没得截。用户点这个开关意思就是要用它，顺手把分屏打开。
      get().setBrowserOpen(true);
    }
    await get().setSettings({ liveCapture: v });
    set({ sync: null });
    if (!v) {
      get().toast('实时截取已关', 'info');
      return;
    }
    get().toast('实时截取已开：网页上多出来的那一手会接到谱上', 'success');
    void get().pollBrowser();
  },

  async setAutoPlay(v) {
    await get().setSettings({ autoPlay: v });
    if (v && !get().browserOpen) get().setBrowserOpen(true);
    if (!v) {
      get().toast('自动落子已关', 'info');
      return;
    }
    get().toast('自动落子已开：本程序里落的子会点到网页棋盘上', 'success');
    // 开的时候先试一次，认不出棋盘现在就告诉用户，别等到下了子才发现点不了
    const shot = await shotPage();
    if (typeof shot === 'string') {
      setSync('自动落子：' + shot, false);
      get().toast('自动落子开着，但网页棋盘还没认出来：' + shot, 'error');
    } else {
      setSync(`自动落子就绪（网页上是 ${shot.size} 路）`, true);
    }
  },

  async pollBrowser() {
    const st = get();
    if (!st.settings.liveCapture || !st.browserOpen || st.finished) return;
    // 引擎正在想棋、或者刚点出去一手还没落定，这两段时间里两边本来就对不齐
    if (st.thinkingBoard !== null || forwarding) return;
    if (polling) return;
    if (Date.now() - lastForwardAt < 2200) return;
    // 截图是异步的：开始这一拍时记下是哪一盘，回来发现换了盘就作废，
    // 不然网页上那一手会接到另一盘的棋谱上
    const board = st.activeBoard;
    polling = true;
    try {
      const shot = await shotPage();
      if (typeof shot === 'string') {
        setSync(shot, false);
        return;
      }
      const now = get();
      if (now.activeBoard !== board) return;
      const size = propNum(now.tree, now.tree.root, 'SZ', 19);
      if (shot.size !== size) {
        setSync(`网页上是 ${shot.size} 路，这盘是 ${size} 路，对不上`, false);
        return;
      }
      const cur = now.current;
      const plan = planMirror(size, positionAt(now.tree, cur).cells, now.turnOverride ?? colorToPlayAt(now.tree, cur), shot.stones);
      if (plan.kind === 'same') {
        setSync('和网页一致', true);
        return;
      }
      if (plan.kind === 'mismatch') {
        setSync(`跟网页对不上：网页上多 ${plan.missing} 颗，本地多 ${plan.extra} 颗，先不动`, false);
        return;
      }
      // 只接"刚好一手"，而且这个节点还没分叉才接：不然会凭空多出一条分支，
      // 用户自己的棋谱树被搅乱了比少接一手麻烦得多。
      if ((now.tree.nodes[cur]?.children.length ?? 0) > 0) {
        setSync('网页上多了一手，但这里已经不止一种下法，没敢接', false);
        return;
      }
      get().playColor(plan.color, plan.point, 'remote');
      setSync(`接上网页的一手：${Position.gtpVertex(plan.point, size)}`, true);
    } finally {
      polling = false;
    }
  },

  async forwardMoveToBrowser(point, color, parentId) {
    const st = get();
    if (!st.settings.autoPlay) return false;
    if (!st.browserOpen) {
      setSync('自动落子：内置浏览器关着', false);
      return false;
    }
    if (isPassPoint(point)) {
      setSync('自动落子：这一手是停一手，得在网页上自己点', false);
      return false;
    }
    // 这一拍正在截就先等它截完，别把这次点击丢了
    for (let i = 0; i < 20 && (polling || forwarding); i++) await sleep(50);
    if (polling || forwarding) return false;
    // 等这一拍的工夫里可能已经换到别的棋盘上了：那一刻的谱面和现在这盘不是一回事
    if (get().activeBoard !== st.activeBoard) return false;
    /*
     * 要点的这一手是接在 parentId 后面的。那个节点的局面在这段等待里要是变过
     * （用户摆子、撤了重下），点出去就跟网页上的棋盘对不上了，宁可不点。
     */
    const now = get();
    if (!now.tree.nodes[parentId] || positionKey(now.tree, parentId) !== positionKey(st.tree, parentId)) {
      setSync('自动落子：这一手还没点出去，谱面已经变了，跳过', false);
      return false;
    }
    forwarding = true;
    try {
      const size = propNum(st.tree, st.tree.root, 'SZ', 19);
      const before = await shotPage();
      if (typeof before === 'string') {
        setSync('自动落子：' + before, false);
        return false;
      }
      if (before.size !== size) {
        setSync(`自动落子：网页上是 ${before.size} 路，这盘是 ${size} 路`, false);
        return false;
      }
      // 点之前先确认网页还停在"这一手之前"：两边对不上说明用户在网页上看的是
      // 另一盘棋，这一下点下去就是往别人的棋盘上落子。
      const plan = planMirror(
        size,
        positionAt(st.tree, parentId).cells,
        st.turnOverride ?? colorToPlayAt(st.tree, parentId),
        before.stones
      );
      if (plan.kind !== 'same') {
        setSync(
          plan.kind === 'move'
            ? `自动落子：网页上已经有 ${Position.gtpVertex(plan.point, size)} 这一手了`
            : `自动落子：网页棋盘跟这盘对不上（网页上多 ${plan.missing} 颗，本地多 ${plan.extra} 颗），没点`,
          false
        );
        return false;
      }
      const at = pointToPage(
        before.grid,
        point,
        { width: before.viewWidth, height: before.viewHeight },
        { width: before.imageWidth, height: before.imageHeight }
      );
      if (!at) {
        setSync('自动落子：算不出这个交叉点在网页上的位置', false);
        return false;
      }
      await withTimeout(window.api.browser.click(before.id, at.x, at.y), 3000, '点网页没回应');
      lastForwardAt = Date.now();
      // 点完再截一次核对。两次都对不上就把开关关掉：网页那头可能轮到对手走，
      // 也可能页面换了、坐标算错了，继续点只会越点越歪。
      for (let i = 0; i < 2; i++) {
        await sleep(i === 0 ? 320 : 520);
        const after = await shotPage();
        if (typeof after === 'string') continue;
        if (after.size === size && expectStone(size, after.stones, point, color)) {
          setSync(`已点到网页上：${Position.gtpVertex(point, size)}`, true);
          return true;
        }
      }
      await get().setSettings({ autoPlay: false });
      setSync('点了网页棋盘但没落上，自动落子已经关掉', false);
      get().toast('这一手没点到网页上，自动落子已关掉：网页那头可能轮到对手走，或者棋盘位置变了', 'error');
      return false;
    } finally {
      forwarding = false;
    }
  }
}));

// 一些便于组件使用的小工具
export function useCurrentPosition(): Position {
  const tree = useStore((s) => s.tree);
  const current = useStore((s) => s.current);
  return positionAt(tree, current);
}

export function useCurrentMarks(): Mark[] {
  const tree = useStore((s) => s.tree);
  const current = useStore((s) => s.current);
  return marksAt(tree, current);
}

export function useMoveNumber(): number {
  const tree = useStore((s) => s.tree);
  const current = useStore((s) => s.current);
  return moveNumberAt(tree, current);
}

export function useBoardSize(): number {
  const tree = useStore((s) => s.tree);
  return propNum(tree, tree.root, 'SZ', 19);
}

export function cloneCurrentTree(): GameTree {
  return cloneTree(useStore.getState().tree);
}

/** 引擎正在想眼前这一盘的棋吗。组件里那几处"转圈/禁用"都该问它。 */
export function useThinking(): boolean {
  return useStore((s) => s.thinkingBoard === s.activeBoard);
}

/**
 * 会话落盘：落子、翻谱、切标签、开新盘都会碰这几个字段，攒一会儿再写一次。
 *
 * 拿这几个字段当信号，而不是去比对整份会话：分析快照一秒好几次，
 * 每次都序列化一遍棋谱太亏了。
 */
useStore.subscribe((s, p) => {
  if (
    s.boards === p.boards &&
    s.activeBoard === p.activeBoard &&
    s.tree === p.tree &&
    s.current === p.current &&
    s.filePath === p.filePath &&
    s.dirty === p.dirty &&
    s.finished === p.finished &&
    s.game === p.game
  ) {
    return;
  }
  writeSessionSoon();
});

/**
 * 标签页对应的 webview 节点。浏览器面板每建一个标签注册一份，
 * 截取的时候要按当前标签去找，不能像以前那样 querySelector 抓到第一个。
 */
const webviews = new Map<string, HTMLElement>();

export function registerWebview(tabId: string, el: HTMLElement | null): void {
  if (el) webviews.set(tabId, el);
  else webviews.delete(tabId);
}

/** 从 webview 节点问出它的 webContentsId，节点已经摘掉或者还没挂载时返回 null。 */
export function webContentsIdOf(el: Element | null | undefined): number | null {
  const wv = el as (HTMLElement & { getWebContentsId?: () => number }) | null | undefined;
  if (!wv?.getWebContentsId || !wv.isConnected) return null;
  try {
    const id = wv.getWebContentsId();
    return typeof id === 'number' && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/** 当前标签的 webContentsId。一个标签都没有时返回 null。 */
export function activeWebContentsId(): number | null {
  const { tabs, activeTabId } = useStore.getState();
  const id = activeTabId && tabs.some((t) => t.id === activeTabId) ? activeTabId : tabs[0]?.id;
  return id ? webContentsIdOf(webviews.get(id)) : null;
}

/** 当前标签的 webview 节点。 */
function activeWebviewEl(): HTMLElement | null {
  const { tabs, activeTabId } = useStore.getState();
  const id = activeTabId && tabs.some((t) => t.id === activeTabId) ? activeTabId : tabs[0]?.id;
  return id ? webviews.get(id) ?? null : null;
}

function currentView(): { id: number; el: HTMLElement } | null {
  const el = activeWebviewEl();
  if (!el) return null;
  const id = webContentsIdOf(el);
  return id === null ? null : { id, el };
}

/**
 * 网页视口的 CSS 像素大小。getBoundingClientRect 给的是它在页面上真正占的框，
 * 显示器缩放和应用自己的缩放都已经算进去了，跟网页自己看到的 viewport 是一回事。
 */
function viewSizeOf(el: HTMLElement): { width: number; height: number } | null {
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1 ? { width: r.width, height: r.height } : null;
}

/**
 * 实时截取与自动落子共用的中间状态，放模块级不放 store：截一次要几百毫秒，
 * 中间每写一次 store 就是一次全界面重画，而"正在截"本身不该出现在界面上。
 */
let polling = false;
let forwarding = false;
let lastForwardAt = 0;

/**
 * 上一次认出来的棋盘框，下次截图先照着它裁。网页四周的聊天栏、比分、按钮都在变，
 * 裁到棋盘这一小块上稳得多也快得多。截图尺寸一变（窗口或分屏被拖动）就作废重认。
 */
let pageCrop: (ImageBox & { imageWidth: number; imageHeight: number }) | null = null;

function cropFor(imageWidth: number, imageHeight: number): ImageBox | null {
  const c = pageCrop;
  if (!c) return null;
  if (Math.abs(c.imageWidth - imageWidth) > 2 || Math.abs(c.imageHeight - imageHeight) > 2) return null;
  return { x: c.x, y: c.y, w: c.w, h: c.h };
}

/** 记下这次认出来的棋盘框，往外扩一圈：棋盘最外圈那条线也框进来更稳。 */
function rememberCrop(rect: ImageBox, imageWidth: number, imageHeight: number): void {
  const padX = Math.round(rect.w * 0.06) + 2;
  const padY = Math.round(rect.h * 0.06) + 2;
  pageCrop = {
    x: Math.max(0, rect.x - padX),
    y: Math.max(0, rect.y - padY),
    w: Math.min(imageWidth, rect.w + padX * 2),
    h: Math.min(imageHeight, rect.h + padY * 2),
    imageWidth,
    imageHeight
  };
}

function setSync(text: string, ok: boolean): void {
  useStore.setState({ sync: { text, at: Date.now(), ok } });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 等一件事，超时就算它没成。截网页在窗口最小化的时候会一直不返回
 * （Electron 要等到有画面才给图），不设上限的话实时截取会卡在那一拍上再也不动。
 */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(what)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

interface PageShot {
  id: number;
  /** 认出来的路数。 */
  size: number;
  stones: number[];
  /** 网格在截图里的位置，点击坐标靠它换算。 */
  grid: GridFit;
  /** 截图的像素尺寸。 */
  imageWidth: number;
  imageHeight: number;
  /** 网页视口的 CSS 像素尺寸，点击坐标要按这个换算。 */
  viewWidth: number;
  viewHeight: number;
}

/**
 * 截一次网页并认出上面的棋盘，认不出来就返回一句原因，不抛异常：
 * 实时截取每隔几秒来一次，页面正在加载、翻页、弹窗都是常态，抛异常会一路炸到事件循环里。
 */
async function shotPage(): Promise<PageShot | string> {
  const view = currentView();
  if (!view) return '内置浏览器里还没有页面';
  const viewSize = viewSizeOf(view.el);
  if (!viewSize) return '浏览器那块还没显示出来';
  let dataUrl: string | null = null;
  try {
    dataUrl = await withTimeout(window.api.browser.capture(view.id), 6000, '截网页没在 6 秒内返回，大概是窗口被最小化了');
  } catch (e) {
    return '截取失败：' + (e instanceof Error ? e.message : String(e));
  }
  if (!dataUrl) return '截取失败，页面可能还没加载好';
  let data: ImageData;
  try {
    data = await imageDataFromUrl(dataUrl);
  } catch {
    return '截下来的画面读不出来';
  }
  // 路数按本地这盘给个提示：认得又快又准，真要是对不上（比如网页上是 19 路）
  // 后面的比对会如实报出来，不会拿着错的路数往下算。
  const tree = useStore.getState().tree;
  const res = recognizeBoard(data, {
    expectedSize: propNum(tree, tree.root, 'SZ', 19),
    crop: cropFor(data.width, data.height),
    // 开局两边都是空盘，实盘识别该认下这个画面；手动导入那边没这个选项，空盘仍然提醒。
    allowEmpty: true
  });
  if (!res.ok || !res.diagnostics) {
    // 网格都没找着，多半是棋盘在画面里太小。手动导入那条路会提示"在图上框选棋盘"，
    // 实时截取没有框选这一步，得告诉用户去调分屏或者网页缩放。
    return res.diagnostics
      ? res.message || '没认出网页上的棋盘'
      : '认不出网页上的棋盘：让棋盘完整、大一些地出现在浏览器那块里（把分隔条往棋盘那边拖，或者在网页里按 Ctrl 加号放大）';
  }
  // 自己找出来的棋盘框留给下一次裁。手动框的不能记，记了会一次比一次大。
  if (!res.diagnostics.usedCrop) {
    const rect = res.diagnostics.boardRect;
    if (rect.w < data.width * 0.98 || rect.h < data.height * 0.98) rememberCrop(rect, data.width, data.height);
  }
  return {
    id: view.id,
    size: res.size,
    stones: res.stones,
    grid: res.diagnostics.grid,
    imageWidth: data.width,
    imageHeight: data.height,
    viewWidth: viewSize.width,
    viewHeight: viewSize.height
  };
}
