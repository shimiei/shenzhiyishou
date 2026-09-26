/**
 * 自测用的合成棋盘：按几种真见过的渲染风格现画一张棋盘出来。
 * 说明见 tools/cv-test.ts，由它和 tools/cv-selftest.mjs 使用。
 */

import { recognizeBoard, type ImageBox, type RecognizeResult } from '../src/renderer/core/cv/recognize';

export type RGB = [number, number, number];

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

const LETTERS = 'ABCDEFGHJKLMNOPQRST';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export type Stop = [number, RGB];

function gradientAt(stops: Stop[], t: number): RGB {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      return mix(c0, c1, (t - t0) / Math.max(1e-6, t1 - t0));
    }
  }
  return stops[stops.length - 1][1];
}

export interface Canvas {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function blend(buf: Uint8ClampedArray, width: number, x: number, y: number, color: RGB, alpha: number): void {
  if (alpha <= 0) return;
  const p = (y * width + x) * 4;
  const a = Math.min(1, alpha);
  buf[p] = buf[p] + (color[0] - buf[p]) * a;
  buf[p + 1] = buf[p + 1] + (color[1] - buf[p + 1]) * a;
  buf[p + 2] = buf[p + 2] + (color[2] - buf[p + 2]) * a;
  buf[p + 3] = 255;
}

export interface Style {
  name: string;
  /** 底色（木色）与可选的纵向渐变。 */
  wood: RGB;
  woodTo?: RGB;
  /** 格线颜色与不透明度。 */
  line: RGB;
  lineAlpha: number;
  /** 棋子半径占步长的比例。 */
  stoneRatio: number;
  black: Stop[];
  white: Stop[];
  /** 描边：颜色与不透明度，占半径的比例位置。 */
  outline?: { color: RGB; alpha: number; at: number };
  /** 木纹噪声幅度（0 到 255）。 */
  grain: number;
  /** 棋盘外的留白（渲染单位）。 */
  margin: number;
  /** 每格像素数；越小越像被压过的截图。 */
  step: number;
  /** 格线宽度占步长的比例（实测客户端画得挺粗，压过一道以后还得能看出来）。 */
  lineRatio: number;
  /** 有的客户端把格线画在棋子上层，棋子身上会透出一道线。 */
  linesOverStones?: boolean;
  /** 画完再整体缩小到这个比例，模拟截图被缩过一道。 */
  shrink: number;
  starRatio: number;
}

export const STYLES: Style[] = [
  {
    // 网页客户端：亮橙木色 + 蓝格线 + 白子是有明暗的灰球面，截图被压过一道
    name: '亮木色客户端',
    wood: [254, 189, 115],
    woodTo: [244, 178, 104],
    line: [104, 151, 198],
    lineAlpha: 1,
    stoneRatio: 0.46,
    black: [[0, [110, 110, 118]], [0.35, [40, 42, 48]], [1, [12, 14, 18]]],
    // 实测这种客户端的白子是“亮处接近纯白、球面主体发灰”，
    // 整圈取样的中位亮度落在 190 上下，比木色（200）还低一点
    white: [[0, [250, 250, 250]], [0.25, [225, 225, 225]], [0.6, [190, 190, 190]], [1, [172, 172, 172]]],
    outline: { color: [120, 120, 112], alpha: 0.45, at: 1 },
    grain: 6,
    margin: 40,
    step: 22,
    lineRatio: 0.2,
    shrink: 0.45,
    starRatio: 0.09
  },
  {
    // 同一个客户端，但格线画在棋子上层：棋子身上会横过一道蓝线，白子的取样会被污染
    name: '格线压在白子上',
    wood: [254, 189, 115],
    woodTo: [244, 178, 104],
    line: [104, 151, 198],
    lineAlpha: 1,
    stoneRatio: 0.46,
    linesOverStones: true,
    black: [[0, [110, 110, 118]], [0.35, [40, 42, 48]], [1, [12, 14, 18]]],
    white: [[0, [250, 250, 250]], [0.25, [225, 225, 225]], [0.6, [190, 190, 190]], [1, [172, 172, 172]]],
    outline: { color: [120, 120, 112], alpha: 0.45, at: 1 },
    grain: 6,
    margin: 40,
    step: 22,
    lineRatio: 0.2,
    shrink: 0.45,
    starRatio: 0.09
  },
  {
    // 本机页面：颜色偏饱和，白子最亮处纯白、靠外圈发灰
    name: '本机页面木色',
    wood: [220, 179, 92],
    woodTo: [211, 169, 79],
    line: [78, 50, 14],
    lineAlpha: 0.78,
    stoneRatio: 0.46,
    black: [[0, [106, 106, 114]], [0.45, [36, 36, 41]], [1, [10, 10, 13]]],
    white: [[0, [255, 255, 255]], [0.6, [242, 242, 240]], [1, [207, 207, 200]]],
    outline: { color: [120, 120, 110], alpha: 0.55, at: 1 },
    grain: 5,
    margin: 44,
    step: 26,
    lineRatio: 0.06,
    shrink: 0.5,
    starRatio: 0.09
  },
  {
    // 照片：偏暗的木色，白子接近平色，颗粒明显，没有缩小
    name: '照片木盘',
    wood: [196, 156, 104],
    woodTo: [172, 132, 84],
    line: [62, 44, 24],
    lineAlpha: 0.85,
    stoneRatio: 0.45,
    black: [[0, [90, 90, 92]], [0.4, [46, 46, 48]], [1, [24, 24, 26]]],
    white: [[0, [252, 251, 248]], [0.7, [242, 241, 236]], [1, [214, 212, 204]]],
    grain: 12,
    margin: 52,
    step: 30,
    lineRatio: 0.05,
    shrink: 1,
    starRatio: 0.09
  },
  {
    // 浅底棋盘（打印图、浅灰界面）：底色没什么彩色，白子靠亮度分
    name: '浅底棋盘',
    wood: [231, 227, 217],
    line: [90, 88, 84],
    lineAlpha: 0.9,
    stoneRatio: 0.45,
    black: [[0, [70, 70, 70]], [1, [18, 18, 18]]],
    white: [[0, [255, 255, 255]], [0.8, [250, 250, 250]], [1, [236, 236, 234]]],
    grain: 3,
    margin: 40,
    step: 24,
    lineRatio: 0.05,
    shrink: 1,
    starRatio: 0.08
  }
];

export interface Fixture {
  style: Style;
  points: Array<[number, number, number]>;
}

export const PATTERN: Array<[string, number]> = [
  ['D4', BLACK], ['Q4', BLACK], ['D16', BLACK], ['Q16', BLACK],
  ['K10', BLACK], ['C10', BLACK], ['R10', BLACK], ['Q10', BLACK],
  ['D10', BLACK], ['F5', BLACK], ['Q14', BLACK], ['D14', BLACK],
  ['C6', WHITE], ['R6', WHITE], ['C14', WHITE], ['R14', WHITE],
  ['Q5', WHITE], ['D5', WHITE], ['K16', WHITE], ['K4', WHITE],
  ['F17', WHITE], ['C3', WHITE], ['R17', WHITE], ['Q12', WHITE]
];

export function toPoint(label: string, size: number): [number, number] {
  const x = LETTERS.indexOf(label[0].toUpperCase());
  const y = size - parseInt(label.slice(1), 10);
  return [x, y];
}

export function patternPoints(size: number, blackOnly: boolean): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const [label, color] of PATTERN) {
    if (blackOnly && color === WHITE) continue;
    const [x, y] = toPoint(label, size);
    // 小棋盘上摆不下的坐标直接跳过，别画到棋盘外面去
    if (x < 0 || y < 0 || x >= size || y >= size) continue;
    out.push([x, y, color]);
  }
  return out;
}

export function renderBoard(style: Style, size: number, points: Array<[number, number, number]>, seed: number): Canvas {
  const w = Math.round(style.margin * 2 + (size - 1) * style.step);
  const h = w;
  const buf = new Uint8ClampedArray(w * h * 4);
  const rnd = mulberry32(seed);
  for (let y = 0; y < h; y++) {
    const base = style.woodTo ? mix(style.wood, style.woodTo, y / (h - 1)) : style.wood;
    for (let x = 0; x < w; x++) {
      const n = (rnd() - 0.5) * style.grain + Math.sin(x * 0.07 + y * 0.021) * style.grain * 0.35;
      const p = (y * w + x) * 4;
      buf[p] = base[0] + n;
      buf[p + 1] = base[1] + n * 0.9;
      buf[p + 2] = base[2] + n * 0.7;
      buf[p + 3] = 255;
    }
  }
  // 格线按整数像素实心画：网页客户端就是这么画的（高清屏上一两条像素），
  // 再叠上后面的缩小，才会得到真实截图里那种偏淡但仍看得出来的线
  const at = (i: number): number => style.margin + i * style.step;
  const lw = Math.max(1, Math.round(style.step * style.lineRatio));
  const half = Math.floor(lw / 2);
  const drawLines = (): void => {
    for (let i = 0; i < size; i++) {
      const c = Math.round(at(i));
      for (let k = 0; k < h; k++) {
        for (let d = -half; d < lw - half; d++) {
          blend(buf, w, c + d, k, style.line, style.lineAlpha);
          blend(buf, w, k, c + d, style.line, style.lineAlpha);
        }
      }
    }
  };
  drawLines();
  const star = style.step * style.starRatio;
  const starAt = size === 19 ? [3, 9, 15] : size === 13 ? [3, 6, 9] : [2, 4, 6];
  for (const sy of starAt) {
    for (const sx of starAt) {
      const cx = at(sx);
      const cy = at(sy);
      for (let y = Math.floor(cy - star); y <= Math.ceil(cy + star); y++) {
        for (let x = Math.floor(cx - star); x <= Math.ceil(cx + star); x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const d = Math.hypot(x - cx, y - cy);
          blend(buf, w, x, y, style.line, Math.max(0, Math.min(1, star + 0.5 - d)) * style.lineAlpha);
        }
      }
    }
  }
  const r = style.step * style.stoneRatio;
  for (const [gx, gy, color] of points) {
    const cx = at(gx);
    const cy = at(gy);
    const stops = color === BLACK ? style.black : style.white;
    const hx = cx - r * 0.28;
    const hy = cy - r * 0.32;
    for (let y = Math.floor(cy - r - 2); y <= Math.ceil(cy + r + 2); y++) {
      for (let x = Math.floor(cx - r - 2); x <= Math.ceil(cx + r + 2); x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d > r + 1) continue;
        const t = Math.min(1, Math.hypot(x - hx, y - hy) / r);
        const color2 = gradientAt(stops, t);
        let alpha = Math.max(0, Math.min(1, r + 0.5 - d));
        blend(buf, w, x, y, color2, alpha);
        if (style.outline) {
          const o = style.outline;
          const ring = Math.abs(d - r * o.at);
          alpha = Math.max(0, Math.min(1, 1 - ring)) * o.alpha;
          blend(buf, w, x, y, o.color, alpha);
        }
      }
    }
  }
  if (style.linesOverStones) drawLines();
  return downscale({ data: buf, width: w, height: h }, style.shrink);
}

function downscale(canvas: Canvas, factor: number): Canvas {
  if (factor >= 1) return canvas;
  const w = Math.max(1, Math.round(canvas.width * factor));
  const h = Math.max(1, Math.round(canvas.height * factor));
  const out = new Uint8ClampedArray(w * h * 4);
  const sw = canvas.width / w;
  const sh = canvas.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sh);
    const y1 = Math.min(canvas.height, Math.max(y0 + 1, Math.ceil((y + 1) * sh)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sw);
      const x1 = Math.min(canvas.width, Math.max(x0 + 1, Math.ceil((x + 1) * sw)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const p = (yy * canvas.width + xx) * 4;
          r += canvas.data[p];
          g += canvas.data[p + 1];
          b += canvas.data[p + 2];
          n += 1;
        }
      }
      const p = (y * w + x) * 4;
      out[p] = r / n;
      out[p + 1] = g / n;
      out[p + 2] = b / n;
      out[p + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

