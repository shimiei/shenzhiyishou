/**
 * 程序外面那些窗口：列出来、盯住它的位置、往它上面真点一下。
 *
 * 为什么走 PowerShell 而不是原生模块：这个项目里一个原生插件都没有（装起来要编译工具链，
 * 打包也跟着麻烦），而 Win32 这几件事（读窗口矩形、查某个屏幕点归谁、搬光标点一下）
 * 用 PowerShell 里的 Add-Type 调 user32 就够，脚本还能打开看。代价是每次点都要起一个
 * powershell.exe（两三百毫秒），对"下一手棋"这种节奏完全够用；只有盯位置那件事要常驻，
 * 所以它单独一个只往外打印的进程，不接命令（PowerShell 里非阻塞读标准输入很难写，
 * 而读位置要的是连续，点一下要的是一次，分成两条路各自都简单）。
 *
 * 坐标一律用屏幕物理像素（跟 Win32 一致）；给 Electron 的 setBounds 之前由调用方换算成 DIP。
 * 脚本正文（那段 C# 与三段 PowerShell）在 winScripts.ts，那边不依赖 electron，自测能直接跑。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { desktopCapturer } from 'electron';
import { tmpDir } from './paths';
import type { DesktopWindow } from '../shared/protocol';
import type { PxRect } from '../shared/windowMap';
import { writeWinScripts } from './winScripts';

/**
 * 目标窗口的一条几何记录。跟协议里的 DesktopGeom 一致，只是主进程内部用。
 */
export interface GeomLine {
  hwnd: number;
  win: PxRect;
  client: PxRect;
  iconic: boolean;
  visible: boolean;
  foreground: boolean;
  /** 助手进程的 DPI 感知（2 = 每显示器感知），坐标是不是物理像素全看它。 */
  dpi?: number;
  gone: boolean;
}

export interface ClickOutcome {
  ok: boolean;
  reason?: string;
  focusBack?: boolean;
}

/**
 * 把三个脚本写进运行目录再交给 PowerShell。写文件那一步在 winScripts 里：
 * 那边不依赖 electron，自测可以直接拿它把同样的字节写出来跑一遍。
 */
function scripts(): { list: string; watch: string; click: string } {
  return writeWinScripts(path.join(tmpDir(), 'win'));
}

function powershell(): string {
  const root = process.env.SystemRoot;
  if (root) return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return 'powershell.exe';
}

function run(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = powershell();
    const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], {
      windowsHide: true
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('powershell 超时'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      out += d;
    });
    child.stderr.on('data', (d: string) => {
      err += d;
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const line = out.trim().split(/\r?\n/).filter((l) => l.startsWith('{') || l.startsWith('[')).pop();
      if (!line) {
        reject(new Error(err.trim() || 'powershell 没给出结果'));
        return;
      }
      resolve(line);
    });
  });
}

/**
 * 屏幕上现在有哪些窗口可以盯。抓帧那头由 desktopCapturer 说了算（真正截的是它），
 * 位置与进程名那头由 PowerShell 说了算，两边按窗口句柄对起来；对不上就退回按标题找。
 */
export async function listWindows(): Promise<DesktopWindow[]> {
  const files = scripts();
  let geo: Array<{ hwnd: number; pid: number; proc: string; title: string; iconic: boolean }> = [];
  try {
    geo = JSON.parse(await run(files.list, [], 8000)) as typeof geo;
  } catch {
    geo = [];
  }
  const byHwnd = new Map<number, (typeof geo)[number]>();
  const byTitle = new Map<string, (typeof geo)[number]>();
  for (const g of geo) {
    byHwnd.set(g.hwnd, g);
    if (!byTitle.has(g.title)) byTitle.set(g.title, g);
  }
  let sources: Array<{ id: string; name: string }> = [];
  try {
    const list = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
    sources = list.map((s) => ({ id: s.id, name: s.name }));
  } catch {
    sources = [];
  }
  const out: DesktopWindow[] = [];
  const seen = new Set<number>();
  for (const s of sources) {
    // 窗口源的 id 形如 window:123456:0，中间那截就是窗口句柄
    const m = /^window:(\d+):/.exec(s.id);
    const hwnd = m ? Number(m[1]) : 0;
    const g = (hwnd ? byHwnd.get(hwnd) : undefined) ?? byTitle.get(s.name);
    const proc = g?.proc ?? '';
    // 自己程序的窗口（包括落点提示那一层）不该出现在"盯住哪个窗口"里
    if (g && g.pid === process.pid) continue;
    if (g && seen.has(g.hwnd)) continue;
    if (g) seen.add(g.hwnd);
    out.push({
      id: s.id,
      hwnd: g?.hwnd ?? hwnd,
      title: s.name,
      proc,
      iconic: g?.iconic ?? false
    });
  }
  return out;
}

/** 盯着一个窗口的位置。返回停止函数；窗口关掉时也会自己停（最后报一条 gone）。 */
export function watchWindow(hwnd: number, onGeom: (g: GeomLine) => void, onEnd?: () => void): () => void {
  const files = scripts();
  const ps = powershell();
  let child: ChildProcessWithoutNullStreams | null = null;
  let stopped = false;
  try {
    child = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', files.watch, '-Hwnd', String(hwnd)], {
      windowsHide: true
    });
  } catch {
    onEnd?.();
    return () => undefined;
  }
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    buf += d;
    let idx = buf.indexOf('\n');
    while (idx >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.startsWith('{')) {
        try {
          const g = JSON.parse(line) as GeomLine;
          onGeom(g);
        } catch {
          /* 半行或者坏行，丢掉 */
        }
      }
      idx = buf.indexOf('\n');
    }
  });
  const done = (): void => {
    if (stopped) return;
    stopped = true;
    onEnd?.();
  };
  child.on('close', done);
  child.on('error', done);
  return () => {
    stopped = true;
    child?.kill();
  };
}

/**
 * 往那个窗口的那个点真点一下。owner 是本程序主窗口的句柄：点完把前台还回来，
 * 不然用户的快捷键会打进刚被点过的那个客户端里。
 */
export async function clickAt(hwnd: number, owner: number, x: number, y: number): Promise<ClickOutcome> {
  const files = scripts();
  try {
    const raw = await run(
      files.click,
      ['-Hwnd', String(hwnd), '-Owner', String(owner), '-X', String(Math.round(x)), '-Y', String(Math.round(y))],
      9000
    );
    const res = JSON.parse(raw) as { ok: boolean; reason?: string; focusBack?: boolean };
    return { ok: res.ok, reason: res.reason, focusBack: res.focusBack };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : '点不动' };
  }
}
