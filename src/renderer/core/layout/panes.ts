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

/**
 * 棋盘和浏览器各自至少留这么多像素，不然拖到极限会有一边没法用。
 * 浏览器的下限给得比"能显示"稍宽一点：它自己还带着一排标签、地址栏和几个按钮，
 * 保底 320 的时候地址栏还剩下能把域名看全的宽度。
 */
export const MIN_BOARD_PX = 300;
export const MIN_BROWSER_PX = 320;

/**
 * 上下分栏时保底的是高度：棋盘那块得放得下一个能看清的棋盘，
 * 浏览器那块得放得下表头几行。这里保的是"整块"的高度，浏览器自己的标签栏、
 * 地址栏、预设按钮还要吃掉一百来像素，剩下的才是留给网页的。
 */
export const MIN_BOARD_H_PX = 320;
export const MIN_BROWSER_H_PX = 300;

/*
 * 左右分栏的比例范围放得宽一些：大屏上用户想把浏览器拉宽到接近整条中间宽度，
 * 是合理的要求，能不能拉过头由下面那对像素保底管着（棋盘不少于 300，浏览器不少于 320）。
 * 范围收得太紧反而会出现"拖到头了还是那么窄"。
 */
export const SPLIT_MIN = 0.15;
export const SPLIT_MAX = 0.85;
/** 上下分栏的范围窄一些：高度上两头都更容易挤没。 */
export const SPLIT_MIN_Y = 0.3;
export const SPLIT_MAX_Y = 0.8;

export const DEFAULT_LEFT = 248;
export const DEFAULT_RIGHT = 316;
/** 左右分栏时棋盘占中间那块的宽度比例。 */
export const DEFAULT_SPLIT = 0.5;
/** 上下分栏时棋盘占的高度比例：棋盘略大一点，网页横过来也就够了。 */
export const DEFAULT_SPLIT_Y = 0.55;

/**
 * 中间那块的排布方向。x 是棋盘在左、浏览器在右；y 是棋盘在上、浏览器在下。
 *
 * 为什么要给两个方向：中间那块的宽度是有限的，而浏览器是满高的，
 * 光靠左右分栏，窗口不够宽的时候浏览器永远是一条竖着的窄缝，网页会按手机版排。
 * 改成上下分栏，浏览器拿到的是整条中间宽度，才像个正常窗口。
 */
export type SplitAxis = 'x' | 'y';

export interface AxisSpec {
  min: number;
  max: number;
  /** 棋盘那侧的像素保底。 */
  boardPx: number;
  /** 浏览器那侧的像素保底。 */
  browserPx: number;
}

export const AXIS_SPEC: Record<SplitAxis, AxisSpec> = {
  x: { min: SPLIT_MIN, max: SPLIT_MAX, boardPx: MIN_BOARD_PX, browserPx: MIN_BROWSER_PX },
  y: { min: SPLIT_MIN_Y, max: SPLIT_MAX_Y, boardPx: MIN_BOARD_H_PX, browserPx: MIN_BROWSER_H_PX }
};

export function axisSpec(axis: SplitAxis): AxisSpec {
  return AXIS_SPEC[axis] ?? AXIS_SPEC.x;
}

/** 用户的选择：auto 是还没选过，这时按窗口自己挑一个方向。 */
export type AxisChoice = SplitAxis | 'auto';

/** 存盘里的值可能是老版本写的，也可能被手改过，认不出来的一律当"还没选过"。 */
export function toAxisChoice(v: unknown): AxisChoice {
  return v === 'y' || v === 'x' ? v : 'auto';
}

/**
 * 还没选过方向时替用户挑一个。
 *
 * 挑法就一条：左右分栏的时候浏览器会有多宽，比它自己的高度还窄，那摆出来就是一条
 * 竖着的窄缝，网页会按手机版排；这种情况改成上下分栏，浏览器直接拿到整条中间宽度。
 * 挑完用户随时能自己改，改过就不再自动了。
 */
export function pickAxis(ratioX: number, mainWidth: number, height: number): SplitAxis {
  if (height <= 0) return 'x';
  const usable = Math.max(mainWidth - SPLITTER_PX, 1);
  const browserW = (1 - fitSplit(ratioX, mainWidth, 'x')) * usable;
  return browserW < height ? 'y' : 'x';
}

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
 * 棋盘与浏览器的比例，mainSize 是中间那块的实际边长（左右分栏量宽度，上下分栏量高度）。
 * 除了比例本身的范围，还要按像素保底：窗口窄的时候 25% 可能连一百像素都不到，
 * 那种尺寸里的网页是没法用的。
 * 两边保底加起来都超过可用空间时就不讲道理了，退回比例夹取的结果。
 */
export function fitSplit(ratio: number, mainSize: number, axis: SplitAxis = 'x'): number {
  const spec = axisSpec(axis);
  const wanted = clamp(ratio, spec.min, spec.max);
  const usable = mainSize - SPLITTER_PX;
  if (usable < spec.boardPx + spec.browserPx) return wanted;
  const lo = Math.max(spec.min, spec.boardPx / usable);
  const hi = Math.min(spec.max, 1 - spec.browserPx / usable);
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

/**
 * 拖分隔条时显示的提示。写两块各有多少像素，比光给一个百分比好懂：
 * 用户想知道的本来就是"浏览器能拖到多宽"。
 */
export function splitSidesHint(ratio: number, mainSize: number, axis: SplitAxis = 'x'): string {
  const usable = Math.max(mainSize - SPLITTER_PX, 1);
  const board = Math.round(ratio * usable);
  const browser = Math.max(Math.round(usable - board), 0);
  const unit = axis === 'y' ? '高' : '宽';
  return `棋盘${unit} ${board} px · 浏览器${unit} ${browser} px`;
}
