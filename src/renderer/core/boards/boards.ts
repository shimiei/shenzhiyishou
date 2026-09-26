/**
 * 多个棋盘的标签页逻辑。跟内置浏览器那套标签一样，全是纯函数，好在 Node 里直接断言。
 *
 * 一盘棋的棋谱、走到哪一手、未保存标记、对局设置、复盘结果收在一个 BoardSlice 里。
 * store 里那几十个动作都是对着顶层字段写的，切标签时把当前那盘换出去、把目标那盘
 * 换进来，动作和组件就都不用改。换进换出按 BOARD_KEYS 来，漏写一个字段编译期就报错，
 * 所以"哪一块属于一盘棋"只有这一处出处。
 */

import { BLACK, type AnalysisSnapshot, type GameTree, type Stone } from '../../../shared/types';
import type { Advice } from '../advice';
import { EMPTY_REVIEW_SUMMARY, type ReviewMove, type ReviewPoint, type ReviewSummary } from '../review/review';
import { cloneTree } from '../sgf/serialize';
import { createTree, moveNumberAt, propNum } from '../sgf/tree';

export interface GameConfig {
  mode: 'manual' | 'vs-ai' | 'ai-vs-ai';
  humanColor: Stone;
  visits: number;
  timeMs: number;
  temperature: number;
  allowResign: boolean;
}

/** 一盘棋的全部状态。当前那盘摊在 store 顶层，其余的存在 boards 里。 */
export interface BoardSlice {
  tree: GameTree;
  current: number;
  past: GameTree[];
  future: GameTree[];
  filePath: string | null;
  dirty: boolean;
  /**
   * 这一盘存在棋谱馆里的哪一条（标题也带一份，标签和标题栏不用为了显示去问一次磁盘）。
   * 存过一次之后按保存就是更新它，不会再攒出一堆同名的。
   */
  record: { id: string; title: string } | null;
  hint: Advice | null;
  /**
   * 这一盘手动指定的行棋方，null 表示按棋谱数。
   * 有手数的局面改轮次改不到棋谱里去（那个节点自己的着手会盖过 PL），所以改用这处界面开关：
   * 落子、提示、实时分析、AI 走一手都认它。
   */
  turnOverride: 1 | 2 | null;
  game: GameConfig;
  /** 开“机机对局”之前是哪一档，关掉时回到这一档。 */
  autoReturn: 'manual' | 'vs-ai';
  finished: string | null;
  deadStones: number[];
  analysis: AnalysisSnapshot | null;
  analyzing: boolean;
  reviewPoints: Record<number, ReviewPoint>;
  reviewSign: Record<number, string>;
  reviewMoves: ReviewMove[];
  reviewSummary: ReviewSummary;
  reviewRunning: boolean;
  reviewDone: number;
  reviewTotal: number;
  reviewStopped: 'done' | 'cancelled' | 'replaced' | 'error' | null;
  reviewError: string | null;
}

/**
 * 属于一盘棋的字段清单，换进换出按它来。
 * 加了字段却忘了写进来，下面那个 everyBoardKeyIsListed 会编译不过。
 */
export const BOARD_KEYS = [
  'tree',
  'current',
  'past',
  'future',
  'filePath',
  'dirty',
  'record',
  'hint',
  'turnOverride',
  'game',
  'autoReturn',
  'finished',
  'deadStones',
  'analysis',
  'analyzing',
  'reviewPoints',
  'reviewSign',
  'reviewMoves',
  'reviewSummary',
  'reviewRunning',
  'reviewDone',
  'reviewTotal',
  'reviewStopped',
  'reviewError'
] as const;

type MissingBoardKey = Exclude<keyof BoardSlice, (typeof BOARD_KEYS)[number]>;

/** 编译期的哨兵：BOARD_KEYS 漏了 BoardSlice 里的字段，这一行就过不去。 */
export const everyBoardKeyIsListed: MissingBoardKey extends never ? true : never = true;

/** 从一处状态里挑出一盘棋（当前那份 store 状态，或者后台存着的切片）。 */
export function sliceFrom(source: BoardSlice): BoardSlice {
  const out: Record<string, unknown> = {};
  for (const k of BOARD_KEYS) out[k] = source[k];
  return out as unknown as BoardSlice;
}

export const DEFAULT_GAME: GameConfig = {
  mode: 'manual',
  humanColor: BLACK,
  visits: 400,
  timeMs: 3000,
  temperature: 0,
  allowResign: true
};

let seq = 0;

export function newBoardId(): string {
  seq += 1;
  return `board-${Date.now().toString(36)}-${seq}`;
}

/** 一盘空棋。 */
export function emptySlice(opts: { size?: number; komi?: number; game?: GameConfig } = {}): BoardSlice {
  const size = opts.size ?? 19;
  const komi = opts.komi ?? 7.5;
  return {
    tree: createTree(size, komi),
    current: 1,
    past: [],
    future: [],
    filePath: null,
    dirty: false,
    record: null,
    hint: null,
    turnOverride: null,
    game: { ...(opts.game ?? DEFAULT_GAME) },
    autoReturn: 'manual',
    finished: null,
    deadStones: [],
    analysis: null,
    analyzing: false,
    reviewPoints: {},
    reviewSign: {},
    reviewMoves: [],
    reviewSummary: { ...EMPTY_REVIEW_SUMMARY },
    reviewRunning: false,
    reviewDone: 0,
    reviewTotal: 0,
    reviewStopped: null,
    reviewError: null
  };
}

/** 一个标签：一个编号、一句说明（“副本”之类）、一盘棋。 */
export interface BoardTab {
  id: string;
  /** 没存过盘时标签上写它。存过盘就用文件名，不看这个。 */
  note: string;
  slice: BoardSlice;
}

export function freshBoard(opts?: { size?: number; komi?: number; game?: GameConfig }): BoardTab {
  return { id: newBoardId(), note: '', slice: emptySlice(opts) };
}

/**
 * 复制一盘棋：整棵棋谱连着分支克隆出来，落点跟着原盘走。
 * 副本不再指向原文件、也不再指着馆里的那一条（保存时另存一份，不会盖掉原件），
 * 撤销历史不带过去；对弈方式退回手动，复制出来是拿来研究的，不该一开就自己下起来。
 * 复盘结果跟棋谱走：cloneTree 保住了节点号，所以那批评点仍然对得上。
 */
export function cloneSlice(src: BoardSlice): BoardSlice {
  const base = sliceFrom(src);
  return {
    ...base,
    tree: cloneTree(base.tree),
    past: [],
    future: [],
    filePath: null,
    record: null,
    // 原件有内容（存过盘、进过馆，或者改动过）的话，副本也算“还没存过”
    dirty: base.dirty || base.filePath !== null || base.record !== null,
    game: { ...base.game, mode: 'manual' },
    autoReturn: 'manual',
    analysis: null,
    analyzing: false,
    reviewRunning: false,
    reviewPoints: { ...base.reviewPoints },
    reviewSign: { ...base.reviewSign },
    reviewMoves: base.reviewMoves.slice(),
    reviewSummary: { ...base.reviewSummary }
  };
}

export function copiedBoard(src: BoardSlice): BoardTab {
  return { id: newBoardId(), note: '副本', slice: cloneSlice(src) };
}

/** 开一个标签。activate 为假表示在后台开，当前标签不动。 */
export function openBoard(
  tabs: BoardTab[],
  tab: BoardTab,
  activeId: string,
  activate = true
): { tabs: BoardTab[]; activeId: string } {
  return { tabs: [...tabs, tab], activeId: activate || !activeId ? tab.id : activeId };
}

/**
 * 关一个标签。关掉的正好是当前那个时，接管它右边那个；右边没有就回左边那个。
 * 全关完时 activeId 是空串，调用方要补一个空盘（棋盘不像浏览器，不能一盘都不在）。
 */
export function closeBoard(
  tabs: BoardTab[],
  id: string,
  activeId: string
): { tabs: BoardTab[]; activeId: string } {
  const index = tabs.findIndex((t) => t.id === id);
  if (index < 0) return { tabs, activeId };
  const rest = tabs.filter((t) => t.id !== id);
  if (rest.length === 0) return { tabs: rest, activeId: '' };
  if (activeId !== id) return { tabs: rest, activeId };
  return { tabs: rest, activeId: rest[Math.min(index, rest.length - 1)].id };
}

/** 前后轮流切标签，绕圈。只剩一个时原地不动。 */
export function stepBoard(tabs: BoardTab[], activeId: string, dir: 1 | -1): string {
  if (tabs.length === 0) return activeId;
  const index = tabs.findIndex((t) => t.id === activeId);
  if (index < 0) return tabs[0].id;
  return tabs[(index + dir + tabs.length) % tabs.length].id;
}

/** 第 n 个标签（从 1 数），Ctrl+1 到 Ctrl+9 用。没有那一个就返回空串。 */
export function nthBoard(tabs: BoardTab[], n: number): string {
  return tabs[n - 1]?.id ?? '';
}

/** 一盘棋在标签上叫什么：馆里的标题 > 文件名 > 自己起的说明 > 未命名。 */
export function boardTitle(tab: BoardTab, max = 16): string {
  const base = tab.slice.filePath ? tab.slice.filePath.split(/[\\/]/).pop() || '' : '';
  const text = tab.slice.record?.title || base || tab.note || '未命名对局';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/**
 * AI 固定执哪一方。只有"人机对局"这一档算固定执一方，辅助模式与机机对局都返回 null
 * （前者 AI 一手都不走，后者两边都归它，都不是"固定执一方"）。
 */
export function aiSideOf(game: GameConfig): 1 | 2 | null {
  return game.mode === 'vs-ai' ? ((3 - game.humanColor) as 1 | 2) : null;
}

/** 标签上的小角标：这盘上正跑着什么。 */
export function boardBadges(tab: BoardTab): string[] {
  const out: string[] = [];
  if (tab.slice.analyzing) out.push('分析');
  if (tab.slice.reviewRunning) out.push('复盘');
  if (tab.slice.game.mode === 'ai-vs-ai') out.push('机机');
  return out;
}

/** 关掉这一盘会不会丢东西。 */
export function hasUnsaved(tab: BoardTab): boolean {
  return tab.slice.dirty;
}

/** 悬停提示：路数、贴目、手数、对弈方式，一眼看清这是哪一盘。 */
export function boardTooltip(tab: BoardTab): string {
  const { tree, current, game, filePath, record, dirty } = tab.slice;
  const size = propNum(tree, tree.root, 'SZ', 19);
  const komi = propNum(tree, tree.root, 'KM', 7.5);
  const ply = moveNumberAt(tree, current);
  const mode = game.mode === 'ai-vs-ai' ? '机机对局' : game.mode === 'vs-ai' ? '人机对局' : '手动对局';
  const head = record ? `棋谱馆：${record.title}` : filePath || boardTitle(tab, 40);
  return `${head}\n${size} 路 · 贴 ${komi} 目 · 第 ${ply} 手\n${mode}${dirty ? ' · 有改动没保存' : ''}`;
}

/** 对弈方式的说法，状态行与提示里都用这一句，免得两处写得不一样。 */
export function gameModeText(game: GameConfig): string {
  if (game.mode === 'ai-vs-ai') return '机机对局';
  if (game.mode === 'vs-ai') return `人机对局 · 你执${game.humanColor === BLACK ? '黑' : '白'}`;
  return '辅助模式 · AI 不自己落子';
}
