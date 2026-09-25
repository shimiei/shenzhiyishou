(() => {
  const cv = document.querySelector('canvas.board-canvas');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const img = ctx.getImageData(0, 0, W, H).data;
  const at = (x, y) => { const o = (y * W + x) * 4; return [img[o], img[o + 1], img[o + 2]]; };
  const isLine = (r, g, b) => r < 140 && g < 110 && b < 95;

  // 在若干条扫描线上找竖线，取分组最多的那条（避开正好压在网格线上的扫描线）
  function bestLines(horizontal) {
    let best = [];
    for (let f = 0.06; f < 0.95; f += 0.017) {
      const pos = horizontal ? Math.round(H * f) : Math.round(W * f);
      const groups = [];
      const n = horizontal ? W : H;
      for (let k = 0; k < n; k++) {
        const [r, g, b] = horizontal ? at(k, pos) : at(pos, k);
        if (isLine(r, g, b)) {
          const last = groups[groups.length - 1];
          if (last && k - last[last.length - 1] <= 2) last.push(k); else groups.push([k]);
        }
      }
      const centers = groups.map((g) => (g[0] + g[g.length - 1]) / 2);
      if (centers.length > best.length) best = centers;
    }
    return best;
  }
  function fit(positions) {
    const gaps = [];
    for (let i = 1; i < positions.length; i++) gaps.push(positions[i] - positions[i - 1]);
    gaps.sort((a, b) => a - b);
    const step = gaps[Math.floor(gaps.length / 2)];
    let best = { pad: 0, hits: -1 };
    for (let p = 0; p < step; p += 0.2) {
      const hits = positions.filter((v) => Math.abs((v - p) / step - Math.round((v - p) / step)) < 0.06).length;
      if (hits > best.hits) best = { pad: p, hits };
    }
    return { step: Math.round(step * 1000) / 1000, pad: Math.round(best.pad * 1000) / 1000, 命中格数: best.hits, 扫描到: positions.length };
  }
  const vfit = fit(bestLines(true));
  const hfit = fit(bestLines(false));

  // 候选点的颜色：蓝 rgba(76,157,240,.72)、首选金 rgba(217,164,65,.9)，木色不会落进这两个判定
  const isBlue = (r, g, b) => b > 140 && b - r > 45;
  const isGold = (r, g, b) => r > 200 && r - b > 90 && g - b > 60 && b < 130;
  const pts = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = at(x, y);
      if (isBlue(r, g, b)) pts.push([x, y, 'b']);
      else if (isGold(r, g, b)) pts.push([x, y, 'g']);
    }
  }
  const clusters = [];
  for (const [x, y, kind] of pts) {
    let hit = null;
    for (const c of clusters) {
      if (c.kind === kind && Math.hypot(c.x / c.n - x, c.y / c.n - y) < c.r + 3) { hit = c; break; }
    }
    if (hit) { hit.x += x; hit.y += y; hit.n++; hit.r = Math.max(hit.r, Math.hypot(hit.x / hit.n - x, hit.y / hit.n - y)); }
    else clusters.push({ x, y, n: 1, kind, r: 0 });
  }
  const idx = (cx, cy) => [Math.round((cx - vfit.pad) / vfit.step * 100) / 100, Math.round((cy - hfit.pad) / hfit.step * 100) / 100];
  const marks = clusters.filter((c) => c.n > 200).map((c) => {
    const cx = c.x / c.n, cy = c.y / c.n;
    const [ax, ay] = idx(cx, cy);
    return { 色: c.kind === 'b' ? '蓝' : '金', 交点: [Math.round(ax), Math.round(ay)], 偏差: [Math.round((ax - Math.round(ax)) * 100) / 100, Math.round((ay - Math.round(ay)) * 100) / 100], 半径: Math.round(c.r), 面积: c.n };
  }).sort((a, b) => a.交点[1] - b.交点[1] || a.交点[0] - b.交点[0]);

  const a = window.__szys.getState().analysis;
  const LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
  const want = ((a && a.lines) || []).slice(0, 5).map((c, i) => {
    const t = c.move.toUpperCase();
    return { 序: i + 1, move: c.move, 交点: [LETTERS.indexOf(t[0]), 19 - parseInt(t.slice(1), 10)] };
  });
  return JSON.stringify({ canvas: [W, H], 竖线: vfit, 横线: hfit, 期望: want, 实测: marks });
})()
