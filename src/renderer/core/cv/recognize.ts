/**
 * 棋盘识别：从截图或照片中定位棋盘、拟合网格、判断每个交叉点的黑白。
 * 思路来自验证过的 Python 版本：木色定位 -> 网格线检测 -> 网格拟合 -> 环形取样。
 * 关键改进是背景色估计：不再只依赖直方图众数（棋子颜色往往比木色更集中，会把众数带偏），
 * 而是用棋盘边距取样、众数、中位数三路互证，取一致的结果。
 */

export interface ImageBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RecognizeOptions {
  /** 指定路数，0 表示自动判断。 */
  expectedSize?: number;
  /** 用户手动框选的棋盘区域，坐标以原图像素为单位。 */
  crop?: ImageBox | null;
  /** 认出一块空盘也算成功（实时截取开局时要用），默认不算。 */
  allowEmpty?: boolean;
}

export interface GridFit {
  originX: number;
  originY: number;
  step: number;
  size: number;
  uniformity: number;
  strategy: string;
}

export interface PointStat {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  lum: number;
  sat: number;
  value: number;
  margin: number;
  /** 整圈取样里“无色又不暗”的比例，白子的第二条判法就是看它（底色没彩色时是 0）。 */
  pale: number;
}

export interface RecognizeDiagnostics {
  boardRect: ImageBox;
  grid: GridFit;
  backgroundLum: number;
  backgroundSat: number;
  backgroundSource: string;
  /** 底色有色时启用了“白子掉了色”这条判法（底色没什么彩色时用不了）。 */
  paleRule: boolean;
  usedCrop: boolean;
  pointStats: PointStat[];
}

export interface Suspect {
  x: number;
  y: number;
  lum: number;
  sat: number;
  guess: number;
}

export interface RecognizeResult {
  ok: boolean;
  size: number;
  /** 长度 size*size，0 空 1 黑 2 白。 */
  stones: number[];
  confidence: number;
  suspects: Suspect[];
  diagnostics: RecognizeDiagnostics | null;
  message: string;
}

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface PixelStats {
  lum: Float32Array;
  r: Uint8ClampedArray;
  g: Uint8ClampedArray;
  b: Uint8ClampedArray;
  width: number;
  height: number;
}

function extractStats(img: ImageData): PixelStats {
  const { width, height, data } = img;
  const n = width * height;
  const lum = new Float32Array(n);
  const r = new Uint8ClampedArray(n);
  const g = new Uint8ClampedArray(n);
  const b = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const rr = data[p];
    const gg = data[p + 1];
    const bb = data[p + 2];
    r[i] = rr;
    g[i] = gg;
    b[i] = bb;
    lum[i] = luminance(rr, gg, bb);
  }
  return { lum, r, g, b, width, height };
}

interface Sample {
  r: number;
  g: number;
  b: number;
  lum: number;
  sat: number;
  n: number;
  /** 各次取样的亮度与彩度。白子要数“整圈里有多少是无色而亮的”，光看中位数不够。 */
  lums: number[];
  sats: number[];
  /** 各次取样落在哪个像素上，用来把压在棋子上的格线挑出去。 */
  xs: number[];
  ys: number[];
}

function sampleRing(stats: PixelStats, cx: number, cy: number, radius: number, samples = 36): Sample {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const lums: number[] = [];
  const sats: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = 0; k < samples; k++) {
    const a = (k / samples) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * radius);
    const y = Math.round(cy + Math.sin(a) * radius);
    if (x < 0 || y < 0 || x >= stats.width || y >= stats.height) continue;
    const i = y * stats.width + x;
    rs.push(stats.r[i]);
    gs.push(stats.g[i]);
    bs.push(stats.b[i]);
    lums.push(stats.lum[i]);
    sats.push(Math.max(stats.r[i], stats.g[i], stats.b[i]) - Math.min(stats.r[i], stats.g[i], stats.b[i]));
    xs.push(x);
    ys.push(y);
  }
  const r = medianOf(rs);
  const g = medianOf(gs);
  const b = medianOf(bs);
  return {
    r,
    g,
    b,
    lum: luminance(r, g, b),
    sat: Math.max(r, g, b) - Math.min(r, g, b),
    n: rs.length,
    lums,
    sats,
    xs,
    ys
  };
}

/**
 * 整圈取样里“无色（彩度低）又不太暗”的像素占多少。
 *
 * 白子是一颗有明暗的球：亮处接近纯白，背光那半边能暗到跟木色一个水平，
 * 只用中位数会被背光半边拖下去。但整圈里绝大多数像素有个共同点：它们没有颜色，
 * 而棋盘底色（木色）恰恰很有颜色，于是“掉了色”这个特征比亮度可靠得多。
 *
 * 格线压在白子上层的客户端（实测就有这种），棋子身上会横过一道彩色的线，
 * 这一小撮像素既不是棋子本色也不算数，交给 ignore 挑出去。
 */
function paleFraction(
  sample: Sample,
  satCut: number,
  lumCut: number,
  ignore: (x: number, y: number) => boolean
): number {
  let hit = 0;
  let count = 0;
  for (let i = 0; i < sample.lums.length; i++) {
    if (ignore(sample.xs[i], sample.ys[i])) continue;
    count += 1;
    if (sample.sats[i] < satCut && sample.lums[i] > lumCut) hit += 1;
  }
  return count === 0 ? 0 : hit / count;
}

/** 木色区域检测，返回棋盘色块范围。 */
function detectWoodRegion(stats: PixelStats, box: ImageBox): ImageBox | null {
  const { lum, r, g, b, width } = stats;
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(stats.width - 1, Math.floor(box.x + box.w - 1));
  const y1 = Math.min(stats.height - 1, Math.floor(box.y + box.h - 1));
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w < 60 || h < 60) return null;

  const colCount = new Int32Array(w);
  const rowCount = new Int32Array(h);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * width + x;
      const l = lum[i];
      if (r[i] > g[i] && g[i] >= b[i] && r[i] - b[i] > 18 && l > 70 && l < 248) {
        colCount[x - x0] += 1;
        rowCount[y - y0] += 1;
      }
    }
  }
  let maxCol = 0;
  let maxRow = 0;
  for (let i = 0; i < w; i++) maxCol = Math.max(maxCol, colCount[i]);
  for (let i = 0; i < h; i++) maxRow = Math.max(maxRow, rowCount[i]);
  if (maxCol < h * 0.3 || maxRow < w * 0.3) return null;

  const pickRange = (counts: Int32Array, threshold: number): [number, number] | null => {
    let a = -1;
    let bIdx = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] > threshold) {
        if (a < 0) a = i;
        bIdx = i;
      }
    }
    return a < 0 ? null : [a, bIdx];
  };
  const cx = pickRange(colCount, maxCol * 0.5);
  const cy = pickRange(rowCount, maxRow * 0.5);
  if (!cx || !cy) return null;
  const rect: ImageBox = { x: x0 + cx[0], y: y0 + cy[0], w: cx[1] - cx[0] + 1, h: cy[1] - cy[0] + 1 };
  if (rect.w < 80 || rect.h < 80) return null;
  return rect;
}

function groupCenters(profile: Int32Array, extent: number, minCoverage: number, edgeTrim: number): number[] {
  const threshold = extent * minCoverage;
  const idx: number[] = [];
  for (let i = 0; i < profile.length; i++) if (profile[i] > threshold) idx.push(i);
  if (idx.length === 0) return [];
  const groups: number[][] = [];
  let cur: number[] = [idx[0]];
  for (let k = 1; k < idx.length; k++) {
    if (idx[k] - idx[k - 1] <= 3) cur.push(idx[k]);
    else {
      groups.push(cur);
      cur = [idx[k]];
    }
  }
  groups.push(cur);
  const last = profile.length - 1;
  // 贴着选区边缘的那一整块，通常不是棋盘的线，而是选区比棋盘大出来的背景或边框
  // （实测截图里棋盘四周各多出十来个像素的深色底，会被当成两条“粗线”混进拟合）。
  const inner = groups.filter((g) => g[0] > edgeTrim && g[g.length - 1] < last - edgeTrim);
  return inner.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

/**
 * 沿一个方向的“线中心”检测。
 *
 * 做法是数每一列里有多少像素算“暗”（对方向翻转后同理数行）。棋盘格线整条贯穿，
 * 一列能数到大半的高度，棋子最多只盖住一部分，于是格线列会明显跳出来。
 *
 * 阈值必须相对底色自适应。缩放过的截图里抗锯齿会把同一条棋盘上的线削弱成两档，
 * 实测强线亮度 77、弱线 105、木色底 146；原来固定按底色的 0.66 取，只认得出强线，
 * 结果网格被按“每两条线取一条”拟合，19 路棋盘的线数正好凑成 9，就认成了 9 路。
 */
function lineCenters(counts: Int32Array, extent: number, edgeTrim: number): number[] {
  return groupCenters(counts, extent, 0.55, edgeTrim);
}

interface Lattice {
  origin: number;
  step: number;
  size: number;
  uniformity: number;
  matched: number;
}

function fitLattice(centers: number[], expected: number): Lattice | null {
  if (centers.length < 5) return null;
  const diffs: number[] = [];
  for (let i = 1; i < centers.length; i++) diffs.push(centers[i] - centers[i - 1]);
  const sorted = diffs.slice().sort((a, b) => a - b);
  const p60 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.6))];
  const small = diffs.filter((d) => d <= p60 && d > 0);
  if (small.length === 0) return null;
  const s0 = medianOf(small);
  if (!(s0 > 2)) return null;
  const span = centers[centers.length - 1] - centers[0];
  const raw = Math.round(span / s0) + 1;
  const candidates: number[] = [];
  for (const n of [raw - 1, raw, raw + 1, 9, 13, 19]) if (n >= 5 && n <= 25 && !candidates.includes(n)) candidates.push(n);

  let best: (Lattice & { score: number; cover: number }) | null = null;
  const passing: Array<Lattice & { score: number; cover: number }> = [];
  for (const n of candidates) {
    if (expected && n !== expected) continue;
    if (n !== 9 && n !== 13 && n !== 19) continue;
    const step = span / (n - 1);
    if (!(step > 4)) continue;
    const idxs: number[] = [];
    const vals: number[] = [];
    for (const c of centers) {
      const k = Math.round((c - centers[0]) / step);
      if (k < 0 || k >= n) continue;
      if (Math.abs(c - (centers[0] + k * step)) <= 0.28 * step) {
        idxs.push(k);
        vals.push(c);
      }
    }
    if (idxs.length < n * 0.6) continue;
    const m = idxs.length;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < m; i++) {
      sx += idxs[i];
      sy += vals[i];
      sxx += idxs[i] * idxs[i];
      sxy += idxs[i] * vals[i];
    }
    const denom = m * sxx - sx * sx;
    if (Math.abs(denom) < 1e-6) continue;
    const bb = (m * sxy - sx * sy) / denom;
    const aa = (sy - bb * sx) / m;
    if (!(bb > 4)) continue;
    let err = 0;
    for (let i = 0; i < m; i++) err += Math.abs(vals[i] - (aa + bb * idxs[i]));
    err /= m;
    const uniformity = Math.max(0, 1 - err / bb);
    const cover = m / n;
    const score = uniformity * (0.5 + 0.5 * cover);
    const entry = { origin: aa, step: bb, size: n, uniformity, score, cover, matched: m };
    passing.push(entry);
    if (!best || score > best.score) best = entry;
  }

  // 差一倍的错最要命（19 路被认成 9 路），所以只要细网格能对上大部分线，
  // 就不要再退回粗的。9 路棋盘用 19 路去拟合最多只能对上不到一半的线，
  // 不会被这条规则误伤。
  const strong = passing.filter((c) => c.cover >= 0.7 && c.uniformity >= 0.85);
  if (strong.length > 0) {
    strong.sort((a, b) => b.size - a.size);
    best = strong[0];
  }
  return best
    ? { origin: best.origin, step: best.step, size: best.size, uniformity: best.uniformity, matched: best.matched }
    : null;
}

function detectGrid(stats: PixelStats, rect: ImageBox, expected: number): GridFit | null {
  const { lum, width } = stats;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(stats.width - 1, Math.floor(rect.x + rect.w - 1));
  const y1 = Math.min(stats.height - 1, Math.floor(rect.y + rect.h - 1));
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w < 60 || h < 60) return null;

  const sampleLum: number[] = [];
  const stride = Math.max(1, Math.floor(Math.min(w, h) / 120));
  for (let y = y0; y <= y1; y += stride) for (let x = x0; x <= x1; x += stride) sampleLum.push(lum[y * width + x]);
  const bg = medianOf(sampleLum);
  // 底色往下留出一截就算线：留得太少会漏掉被缩放削弱的线，留得太多会把阴影算进来。
  const darkCut = bg - Math.max(10, bg * 0.16);

  const strategies: Array<{ name: string; test: (l: number) => boolean }> = [
    { name: 'dark-line', test: (l) => l < darkCut },
    { name: 'contrast-line', test: (l) => Math.abs(l - bg) > Math.max(20, bg * 0.32) },
    { name: 'deeper-line', test: (l) => l < Math.min(darkCut, bg * 0.5) }
  ];

  let best: (GridFit & { score: number }) | null = null;
  for (const strat of strategies) {
    const colCount = new Int32Array(w);
    const rowCount = new Int32Array(h);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (strat.test(lum[y * width + x])) {
          colCount[x - x0] += 1;
          rowCount[y - y0] += 1;
        }
      }
    }
    const cols = fitLattice(lineCenters(colCount, h, 3), expected);
    const rows = fitLattice(lineCenters(rowCount, w, 3), expected);
    if (!cols || !rows || cols.size !== rows.size) continue;
    const grid: GridFit = {
      originX: x0 + cols.origin,
      originY: y0 + rows.origin,
      step: (cols.step + rows.step) / 2,
      size: cols.size,
      uniformity: (cols.uniformity + rows.uniformity) / 2,
      strategy: strat.name
    };
    // 参与比较的不只是“拟合得多齐”，还有“解释了多少条线”。否则用某个策略
    // 只认出一半的线时，反而因为那半数线排得格外整齐而胜出。
    const explained = (cols.matched + rows.matched) / 2 / 19;
    const score = grid.uniformity * (0.5 + 0.5 * Math.min(1, explained));
    if (!best || score > best.score) best = { ...grid, score };
  }
  return best;
}

interface BgGuess {
  lum: number;
  sat: number;
  source: string;
}

function clampBox(stats: PixelStats, rect: ImageBox): ImageBox {
  return {
    x: Math.max(0, rect.x),
    y: Math.max(0, rect.y),
    w: Math.min(stats.width - Math.max(0, rect.x), rect.w),
    h: Math.min(stats.height - Math.max(0, rect.y), rect.h)
  };
}

/** 从棋盘边距取样，边距处一定是空的棋盘底色。 */
function marginGuess(stats: PixelStats, grid: GridFit, rect: ImageBox): BgGuess | null {
  const box = clampBox(stats, rect);
  const offset = grid.step * 0.7;
  const samples: Sample[] = [];
  const push = (cx: number, cy: number): void => {
    const margin = Math.min(
      cx - box.x,
      cy - box.y,
      box.x + box.w - cx,
      box.y + box.h - cy
    );
    if (margin < 3) return;
    const s = sampleRing(stats, cx, cy, Math.max(2, grid.step * 0.1), 16);
    if (s.n >= 8) samples.push(s);
  };
  const x0 = grid.originX;
  const y0 = grid.originY;
  const xN = grid.originX + (grid.size - 1) * grid.step;
  const yN = grid.originY + (grid.size - 1) * grid.step;
  for (let k = 0; k < grid.size; k++) {
    push(x0 + k * grid.step, y0 - offset);
    push(x0 + k * grid.step, yN + offset);
    push(x0 - offset, y0 + k * grid.step);
    push(xN + offset, y0 + k * grid.step);
  }
  if (samples.length < 12) return null;
  const lums = samples.map((s) => s.lum);
  const med = medianOf(lums);
  const mad = medianOf(lums.map((v) => Math.abs(v - med)));
  if (mad > 26) return null;
  const near = samples.filter((s) => Math.abs(s.lum - med) < 30);
  return { lum: med, sat: medianOf(near.map((s) => s.sat)), source: '边距取样' };
}

/** 众数估计，但拒绝落在亮度两端的众数（棋子往往比底色更集中）。 */
function modeGuess(lums: number[], sats: number[], minLum: number, maxLum: number): BgGuess | null {
  const hist = new Map<number, number>();
  for (const l of lums) {
    const bin = Math.round(l / 6) * 6;
    hist.set(bin, (hist.get(bin) ?? 0) + 1);
  }
  let bestBin = 0;
  let bestCount = -1;
  for (const [bin, count] of hist) {
    if (count > bestCount) {
      bestCount = count;
      bestBin = bin;
    }
  }
  if (bestCount < lums.length * 0.12) return null;
  if (bestBin <= minLum + 6 || bestBin >= maxLum - 6) return null;
  const idx: number[] = [];
  for (let i = 0; i < lums.length; i++) {
    if (Math.abs(lums[i] - bestBin) <= 9) idx.push(i);
  }
  return { lum: medianOf(idx.map((i) => lums[i])), sat: medianOf(idx.map((i) => sats[i])), source: '亮度众数' };
}

function medianGuess(lums: number[], sats: number[]): BgGuess {
  const med = medianOf(lums);
  const near: number[] = [];
  for (let i = 0; i < lums.length; i++) if (Math.abs(lums[i] - med) < 24) near.push(sats[i]);
  return { lum: med, sat: medianOf(near.length ? near : sats), source: '亮度中位数' };
}

function chooseBackground(
  lums: number[],
  sats: number[],
  margin: BgGuess | null
): BgGuess {
  const sortedL = lums.slice().sort((a, b) => a - b);
  const minLum = sortedL[0];
  const maxLum = sortedL[sortedL.length - 1];
  const mode = modeGuess(lums, sats, minLum, maxLum);
  const med = medianGuess(lums, sats);
  const candidates: BgGuess[] = [];
  if (margin) candidates.push(margin);
  if (mode) candidates.push(mode);
  candidates.push(med);
  // 多路一致时取彼此接近的一组的中位数；不一致时优先边距，其次众数，最后中位数
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (Math.abs(candidates[i].lum - candidates[j].lum) < 26) {
        const pick = margin && Math.abs(margin.lum - candidates[i].lum) < 40 ? margin : candidates[i];
        return { lum: (candidates[i].lum + candidates[j].lum) / 2, sat: pick.sat, source: `${candidates[i].source}+${candidates[j].source}` };
      }
    }
  }
  return candidates[0];
}

export function recognizeBoard(img: ImageData, opts: RecognizeOptions = {}): RecognizeResult {
  const expected = opts.expectedSize ?? 0;
  const full: ImageBox = { x: 0, y: 0, w: img.width, h: img.height };
  const stats = extractStats(img);

  let searchBox = opts.crop ? { ...opts.crop } : full;
  let usedCrop = Boolean(opts.crop);
  if (!opts.crop) {
    const wood = detectWoodRegion(stats, full);
    if (wood) searchBox = wood;
  }

  let grid = detectGrid(stats, searchBox, expected);
  if (!grid && !opts.crop) {
    grid = detectGrid(stats, full, expected);
    if (grid) searchBox = full;
  }
  if (!grid) {
    return {
      ok: false,
      size: 0,
      stones: [],
      confidence: 0,
      suspects: [],
      diagnostics: null,
      message: '没能识别出棋盘网格。请在图上手动框选棋盘范围后再试，或确认截图里棋盘完整、无遮挡。'
    };
  }
  if (grid.uniformity < 0.6) {
    return {
      ok: false,
      size: 0,
      stones: [],
      confidence: 0,
      suspects: [],
      diagnostics: null,
      message: `网格拟合误差偏大（均匀度 ${(grid.uniformity * 100).toFixed(0)}%），可能截图被缩放或裁剪，请手动框选棋盘。`
    };
  }
  // 棋盘被画面裁掉时，拟合出来的"最外圈线"会贴到图像边缘，此时路数是编出来的：
  // 19 路被切掉右边一半，网格会顺着可见的线凑出一个 9 路或 13 路，还给出不低的置信度。
  // 这种答案比识别失败更坏，所以宁可在这里拦住。正常截图里最外圈线离图边至少有一目，
  // 手动框得特别紧才会踩到这条线。
  const edgeCut = grid.step * 0.45;
  const outerX = grid.originX - edgeCut;
  const outerY = grid.originY - edgeCut;
  const outerR = grid.originX + (grid.size - 1) * grid.step + edgeCut;
  const outerB = grid.originY + (grid.size - 1) * grid.step + edgeCut;
  if (outerX < 0 || outerY < 0 || outerR > img.width || outerB > img.height) {
    return {
      ok: false,
      size: 0,
      stones: [],
      confidence: 0,
      suspects: [],
      diagnostics: null,
      message: '棋盘被画面裁掉了一部分，识别出来的路数不可信。把整块棋盘放进画面再截一次（可以先用 Ctrl 加减号缩小网页，或者把分屏拉宽）。'
    };
  }

  const total = grid.size * grid.size;
  const pointStats: PointStat[] = new Array(total);
  const lums: number[] = new Array(total);
  const sats: number[] = new Array(total);
  const samples: Sample[] = new Array(total);
  const radius = grid.step * 0.3;
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      const i = y * grid.size + x;
      const s = sampleRing(stats, grid.originX + x * grid.step, grid.originY + y * grid.step, radius);
      lums[i] = s.lum;
      sats[i] = s.sat;
      samples[i] = s;
      pointStats[i] = { x, y, r: s.r, g: s.g, b: s.b, lum: s.lum, sat: s.sat, value: EMPTY, margin: 0, pale: 0 };
    }
  }

  const bg = chooseBackground(lums, sats, marginGuess(stats, grid, searchBox));

  const blackCut = Math.min(bg.lum - Math.max(24, bg.lum * 0.18), 165);
  const whiteCut = bg.lum + Math.max(16, bg.lum * 0.09);
  const whiteSatCut = Math.max(18, bg.sat * 0.65);

  // 白子的第二条判法：底色有色、白子无色，就靠“掉了色”认。
  // 有的客户端把白子画成一颗带明暗的球，背光半边能暗到跟木色一样，整圈取样的中位亮度
  // 甚至比底色还低一点（实测木色亮度 200、彩度 139，白子整圈中位亮度 190、彩度 10 上下）。
  // 这种盘上按亮度求阈值永远是“怎么调都差一点”：调低了把木色算成白子，调高了白子全丢，
  // 因为两者亮度本来就不是一个方向的东西。彩色对无色的差别才是稳定的那条线。
  // 底色本身没什么彩色时（浅底棋盘、打印图）这条路自动关掉，还是老办法。
  const paleRule = bg.sat >= 45;
  const paleSatCut = Math.max(26, bg.sat * 0.4);
  const paleLumCut = bg.lum - Math.max(14, bg.lum * 0.1);
  // 取样圈整好会跟交叉点的两条格线相交，格线画在棋子上层的客户端会把这四个方向染成线色。
  // 划掉贴着格线的取样（离格线一个线宽以内），留下的斜向几段看的是棋子本色。
  // 这个线宽按截图上格线的实际粗细取，不跟着步长放大，否则大图上会把整圈都划掉。
  const lineGuard = Math.min(Math.max(1.2, grid.step * 0.08), 2.5);
  const boardX1 = grid.originX + (grid.size - 1) * grid.step;
  const boardY1 = grid.originY + (grid.size - 1) * grid.step;
  const ignoreSample = (x: number, y: number): boolean => {
    // 棋盘外面的那圈（边距）跟棋盘内的木色未必一样，边线上的棋子有一角取样落在那里，
    // 那部分判断不了棋子本色，按不算处理
    if (x < grid.originX - grid.step * 0.5 || x > boardX1 + grid.step * 0.5) return true;
    if (y < grid.originY - grid.step * 0.5 || y > boardY1 + grid.step * 0.5) return true;
    const kx = Math.round((x - grid.originX) / grid.step);
    const ky = Math.round((y - grid.originY) / grid.step);
    return (
      Math.abs(x - (grid.originX + kx * grid.step)) <= lineGuard ||
      Math.abs(y - (grid.originY + ky * grid.step)) <= lineGuard
    );
  };

  const stones: number[] = new Array(total).fill(EMPTY);
  for (let i = 0; i < total; i++) {
    const l = lums[i];
    const s = sats[i];
    const pale = paleRule ? paleFraction(samples[i], paleSatCut, paleLumCut, ignoreSample) : 0;
    pointStats[i].pale = pale;
    let v = EMPTY;
    let margin = Math.min(Math.abs(l - bg.lum), Math.max(Math.abs(l - blackCut), Math.abs(l - whiteCut)));
    if (l < blackCut) {
      v = BLACK;
      margin = blackCut - l;
    } else if (l > whiteCut && s < whiteSatCut) {
      v = WHITE;
      margin = Math.min(l - whiteCut, whiteSatCut - s);
    } else if (paleRule && pale >= 0.5) {
      v = WHITE;
      margin = (pale - 0.5) * 40;
    } else {
      margin = Math.min(Math.abs(l - blackCut), Math.abs(l - whiteCut) + (s < whiteSatCut ? 0 : 12));
    }
    stones[i] = v;
    pointStats[i].value = v;
    pointStats[i].margin = margin;
  }

  const suspects: Suspect[] = [];
  for (let i = 0; i < total; i++) {
    if (pointStats[i].margin < 12) {
      suspects.push({ x: pointStats[i].x, y: pointStats[i].y, lum: lums[i], sat: sats[i], guess: stones[i] });
    }
  }

  const stoneCount = stones.filter((v) => v !== EMPTY).length;
  const blackCount = stones.filter((v) => v === BLACK).length;
  const whiteCount = stoneCount - blackCount;
  const confidence = Math.max(0, Math.min(1, 1 - suspects.length / Math.max(1, total)) * Math.min(1, grid.uniformity + 0.1));

  return {
    // 空盘算不算认成功，看调用方：手动导入时一颗子都没有多半是截错了图，要拦；
    // 实时截取时开局的空盘就是正常画面，不能报错。
    ok: stoneCount > 0 || opts.allowEmpty === true,
    size: grid.size,
    stones,
    confidence,
    suspects,
    diagnostics: {
      boardRect: searchBox,
      grid,
      backgroundLum: bg.lum,
      backgroundSat: bg.sat,
      backgroundSource: bg.source,
      paleRule,
      usedCrop,
      pointStats
    },
    message:
      stoneCount > 0
        ? `识别到 ${grid.size} 路，黑 ${blackCount} 白 ${whiteCount}，置信度 ${(confidence * 100).toFixed(0)}%`
        : '识别到棋盘但是没有看到棋子，请确认截图内容。'
  };
}
