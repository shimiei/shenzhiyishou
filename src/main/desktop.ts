/**
 * 盯住程序外面一个窗口：按窗口开一路抓帧源、跟着它的位置走、把"这一手要点哪儿"叠在它上面、
 * 以及真的把鼠标搬过去点一下。
 *
 * 分工：这个模块拿窗口句柄与几何（windowHelper 走 PowerShell），抓帧本身由 Chromium 做
 * （setDisplayMediaRequestHandler 授权给界面里的一个 video），叠层是一个自己开的透明小窗。
 * 界面那边只管认棋盘和决定要点哪儿，屏幕上的事全在这里。
 */

import { BrowserWindow, desktopCapturer, screen, type Session } from 'electron';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpDir } from './paths';
import { clickAt, listWindows, watchWindow, type GeomLine } from './windowHelper';
import { frameAspectMatches, frameFraction, framePointToScreen, pickFrameRect, type FrameSize, type PxRect } from '../shared/windowMap';
import type { DesktopClickResult, DesktopGeom, DesktopMark, DesktopWindow } from '../shared/protocol';

interface Target extends DesktopWindow {
  /** 抓帧源的 id，交给 setDisplayMediaRequestHandler 用。 */
  id: string;
}

let target: Target | null = null;
let geom: DesktopGeom | null = null;
let stopWatch: (() => void) | null = null;
let overlay: BrowserWindow | null = null;
let overlayReady: Promise<void> | null = null;
let markTimer: NodeJS.Timeout | null = null;
/** 现在叠层上画的是什么（画面上占几成 + 颜色），窗口一动就按它重画。 */
let drawn: { frac: { x: number; y: number }; color: 1 | 2 } | null = null;
/** 上一次标注时画面的尺寸：叠层跟着窗口走的时候要用它把"点"换算成比例。 */
let drawnFrame: FrameSize | null = null;
let geomSink: ((g: DesktopGeom) => void) | null = null;
let ownerHwnd = 0;

export function setGeomSink(cb: ((g: DesktopGeom) => void) | null): void {
  geomSink = cb;
}

/** 主窗口的句柄：点完一手要把前台还回它，不然用户的快捷键会打进刚点过的那个客户端里。 */
export function setOwnerWindow(win: BrowserWindow): void {
  try {
    const buf = win.getNativeWindowHandle();
    ownerHwnd = buf.length >= 8 ? Number(buf.readBigInt64LE(0)) : buf.readInt32LE(0);
  } catch {
    ownerHwnd = 0;
  }
}

/**
 * 界面要抓某个窗口的画面时，Chromium 会来问这里要源。
 * 只有用户当前选中的那个窗口放行，别的（以及用户没选就发起的）一律拒掉：
 * 程序里没有任何一条路会去抓用户没指定的窗口。
 */
export function installDisplayMediaHandler(ses: Session): void {
  ses.setDisplayMediaRequestHandler(
    (_request, callback) => {
      const want = target;
      void (async () => {
        if (!want) {
          callback({});
          return;
        }
        try {
          const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
          const src = sources.find((s) => s.id === want.id);
          if (!src) {
            callback({});
            return;
          }
          callback({ video: src });
        } catch {
          callback({});
        }
      })();
    },
    { useSystemPicker: false }
  );
}

function toGeom(g: GeomLine): DesktopGeom {
  return {
    hwnd: g.hwnd,
    win: g.win,
    client: g.client,
    iconic: g.iconic,
    visible: g.visible,
    foreground: g.foreground,
    gone: g.gone === true
  };
}

/**
 * 盯住某个窗口。抓帧源要等界面自己来要（getDisplayMedia），这里先把位置那条线接上：
 * 叠层要跟着窗口走、点之前要知道窗口在哪儿、界面也要能显示"窗口最小化了"这种状态。
 */
export async function pickWindow(win: DesktopWindow | null): Promise<{ ok: boolean; error?: string }> {
  stopWatch?.();
  stopWatch = null;
  hideMark();
  if (!win) {
    target = null;
    geom = null;
    return { ok: true };
  }
  let alive = false;
  try {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
    alive = sources.some((s) => s.id === win.id);
  } catch {
    alive = false;
  }
  if (!alive) {
    target = null;
    geom = null;
    return { ok: false, error: '那个窗口已经不在了，重新选一个' };
  }
  target = { ...win };
  geom = null;
  if (win.hwnd > 0) {
    stopWatch = watchWindow(win.hwnd, (line) => {
      geom = toGeom(line);
      geomSink?.(geom);
      // 窗口被拖动、换了大小、被最小化的时候，叠层要么跟着挪，要么收起来
      if (drawn) {
        if (geom.gone || geom.iconic || !geom.visible) hideMark();
        else if (drawnFrame) positionOverlay(drawnFrame);
      }
    });
  }
  return { ok: true };
}

export function currentGeom(): DesktopGeom | null {
  return geom;
}

const OVERLAY_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
canvas{display:block;width:100vw;height:100vh}
</style></head><body><canvas id="c"></canvas><script>
var c = document.getElementById('c');
function fit(){ c.width = window.innerWidth; c.height = window.innerHeight; paint(); }
window.addEventListener('resize', fit);
window.__mark = null;
window.__draw = function(m){ window.__mark = m; paint(); };
window.__clear = function(){ window.__mark = null; paint(); };
window.__state = function(){ return { mark: window.__mark, w: c.width, h: c.height }; };
function paint(){
  var g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  var m = window.__mark;
  if (!m) return;
  var x = m.fx * c.width, y = m.fy * c.height;
  var r = Math.max(9, Math.min(c.width, c.height) * 0.022);
  // 两圈：外面那圈是护着里面那圈的深色描边，木色底和棋子上都看得清
  var core = m.color === 2 ? '#14171c' : '#f7f8fa';
  var edge = m.color === 2 ? '#f7f8fa' : '#14171c';
  g.lineCap = 'round';
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  g.lineWidth = Math.max(4, r * 0.5); g.strokeStyle = edge; g.stroke();
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  g.lineWidth = Math.max(2, r * 0.26); g.strokeStyle = core; g.stroke();
  // 中间一个小点，标的是交叉点本身
  g.beginPath(); g.arc(x, y, Math.max(1.5, r * 0.14), 0, Math.PI * 2);
  g.fillStyle = core; g.fill();
}
fit();
</script></body></html>`;

function overlayFile(): string {
  const file = path.join(tmpDir(), 'overlay.html');
  writeFileSync(file, OVERLAY_HTML, 'utf8');
  return file;
}

function ensureOverlay(): BrowserWindow | null {
  if (overlay && !overlay.isDestroyed()) return overlay;
  const win = new BrowserWindow({
    width: 200,
    height: 200,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false }
  });
  // 点得到它就点不到下面的棋盘了，这一层永远只是看的
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  overlayReady = new Promise<void>((resolve) => {
    win.webContents.once('did-finish-load', () => resolve());
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void win.loadFile(overlayFile());
  win.on('closed', () => {
    overlay = null;
    overlayReady = null;
  });
  overlay = win;
  return win;
}

/** 把叠层铺到目标窗口上，并把它挪到这一帧画面盖住的那块矩形的位置。 */
function positionOverlay(frame: FrameSize): { ok: boolean; error?: string } {
  const g = geom;
  const win = ensureOverlay();
  if (!win) return { ok: false, error: '叠层开不出来' };
  if (!target) return { ok: false, error: '还没选窗口' };
  if (!g) return { ok: false, error: '还没读到目标窗口的位置' };
  if (g.gone) return { ok: false, error: '目标窗口已经关掉了' };
  if (g.iconic) return { ok: false, error: '目标窗口最小化了' };
  if (!g.visible) return { ok: false, error: '目标窗口不在屏幕上' };
  const region = pickFrameRect(frame, g.win, g.client);
  const dip = screen.screenToDipRect(null, {
    x: region.rect.x,
    y: region.rect.y,
    width: region.rect.w,
    height: region.rect.h
  });
  // 无边框全透明的窗口在 Windows 上偶尔会自己去对齐到整数倍缩放，索性按算出来的值再校一次
  win.setBounds({
    x: Math.round(dip.x),
    y: Math.round(dip.y),
    width: Math.max(1, Math.round(dip.width)),
    height: Math.max(1, Math.round(dip.height))
  });
  return { ok: true };
}

/** 把标注画到目标窗口上。点一次就留着，给 ttlMs 的话到点自己消失。 */
export async function showMark(m: DesktopMark): Promise<boolean> {
  drawn = { frac: frameFraction(m.point, m.frame), color: m.color };
  drawnFrame = { width: m.frame.width, height: m.frame.height };
  const placed = positionOverlay(drawnFrame);
  if (!placed.ok) return false;
  const win = overlay;
  if (!win || win.isDestroyed()) return false;
  if (overlayReady) await overlayReady;
  if (!win.isDestroyed()) {
    const payload = { fx: drawn.frac.x, fy: drawn.frac.y, color: m.color };
    void win.webContents.executeJavaScript(`window.__draw(${JSON.stringify(payload)})`);
    win.showInactive();
  }
  if (markTimer) clearTimeout(markTimer);
  markTimer = null;
  if (m.ttlMs && m.ttlMs > 0) {
    markTimer = setTimeout(() => {
      hideMark();
    }, m.ttlMs);
  }
  return true;
}

export function hideMark(): void {
  if (markTimer) clearTimeout(markTimer);
  markTimer = null;
  drawn = null;
  drawnFrame = null;
  if (overlay && !overlay.isDestroyed()) {
    void overlay.webContents.executeJavaScript('window.__clear()').catch(() => undefined);
    overlay.hide();
  }
}

/** 叠层现在画的是什么（落点在哪、什么颜色）。验收时用它核对对位。 */
export function markState(): { frac: { x: number; y: number }; color: 1 | 2; bounds: PxRect | null } | null {
  if (!drawn) return null;
  const b =
    overlay && !overlay.isDestroyed()
      ? (() => {
          const r = overlay.getBounds();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        })()
      : null;
  return { frac: drawn.frac, color: drawn.color, bounds: b };
}

function explain(reason: string | undefined): string {
  if (!reason) return '点不动';
  if (reason === 'gone') return '目标窗口已经关掉了';
  if (reason === 'minimized') return '目标窗口最小化了，点不进去';
  if (reason === 'hidden') return '目标窗口不在屏幕上';
  if (reason === 'outside') return '算出来的那一点不在目标窗口的客户区里（窗口位置变了，或者框选过时了）';
  if (reason === 'resized') return '窗口刚改了大小，画面还没跟上，这一拍先不点，下一拍重新认过再点';
  if (reason.startsWith('covered:')) {
    const [, rootPid, targetPid] = reason.split(':');
    return `那一点上盖着别的窗口（属于进程 ${rootPid}，目标进程是 ${targetPid}），没敢点`;
  }
  return reason;
}

/**
 * 真点一下。坐标由调用方按画面像素给，这里换算成屏幕物理像素。
 *
 * 点之前把叠层收起来：它是最上层的窗口，虽然设了鼠标穿透，但没必要让它夹在鼠标和目标之间。
 */
export async function clickPoint(frame: FrameSize, point: { x: number; y: number }): Promise<DesktopClickResult> {
  const g = geom;
  if (!target) return { ok: false, reason: '还没选窗口' };
  if (!g || g.gone) return { ok: false, reason: '目标窗口不在了' };
  if (g.iconic) return { ok: false, reason: '目标窗口最小化了，点不进去' };
  if (!g.visible) return { ok: false, reason: '目标窗口不在屏幕上' };
  const region = pickFrameRect(frame, g.win, g.client);
  // 画面比跟窗口现在的比例对不上，说明窗口在这几帧里改过大小，按比例算出来的点会偏
  if (!frameAspectMatches(frame, region.rect)) return { ok: false, reason: 'resized' };
  const at = framePointToScreen(point, frame, region.rect);
  hideMark();
  const res = await clickAt(target.hwnd, ownerHwnd, at.x, at.y);
  if (!res.ok) return { ok: false, reason: explain(res.reason), screen: at, focusBack: res.focusBack };
  return { ok: true, screen: at, focusBack: res.focusBack };
}

export async function windows(): Promise<DesktopWindow[]> {
  return listWindows();
}

/** 程序退出前把常驻的那个读位置进程收掉。 */
export function disposeDesktop(): void {
  stopWatch?.();
  stopWatch = null;
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  overlay = null;
}
