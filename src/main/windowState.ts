/**
 * 窗口位置与尺寸的落地计算。
 *
 * 单独拆出来是因为这里全是边界情况，而且只有纯函数才好断言：
 * 换屏幕、拔掉副屏、改过系统缩放之后，settings.json 里记着的坐标可能已经落在看不见的地方，
 * 直接照着开就会出现"窗口打不开"或者"只剩一条边在屏幕上"的样子。
 * 更要紧的一条：窗口不能开得比工作区还大，那样连标题栏带边框都在屏幕外，用户根本没法拖回来。
 */

export interface SavedWindowBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  maximized?: boolean;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FitOptions {
  minWidth: number;
  minHeight: number;
  defaultWidth: number;
  defaultHeight: number;
  /** 工作区列表，第一项当主屏用。 */
  workAreas: Box[];
}

export interface FittedWindow {
  bounds: Box;
  maximized: boolean;
}

/** 窗口至少要有这么多像素留在屏幕里，否则鼠标够不到标题栏，等于关不掉也拖不动。 */
const MIN_VISIBLE = 120;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 算出这次该用什么位置、多大、要不要最大化。
 * saved 里没有位置信息（第一次启动）就按默认尺寸居中。
 */
export function fitWindow(saved: SavedWindowBounds, opt: FitOptions): FittedWindow {
  const areas = opt.workAreas.filter((a) => a.width > 0 && a.height > 0);
  if (areas.length === 0) {
    const width = Math.max(opt.minWidth, Math.round(saved.width ?? opt.defaultWidth));
    const height = Math.max(opt.minHeight, Math.round(saved.height ?? opt.defaultHeight));
    return { bounds: { x: 0, y: 0, width, height }, maximized: false };
  }

  const primary = areas[0];
  const fitSize = (area: Box): { width: number; height: number } => ({
    // 尺寸夹进工作区：比屏幕还大的窗口，边和角都在屏幕外，拖不动。
    width: clamp(Math.round(saved.width ?? opt.defaultWidth), opt.minWidth, Math.max(opt.minWidth, area.width)),
    height: clamp(Math.round(saved.height ?? opt.defaultHeight), opt.minHeight, Math.max(opt.minHeight, area.height))
  });
  const centerIn = (area: Box, size: { width: number; height: number }): Box => ({
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + (area.height - size.height) / 2),
    ...size
  });

  const maximized = Boolean(saved.maximized);
  if (!isNum(saved.x) || !isNum(saved.y)) {
    return { bounds: centerIn(primary, fitSize(primary)), maximized };
  }

  // 先按主屏夹一遍尺寸，用这个矩形去认窗口本来在哪块屏幕上。
  const first = fitSize(primary);
  const rect: Box = { x: Math.round(saved.x), y: Math.round(saved.y), ...first };
  const overlapOf = (a: Box): { x: number; y: number } => ({
    x: Math.max(0, Math.min(rect.x + rect.width, a.x + a.width) - Math.max(rect.x, a.x)),
    y: Math.max(0, Math.min(rect.y + rect.height, a.y + a.height) - Math.max(rect.y, a.y))
  });

  let host: Box | null = null;
  let best = 0;
  for (const a of areas) {
    const o = overlapOf(a);
    const area = o.x * o.y;
    if (area > best) {
      best = area;
      host = a;
    }
  }

  // 露得太少就等于看不见，这时候回主屏居中，别让窗口留在屏幕缝里。
  const needX = Math.min(rect.width, MIN_VISIBLE);
  const needY = Math.min(rect.height, MIN_VISIBLE);
  if (!host) return { bounds: centerIn(primary, first), maximized };
  const seen = overlapOf(host);
  if (seen.x < needX || seen.y < needY) return { bounds: centerIn(primary, first), maximized };

  // 认下来的那块屏幕如果更小（副屏常常更矮），尺寸要按它的工作区再夹一次。
  const size = fitSize(host);
  const x = clamp(rect.x, host.x - size.width + MIN_VISIBLE, host.x + host.width - MIN_VISIBLE);
  const y = clamp(rect.y, host.y, host.y + host.height - MIN_VISIBLE);
  return { bounds: { x: Math.round(x), y: Math.round(y), ...size }, maximized };
}
