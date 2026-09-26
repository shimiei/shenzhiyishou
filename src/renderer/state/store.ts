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
  type Mark,
  type MarkType
} from '../core/sgf/tree';
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
import { cloneTree } from '../core/sgf/serialize';
import { engineSgfFor } from '../core/sgf/engineSgf';
import { parseSgf } from '../core/sgf/parse';
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

export type Tool = 'play' | 'black' | 'white' | 'erase' | 'triangle' | 'square' | 'circle' | 'cross' | 'label';
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
  | null;

export interface GameConfig {
  mode: 'manual' | 'vs-ai' | 'ai-vs-ai';
  humanColor: Stone;
  visits: number;
  timeMs: number;
  temperature: number;
  allowResign: boolean;
}

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

  tool: Tool;
  hover: number | null;
  cursor: number | null;
  /** 是否在棋盘上铺形势判断的热力块，默认关，免得挡住棋子。 */
  showOwnership: boolean;

  engineStatus: EngineStatus;
  analysis: AnalysisSnapshot | null;
  analyzing: boolean;
  /** 分析引擎正在起步（拉起进程、换网络都要十几秒）。界面靠它显示"启动中"。 */
  analyzeStarting: boolean;
  thinking: boolean;
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
  playAiMove: (force?: boolean) => Promise<string | null>;
  maybeAiTurn: () => Promise<void>;
  /**
   * 机机对局随时开、随时停：开了双方都由 AI 自动走，从当前局面接着下，
   * 停了就回到开之前那一档。生成棋谱来复盘，或者想看引擎自己怎么下，用它。
   */
  toggleAiVsAi: () => void;
  /** 关掉机机对局并回到原来那一档。reason 是给提示用的说法，"下完了"不再多说一句。 */
  stopAiVsAi: (reason: '已停' | '下完了') => void;
  /** 让引擎按当前行棋方走一手，走完就停，不接着自动走。 */
  aiMoveNow: () => Promise<void>;
  doHint: () => Promise<void>;
  setHint: (advice: Advice | null) => void;
  /** 候选点面板点一下，把它当推荐画到棋盘上。 */
  pickCandidate: (move: string, winrate: number, scoreLead: number) => void;
  setTurn: (color: 1 | 2) => void;
  resign: () => void;

  newGame: (opts: Partial<GameConfig> & { size?: number; komi?: number; handicap?: number; rules?: string }) => void;
  loadSgf: (content: string, path?: string) => void;
  importPosition: (stones: number[], size: number, asNew: boolean) => void;
  setTool: (t: Tool) => void;
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
  setThinking: (v: boolean) => void;
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
  /** 主进程算完一个局面，结果记进来。 */
  addReviewPoint: (p: ReviewPoint) => void;
  endReview: (reason: 'done' | 'cancelled' | 'replaced' | 'error', error?: string) => void;
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
function sgfFor(tree: GameTree, node: number): string {
  const color = colorToPlayAt(tree, node) === BLACK ? 'B' : 'W';
  return engineSgfFor(tree, node, color).sgf;
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

function clampRange(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 实时分析的代号，每次发起和每次停下都加一。引擎那头回话晚一步时用它分辨
 * "这次回话还算不算数"，见 startAnalysis 与 stopAnalysis。
 */
let analyzeRun = 0;

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

export const useStore = create<AppStore>((set, get) => ({
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  info: null,
  theme: 'dark',

  tree: createTree(19, 7.5),
  current: 1,
  past: [],
  future: [],
  filePath: null,
  dirty: false,

  tool: 'play',
  hover: null,
  cursor: null,

  engineStatus: emptyStatus,
  analysis: null,
  analyzing: false,
  analyzeStarting: false,
  thinking: false,
  hint: null,
  engineLogs: [],

  game: { mode: 'manual', humanColor: BLACK, visits: 400, timeMs: 3000, temperature: 0, allowResign: true },
  autoReturn: 'manual',
  finished: null,
  deadStones: [],

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
  reviewPoints: {},
  reviewSign: {},
  reviewMoves: [],
  reviewSummary: { moves: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, worst: null, totalLoss: 0 },
  reviewRunning: false,
  reviewDone: 0,
  reviewTotal: 0,
  reviewStopped: null,
  reviewError: null,

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

  toast(text, kind = 'info') {
    const id = Date.now() + Math.random();
    set({ toasts: [...get().toasts, { text, kind, id }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3200);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  commit(tree, current) {
    const prev = get();
    const cur = prev.current;
    const nextCurrent = current ?? (tree.nodes[cur] ? cur : tree.root);
    // 盘面变了（落了子、摆了子、提了子）推荐就作废；只改注释标记时留着，
    // 那条推荐还是这个局面的。
    const sameBoard = prev.hint !== null && positionKey(tree, nextCurrent) === positionKey(prev.tree, cur);
    /*
     * 棋谱变了，复盘评点得跟着重算：多了一手就可能多出一处问题手，
     * 在分支里拐弯也会让"后面那一手"变成另一手。原始结果按节点存着，重算的只是整理这一步。
     */
    const derived = Object.keys(prev.reviewPoints).length > 0 ? deriveReview(tree, prev.reviewPoints, prev.reviewSign) : null;
    set({
      tree,
      current: nextCurrent,
      past: [...get().past.slice(-120), get().tree],
      future: [],
      dirty: true,
      hint: sameBoard ? prev.hint : null,
      ...(derived ? { reviewMoves: derived.moves, reviewSummary: derived.summary } : {})
    });
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
    const { tree, current } = get();
    const color = colorToPlayAt(tree, current);
    get().playColor(color, point);
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
    const color = colorToPlayAt(tree, current);
    const res = addMoveNode(tree, current, color, PASS, { mainLine: true, source: 'human' });
    get().commit(res.tree, res.id);
    // 连续两停，终局
    if (endedByDoublePass(res.tree, res.id)) {
      get().setDialog('score');
    } else {
      void get().maybeAiTurn();
    }
  },

  async playAiMove(force = false): Promise<string | null> {
    const { tree, current, game, finished } = get();
    if (finished || get().thinking) return null;
    const color = colorToPlayAt(tree, current);
    const aiColor = (3 - game.humanColor) as 1 | 2;
    if (!force && color !== aiColor && game.mode !== 'ai-vs-ai') return null;
    const nodeAtRequest = current;
    get().setThinking(true);
    try {
      const res = await window.api.engine.genMove({
        sgf: sgfFor(tree, current),
        color: color === BLACK ? 'B' : 'W',
        maxVisits: game.visits,
        maxTimeMs: game.timeMs,
        allowResign: game.allowResign,
        temperature: game.temperature
      });
      if (get().current !== nodeAtRequest) return null; // 用户已经切换了节点
      if (res.error) {
        get().toast('引擎出错：' + res.error, 'error');
        return null;
      }
      if (res.resigned) {
        const winner = color === BLACK ? '白' : '黑';
        get().setFinished(`白胜` === winner + '胜' ? winner + '胜（认输）' : `${winner}中盘胜`);
        const t = get().tree;
        get().commit(setProp(t, t.root, 'RE', [`${winner === '黑' ? 'B' : 'W'}+R`]), get().current);
        get().toast(`${color === BLACK ? '黑方' : '白方'}认输，${winner}中盘胜`, 'success');
        // 这盘到此为止，机机档就没必要再亮着了（认输的提示刚说过，不用再说一遍）
        if (get().game.mode === 'ai-vs-ai') get().stopAiVsAi('下完了');
        return null;
      }
      const size = propNum(tree, tree.root, 'SZ', 19);
      const point = Position.parseVertex(res.move, size);
      const r2 = addMoveNode(get().tree, get().current, color, point, { mainLine: true, source: 'ai' });
      get().commit(r2.tree, r2.id);
      void get().forwardMoveToBrowser(point, color, nodeAtRequest);
      // 引擎替人停的那一手也算：两边连续停一手就是对局到头，接着自动走会一直停下去
      if (endedByDoublePass(r2.tree, r2.id)) {
        if (get().game.mode === 'ai-vs-ai') get().stopAiVsAi('下完了');
        get().toast('双方连续停一手，这一局下完了，打开形势判断看看结果', 'success');
        get().setDialog('score');
        return res.move;
      }
      if (get().game.mode === 'ai-vs-ai') setTimeout(() => void get().maybeAiTurn(), 400);
      return res.move;
    } catch (e) {
      get().toast('引擎出错：' + (e instanceof Error ? e.message : String(e)), 'error');
      return null;
    } finally {
      get().setThinking(false);
    }
  },

  async aiMoveNow() {
    const { finished } = get();
    if (finished) {
      get().toast('这盘已经结束了', 'info');
      return;
    }
    const { tree, current } = get();
    const color = colorToPlayAt(tree, current);
    if (get().thinking) return;
    set({ hint: null });
    const move = await get().playAiMove(true);
    if (move !== null) {
      get().toast(`${colorName(color)}方 AI 走了 ${isPassMove(move) ? '停一手' : move}`, 'info');
    }
  },

  toggleAiVsAi() {
    const { game, finished, tree, current } = get();
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
    set({ game: { ...game, mode: 'ai-vs-ai' }, autoReturn: game.mode, hint: null });
    get().toast(
      get().reviewRunning
        ? '机机对局：轮到谁谁自动走，再点一下"停机机"就停。复盘正在算，两个引擎抢显卡，都会慢一些'
        : '机机对局：轮到谁谁自动走，再点一下"停机机"就停',
      'info'
    );
    void get().maybeAiTurn();
  },

  stopAiVsAi(reason) {
    const { game, autoReturn, thinking } = get();
    if (game.mode !== 'ai-vs-ai') return;
    set({ game: { ...game, mode: autoReturn } });
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

  async maybeAiTurn() {
    const { game, tree, current, finished, thinking } = get();
    if (finished) return;
    if (game.mode === 'manual') return;
    // 两边都停过一手就是对局到头了，别再往下走
    if (endedByDoublePass(tree, current)) return;
    /*
     * 引擎正忙（刚按过提示、上一手还没算完）时按下"机机对下"，这一按不能白按：
     * 等它收尾再接上。等的时候模式可能已经被关掉，每次醒来都重新读一遍。
     */
    if (thinking) {
      setTimeout(() => void get().maybeAiTurn(), 300);
      return;
    }
    if (game.mode === 'ai-vs-ai') {
      void get().playAiMove();
      return;
    }
    const color = colorToPlayAt(tree, current);
    const aiColor = (3 - game.humanColor) as 1 | 2;
    if (color === aiColor) void get().playAiMove();
  },

  /**
   * 提示只是给建议，绝不落子：落子要么用户自己点棋盘，要么点"AI 走一手"。
   * 计算期间占住 thinking，连点不会排出一串引擎请求，也不会刷出一串重复提示。
   */
  async doHint() {
    const { tree, current, thinking } = get();
    if (thinking) return;
    const color = colorToPlayAt(tree, current);
    get().setThinking(true);
    try {
      const { settings } = get();
      const res = await window.api.engine.hint(
        sgfFor(tree, current),
        settings.analyzeVisits,
        color === BLACK ? 'B' : 'W',
        // 提示也要带时限：大网络上一手提示跑几十秒会让人以为卡住。用每步限时那一档。
        settings.playTimeMs
      );

      if (get().current !== current) return; // 用户已经翻到别的局面去了
      if (res.error) {
        get().toast('引擎出错：' + res.error, 'error');
        return;
      }
      const advice: Advice = { color, move: res.move, winrate: res.winrate, scoreLead: res.scoreLead };
      set({ hint: advice });
      get().toast(adviceLine(advice));
    } catch (e) {
      get().toast('引擎出错：' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      get().setThinking(false);
      /*
       * 引擎算这一手之前会把实时分析停掉，给搜索腾机器（这一步是 genMove 里做的）。
       * 提示不落子，没人触发界面里那条"局面变了就重连分析"，所以要在这里把它接回去：
       * 不接的话面板还写着"分析中"，候选点却停在上一手那几个上，看的人会以为分析坏了。
       */
      if (get().analyzing) void get().startAnalysis(true);
    }
  },

  setHint(advice) {
    set({ hint: advice });
  },

  pickCandidate(move, winrate, scoreLead) {
    const { tree, current, analysis } = get();
    /*
     * 面板上那几行可能还是上一个局面的（刚落下新的一手、新的还没算出来）。
     * 那上面推荐的点在这个局面上未必成立，索性不接这一下，免得画个错的推荐圈。
     */
    if (analysis && analysis.nodeId >= 0 && analysis.nodeId !== current) return;
    set({ hint: { color: colorToPlayAt(tree, current), move, winrate, scoreLead } });
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

  resign() {
    const { tree, current, game } = get();
    const color = colorToPlayAt(tree, current);
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
    set({
      tree,
      current: tree.root,
      past: [],
      future: [],
      filePath: null,
      dirty: false,
      analysis: null,
      finished: null,
      deadStones: [],
      hint: null,
      game: { ...get().game, ...opts, humanColor },
      autoReturn: 'manual'
    });
    get().clearReview();
    void get().maybeAiTurn();
  },

  loadSgf(content, path) {
    try {
      const trees = parseSgf(content);
      const tree = trees[0];
      let cur = tree.root;
      while (tree.nodes[cur]?.children.length) cur = tree.nodes[cur].children[0];
      set({
        tree,
        current: cur,
        past: [],
        future: [],
        filePath: path ?? null,
        dirty: false,
        analysis: null,
        finished: null,
        deadStones: [],
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
      set({
        tree: t,
        current: t.root,
        past: [],
        future: [],
        filePath: null,
        dirty: true,
        analysis: null,
        finished: null,
        deadStones: [],
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
    set({ tool: t });
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
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
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
    const color = colorToPlayAt(tree, current);
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
        sgf: sgfFor(tree, current),
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
      set({ analyzing: true });
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
    analyzeRun++;
    set({ analyzing: false, analysis: null, analyzeStarting: false });
    await window.api.engine.analyzeStop();
  },

  async toggleAnalysis() {
    if (get().analyzing) await get().stopAnalysis();
    else await get().startAnalysis();
  },

  setAnalysis(s) {
    set({ analysis: s });
  },

  async startReview() {
    const { tree, settings, reviewPoints, reviewSign, reviewRunning } = get();
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
    set({ reviewRunning: true, reviewDone: 0, reviewTotal: todo.length, reviewStopped: null, reviewError: null });
    get().toast(`开始复盘：从第 ${cover} 手之后算起，共 ${todo.length} 个局面`, 'info');
    const res = await window.api.engine.reviewStart({
      positions: todo,
      visits: settings.reviewVisits,
      maxTimeMs: 0,
      lines: 8
    });
    if (!res.ok) {
      set({ reviewRunning: false, reviewError: res.error ?? '复盘没能开始' });
      get().toast('复盘没能开始：' + (res.error ?? ''), 'error');
    }
  },

  async stopReview() {
    await window.api.engine.reviewStop();
    // 结果不清：已经算出来的那一半照样有用
    set({ reviewRunning: false });
  },

  addReviewPoint(p) {
    const { tree, reviewPoints, reviewSign } = get();
    const points = { ...reviewPoints, [p.nodeId]: p };
    const signs = { ...reviewSign, [p.nodeId]: positionSign(tree, p.nodeId) };
    const derived = deriveReview(tree, points, signs);
    set({ reviewPoints: points, reviewSign: signs, reviewMoves: derived.moves, reviewSummary: derived.summary });
  },

  endReview(reason, error) {
    set({ reviewRunning: false, reviewStopped: reason, reviewError: error ?? null });
    const { reviewMoves } = get();
    if (reason === 'cancelled' || reason === 'replaced') {
      get().toast(
        reason === 'replaced' ? '复盘被实时分析顶掉了，已经算完的部分留着' : `复盘停下了，已经算完 ${reviewMoves.length} 手`,
        'info'
      );
      return;
    }
    if (reason === 'error') {
      get().toast('复盘出错：' + (error ?? ''), 'error');
      return;
    }
    const s = get().reviewSummary;
    get().toast(
      s.worst && s.worst.loss > 0
        ? `复盘完了：${reviewMoves.length} 手，恶手 ${s.blunder} 处、失误 ${s.mistake} 处，最大的一手是第 ${s.worst.ply} 手`
        : `复盘完了：${reviewMoves.length} 手`,
      'success'
    );
    // 复盘完顺手停在第一处问题手上，省得自己去找
    const first = problemMoves(reviewMoves)[0];
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

  setThinking(v) {
    set({ thinking: v });
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
    if (st.thinking || forwarding) return;
    if (polling) return;
    if (Date.now() - lastForwardAt < 2200) return;
    polling = true;
    try {
      const shot = await shotPage();
      if (typeof shot === 'string') {
        setSync(shot, false);
        return;
      }
      const now = get();
      const size = propNum(now.tree, now.tree.root, 'SZ', 19);
      if (shot.size !== size) {
        setSync(`网页上是 ${shot.size} 路，这盘是 ${size} 路，对不上`, false);
        return;
      }
      const cur = now.current;
      const plan = planMirror(size, positionAt(now.tree, cur).cells, colorToPlayAt(now.tree, cur), shot.stones);
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
      const plan = planMirror(size, positionAt(st.tree, parentId).cells, colorToPlayAt(st.tree, parentId), before.stones);
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
