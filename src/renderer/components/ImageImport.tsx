import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { recognizeBoard, type ImageBox, type RecognizeResult } from '../core/cv/recognize';
import { BLACK, WHITE } from '../../shared/types';

const MAX_W = 720;
const MAX_H = 520;

export function ImageImportDialog(): React.ReactElement | null {
  const image = useStore((s) => s.image);
  const openImage = useStore((s) => s.openImage);
  const importPosition = useStore((s) => s.importPosition);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [result, setResult] = useState<RecognizeResult | null>(null);
  const [stones, setStones] = useState<number[]>([]);
  const [size, setSize] = useState(19);
  const [expected, setExpected] = useState(0);
  const [crop, setCrop] = useState<ImageBox | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSuspects, setShowSuspects] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [cropMode, setCropMode] = useState(false);
  const drag = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [visionMsg, setVisionMsg] = useState('');

  const runRecognize = useCallback(
    (target: HTMLImageElement | null, useCrop: ImageBox | null, exp: number) => {
      const source = target ?? img;
      if (!source) return;
      setBusy(true);
      try {
        const off = document.createElement('canvas');
        off.width = source.naturalWidth;
        off.height = source.naturalHeight;
        const ctx = off.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
        ctx.drawImage(source, 0, 0);
        const data = ctx.getImageData(0, 0, off.width, off.height);
        const res = recognizeBoard(data, { expectedSize: exp, crop: useCrop });
        setResult(res);
        if (res.size) {
          setSize(res.size);
          setStones(res.stones.slice());
        }
        if (!res.ok) toast(res.message, 'error');
      } catch (e) {
        toast('识别出错：' + (e instanceof Error ? e.message : String(e)), 'error');
      } finally {
        setBusy(false);
      }
    },
    [img, toast]
  );

  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    const el = new Image();
    el.onload = () => {
      if (cancelled) return;
      const s = Math.min(1, MAX_W / el.naturalWidth, MAX_H / el.naturalHeight);
      setScale(s);
      setImg(el);
      setCrop(null);
      runRecognize(el, null, 0);
    };
    el.onerror = () => toast('图片打不开', 'error');
    el.src = image.dataUrl;
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  // 画布绘制：底图 + 网格 + 识别结果 + 可疑点
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const dispW = Math.round(img.naturalWidth * scale);
    const dispH = Math.round(img.naturalHeight * scale);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(dispW * dpr);
    canvas.height = Math.round(dispH * dpr);
    canvas.style.width = dispW + 'px';
    canvas.style.height = dispH + 'px';
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.drawImage(img, 0, 0, dispW, dispH);

    const grid = result?.diagnostics?.grid;
    if (grid && showGrid) {
      const step = grid.step * scale;
      const ox = grid.originX * scale;
      const oy = grid.originY * scale;
      ctx.strokeStyle = 'rgba(76,157,240,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < grid.size; i++) {
        ctx.moveTo(ox + i * step, oy);
        ctx.lineTo(ox + i * step, oy + (grid.size - 1) * step);
        ctx.moveTo(ox, oy + i * step);
        ctx.lineTo(ox + (grid.size - 1) * step, oy + i * step);
      }
      ctx.stroke();
    }

    if (grid && stones.length) {
      const step = grid.step * scale;
      const r = Math.max(2, step * 0.22);
      for (let i = 0; i < stones.length; i++) {
        if (!stones[i]) continue;
        const x = grid.originX * scale + (i % size) * step;
        const y = grid.originY * scale + Math.floor(i / size) * step;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = stones[i] === BLACK ? 'rgba(20,24,30,0.95)' : 'rgba(250,250,252,0.98)';
        ctx.fill();
        ctx.strokeStyle = stones[i] === BLACK ? 'rgba(120,200,255,0.9)' : 'rgba(40,60,90,0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    if (showSuspects && result?.suspects) {
      const grid2 = result.diagnostics?.grid;
      if (grid2) {
        const step = grid2.step * scale;
        for (const s of result.suspects) {
          const x = grid2.originX * scale + s.x * step;
          const y = grid2.originY * scale + s.y * step;
          ctx.beginPath();
          ctx.arc(x, y, step * 0.45, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(224,92,82,0.9)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    if (crop) {
      ctx.strokeStyle = 'rgba(217,164,65,0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(crop.x * scale, crop.y * scale, crop.w * scale, crop.h * scale);
      ctx.setLineDash([]);
    }
    if (drag.current) {
      const d = drag.current;
      ctx.strokeStyle = 'rgba(217,164,65,0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(Math.min(d.x0, d.x1) * scale, Math.min(d.y0, d.y1) * scale, Math.abs(d.x1 - d.x0) * scale, Math.abs(d.y1 - d.y0) * scale);
      ctx.setLineDash([]);
    }
  }, [img, scale, result, stones, size, showSuspects, showGrid, crop]);

  if (!image) return null;

  const toImage = (clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  };

  const nearestPoint = (ix: number, iy: number): number | null => {
    const grid = result?.diagnostics?.grid;
    if (!grid) return null;
    const gx = Math.round((ix - grid.originX) / grid.step);
    const gy = Math.round((iy - grid.originY) / grid.step);
    if (gx < 0 || gy < 0 || gx >= grid.size || gy >= grid.size) return null;
    const px = grid.originX + gx * grid.step;
    const py = grid.originY + gy * grid.step;
    if (Math.hypot(ix - px, iy - py) > grid.step * 0.6) return null;
    return gy * grid.size + gx;
  };

  const cycle = (point: number): void => {
    const next = stones.slice();
    const cur = next[point];
    next[point] = cur === 0 ? BLACK : cur === BLACK ? WHITE : 0;
    setStones(next);
  };

  const counts = stones.reduce(
    (acc, v) => {
      if (v === BLACK) acc.black += 1;
      else if (v === WHITE) acc.white += 1;
      return acc;
    },
    { black: 0, white: 0 }
  );

  const visionRecognize = async (): Promise<void> => {
    const v = settings.vision;
    if (!v.enabled || !v.endpoint || !v.apiKey) {
      setVisionMsg('还没有配置视觉大模型接口。到「设置 → 图片识别」里填好接口地址、模型名和密钥之后就能用。');
      return;
    }
    setVisionMsg('正在请求视觉大模型…');
    try {
      const body = {
        model: v.model,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `这是一张围棋棋盘的照片或截图。棋盘是 ${size} 路。请只输出 ${size} 行，每行 ${size} 个字符，用 . 表示空点，X 表示黑子，O 表示白子，不要任何解释和多余文字。`
              },
              { type: 'image_url', image_url: { url: image.dataUrl } }
            ]
          }
        ]
      };
      const res = await fetch(v.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${v.apiKey}` },
        body: JSON.stringify(body)
      });
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = json.choices?.[0]?.message?.content ?? '';
      const rows = text
        .split(/\r?\n/)
        .map((line) => line.replace(/[^XO.]/gi, '').toUpperCase())
        .filter((line) => line.length === size);
      if (rows.length !== size) {
        setVisionMsg('大模型返回的格式不对，没能解析出棋盘。请重试，或者继续手工修正。');
        return;
      }
      const next = new Array(size * size).fill(0);
      rows.forEach((row, y) => {
        for (let x = 0; x < size; x++) {
          next[y * size + x] = row[x] === 'X' ? BLACK : row[x] === 'O' ? WHITE : 0;
        }
      });
      setStones(next);
      setVisionMsg('已采用大模型识别结果，请再核对一遍。');
    } catch (e) {
      setVisionMsg('请求失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="overlay">
      <div className="dialog wide">
        <div className="dialog-head">
          <span className="title">从图片识别棋谱</span>
          <span className="small faint">{image.name}</span>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={() => openImage(null)}>
            关闭
          </button>
        </div>
        <div className="dialog-body">
          <div className="cv-toolbar">
            <div className="seg">
              {[
                { v: 0, label: '自动' },
                { v: 9, label: '9 路' },
                { v: 13, label: '13 路' },
                { v: 19, label: '19 路' }
              ].map((o) => (
                <button
                  key={o.v}
                  className={'seg-item' + (expected === o.v ? ' active' : '')}
                  onClick={() => {
                    setExpected(o.v);
                    runRecognize(img, crop, o.v);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button className={'btn sm' + (cropMode ? ' primary' : '')} onClick={() => setCropMode(!cropMode)}>
              {cropMode ? '正在框选（拖一下）' : '手动框选棋盘'}
            </button>
            {crop ? (
              <button
                className="btn sm"
                onClick={() => {
                  setCrop(null);
                  setCropMode(false);
                  runRecognize(img, null, expected);
                }}
              >
                清除框选
              </button>
            ) : null}
            <button className="btn sm" disabled={busy} onClick={() => runRecognize(img, crop, expected)}>
              {busy ? '识别中…' : '重新识别'}
            </button>
            <button className={'chip' + (showGrid ? ' active' : '')} onClick={() => setShowGrid(!showGrid)}>
              网格
            </button>
            <button className={'chip' + (showSuspects ? ' active' : '')} onClick={() => setShowSuspects(!showSuspects)}>
              可疑点
            </button>
          </div>

          <div className="img-stage">
            <canvas
              ref={canvasRef}
              style={{ cursor: cropMode ? 'crosshair' : 'pointer' }}
              onPointerDown={(e) => {
                if (cropMode) {
                  const p = toImage(e.clientX, e.clientY);
                  drag.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
                  setCrop({ x: p.x, y: p.y, w: 1, h: 1 });
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                }
              }}
              onPointerMove={(e) => {
                if (cropMode && drag.current) {
                  const p = toImage(e.clientX, e.clientY);
                  drag.current.x1 = p.x;
                  drag.current.y1 = p.y;
                  setCrop({
                    x: Math.min(drag.current.x0, p.x),
                    y: Math.min(drag.current.y0, p.y),
                    w: Math.abs(p.x - drag.current.x0),
                    h: Math.abs(p.y - drag.current.y0)
                  });
                }
              }}
              onPointerUp={() => {
                if (cropMode && drag.current) {
                  const d = drag.current;
                  const box: ImageBox = {
                    x: Math.min(d.x0, d.x1),
                    y: Math.min(d.y0, d.y1),
                    w: Math.abs(d.x1 - d.x0),
                    h: Math.abs(d.y1 - d.y0)
                  };
                  drag.current = null;
                  setCropMode(false);
                  setCrop(box);
                  if (box.w > 40 && box.h > 40) runRecognize(img, box, expected);
                }
              }}
              onClick={(e) => {
                if (cropMode) return;
                const p = toImage(e.clientX, e.clientY);
                const point = nearestPoint(p.x, p.y);
                if (point !== null) cycle(point);
              }}
            />
          </div>

          <div className="row wrap" style={{ marginTop: 12 }}>
            <span className="badge">{result?.message ?? '等待识别'}</span>
            <span className="badge">
              黑 <b className="mono">{counts.black}</b>
            </span>
            <span className="badge">
              白 <b className="mono">{counts.white}</b>
            </span>
            <div className="spacer" />
            <button
              className="btn sm"
              onClick={() => {
                setStones(stones.map((v) => (v === BLACK ? WHITE : v === WHITE ? BLACK : 0)));
              }}
            >
              交换黑白
            </button>
            <button className="btn sm" onClick={() => setStones(new Array(size * size).fill(0))}>
              清空
            </button>
            <button className="btn sm" onClick={() => void visionRecognize()}>
              用视觉大模型
            </button>
          </div>
          <div className="small faint" style={{ marginTop: 8, lineHeight: 1.7 }}>
            直观点一下交叉点就能改：空 → 黑 → 白 → 空。红圈是识别把握不大的地方，建议重点核对。
            {visionMsg ? <div style={{ color: 'var(--accent-text)', marginTop: 4 }}>{visionMsg}</div> : null}
          </div>
        </div>
        <div className="dialog-foot">
          <span className="small faint">
            识别结果只是局面，不含手顺。可以新建一份棋谱，也可以接到当前谱后面继续下。
          </span>
          <div className="spacer" />
          <button
            className="btn primary"
            disabled={counts.black + counts.white === 0}
            onClick={() => {
              importPosition(stones, size, true);
              openImage(null);
            }}
          >
            新建棋谱
          </button>
          <button
            className="btn"
            disabled={counts.black + counts.white === 0}
            onClick={() => {
              importPosition(stones, size, false);
              openImage(null);
            }}
          >
            接到当前谱后续
          </button>
          <button className="btn ghost" onClick={() => openImage(null)}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
