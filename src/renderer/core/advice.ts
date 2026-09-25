import { BLACK } from '../../shared/types';

/**
 * 一手推荐。提示永远按"现在轮到谁"来算，color 必须跟着一起走到界面上：
 * 只说一个坐标，用户没法知道这是建议自己还是建议对手的。
 */
export interface Advice {
  color: 1 | 2;
  move: string;
  /** 引擎给的胜率与目差，都是行棋方视角。 */
  winrate: number;
  scoreLead: number;
}

export function colorName(color: 1 | 2): string {
  return color === BLACK ? '黑' : '白';
}

/** 引擎把停一手写成 pass，本程序内部写成 tt（19 路以下）。 */
export function isPassMove(move: string): boolean {
  return /^(pass|tt)$/i.test(move.trim());
}

/** 目差按"谁领先"说，胜率和目差都在同一句里，视角不会看串。 */
export function leadText(scoreLead: number): string {
  const v = Math.abs(scoreLead) < 0.05 ? 0 : scoreLead;
  if (v === 0) return '形势两分';
  return v > 0 ? `领先 ${v.toFixed(1)} 目` : `落后 ${Math.abs(v).toFixed(1)} 目`;
}

export function adviceLine(a: Advice): string {
  const me = colorName(a.color);
  const move = isPassMove(a.move) ? '停一手' : a.move;
  return `${me}棋推荐 ${move} · ${me}方胜率 ${(a.winrate * 100).toFixed(1)}% · ${leadText(a.scoreLead)}`;
}

/** 状态条上那一条，短一些，别把提子和贴目挤没了。 */
export function adviceChip(a: Advice): string {
  const me = colorName(a.color);
  const move = isPassMove(a.move) ? '停一手' : a.move;
  return `${me}棋推荐 ${move} ${(a.winrate * 100).toFixed(0)}%`;
}
