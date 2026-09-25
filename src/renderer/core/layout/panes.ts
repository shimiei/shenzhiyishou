/**
 * 分栏尺寸的落地计算。纯函数，和 main/windowState.ts 一个路子：
 * 这类"夹一夹"的逻辑全是边界，只有断言得住才不会在某个窗口宽度下露出半截按钮。
 */

/** 分隔条本身的宽度，算可用空间时要先扣掉。 */
export const SPLITTER_PX = 5;

/** 左栏放得下"结构/手数/注释"三个页签加一个对局信息按钮的下限，实测出来的。 */
export const LEFT_MIN = 214;
export const LEFT_MAX = 420;
/** 右栏是引擎面板的卡片和滑杆，再窄就开始折行。 */
export const RIGHT_MIN = 240;
export const RIGHT_MAX = 520;

/** 棋盘和浏览器各自至少留这么多像素，不然拖到极限会有一边没法用。 */
export const MIN_BOARD_PX = 300;
export const MIN_BROWSER_PX = 260;

export const SPLIT_MIN = 0.25;
export const SPLIT_MAX = 0.75;

export const DEFAULT_LEFT = 248;
export const DEFAULT_RIGHT = 316;
export const DEFAULT_SPLIT = 0.5;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 侧栏宽度：用户拖过就听用户的，但必须给中间留够地方。
 * reserve 是"中间那块至少要多少像素"，剩下的才是这侧栏能占的上限。
 */
export function fitPanelWidth(desired: number, min: number, max: number, windowWidth: number, reserve: number): number {
  const ceiling = Math.max(min, windowWidth - reserve - SPLITTER_PX);
  return Math.round(clamp(desired, min, Math.min(max, ceiling)));
}

/**
 * 棋盘与浏览器的比例。除了比例本身的范围，还要按像素保底：
 * 窗口窄的时候 25% 可能连一百像素都不到，那种宽度里的网页是没法用的。
 * 两边保底加起来都超过可用宽度时就不讲道理了，退回比例夹取的结果。
 */
export function fitSplit(ratio: number, mainWidth: number): number {
  const wanted = clamp(ratio, SPLIT_MIN, SPLIT_MAX);
  const usable = mainWidth - SPLITTER_PX;
  if (usable < MIN_BOARD_PX + MIN_BROWSER_PX) return wanted;
  const lo = Math.max(SPLIT_MIN, MIN_BOARD_PX / usable);
  const hi = Math.min(SPLIT_MAX, 1 - MIN_BROWSER_PX / usable);
  if (lo > hi) return wanted;
  return clamp(wanted, lo, hi);
}

/** 拖动分隔条时的提示文字，给用户看清楚现在多宽。 */
export function pxHint(value: number): string {
  return `${Math.round(value)} px`;
}

export function percentHint(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
