import { useEffect, useMemo, useRef, useState } from 'react';
import { BLACK, EMPTY, PASS, WHITE, type Stone } from '../../shared/types';
import { Position } from '../core/go/position';
import type { Mark } from '../core/sgf/tree';

export interface Candidate {
  move: string;
  winrate: number;
  visits: number;
  scoreLead?: number;
}

interface BoardProps {
  size: number;
  position: Position;
  marks?: Mark[];
  lastMove?: number | null;
  hover?: number | null;
  ownership?: number[] | null;
  candidates?: Candidate[];
  hintMove?: string | null;
  /** 推荐点属于哪一方。画成同色的幽灵子，看图就知道是建议谁走。 */
  hintColor?: 1 | 2 | null;
  dead?: number[];
  showCoords?: boolean;
  showNumbers?: boolean;
  /** 各交叉点上的手数，只有开启手数显示时用得上。 */
  numbers?: Map<number, number>;
  interactive?: boolean;
  clickable?: boolean;
  onPlay?: (point: number) => void;
  onHover?: (point: number | null) => void;
  onToggleDead?: (point: number) => void;
  zoom?: number;
  /** 试下预览：额外的临时棋子（如变化图预览） */
  preview?: Array<{ point: number; color: Stone }> | null;
  /**
   * 直接指定棋盘像素尺寸。棋盘根节点是自己量自己的，
   * 放在弹窗这种高度由内容撑开的容器里会变成循环依赖，
   * 最后缩到下限尺寸，所以这类场合由外部给定尺寸。
   */
  fixedBox?: number;
}

const LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

// 坐标解析用规则引擎那一份，别在画布这边再抄一遍：
// 引擎报的着法、界面上的推荐点、棋盘上留下的子都靠它落到同一个交叉点，
// 两处各写一份，早晚会在只改一处的时候错位。
const parseVertex = (v: string, size: number): number => Position.parseVertex(v, size);

interface Sprite {
  canvas: HTMLCanvasElement;
  size: number;
}

function makeStoneSprite(color: 1 | 2, radius: number, dpr: number): Sprite {
  const pad = radius * 0.5 + 2;
  const side = Math.ceil((radius + pad) * 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(side * dpr);
  canvas.height = Math.ceil(side * dpr);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.scale(dpr, dpr);
  const cx = side / 2;
  const cy = side / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.42)';
  ctx.shadowBlur = radius * 0.42;
  ctx.shadowOffsetY = radius * 0.14;
  const grad = ctx.createRadialGradient(cx - radius * 0.34, cy - radius * 0.36, radius * 0.08, cx, cy, radius * 1.06);
  if (color === BLACK) {
    grad.addColorStop(0, '#7b838f');
    grad.addColorStop(0.28, '#3a4048');
    grad.addColorStop(0.72, '#16191d');
    grad.addColorStop(1, '#05070a');
  } else {
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.42, '#f7f8fa');
    grad.addColorStop(0.82, '#e2e5ea');
    grad.addColorStop(1, '#bcc2cb');
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 边缘一层细描边，让白子在木色上更清晰
  ctx.strokeStyle = color === BLACK ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.20)';
  ctx.lineWidth = Math.max(0.6, radius * 0.05);
  ctx.beginPath();
  ctx.arc(cx, cy, radius - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  return { canvas, size: side };
}

export function Board({
  size,
  position,
  marks = [],
  lastMove = null,
  hover = null,
  ownership = null,
  candidates = [],
  hintMove = null,
  hintColor = null,
  dead = [],
  showCoords = true,
  showNumbers = false,
  numbers,
  interactive = true,
  clickable = true,
  onPlay,
  onHover,
  onToggleDead,
  zoom = 1,
  preview = null,
  fixedBox
}: BoardProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState(fixedBox ?? 560);

  useEffect(() => {
    if (fixedBox) {
      setBox(fixedBox);
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const avail = Math.min(r.width - 28, r.height - 28);
      setBox(Math.max(240, avail));
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setBox(Math.max(240, Math.min(r.width - 28, r.height - 28)));
    return () => ro.disconnect();
  }, [fixedBox]);

  const dims = useMemo(() => {
    const px = Math.round(box * zoom);
    const pad = showCoords ? px * (size >= 19 ? 0.052 : 0.075) : px * 0.032;
    const step = (px - pad * 2) / (size - 1);
    return { px, pad, step };
  }, [box, zoom, size, showCoords]);

  const deadSet = useMemo(() => new Set(dead), [dead]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const { px, pad, step } = dims;
    canvas.width = Math.round(px * dpr);
    canvas.height = Math.round(px * dpr);
    canvas.style.width = px + 'px';
    canvas.style.height = px + 'px';
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, px, px);

    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

    // 木纹棋盘
    const wood = ctx.createLinearGradient(0, 0, px, px);
    if (theme === 'light') {
      wood.addColorStop(0, '#f0c98d');
      wood.addColorStop(0.5, '#e7bd7c');
      wood.addColorStop(1, '#d9a962');
    } else {
      wood.addColorStop(0, '#c99a5e');
      wood.addColorStop(0.5, '#bd8d51');
      wood.addColorStop(1, '#a97c46');
    }
    ctx.fillStyle = wood;
    ctx.fillRect(0, 0, px, px);
    // 淡淡木纹
    ctx.save();
    ctx.globalAlpha = 0.045;
    ctx.strokeStyle = theme === 'light' ? '#7a5320' : '#3b2708';
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      const y = (i / 26) * px + ((i * 37) % 11) * 0.3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(px * 0.3, y + 4, px * 0.6, y - 5, px, y + 2);
      ctx.stroke();
    }
    ctx.restore();
    // 外框
    ctx.strokeStyle = theme === 'light' ? 'rgba(90,60,20,0.35)' : 'rgba(40,24,4,0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0.75, 0.75, px - 1.5, px - 1.5);

    const at = (i: number): [number, number] => [pad + (i % size) * step, pad + Math.floor(i / size) * step];

    // 网格
    ctx.strokeStyle = theme === 'light' ? 'rgba(70,44,12,0.72)' : 'rgba(48,30,8,0.78)';
    ctx.lineWidth = Math.max(0.7, step * 0.028);
    ctx.beginPath();
    for (let i = 0; i < size; i++) {
      const p = pad + i * step;
      ctx.moveTo(pad, p);
      ctx.lineTo(pad + (size - 1) * step, p);
      ctx.moveTo(p, pad);
      ctx.lineTo(p, pad + (size - 1) * step);
    }
    ctx.stroke();

    // 星位
    const starEdge = size >= 19 ? 3 : size >= 13 ? 3 : 2;
    const far = size - 1 - starEdge;
    const mid = (size - 1) / 2;
    const stars: Array<[number, number]> = [];
    if (size >= 13) {
      for (const y of [starEdge, mid, far]) for (const x of [starEdge, mid, far]) stars.push([x, y]);
    } else {
      stars.push([starEdge, starEdge], [starEdge, far], [far, starEdge], [far, far], [mid, mid]);
    }
    ctx.fillStyle = theme === 'light' ? 'rgba(60,38,10,0.85)' : 'rgba(40,25,6,0.9)';
    for (const [x, y] of stars) {
      ctx.beginPath();
      ctx.arc(pad + x * step, pad + y * step, Math.max(1.7, step * 0.075), 0, Math.PI * 2);
      ctx.fill();
    }

    // 坐标
    if (showCoords) {
      ctx.fillStyle = theme === 'light' ? 'rgba(70,45,14,0.82)' : 'rgba(255,240,215,0.74)';
      ctx.font = `${Math.round(step * 0.4)}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < size; i++) {
        const p = pad + i * step;
        ctx.fillText(LETTERS[i] ?? '', p, pad - step * 0.62);
        ctx.fillText(LETTERS[i] ?? '', p, pad + (size - 1) * step + step * 0.62);
        const label = String(size - i);
        ctx.fillText(label, pad - step * 0.66, p);
        ctx.fillText(label, pad + (size - 1) * step + step * 0.66, p);
      }
    }

    // 权属（形势判断）
    if (ownership && ownership.length >= size * size) {
      for (let i = 0; i < size * size; i++) {
        const v = ownership[i];
        if (Math.abs(v) < 0.12) continue;
        const [cx, cy] = at(i);
        const s = step * 0.2;
        ctx.fillStyle = v > 0 ? `rgba(10,12,16,${Math.min(0.7, Math.abs(v))})` : `rgba(255,255,255,${Math.min(0.78, Math.abs(v))})`;
        if (v < 0 && theme === 'light') ctx.fillStyle = `rgba(255,255,255,${Math.min(0.9, Math.abs(v))})`;
        ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
      }
    }

    // 棋子
    const radius = step * 0.472;
    const blackSprite = makeStoneSprite(BLACK, radius, dpr);
    const whiteSprite = makeStoneSprite(WHITE, radius, dpr);
    const stoneList: Array<{ i: number; color: Stone }> = [];
    for (let i = 0; i < size * size; i++) {
      const c = position.cells[i] as Stone;
      if (c !== EMPTY) stoneList.push({ i, color: c });
    }
    if (preview) for (const p of preview) stoneList.push({ i: p.point, color: p.color });
    for (const st of stoneList) {
      const [cx, cy] = at(st.i);
      const sprite = st.color === BLACK ? blackSprite : whiteSprite;
      const ghost = deadSet.has(st.i) || (preview?.some((p) => p.point === st.i) ?? false);
      if (ghost) ctx.globalAlpha = deadSet.has(st.i) ? 0.42 : 0.82;
      ctx.drawImage(sprite.canvas, cx - sprite.size / 2, cy - sprite.size / 2, sprite.size, sprite.size);
      if (ghost) ctx.globalAlpha = 1;
    }

    const contrast = (i: number): string => {
      const c = position.cells[i] as Stone;
      if (c === BLACK) return 'rgba(255,255,255,0.92)';
      if (c === WHITE) return 'rgba(20,24,30,0.92)';
      return 'rgba(30,70,140,0.95)';
    };

    // 死子标记
    for (const i of dead) {
      const [cx, cy] = at(i);
      const r = step * 0.2;
      ctx.strokeStyle = 'rgba(224,92,82,0.95)';
      ctx.lineWidth = Math.max(1.4, step * 0.055);
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - r);
      ctx.lineTo(cx + r, cy + r);
      ctx.moveTo(cx + r, cy - r);
      ctx.lineTo(cx - r, cy + r);
      ctx.stroke();
    }

    // 最后一手
    if (lastMove !== null && lastMove !== undefined && lastMove !== PASS && lastMove >= 0 && lastMove < size * size) {
      const [cx, cy] = at(lastMove);
      ctx.fillStyle = contrast(lastMove);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, step * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }

    // 标记
    ctx.lineWidth = Math.max(1.4, step * 0.052);
    for (const m of marks) {
      const i = m.y * size + m.x;
      const [cx, cy] = at(i);
      const r = step * 0.2;
      ctx.strokeStyle = contrast(i);
      ctx.fillStyle = contrast(i);
      ctx.beginPath();
      switch (m.type) {
        case 'triangle':
          ctx.moveTo(cx, cy - r * 1.15);
          ctx.lineTo(cx + r * 1.05, cy + r * 0.75);
          ctx.lineTo(cx - r * 1.05, cy + r * 0.75);
          ctx.closePath();
          ctx.stroke();
          break;
        case 'square':
          ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
          break;
        case 'circle':
          ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'cross':
          ctx.moveTo(cx - r, cy - r);
          ctx.lineTo(cx + r, cy + r);
          ctx.moveTo(cx + r, cy - r);
          ctx.lineTo(cx - r, cy + r);
          ctx.stroke();
          break;
        case 'dim':
          ctx.globalAlpha = 0.42;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          break;
        case 'territoryB':
          ctx.fillRect(cx - r * 0.7, cy - r * 0.7, r * 1.4, r * 1.4);
          break;
        case 'territoryW':
          ctx.globalAlpha = 0.75;
          ctx.fillRect(cx - r * 0.7, cy - r * 0.7, r * 1.4, r * 1.4);
          ctx.globalAlpha = 1;
          break;
        case 'label': {
          const text = m.label ?? '';
          ctx.beginPath();
          ctx.arc(cx, cy, r * 1.15, 0, Math.PI * 2);
          ctx.fillStyle = i < position.cells.length && position.cells[i] === BLACK ? 'rgba(255,255,255,0.94)' : 'rgba(255,255,255,0.9)';
          ctx.fill();
          ctx.fillStyle = '#1a1d22';
          ctx.font = `600 ${Math.round(step * 0.44)}px ${getComputedStyle(document.body).fontFamily}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, cx, cy + step * 0.01);
          break;
        }
        default:
          break;
      }
    }

    // 手数
    if (showNumbers && numbers && numbers.size > 0) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(step * 0.4)}px ${getComputedStyle(document.body).fontFamily}`;
      for (const [point, num] of numbers) {
        if (point < 0 || point >= size * size) continue;
        const [cx, cy] = at(point);
        ctx.fillStyle = contrast(point);
        ctx.fillText(String(num), cx, cy + step * 0.015);
      }
    }

    // 推荐点
    if (candidates.length > 0) {
      candidates.slice(0, 5).forEach((cand, idx) => {
        const p = parseVertex(cand.move, size);
        if (p === PASS) return;
        const [cx, cy] = at(p);
        const r = step * (idx === 0 ? 0.3 : 0.24);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = idx === 0 ? 'rgba(217,164,65,0.9)' : 'rgba(76,157,240,0.72)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = Math.max(1, step * 0.03);
        ctx.stroke();
        ctx.fillStyle = '#12151a';
        ctx.font = `700 ${Math.round(step * 0.34)}px ${getComputedStyle(document.body).fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(idx + 1), cx, cy + step * 0.012);
      });
      const top = candidates[0];
      const p = parseVertex(top.move, size);
      if (p !== PASS) {
        const [cx, cy] = at(p);
        const text = `${(top.winrate * 100).toFixed(1)}%`;
        ctx.font = `600 ${Math.round(step * 0.32)}px ${getComputedStyle(document.body).fontFamily}`;
        const w = ctx.measureText(text).width + step * 0.2;
        const h = step * 0.46;
        let bx = cx + step * 0.35;
        let by = cy - h / 2;
        if (bx + w > px - 4) bx = cx - step * 0.35 - w;
        if (by < 4) by = 4;
        ctx.fillStyle = 'rgba(12,14,18,0.78)';
        ctx.beginPath();
        ctx.roundRect(bx, by, w, h, h * 0.32);
        ctx.fill();
        ctx.fillStyle = '#f0c069';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bx + w / 2, by + h / 2);
      }
    }

    // 推荐提示：一个该走的那一方的幽灵子 + 金圈。只给建议，不落子。
    if (hintMove) {
      const p = parseVertex(hintMove, size);
      if (p !== PASS && p >= 0 && p < size * size && position.cells[p] === EMPTY) {
        const [cx, cy] = at(p);
        const sprite = hintColor === WHITE ? whiteSprite : blackSprite;
        ctx.globalAlpha = 0.45;
        ctx.drawImage(sprite.canvas, cx - sprite.size / 2, cy - sprite.size / 2, sprite.size, sprite.size);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(217,164,65,0.95)';
        ctx.lineWidth = Math.max(2, step * 0.07);
        ctx.setLineDash([step * 0.16, step * 0.12]);
        ctx.beginPath();
        ctx.arc(cx, cy, step * 0.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 悬停预览
    if (interactive && hover !== null && hover !== undefined && hover >= 0 && hover < size * size) {
      const occupied = position.cells[hover] !== EMPTY;
      const [cx, cy] = at(hover);
      const legal = !occupied && position.isLegal((3 - position.toPlay) as 1 | 2, hover);
      if (legal) {
        ctx.globalAlpha = 0.42;
        const sprite = position.toPlay === BLACK ? blackSprite : whiteSprite;
        ctx.drawImage(sprite.canvas, cx - sprite.size / 2, cy - sprite.size / 2, sprite.size, sprite.size);
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = 'rgba(224,92,82,0.75)';
        ctx.lineWidth = Math.max(1.4, step * 0.05);
        const r = step * 0.2;
        ctx.beginPath();
        ctx.moveTo(cx - r, cy - r);
        ctx.lineTo(cx + r, cy + r);
        ctx.moveTo(cx + r, cy - r);
        ctx.lineTo(cx - r, cy + r);
        ctx.stroke();
      }
    }
  }, [
    dims,
    size,
    position,
    marks,
    lastMove,
    hover,
    ownership,
    candidates,
    hintMove,
    hintColor,
    dead,
    deadSet,
    showCoords,
    showNumbers,
    interactive,
    preview
  ]);

  const locate = (clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { pad, step } = dims;
    const x = ((clientX - rect.left) / rect.width) * dims.px;
    const y = ((clientY - rect.top) / rect.height) * dims.px;
    const gx = Math.round((x - pad) / step);
    const gy = Math.round((y - pad) / step);
    if (gx < 0 || gy < 0 || gx >= size || gy >= size) return null;
    const px = pad + gx * step;
    const py = pad + gy * step;
    const dist = Math.hypot(x - px, y - py);
    if (dist > step * 0.62) return null;
    return gy * size + gx;
  };

  return (
    <div className="board-area" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className={'board-canvas' + (clickable ? '' : ' editing')}
        onPointerMove={(e) => {
          if (!interactive) return;
          const p = locate(e.clientX, e.clientY);
          if (p !== hover) onHover?.(p);
        }}
        onPointerLeave={() => onHover?.(null)}
        onPointerDown={(e) => {
          if (!clickable) return;
          const p = locate(e.clientX, e.clientY);
          if (p === null) return;
          if (e.button === 2) {
            e.preventDefault();
            onToggleDead?.(p);
            return;
          }
          if (onToggleDead && e.shiftKey) {
            onToggleDead(p);
            return;
          }
          onPlay?.(p);
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
