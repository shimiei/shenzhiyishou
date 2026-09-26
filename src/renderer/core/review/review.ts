import { BLACK, PASS, WHITE, type Stone } from '../../../shared/types';
import { Position } from '../go/position';

/**
 * 复盘：把引擎逐手算出来的结果整理成一局棋的评点。
 *
 * 这里全是纯计算，不碰引擎也不碰界面，方便自测。
 * 数据流是：主进程按手顺逐个局面分析，每个局面给一份快照；
 * 本模块把相邻两份快照一比，算出"这一手让下棋那方掉了多少胜率"。
 */

/** 候选点。胜率统一换算成黑棋视角，省得界面上再翻一次。 */
export interface ReviewCandidate {
  move: string;
  blackWinrate: number;
  visits: number;
}

/** 一个局面的分析结果，视角统一成黑棋。 */
export interface ReviewPoint {
  nodeId: number;
  /** 手数，起始局面是 0，之后每落一子加一。 */
  ply: number;
  /** 这个局面上该谁走。 */
  turn: 'B' | 'W';
  /** 黑棋胜率，0 到 1。 */
  blackWinrate: number;
  /** 黑棋目差。 */
  blackScoreLead: number;
  visits: number;
  /** 引擎的第一推荐，停一手是"pass"。 */
  bestMove: string;
  /** 引擎看过的候选中最好的几个，按胜率从高到低。 */
  candidates: ReviewCandidate[];
}

/** 评点等级。按胜率损失分档，门槛都在 GRADE_CUTS 里。 */
export type Grade = 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export interface ReviewMove {
  nodeId: number;
  ply: number;
  color: Stone;
  /** 落点，停一手是 PASS（-1）。 */
  point: number;
  /** GTP 坐标，停一手写成"停一手"。 */
  vertex: string;
  /** 这一手之前的黑棋胜率。 */
  winrateBefore: number;
  /** 这一手之后的黑棋胜率。 */
  winrateAfter: number;
  /** 这一手让下棋那方亏掉的胜率，正数是亏。 */
  loss: number;
  /** 这一手让下棋那方亏掉的目数，正数是亏。 */
  lossPoints: number;
  /** 引擎在这个局面上推荐的手。 */
  bestMove: string;
  /** 实际这手在引擎候选里的名次，1 是最好的；不在候选里是 0。 */
  rank: number;
  /** 引擎推荐的这一手，下棋那方走它之后的胜率（0 到 1）。 */
  bestWinrate: number;
  visits: number;
  grade: Grade;
}

export interface ReviewSummary {
  /** 评点了几手。 */
  moves: number;
  best: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  blunder: number;
  /** 损失最大的一手。 */
  worst: ReviewMove | null;
  /** 各手损失的合计，用来粗略看整局的质量。 */
  totalLoss: number;
}

/**
 * 分档门槛，单位是胜率百分点（0 到 100）。
 * 一手的胜负损失在 2 个点以内算正常，5 个点以内是小失误，
 * 12 个点以上在职业棋里基本就翻盘了，所以叫恶手。
 */
export const GRADE_CUTS = { good: 2, inaccuracy: 5, mistake: 12 } as const;

export const GRADE_LABEL: Record<Grade, string> = {
  best: '最佳',
  good: '正常',
  inaccuracy: '小失误',
  mistake: '失误',
  blunder: '恶手'
};

/** 复盘里当"问题手"看待的档。正常和最佳的略过。 */
export const PROBLEM_GRADES: Grade[] = ['inaccuracy', 'mistake', 'blunder'];

export function gradeOf(lossPercent: number, rank: number): Grade {
  if (rank === 1 && lossPercent <= GRADE_CUTS.good) return 'best';
  if (lossPercent <= GRADE_CUTS.good) return 'good';
  if (lossPercent <= GRADE_CUTS.inaccuracy) return 'inaccuracy';
  if (lossPercent <= GRADE_CUTS.mistake) return 'mistake';
  return 'blunder';
}

/** 胜率在界面上都按百分点显示，损失也是百分点。 */
export function toPercent(v: number): number {
  return Math.round(v * 1000) / 10;
}

/** 停一手的坐标写法，和引擎一致。 */
export const PASS_VERTEX = 'pass';

/**
 * 把逐手分析结果整理成评点。
 *
 * moves 是主线上的着法顺序（不含起始局面），points 是逐局面的分析结果，
 * 两者长度必须差一：points[i] 是第 i 手之前的局面，points[i+1] 是之后的。
 * 对不上（引擎没算完就被取消）就只评到能对上的地方为止，不硬猜，
 * 免得把"没算出来"当成"下得差"。
 */
export function buildReview(
  moves: Array<{ nodeId: number; color: Stone; point: number }>,
  points: ReviewPoint[],
  size: number
): ReviewMove[] {
  const out: ReviewMove[] = [];
  const n = Math.min(moves.length, Math.max(0, points.length - 1));
  for (let i = 0; i < n; i++) {
    const before = points[i];
    const after = points[i + 1];
    if (!before || !after) break;
    const mv = moves[i];
    const mover: Stone = mv.color === WHITE ? WHITE : BLACK;
    // 同一手棋，从下棋那方的角度看亏了多少。白棋的胜率是 1 减黑棋的，所以翻个符号。
    const sign = mover === BLACK ? 1 : -1;
    const loss = (before.blackWinrate - after.blackWinrate) * sign;
    const lossPoints = (before.blackScoreLead - after.blackScoreLead) * sign;
    const bestWinrate = before.turn === 'B' ? before.blackWinrate : 1 - before.blackWinrate;
    const played = vertexOf(mv.point, size);
    const idx = before.candidates.findIndex((c) => c.move === played);
    const rank = idx >= 0 ? idx + 1 : 0;
    out.push({
      nodeId: mv.nodeId,
      ply: i + 1,
      color: mover,
      point: mv.point,
      vertex: played,
      winrateBefore: before.blackWinrate,
      winrateAfter: after.blackWinrate,
      loss,
      lossPoints,
      bestMove: before.bestMove,
      rank,
      bestWinrate,
      visits: before.visits,
      grade: gradeOf(toPercent(Math.max(0, loss)), rank)
    });
  }
  return out;
}

function vertexOf(point: number, size: number): string {
  if (point === PASS || point < 0) return PASS_VERTEX;
  return Position.gtpVertex(point, size);
}

export function summarize(moves: ReviewMove[]): ReviewSummary {
  const s: ReviewSummary = {
    moves: moves.length,
    best: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
    worst: null,
    totalLoss: 0
  };
  for (const m of moves) {
    s[m.grade] += 1;
    s.totalLoss += Math.max(0, m.loss);
    if (!s.worst || m.loss > s.worst.loss) s.worst = m;
  }
  return s;
}

/** 胜率曲线：横轴手数，纵轴黑棋胜率。 */
export function curvePoints(points: ReviewPoint[]): Array<{ ply: number; black: number }> {
  return points
    .slice()
    .sort((a, b) => a.ply - b.ply)
    .map((p) => ({ ply: p.ply, black: clamp01(p.blackWinrate) }));
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 问题手列表，损失大的排前面。 */
export function problemMoves(moves: ReviewMove[], minGrade: Grade = 'inaccuracy'): ReviewMove[] {
  const floor = Math.max(0, PROBLEM_GRADES.indexOf(minGrade));
  return moves
    .filter((m) => PROBLEM_GRADES.indexOf(m.grade) >= floor && m.loss > 0)
    .sort((a, b) => b.loss - a.loss || a.ply - b.ply);
}

/**
 * 从当前手数出发找下一处（或上一处）值得看的地方。
 * dir 为 1 往后找，-1 往前找。找不到返回 null，界面据此把按钮置灰。
 */
export function nextProblem(moves: ReviewMove[], fromPly: number, dir: 1 | -1, minGrade: Grade = 'inaccuracy'): ReviewMove | null {
  const floor = Math.max(0, PROBLEM_GRADES.indexOf(minGrade));
  const list = moves
    .filter((m) => PROBLEM_GRADES.indexOf(m.grade) >= floor && m.loss > 0)
    .sort((a, b) => a.ply - b.ply);
  if (dir === 1) return list.find((m) => m.ply > fromPly) ?? null;
  const before = list.filter((m) => m.ply < fromPly);
  return before.length ? before[before.length - 1] : null;
}
