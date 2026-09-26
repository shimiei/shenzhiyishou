/**
 * 外部窗口的坐标换算：画面像素 ↔ 比例框 ↔ 屏幕像素。
 *
 * 放在 shared 里是因为两边都要用：主进程拿它定位落点提示叠层、算真鼠标要点到屏幕哪个点，
 * 界面拿它把用户框的那一块存成比例、下次照着裁。这里全是纯函数，能直接自测。
 *
 * 一条要紧的约定：窗口抓帧给的画面到底是从整个窗口的左上角开始，还是从客户区（去掉标题栏
 * 和边框）开始，各个系统版本不一样。不去猜，拿长宽比跟两个候选矩形比一比，像哪个算哪个。
 */

/** 屏幕上的一块矩形，物理像素（跟 Win32 给的单位一致）。 */
export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 画面里的一块区域，比例（0~1）。存设置、叠层定位都用它，窗口大小变了也还成立。 */
export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 画面像素坐标。 */
export interface FrameSize {
  width: number;
  height: number;
}

export interface FramePoint {
  x: number;
  y: number;
}

/**
 * 框要小到什么程度算误拖。手一抖拖出几个像素的框会把棋盘裁得只剩一个角，
 * 那种框比没有框更坏（认不出来还找不到原因），所以太小的直接当没框。
 */
const MIN_SIDE = 0.04;

export function toNorm(box: PxRect, frame: FrameSize): NormBox | null {
  if (frame.width <= 0 || frame.height <= 0) return null;
  return {
    x: box.x / frame.width,
    y: box.y / frame.height,
    w: box.w / frame.width,
    h: box.h / frame.height
  };
}

/**
 * 比例框换算回这一刻画面的像素框。
 *
 * pad 是按框自身大小外扩的比例：棋盘最外圈那条线也框进去，认网格的时候才有的可依。
 * 用户框得紧是常态，所以这一步不是可选项，默认就往外放一圈。
 */
export function toPx(box: NormBox, frame: FrameSize, pad = 0): PxRect | null {
  if (frame.width <= 0 || frame.height <= 0) return null;
  const x0 = box.x * frame.width;
  const y0 = box.y * frame.height;
  const w0 = box.w * frame.width;
  const h0 = box.h * frame.height;
  if (!(w0 > 1) || !(h0 > 1)) return null;
  const padX = w0 * pad;
  const padY = h0 * pad;
  const left = Math.max(0, Math.round(x0 - padX));
  const top = Math.max(0, Math.round(y0 - padY));
  const right = Math.min(frame.width, Math.round(x0 + w0 + padX));
  const bottom = Math.min(frame.height, Math.round(y0 + h0 + padY));
  if (right - left < 2 || bottom - top < 2) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** 拖出来的那个框能不能用：够大、在图里、坐标是数。不能用就给 null，当作没框。 */
export function usableCrop(box: NormBox | null | undefined): NormBox | null {
  if (!box) return null;
  const vals = [box.x, box.y, box.w, box.h];
  if (vals.some((v) => !Number.isFinite(v))) return null;
  const x = Math.min(Math.max(box.x, 0), 1);
  const y = Math.min(Math.max(box.y, 0), 1);
  const w = Math.min(box.w, 1 - x);
  const h = Math.min(box.h, 1 - y);
  if (w < MIN_SIDE || h < MIN_SIDE) return null;
  return { x, y, w, h };
}

/** 按两点拖出的框（哪个方向拖都行）。 */
export function boxFromDrag(a: FramePoint, b: FramePoint, frame: FrameSize): NormBox | null {
  const box: PxRect = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  };
  return usableCrop(toNorm(box, frame));
}

/**
 * 这一帧画面盖住了屏幕上哪块矩形。
 *
 * 窗口抓帧给的可能是整窗（带标题栏），也可能是客户区，还有可能是被缩放过的（远程桌面那类
 * 画面常常是缩小显示的）。这三种情况下长宽比只有一个跟它一样：跟整窗比、跟客户区比，
 * 谁更接近就是谁。窗口无边框时两个矩形本来就一样，选哪个都对。
 */
export function pickFrameRect(
  frame: FrameSize,
  win: PxRect,
  client: PxRect
): { rect: PxRect; kind: 'window' | 'client' } {
  const aspect = (r: PxRect): number => (r.h > 0 ? r.w / r.h : 0);
  const fa = frame.height > 0 ? frame.width / frame.height : 0;
  const winDiff = Math.abs(fa - aspect(win));
  const clientDiff = Math.abs(fa - aspect(client));
  // 无边框窗口两个一样，直接归到整窗，省得同一个情况两处判断
  const useClient = clientDiff < winDiff - 1e-6;
  return useClient ? { rect: client, kind: 'client' } : { rect: win, kind: 'window' };
}

/**
 * 画面里的一个点，对应屏幕上哪个物理像素点。
 *
 * 按比例映射，所以画面被缩小过（远程桌面窗口就是缩小的）也照样对：棋盘在画面里占几分之几，
 * 点就落在窗口里几分之几的地方。
 */
export function framePointToScreen(
  p: FramePoint,
  frame: FrameSize,
  rect: PxRect
): { x: number; y: number } {
  const sx = frame.width > 0 ? rect.w / frame.width : 1;
  const sy = frame.height > 0 ? rect.h / frame.height : 1;
  return { x: rect.x + p.x * sx, y: rect.y + p.y * sy };
}

/**
 * 画面里的点在它盖住的那块矩形里占几成。
 * 落点提示叠层就铺在这块矩形上，按这个比例画环，于是不用管 DPI、缩放、多屏。
 */
export function frameFraction(p: FramePoint, frame: FrameSize): { x: number; y: number } {
  if (frame.width <= 0 || frame.height <= 0) return { x: 0, y: 0 };
  return {
    x: Math.min(Math.max(p.x / frame.width, 0), 1),
    y: Math.min(Math.max(p.y / frame.height, 0), 1)
  };
}

/**
 * 这一帧画面的比例，跟窗口现在的比例对不对得上。
 *
 * 窗口在这几帧里改过大小的话（比如用户在拖动窗口边缘），画面还是旧尺寸，按比例算出来的
 * 点就会偏，而"点歪了"是点出去之后才知道的事。所以点之前先拿这个挡一道：对不上就这一拍
 * 不点，等下一拍重新认过。默认容差 6%，宽高比从 16:10 变成 4:3 这种一眼能看出的变化会拦下来，
 * 而无边框窗口那种几个像素的差别不拦。
 */
export function frameAspectMatches(frame: FrameSize, rect: PxRect, tol = 0.06): boolean {
  const rectAspect = rect.h > 0 ? rect.w / rect.h : 0;
  const frameAspect = frame.height > 0 ? frame.width / frame.height : 0;
  if (!rectAspect || !frameAspect) return false;
  return Math.abs(frameAspect - rectAspect) / rectAspect <= tol;
}
