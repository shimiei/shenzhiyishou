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
  infoFromTree,
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
import { cloneTree } from '../core/sgf/serialize';
import { engineSgfFor } from '../core/sgf/engineSgf';
import { parseSgf } from '../core/sgf/parse';
import { Position } from '../core/go/position';
import { closeTab, makeTab, openTab, stepTab, type BrowserTab } from '../core/browser/tabs';
import {
  DEFAULT_LEFT,
  DEFAULT_RIGHT,
  DEFAULT_SPLIT,
  LEFT_MAX,
  LEFT_MIN,
  RIGHT_MAX,
  RIGHT_MIN,
  SPLIT_MAX,
  SPLIT_MIN
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
  thinking: boolean;
  /** 手里这条推荐，带颜色。盘面一变就作废，不会留在旧局面的点上。 */
  hint: Advice | null;
  engineLogs: string[];

  game: GameConfig;
  finished: string | null;
  deadStones: number[];

  dialog: DialogName;
  image: { dataUrl: string; name: string } | null;
  browserOpen: boolean;
  splitRatio: number;
  /** 左右两栏的像素宽度，拖动分隔条时改。 */
  leftWidth: number;
  rightWidth: number;
  /** 内置浏览器的标签页，一个标签一份 webview。 */
  tabs: BrowserTab[];
  activeTabId: string | null;
  zoom: number;
  toasts: Toast[];

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
  playColor: (color: 1 | 2, point: number) => void;
  pass: () => void;
  playAiMove: (force?: boolean) => Promise<string | null>;
  maybeAiTurn: () => Promise<void>;
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
  setSplit: (v: number) => void;
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

function clampRange(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
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
  browserOpen: boolean;
}): void {
  const layout: AppSettings['layout'] = {
    leftWidth: Math.round(s.leftWidth),
    rightWidth: Math.round(s.rightWidth),
    splitRatio: s.splitRatio,
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
  thinking: false,
  hint: null,
  engineLogs: [],

  game: { mode: 'manual', humanColor: BLACK, visits: 400, timeMs: 3000, temperature: 0, allowResign: true },
  finished: null,
  deadStones: [],

  dialog: null,
  image: null,
  browserOpen: false,
  splitRatio: DEFAULT_SPLIT,
  leftWidth: DEFAULT_LEFT,
  rightWidth: DEFAULT_RIGHT,
  tabs: [],
  activeTabId: null,
  zoom: 1,
  showOwnership: false,
  toasts: [],

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
    set({
      tree,
      current: nextCurrent,
      past: [...get().past.slice(-120), get().tree],
      future: [],
      dirty: true,
      hint: sameBoard ? prev.hint : null
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

  playColor(color, point) {
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
    const res = addMoveNode(tree, current, color, point, { mainLine: true });
    get().commit(res.tree, res.id);
    get().setAnalysis(null);
    void get().maybeAiTurn();
  },

  pass() {
    const { tree, current } = get();
    const color = colorToPlayAt(tree, current);
    const res = addMoveNode(tree, current, color, PASS, { mainLine: true });
    get().commit(res.tree, res.id);
    // 连续两停，终局
    const path = pathTo(res.tree, res.id);
    const lastTwo = path.slice(-2).map((id) => moveAtSized(res.tree, id));
    if (lastTwo.length === 2 && lastTwo.every((m) => m && m.point === PASS)) {
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
        return null;
      }
      const size = propNum(tree, tree.root, 'SZ', 19);
      const point = Position.parseVertex(res.move, size);
      const r2 = addMoveNode(get().tree, get().current, color, point, { mainLine: true });
      get().commit(r2.tree, r2.id);
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

  async maybeAiTurn() {
    const { game, tree, current, finished } = get();
    if (finished) return;
    if (game.mode === 'manual') return;
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
    }
  },

  setHint(advice) {
    set({ hint: advice });
  },

  pickCandidate(move, winrate, scoreLead) {
    const { tree, current } = get();
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
      game: { ...get().game, ...opts, humanColor }
    });
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
        game: { ...get().game, mode: 'manual' }
      });
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
        game: { ...get().game, mode: 'manual' }
      });
      get().toast(`已导入局面：黑 ${ab.length} 白 ${aw.length}`, 'success');
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
    if (analyzing && !force) return;
    const color = colorToPlayAt(tree, current);
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
    set({ analyzing: true, analysis: null });
  },

  async stopAnalysis() {
    await window.api.engine.analyzeStop();
    set({ analyzing: false, analysis: null });
  },

  async toggleAnalysis() {
    if (get().analyzing) await get().stopAnalysis();
    else await get().startAnalysis();
  },

  setAnalysis(s) {
    set({ analysis: s });
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

  setSplit(v) {
    set({ splitRatio: clampRange(v, SPLIT_MIN, SPLIT_MAX) });
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
