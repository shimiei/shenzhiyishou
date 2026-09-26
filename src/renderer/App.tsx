import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, activeWebContentsId } from './state/store';
import { TitleBar } from './components/TitleBar';
import { Toolbar } from './components/Toolbar';
import { LeftPanel } from './components/LeftPanel';
import { EnginePanel } from './components/EnginePanel';
import { StatusBar } from './components/StatusBar';
import { BrowserPanel } from './components/BrowserPanel';
import { DragHandle } from './components/DragHandle';
import { ImageImportDialog } from './components/ImageImport';
import { DialogsHost } from './components/Dialogs';
import { Board, type Candidate } from './components/Board';
import { useShortcuts } from './hooks/useShortcuts';
import { infoFromTree, marksAt, moveAtSized, moveNumberAt, pathTo, positionAt, propNum } from './core/sgf/tree';
import { serializeSgf } from './core/sgf/serialize';
import {
  DEFAULT_LEFT,
  DEFAULT_RIGHT,
  DEFAULT_SPLIT,
  DEFAULT_SPLIT_Y,
  LEFT_MAX,
  LEFT_MIN,
  MIN_BOARD_PX,
  MIN_BROWSER_PX,
  RIGHT_MAX,
  RIGHT_MIN,
  SPLITTER_PX,
  fitPanelWidth,
  fitSplit,
  pickAxis,
  pxHint,
  splitSidesHint,
  type SplitAxis
} from './core/layout/panes';
import { BLACK } from '../shared/types';

export function App(): React.ReactElement {
  const ready = useStore((s) => s.ready);
  const boot = useStore((s) => s.boot);
  const tree = useStore((s) => s.tree);
  const current = useStore((s) => s.current);
  const analyzing = useStore((s) => s.analyzing);
  const snapshot = useStore((s) => s.analysis);
  const browserOpen = useStore((s) => s.browserOpen);
  const splitRatio = useStore((s) => s.splitRatio);
  const splitRatioY = useStore((s) => s.splitRatioY);
  const splitAxisPref = useStore((s) => s.splitAxis);
  const setSplitAxis = useStore((s) => s.setSplitAxis);
  const leftWidth = useStore((s) => s.leftWidth);
  const rightWidth = useStore((s) => s.rightWidth);
  const setSplit = useStore((s) => s.setSplit);
  const setLeftWidth = useStore((s) => s.setLeftWidth);
  const setRightWidth = useStore((s) => s.setRightWidth);
  const [wsWidth, setWsWidth] = useState(0);
  const [wsHeight, setWsHeight] = useState(0);
  const dragStart = useRef({ left: DEFAULT_LEFT, right: DEFAULT_RIGHT, split: DEFAULT_SPLIT });
  const settings = useStore((s) => s.settings);
  const zoom = useStore((s) => s.zoom);
  const showOwnership = useStore((s) => s.showOwnership);
  const setShowOwnership = useStore((s) => s.setShowOwnership);
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  const hover = useStore((s) => s.hover);
  const setHover = useStore((s) => s.setHover);
  const hint = useStore((s) => s.hint);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const thinking = useStore((s) => s.thinking);
  const wsRef = useRef<HTMLDivElement | null>(null);

  useShortcuts();

  useEffect(() => {
    void boot();
  }, [boot]);

  // 侧栏能占多宽要看工作区现在多宽，窗口一改就得重新算，所以量着走。
  // 高度也要量：上下分栏时棋盘与浏览器分的是高度。
  useEffect(() => {
    const el = wsRef.current;
    if (!el) return;
    const measure = (): void => {
      setWsWidth(el.clientWidth);
      setWsHeight(el.clientHeight);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [ready]);

  // 网页里点了新标签的链接（主进程拦下来转过来的），在分屏里开成标签
  useEffect(() => {
    return window.api.browser.onOpenTab((req) => {
      useStore.getState().openBrowserTab(req.url, req.activate);
    });
  }, []);  // 引擎事件
  useEffect(() => {
    const off = window.api.engine.onEvent((e) => {
      const st = useStore.getState();
      if (e.type === 'status' && e.status) st.setEngineStatus(e.status);
      else if (e.type === 'log' && e.text) st.pushLog(e.text);
      else if (e.type === 'error' && e.text) {
        st.toast(e.text, 'error');
        // 走 stopAnalysis 而不是直接清 analysis：它会一并把 analyzing 置回 false，
        // 否则上面那个重新分析的效果会立刻再发一次，变成死循环。
        void st.stopAnalysis();
      } else if (e.type === 'info' && e.snapshot) {
        const snap = e.snapshot;
        if (snap.nodeId >= 0 && snap.nodeId !== useStore.getState().current) return;
        st.setAnalysis(snap);
      } else if (e.type === 'review' && e.review) {
        st.addReviewPoint(e.review);
        if (e.reviewProgress) useStore.setState({ reviewDone: e.reviewProgress.done, reviewTotal: e.reviewProgress.total });
      } else if (e.type === 'reviewEnd' && e.reviewEnd) {
        st.endReview(e.reviewEnd.reason, e.reviewEnd.error);
      }
    });
    return off;
  }, []);

  // 局面变化时重新分析。
  // 注意这里故意不把 analyzing 放进依赖：它在依赖里的话，打开实时分析这个动作
  // 本身就会触发一次重跑，于是刚起步的分析 200 毫秒后被自己停掉重来，
  // 界面上的候选永远停在最初那几个一访的点上。用 ref 读当前值即可。
  const analyzingRef = useRef(analyzing);
  analyzingRef.current = analyzing;
  useEffect(() => {
    if (!analyzingRef.current) return;
    const t = setTimeout(() => {
      void useStore.getState().startAnalysis(true);
    }, 200);
    return () => clearTimeout(t);
  }, [current, tree, settings.analyzeVisits]);

  // 实时截取：每两三秒看一眼网页上的棋盘。间隔不敢再短，截一张加认一次要两三百毫秒，
  // 而且网页那头落完子常有动画，截太勤容易拍到还没落定的画面。
  const liveCapture = settings.liveCapture;
  useEffect(() => {
    if (!liveCapture) return;
    const t = window.setInterval(() => void useStore.getState().pollBrowser(), 2500);
    return () => window.clearInterval(t);
  }, [liveCapture]);

  // 侧栏切分支时不要残留旧提示
  useEffect(() => {
    useStore.getState().setHint(null);
  }, [current]);

  // 菜单命令
  useEffect(() => {
    const off = window.api.app.onCommand((cmd) => {
      const s = useStore.getState();
      switch (cmd) {
        case 'new':
          s.setDialog('newgame');
          break;
        case 'open':
          void window.api.files.openSgf().then((res) => {
            if (res) s.loadSgf(res.content, res.path);
          });
          break;
        case 'save':
        case 'saveAs':
          void (async () => {
            const content = serializeSgf(s.tree);
            const info = infoFromTree(s.tree);
            const name = `${info.blackName || '黑'}对${info.whiteName || '白'}.sgf`;
            const saved = await window.api.files.saveSgf(s.filePath ?? name, content);
            if (saved) {
              useStore.setState({ filePath: saved, dirty: false });
              s.toast('已保存到 ' + saved, 'success');
            }
          })();
          break;
        case 'importImage':
          void window.api.files.openImage().then((img) => {
            if (img) s.openImage({ dataUrl: img.dataUrl, name: img.name });
          });
          break;
        case 'captureBrowser':
          void (async () => {
            const id = activeWebContentsId();
            if (id === null) {
              s.setBrowserOpen(true);
              s.toast('请先在内置浏览器里打开网页', 'info');
              return;
            }
            const dataUrl = await window.api.browser.capture(id);
            if (dataUrl) s.openImage({ dataUrl, name: '内置浏览器截取' });
            else s.toast('截取失败', 'error');
          })();
          break;
        case 'undo':
          s.undo();
          break;
        case 'redo':
          s.redo();
          break;
        case 'pass':
          s.pass();
          break;
        case 'resign':
          s.resign();
          break;
        case 'hint':
          void s.doHint();
          break;
        case 'aiMove':
          void s.aiMoveNow();
          break;
        case 'toggleAiVsAi':
          s.toggleAiVsAi();
          break;
        case 'toggleAnalysis':
          void s.toggleAnalysis();
          break;
        case 'score':
          s.setDialog('score');
          break;
        case 'copySgf':
          void window.api.clip.writeText(serializeSgf(s.tree)).then(() => s.toast('SGF 已复制到剪贴板', 'success'));
          break;
        case 'settings':
          s.setDialog('settings');
          break;
        case 'models':
          s.setDialog('models');
          break;
        case 'library':
          void (async () => {
            const info = infoFromTree(s.tree);
            const content = serializeSgf(s.tree);
            await window.api.library.save({
              meta: {
                title: `${info.blackName || '黑'} 对 ${info.whiteName || '白'}${info.date ? ' ' + info.date : ''}`,
                blackName: info.blackName,
                whiteName: info.whiteName,
                result: info.result,
                date: info.date,
                size: info.size,
                moves: moveNumberAt(s.tree, s.current)
              },
              content
            });
            s.toast('已存入棋谱库', 'success');
          })();
          break;
        case 'toggleBrowser':
          s.setBrowserOpen(!s.browserOpen);
          break;
        case 'browserNewTab':
          // 分屏关着或者一个标签都没有时，setBrowserOpen 自己会补一个空白标签，
          // 这时候再新建就多出一张空白页了
          if (!s.browserOpen || s.tabs.length === 0) s.setBrowserOpen(true);
          else s.openBrowserTab('about:blank');
          break;
        case 'browserCloseTab': {
          const id = s.activeTabId ?? s.tabs[0]?.id;
          if (id) s.closeBrowserTab(id);
          break;
        }
        case 'browserNextTab':
          s.stepBrowserTab(1);
          break;
        case 'browserPrevTab':
          s.stepBrowserTab(-1);
          break;
        case 'about':
          s.setDialog('about');
          break;
        default:
          break;
      }
    });
    return off;
  }, []);

  const size = propNum(tree, tree.root, 'SZ', 19);
  const position = useMemo(() => positionAt(tree, current), [tree, current]);
  const marks = useMemo(() => marksAt(tree, current), [tree, current]);
  const lastMove = useMemo(() => {
    const mv = moveAtSized(tree, current);
    return mv ? mv.point : null;
  }, [tree, current]);

  const numbers = useMemo(() => {
    const map = new Map<number, number>();
    if (!settings.moveNumbers) return map;
    let n = 0;
    for (const id of pathTo(tree, current)) {
      const mv = moveAtSized(tree, id);
      if (!mv || mv.point < 0) continue;
      n += 1;
      map.set(mv.point, n);
    }
    return map;
  }, [tree, current, settings.moveNumbers]);

  const candidates: Candidate[] = useMemo(() => {
    if (!snapshot?.lines?.length) return [];
    return snapshot.lines.slice(0, 5).map((l) => ({
      move: l.move,
      visits: l.visits,
      // 统一换算成黑棋胜率，和上面的胜率条一致
      winrate: snapshot.turn === 'B' ? l.winrate : 1 - l.winrate
    }));
  }, [snapshot]);

  // 侧栏按用户拖出来的宽度显示，但必须先给中间那块留够地方：
  // 窗口拖窄的时候光靠 CSS 的 min-width 会把棋盘挤成一条缝，这里连上限一起算出来。
  // 中间那块要留多少跟分屏有关：浏览器开着的时候棋盘和浏览器都得有地方站。
  const panes = useMemo(() => {
    const total = wsWidth || 1500;
    const mid = browserOpen ? MIN_BOARD_PX + SPLITTER_PX + MIN_BROWSER_PX : MIN_BOARD_PX;
    const left = fitPanelWidth(leftWidth, LEFT_MIN, LEFT_MAX, total, RIGHT_MIN + SPLITTER_PX + mid);
    const right = fitPanelWidth(rightWidth, RIGHT_MIN, RIGHT_MAX, total, left + SPLITTER_PX + mid);
    const mainWidth = Math.max(total - left - right - 2 * SPLITTER_PX, 0);
    return { left, right, mainWidth, mid };
  }, [leftWidth, rightWidth, wsWidth, browserOpen]);

  /**
   * 中间那块怎么排。用户自己选过就听用户的；没选过时按窗口挑一个：
   * 左右分栏摆出来浏览器比它自己还高（竖着的一条窄缝）就用上下分栏，
   * 免得一打开浏览器就是手机版的网页。
   */
  const layoutAxis: SplitAxis =
    splitAxisPref === 'auto' ? pickAxis(splitRatio, panes.mainWidth, wsHeight || 900) : splitAxisPref;
  /** 当前方向下棋盘占的比例。两个方向各记一份，切来切去不用重新拖一遍。 */
  const axisRatio = layoutAxis === 'y' ? splitRatioY : splitRatio;
  /** 当前方向下中间那块的可用边长：左右分栏看宽度，上下分栏看高度。 */
  const mainSize = (): number => (layoutAxis === 'y' ? wsHeight || 900 : panes.mainWidth);

  const split = browserOpen ? fitSplit(axisRatio, mainSize(), layoutAxis) : DEFAULT_SPLIT;

  /** 拖动时只改"用户意图值"：按当前窗口夹一遍再存，免得存进去一个非法的宽度。 */
  const dragLeft = (dx: number): void => {
    const total = wsRef.current?.clientWidth ?? 1500;
    setLeftWidth(
      fitPanelWidth(dragStart.current.left + dx, LEFT_MIN, LEFT_MAX, total, RIGHT_MIN + SPLITTER_PX + panes.mid)
    );
  };
  const dragRight = (dx: number): void => {
    const total = wsRef.current?.clientWidth ?? 1500;
    // 右栏在右边，往右拖是把它拖窄
    setRightWidth(
      fitPanelWidth(dragStart.current.right - dx, RIGHT_MIN, RIGHT_MAX, total, panes.left + SPLITTER_PX + panes.mid)
    );
  };
  /**
   * 上下分栏时把这条横的分隔条往下拖，上面那块（棋盘）变大；左右分栏时
   * 把竖的分隔条往右拖，左边那块（棋盘）变大。两个方向都是"往棋盘那边拖棋盘就变大"，
   * 所以位移的正负号是同一套算法。
   */
  const dragSplit = (delta: number): void => {
    const usable = Math.max(mainSize() - SPLITTER_PX, 1);
    setSplit(fitSplit(dragStart.current.split + delta / usable, mainSize(), layoutAxis), layoutAxis);
  };

  // 提示显示的是"实际会显示成多宽"，跟渲染用的是同一套夹取，
  // 窗口不够宽时不会谎报一个显示不出来的数字
  const liveWidth = (): number => wsRef.current?.clientWidth ?? 1500;
  const leftHint = (): string =>
    pxHint(fitPanelWidth(useStore.getState().leftWidth, LEFT_MIN, LEFT_MAX, liveWidth(), RIGHT_MIN + SPLITTER_PX + panes.mid));
  const rightHint = (): string =>
    pxHint(fitPanelWidth(useStore.getState().rightWidth, RIGHT_MIN, RIGHT_MAX, liveWidth(), panes.left + SPLITTER_PX + panes.mid));
  const splitHint = (): string => {
    const s = useStore.getState();
    const axis = layoutAxis;
    const size = axis === 'y' ? (wsRef.current?.clientHeight ?? 900) : panes.mainWidth;
    const ratio = axis === 'y' ? s.splitRatioY : s.splitRatio;
    return splitSidesHint(fitSplit(ratio, size, axis), size, axis);
  };

  if (!ready) {
    return (
      <div className="app" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="dim">正在准备…</div>
      </div>
    );
  }

  const boardClick = (point: number): void => {
    const s = useStore.getState();
    if (tool === 'play') s.play(point);
    else if (tool === 'black') s.setSetupStone(point, BLACK);
    else if (tool === 'white') s.setSetupStone(point, 2);
    else if (tool === 'erase') s.setSetupStone(point, 0);
    else s.toggleMark(tool, point);
  };

  return (
    <div className="app">
      <TitleBar />
      <Toolbar />
      <div className="workspace" ref={wsRef}>
        <LeftPanel style={{ width: panes.left, minWidth: panes.left }} />
        <DragHandle
          title="拖动调整左栏宽度，双击复位"
          onStart={() => {
            // 从"看得见的宽度"起步，不是从存盘的那个数：窗口窄的时候两者不一样，
            // 否则会先拖过一段什么都不动的距离，手感发黏
            dragStart.current.left = panes.left;
          }}
          onMove={(dx) => dragLeft(dx)}
          hint={leftHint}
          onReset={() => setLeftWidth(DEFAULT_LEFT)}
        />
        <div className="main-col">
          <div
            className={'main-split' + (layoutAxis === 'y' ? ' stacked' : '')}
            style={{
              display: 'flex',
              flexDirection: layoutAxis === 'y' ? 'column' : 'row',
              flex: 1,
              minHeight: 0,
              minWidth: 0
            }}
          >
            <div
              style={{
                flex: browserOpen ? `${split} 1 0%` : '1 1 auto',
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                minHeight: 0,
                position: 'relative'
              }}
            >
              <div className="toolbar" style={{ height: 34, minHeight: 34, background: 'transparent', borderBottom: 'none', paddingTop: 4 }}>
                <div className="seg" title="落子与编辑工具">
                  {(
                    [
                      ['play', '落子'],
                      ['black', '放黑子'],
                      ['white', '放白子'],
                      ['erase', '拿掉子'],
                      ['triangle', '三角'],
                      ['square', '方块'],
                      ['circle', '圆'],
                      ['cross', '叉'],
                      ['label', '字母']
                    ] as Array<[typeof tool, string]>
                  ).map(([t, label]) => (
                    <button key={t} className={'seg-item' + (tool === t ? ' active' : '')} onClick={() => setTool(t)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="spacer" />
                {thinking ? <span className="badge warn">引擎思考中…</span> : null}
                <span className="small faint">{hover !== null ? coordText(hover, size) : ''}</span>
              </div>
              <Board
                size={size}
                position={position}
                marks={marks}
                lastMove={lastMove}
                hover={hover}
                ownership={showOwnership ? (snapshot?.ownership ?? null) : null}
                candidates={candidates}
                hintMove={hint?.move ?? null}
                hintColor={hint?.color ?? null}
                showCoords={settings.coords}
                showNumbers={settings.moveNumbers}
                lastMoveMark={settings.lastMoveMark}
                numbers={numbers}
                zoom={zoom}
                onHover={setHover}
                onPlay={boardClick}
              />
            </div>
            {browserOpen ? (
              <>
                <DragHandle
                  dir={layoutAxis}
                  title={
                    layoutAxis === 'y'
                      ? '拖动调整棋盘与浏览器的高度，双击复位'
                      : '拖动调整棋盘与浏览器的宽度，双击复位'
                  }
                  onStart={() => {
                    // 从"看得见的尺寸"起步，不是从存盘的那个数：窗口小的时候两者不一样，
                    // 否则会先拖过一段什么都不动的距离，手感发黏
                    dragStart.current.split = split;
                  }}
                  onMove={(delta) => dragSplit(delta)}
                  hint={splitHint}
                  onReset={() => setSplit(layoutAxis === 'y' ? DEFAULT_SPLIT_Y : DEFAULT_SPLIT, layoutAxis)}
                />
                <div style={{ flex: `${1 - split} 1 0%`, display: 'flex', minWidth: 0, minHeight: 0 }}>
                  <BrowserPanel axis={layoutAxis} onAxis={setSplitAxis} />
                </div>
              </>
            ) : null}
          </div>
        </div>
        <DragHandle
          title="拖动调整右栏宽度，双击复位"
          onStart={() => {
            dragStart.current.right = panes.right;
          }}
          onMove={(dx) => dragRight(dx)}
          hint={rightHint}
          onReset={() => setRightWidth(DEFAULT_RIGHT)}
        />
        <EnginePanel
          style={{ width: panes.right, minWidth: panes.right }}
          snapshot={snapshot}
          showOwnership={showOwnership}
          onShowOwnership={setShowOwnership}
          onPickCandidate={(c) => useStore.getState().pickCandidate(c.move, c.winrate, c.scoreLead)}
        />
      </div>
      <StatusBar />
      <DialogsHost snapshot={snapshot} />
      <ImageImportDialog />
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.kind} onClick={() => dismissToast(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function coordText(point: number, size: number): string {
  const letters = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
  return letters[point % size] + String(size - Math.floor(point / size));
}
