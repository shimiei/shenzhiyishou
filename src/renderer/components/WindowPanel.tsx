import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSourceVideo, useStore } from '../state/store';
import { boxFromDrag, usableCrop, type NormBox } from '../../shared/windowMap';
import type { DesktopWindow } from '../../shared/protocol';

interface Fit {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 分屏那一栏的第二档：盯住程序外面的一个窗口（原生客户端、远程桌面画面）。
 *
 * 画面是主进程按窗口开的一路视频流，认棋盘还是渲染进程里那套 recognizeBoard。
 * 这一块只管三件事：选窗口、把画面摆正（含在画面上框出棋盘）、把程序看见的东西显示出来
 * （认到的棋盘框、落点）。认与点都不在这里，在 store 里。
 */
export function WindowPanel(): React.ReactElement {
  const settings = useStore((s) => s.settings);
  const geom = useStore((s) => s.desktopGeom);
  const shot = useStore((s) => s.sourceShot);
  const markAt = useStore((s) => s.markAt);
  const sync = useStore((s) => s.sync);
  const toast = useStore((s) => s.toast);
  const pickDesktopWindow = useStore((s) => s.pickDesktopWindow);
  const setWindowCrop = useStore((s) => s.setWindowCrop);
  const setWindowMark = useStore((s) => s.setWindowMark);
  const checkSource = useStore((s) => s.checkSource);
  const markCurrent = useStore((s) => s.markCurrent);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [list, setList] = useState<DesktopWindow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [dragBox, setDragBox] = useState<NormBox | null>(null);
  const [picked, setPicked] = useState<DesktopWindow | null>(null);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [fit, setFit] = useState<Fit | null>(null);

  const targetKey = `${settings.captureWindowTitle}|${settings.captureWindowProc}`;
  const box = usableCrop(settings.captureCrop);

  // 抽帧那套（store 里的 shotWindow）从这儿拿视频元素
  useEffect(() => {
    registerSourceVideo(videoRef.current);
    return () => registerSourceVideo(null);
  }, []);

  /**
   * 选窗口。没指定就按设置里记住的进程名找回来：窗口标题会随对局变
   *（"对局中 3/5"这种），但进程名不会，所以先按进程名挑，标题只是用来在多个里选更像的。
   */
  const chooseWindow = useCallback(
    async (want: DesktopWindow | null, quiet = false): Promise<void> => {
      if (!want) {
        setPicked(null);
        await pickDesktopWindow(null);
        return;
      }
      setBusy(true);
      const ok = await pickDesktopWindow(want);
      setBusy(false);
      if (ok) {
        setPicked(want);
        setList(null);
      } else if (!quiet) {
        setPicked(null);
      }
    },
    [pickDesktopWindow]
  );

  const ensurePicked = useCallback(
    async (quiet: boolean): Promise<void> => {
      const title = settings.captureWindowTitle;
      const proc = settings.captureWindowProc;
      if (!title && !proc) {
        if (!quiet) {
          const all = await window.api.desktop.list();
          setList(all);
        }
        return;
      }
      const all = await window.api.desktop.list();
      const byProc = all.filter((w) => proc && w.proc === proc);
      const same = byProc.find((w) => w.title === title) ?? byProc[0] ?? null;
      const fallback = same ?? all.find((w) => w.title === title) ?? null;
      if (!fallback) {
        if (!quiet) {
          setList(all);
          toast(`没找到上次那个窗口${proc ? `（${proc}）` : ''}，重新选一个`, 'info');
        }
        return;
      }
      await chooseWindow(fallback, quiet);
    },
    [settings.captureWindowProc, settings.captureWindowTitle, chooseWindow, toast]
  );

  // 进这一档、或者换过记住的窗口，就把它接回来
  useEffect(() => {
    void ensurePicked(true);
    // ensurePicked 依赖的那几个值变了才重来；它自己每次都是新的，不该进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  // 开视频流。换窗口就重开一条，旧的那条一定要停掉，不然系统的抓帧一直挂着
  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    const start = async (): Promise<void> => {
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 10, max: 15 } },
          audio: false
        });
      } catch (e) {
        if (!cancelled) setStreamErr(e instanceof Error ? e.message : String(e));
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      setStreamErr(null);
      try {
        await v.play();
      } catch {
        /* 静音流，一般不会失败 */
      }
      setLive(true);
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.onended = () => setLive(false);
      }
    };
    void start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      setLive(false);
      setVideoSize({ width: 0, height: 0 });
    };
  }, [picked]);

  // 画面按比例摆进这一栏：留出上下或左右的空，框选与叠层都按这块算
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const layout = (): void => {
      const r = stage.getBoundingClientRect();
      const vw = videoSize.width;
      const vh = videoSize.height;
      if (r.width < 8 || r.height < 8 || vw < 8 || vh < 8) {
        setFit(null);
        return;
      }
      const scale = Math.min(r.width / vw, r.height / vh);
      const width = Math.round(vw * scale);
      const height = Math.round(vh * scale);
      setFit({ left: Math.round((r.width - width) / 2), top: Math.round((r.height - height) / 2), width, height });
    };
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [videoSize, picked]);

  const onVideoMeta = (): void => {
    const v = videoRef.current;
    if (!v) return;
    setVideoSize({ width: v.videoWidth, height: v.videoHeight });
  };

  /** 鼠标落在画面里的哪个像素上。除以显示出来的那块的实际大小，跟画面上的一致性由 fit 保证。 */
  const pointerToFrame = (e: React.PointerEvent): { x: number; y: number } | null => {
    const stage = stageRef.current;
    const v = videoRef.current;
    if (!stage || !v || !fit || !fit.width || !fit.height || !v.videoWidth) return null;
    const r = stage.getBoundingClientRect();
    const x = e.clientX - r.left - fit.left;
    const y = e.clientY - r.top - fit.top;
    if (x < 0 || y < 0 || x > fit.width || y > fit.height) return null;
    return { x: (x / fit.width) * v.videoWidth, y: (y / fit.height) * v.videoHeight };
  };

  const openPicker = async (): Promise<void> => {
    setBusy(true);
    try {
      const all = await window.api.desktop.list();
      setList(all);
      if (all.length === 0) toast('没列出窗口来：先把你那个客户端开着', 'info');
    } finally {
      setBusy(false);
    }
  };

  /** 认到的棋盘在画面里占哪儿（网格最外圈线往外放半格）。 */
  const boardBox =
    shot && shot.grid.size > 0
      ? {
          x: (shot.grid.originX - shot.grid.step * 0.5) / shot.frame.width,
          y: (shot.grid.originY - shot.grid.step * 0.5) / shot.frame.height,
          w: ((shot.grid.size - 1) * shot.grid.step + shot.grid.step) / shot.frame.width,
          h: ((shot.grid.size - 1) * shot.grid.step + shot.grid.step) / shot.frame.height
        }
      : null;
  const markRel =
    markAt && videoSize.width > 0
      ? { x: markAt.x / videoSize.width, y: markAt.y / videoSize.height, color: markAt.color }
      : null;
  const stones = shot ? shot.stones.filter((v) => v !== 0).length : 0;

  return (
    <div className="win-src">
      <div className="row wrap win-src-bar">
        <button className="btn sm" disabled={busy} onClick={() => void openPicker()}>
          {picked ? '换窗口…' : '选窗口…'}
        </button>
        <button className="btn sm" disabled={!picked || busy} onClick={() => void checkSource()}>
          认一下
        </button>
        <button
          className="btn sm"
          disabled={!picked}
          title="把当前这一手（没有就拿天元）标到那个窗口上，看看位置对不对"
          onClick={() => void markCurrent(4000)}
        >
          标一下
        </button>
        {box ? (
          <button className="btn sm" onClick={() => void setWindowCrop(null)}>
            清除框选
          </button>
        ) : null}
        <button
          className={'chip' + (settings.windowMark ? ' active' : '')}
          title={'落点提示：点之前把“要点哪儿”画成一个环叠在那个窗口上，你自己看得见它落在哪儿'}
          onClick={() => void setWindowMark(!settings.windowMark)}
        >
          落点提示
        </button>
        <span className="small faint win-src-status">
          {picked ? picked.title : settings.captureWindowTitle || '还没选窗口'}
          {geom
            ? ` · ${geom.win.w}×${geom.win.h}${geom.iconic ? ' · 最小化了' : ''}${geom.gone ? ' · 已关掉' : ''}`
            : ''}
          {shot ? ` · 认到 ${shot.size} 路 ${stones} 子` : ''}
          {live ? '' : ' · 没有画面'}
        </span>
      </div>
      {sync ? (
        <div className="row" style={{ padding: '0 8px 4px' }}>
          <span className={'sync-msg' + (sync.ok ? ' ok' : ' err')}>{sync.text}</span>
        </div>
      ) : null}
      {list ? (
        <div className="win-src-list">
          <div className="row" style={{ justifyContent: 'space-between', padding: '2px 6px' }}>
            <span className="small faint">挑一个窗口盯住（就是那个下棋的客户端，或者远程画面那个窗口）</span>
            <button className="btn sm" onClick={() => setList(null)}>
              取消
            </button>
          </div>
          <div className="win-src-items">
            {list.map((w) => (
              <button
                key={w.id}
                className={'win-src-item' + (picked?.id === w.id ? ' active' : '')}
                onClick={() => void chooseWindow(w)}
                title={`${w.title}${w.proc ? `（${w.proc}）` : ''}`}
              >
                <span className="win-src-item-title">{w.title}</span>
                <span className="small faint">{w.proc || '未知进程'}{w.iconic ? ' · 最小化' : ''}</span>
              </button>
            ))}
            {list.length === 0 ? <span className="small faint">一个窗口都没列出来</span> : null}
          </div>
        </div>
      ) : null}
      <div className="win-src-stage" ref={stageRef}>
        <video
          ref={videoRef}
          className="win-src-video"
          style={fit ? { left: fit.left, top: fit.top, width: fit.width, height: fit.height } : undefined}
          muted
          playsInline
          onLoadedMetadata={onVideoMeta}
          onResize={onVideoMeta}
          onPointerDown={(e) => {
            const p = pointerToFrame(e);
            if (!p) return;
            dragRef.current = p;
            setDragBox({ x: p.x, y: p.y, w: 0, h: 0 });
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            const p = pointerToFrame(e);
            if (!p) return;
            setDragBox(boxFromDrag(d, p, videoSize) ?? { x: 0, y: 0, w: 0, h: 0 });
          }}
          onPointerUp={() => {
            const d = dragRef.current;
            dragRef.current = null;
            const box2 = dragBox;
            setDragBox(null);
            if (!d || !box2) return;
            // 拖出来太小就当没框（手抖），够大就存下来一直用它认
            const clean = usableCrop(box2);
            if (clean) void setWindowCrop(clean);
          }}
        />
        {fit ? (
          <div className="win-src-overlay" style={{ left: fit.left, top: fit.top, width: fit.width, height: fit.height }}>
            {box ? (
              <div
                className="win-src-frame"
                style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
              />
            ) : null}
            {boardBox ? (
              <div
                className="win-src-board"
                style={{
                  left: `${boardBox.x * 100}%`,
                  top: `${boardBox.y * 100}%`,
                  width: `${boardBox.w * 100}%`,
                  height: `${boardBox.h * 100}%`
                }}
                title="程序认出来的棋盘位置"
              />
            ) : null}
            {markRel ? (
              <div
                className={'win-src-mark' + (markRel.color === 2 ? ' white' : '')}
                style={{ left: `${markRel.x * 100}%`, top: `${markRel.y * 100}%` }}
                title="这一手该点这儿"
              />
            ) : null}
            {dragBox ? (
              <div
                className="win-src-drag"
                style={{ left: `${dragBox.x * 100}%`, top: `${dragBox.y * 100}%`, width: `${dragBox.w * 100}%`, height: `${dragBox.h * 100}%` }}
              />
            ) : null}
          </div>
        ) : null}
        {!picked ? (
          <div className="win-src-empty">
            <div>还没选窗口</div>
            <div className="small faint">点上面的"选窗口…"，挑那个下棋的客户端或者远程画面窗口</div>
          </div>
        ) : null}
        {picked && !live ? (
          <div className="win-src-empty">
            <div>{streamErr ? '抓不到这个窗口的画面' : '正在取画面…'}</div>
            {streamErr ? <div className="small faint">{streamErr}</div> : null}
            {geom?.iconic ? <div className="small faint">这个窗口最小化了，最小化时系统不给画面</div> : null}
          </div>
        ) : null}
      </div>
      <div className="small faint win-src-tip">
        在画面上按住拖一下，把棋盘框出来：框一次以后就按这块认，认得更快也更稳。认到的棋盘会画一个白框，
        落子前那个环是要点的地方。
      </div>
    </div>
  );
}
