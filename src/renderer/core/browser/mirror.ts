import { EMPTY, PASS, type Stone } from '../../../shared/types';
import { Position } from '../go/position';

/**
 * 实时截取与自动落子共用的纯逻辑：把"网页上那盘棋"和"本地这盘棋"对上。
 *
 * 这里刻意不碰 DOM、不碰 IPC，全是可以直接喂用例的函数：
 * 识别出来的局面和本地局面到底差在哪、是不是刚好差一手、那一手是哪儿，
 * 以及棋盘上某个交叉点对应网页里的哪个像素。这三件事错一件都会点歪。
 */

export type MirrorPlan =
  /** 两边一模一样，什么都不用做。 */
  | { kind: 'same' }
  /** 刚好差一手棋，这一手可以接到谱上。 */
  | { kind: 'move'; point: number; color: 1 | 2 }
  /** 差得不止一手（换了一盘棋、或者识别漏了几颗）。 */
  | { kind: 'mismatch'; missing: number; extra: number };

function sameCells(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * 看网页上的局面是不是"本地这盘棋刚被下了一手"。
 *
 * 只认"恰好一手"：在本地局面上把轮谁走的那一方挨个点试一遍，点完（含提子、含
 * 劫）跟截图完全一致才算数。这样提子、打劫这些都会自然对上，不会因为盘上少了
 * 几颗子就认不出来。对不上的时候只报差多少颗，绝不自己去改本地棋盘：那可能是
 * 用户在看另一盘棋，也可能只是识别错了一颗。
 */
export function planMirror(
  size: number,
  localCells: ArrayLike<number>,
  localToPlay: 1 | 2,
  capturedCells: ArrayLike<number>
): MirrorPlan {
  if (capturedCells.length !== size * size || localCells.length !== size * size) {
    return { kind: 'mismatch', missing: 0, extra: 0 };
  }
  if (sameCells(localCells, capturedCells)) return { kind: 'same' };

  const base = new Position(size, localToPlay);
  base.cells = Int8Array.from(localCells as ArrayLike<number>);
  for (let i = 0; i < size * size; i++) {
    if (base.cells[i] === EMPTY) {
      const probe = base.clone();
      if (!probe.play(localToPlay, i).ok) continue;
      if (sameCells(probe.cells, capturedCells)) return { kind: 'move', point: i, color: localToPlay };
    }
  }

  // 差得不止一手：分开数"网页上有本地没有的"和"本地有网页上没有的"，
  // 提示里说清楚，用户一眼就知道是多认了还是漏认了。
  let missing = 0;
  let extra = 0;
  for (let i = 0; i < size * size; i++) {
    const a = localCells[i] as Stone;
    const b = capturedCells[i] as Stone;
    if (a === b) continue;
    if (b !== EMPTY && (a === EMPTY || a !== b)) missing += 1;
    if (a !== EMPTY && (b === EMPTY || a !== b)) extra += 1;
  }
  return { kind: 'mismatch', missing, extra };
}

/** 点上去以后那颗子应该在的位置。用来核对这一下到底落上没有。 */
export function expectStone(size: number, cells: ArrayLike<number>, point: number, color: 1 | 2): boolean {
  if (point < 0 || point >= size * size) return false;
  return cells[point] === color;
}

export interface GridLike {
  originX: number;
  originY: number;
  step: number;
  size: number;
}

export interface ViewBox {
  /** 网页视口尺寸，CSS 像素。 */
  width: number;
  height: number;
}

export interface ImageBoxPx {
  /** 截图尺寸，像素。 */
  width: number;
  height: number;
}

/**
 * 交叉点在网页上的点击坐标。
 *
 * 识别出来的网格坐标是"截图里的像素"，而 click 要的是网页的 CSS 像素。
 * 大多数情况下两者 1:1，但显示器缩放、webview 自身的缩放都可能让截图比视口大，
 * 所以按两个尺寸的比值缩一下，不要假设相等。
 */
export function pointToPage(
  grid: GridLike,
  point: number,
  view: ViewBox,
  image: ImageBoxPx
): { x: number; y: number } | null {
  if (grid.size <= 0 || !Number.isFinite(grid.step) || grid.step <= 0) return null;
  const x = point % grid.size;
  const y = Math.floor(point / grid.size);
  if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) return null;
  const sx = image.width > 0 ? view.width / image.width : 1;
  const sy = image.height > 0 ? view.height / image.height : 1;
  return {
    x: (grid.originX + x * grid.step) * sx,
    y: (grid.originY + y * grid.step) * sy
  };
}

/** 引擎/坐标里的弃着：不往网页上点。 */
export function isPassPoint(point: number): boolean {
  return point === PASS;
}
