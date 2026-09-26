import { useEffect, useMemo, useRef, useState } from 'react';
import { useThinking, useStore, activeWebContentsId } from './state/store';
import { TitleBar } from './components/TitleBar';
import { Toolbar } from './components/Toolbar';
import { BoardTabs } from './components/BoardTabs';
import { LeftPanel } from './components/LeftPanel';
import { EnginePanel } from './components/EnginePanel';
import { StatusBar } from './components/StatusBar';
import { BrowserPanel } from './components/BrowserPanel';
import { DragHandle } from './components/DragHandle';
import { ScrollRow } from './components/ScrollRow';
import { ImageImportDialog } from './components/ImageImport';
import { DialogsHost } from './components/Dialogs';
import { LibraryPage } from './components/LibraryPage';
import { Board, type Candidate } from './components/Board';
import { useShortcuts } from './hooks/useShortcuts';
import {
  marksAt,
  moveAtSized,
  pathTo,
  positionAt,
  propNum,
  turnWithOverride
} from './core/sgf/tree';
import { serializeSgf } from './core/sgf/serialize';
import { nextLabel } from './core/sgf/codec';
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
  const activeBoard = useStore((s) => s.activeBoard);
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
  const freeColor = useStore((s) => s.freeColor);
  const setFreeColor = useStore((s) => s.setFreeColor);
  const turnOverride = useStore((s) => s.turnOverride);
  const libraryPage = useStore((s) => s.libraryPage);
  const thinking = useThinking();
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
        if (e.board) {
          /*
           * 出错的是某一盘的分析流：把那一盘收干净就行。
           * 走停分析那一套（状态先落、再问引擎）而不是直接清字段，
           * 否则"局面一变就重开分析"那个效果会立刻再发一次，变成死循环。
           */
          st.patchBoard(e.board, { analyzing: false, analysis: null });
          void window.api.engine.analyzeStop(e.board);
        } else {
          void st.stopAnalysis();
        }
      } else if (e.type === 'info' && e.snapshot) {
        /*
         * nodeId 为 -1 的是对局引擎"正在算这一手"的实时战报，跟实时分析不是一回事，
         * 分析关着的时候也照收（不然 AI 落子那几秒面板上什么都不显示）。
         * 带节点号的是分析结论，分析关掉之后流断开之前可能还有一两行在路上，
         * 别让它们把刚清空的面板又填上（这一层判断在 applySnapshot 里）。
         * 落到哪一盘由 board 说了算：开着的棋盘不止一盘，收错了盘子会画到别人的谱上。
         */
        st.applySnapshot(e.board ?? '', e.snapshot);
      } else if (e.type === 'analysisStopped') {
        st.analysisReplaced(e.board ?? '');
      } else if (e.type === 'review' && e.review) {
        st.addReviewPoint(e.review, e.review.board);
        if (e.reviewProgress) st.patchBoard(e.review.board, { reviewDone: e.reviewProgress.done, reviewTotal: e.reviewProgress.total });
      } else if (e.type === 'reviewEnd' && e.reviewEnd) {
        st.endReview(e.reviewEnd.reason, e.reviewEnd.error, e.board ?? '');
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
  // 上一次触发这个效果时是哪一盘。换了盘就不再往下走：切标签不是"局面变了"，
  // 那一盘该跑的分析由它自己的状态（和主进程那头记的归属）说了算。
  const boardRef = useRef(activeBoard);
  useEffect(() => {
    const switched = boardRef.current !== activeBoard;
    boardRef.current = activeBoard;
    if (switched) return;
    if (!analyzingRef.current) return;
    const t = setTimeout(() => {
      // 这 200 毫秒里用户可能已经把分析关了（刚落一手就点暂停），那这一手之后就别再拉起来
      if (!analyzingRef.current) return;
      void useStore.getState().startAnalysis(true);
    }, 200);
    return () => clearTimeout(t);
  }, [current, tree, activeBoard, settings.analyzeVisits]);

  /*
   * 实时截取：平时每一两秒看一次目标画面里的棋盘。
   *
   * 内置浏览器那一档取帧贵（一次 capturePage 要两三百毫秒），所以 2.5 秒、自动落子开着时
   * 1.2 秒；外部窗口那一档是视频流抽帧，几毫秒就取一帧，可以跟紧些，让本地尽快跟上对面。
   * 自动落子开着时两边得一模一样才点得出去，本地落后一手就意味着用户这一下会被判成
   * "那边已经有这一手了"，所以这时宁可多取几次。
   */
  const liveCapture = settings.liveCapture;
  const autoPlay = settings.autoPlay;
  const toWindow = settings.captureSource === 'window';
  useEffect(() => {
    if (!liveCapture) return;
    const idle = toWindow ? 1500 : 2500;
    const busy = toWindow ? 700 : 1200;
    let timer = 0;
    const tick = (): void => {
      void useStore.getState().pollSource();
      timer = window.setTimeout(tick, useStore.getState().settings.autoPlay ? busy : idle);
    };
    timer = window.setTimeout(tick, autoPlay ? busy : idle);
    return () => window.clearTimeout(timer);
  }, [liveCapture, autoPlay, toWindow]);

  /*
   * 点出去但没核实的那一手，每隔一会儿再看一眼两边的棋盘。
   *
   * 不放在实时截取那一拍里：自动落子可以单独开着（实时截取关着），而"没落上的那一手
   * 得自己补上"是自动落子自己的事，不该因为另一个开关关着就没人管。两处同时跑也不要紧，
   * store 里那个正在重试的标志会让它们排着队来。
   */
  useEffect(() => {
    if (!autoPlay) return;
    let timer = 0;
    const tick = (): void => {
      void useStore.getState().retryPending();
      timer = window.setTimeout(tick, 1500);
    };
    timer = window.setTimeout(tick, 1500);
    return () => window.clearTimeout(timer);
  }, [autoPlay]);

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
          // 保存就是存进棋谱馆，不再弹系统对话框；想存成散装 .sgf 走另存为
          void s.saveToLibrary();
          break;
        case 'saveAs':
          void s.saveAsFile();
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
          s.setLibraryPage(true);
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
        case 'boardNew':
          s.openBoardTab();
          break;
        case 'boardDuplicate':
          s.duplicateBoard();
          break;
        case 'boardClose':
          s.closeBoardTab(s.activeBoard);
          break;
        case 'boardCloseOthers':
          s.closeOtherBoards();
          break;
        case 'boardCloseAll':
          s.closeAllBoards();
          break;
        case 'boardNext':
          s.stepBoardTab(1);
          break;
        case 'boardPrev':
          s.stepBoardTab(-1);
          break;
        case 'boardReopen':
          s.reopenBoard();
          break;
        case 'about':
          s.setDialog('about');
          break;
        default: {
          // 菜单里"第 N 个棋盘"那九条
          const nth = /^boardN([1-9])$/.exec(cmd);
          if (nth) s.nthBoardTab(Number(nth[1]));
          break;
        }
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

  /*
   * 字母工具预览用的那个字母：跟真摆下去时挑的是同一个函数，
   * 不然预览写着 A、落下的却是 B。
   */
  const previewLabel =
    tool === 'label' ? nextLabel(tree.nodes[current]?.props.LB ?? []) : undefined;

  // 这一手轮到谁：手动指定过就按指定的。落子预览、状态栏、提示都看它
  const turnColor = turnWithOverride(tree, current, turnOverride);

  const boardClick = (point: number): void => {
    const s = useStore.getState();
    if (tool === 'play') s.play(point);
    // 自由落子：颜色由手里这个选择定，不按手数交替，但它是真正的一手棋（占手数、能悔棋）
    else if (tool === 'free') s.playColor(freeColor, point);
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
              <BoardTabs />
              <div className="toolbar" style={{ height: 34, minHeight: 34, background: 'transparent', borderBottom: 'none', paddingTop: 4 }}>
                <ScrollRow className="tool-row" revealKey={tool === 'free' ? `free-${freeColor}` : tool}>
                  <div className="seg" title="落子与编辑工具">
                    {(
                      [
                        ['play', '落子'],
                        ['free', '自由落子'],
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
                      <button
                        key={t}
                        className={'seg-item' + (tool === t ? ' active' : '')}
                        onClick={() => setTool(t)}
                        title={
                          t === 'play'
                            ? '按棋谱轮流落子：这一手该谁走就落谁的颜色'
                            : t === 'free'
                              ? '自由落子：下一手落哪个颜色由你定，黑白不再轮流。是真的一手棋（占手数、能悔棋），补一手、照着书录棋都行'
                              : t === 'black' || t === 'white'
                                ? '摆子：只把这个颜色的子摆在盘上，不占手数。摆局面、改局面用它'
                                : t === 'erase'
                                  ? '把这一点上的子拿掉，不占手数'
                                  : '标记：点在子或空点上，不改动棋子'
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {tool === 'free' ? (
                    <div className="seg" title="自由落子要落的颜色">
                      <button
                        className={'seg-item' + (freeColor === BLACK ? ' active' : '')}
                        onClick={() => setFreeColor(BLACK)}
                      >
                        <span className="stone-dot black" />黑
                      </button>
                      <button
                        className={'seg-item' + (freeColor === BLACK ? '' : ' active')}
                        onClick={() => setFreeColor(2)}
                      >
                        <span className="stone-dot white" />白
                      </button>
                    </div>
                  ) : null}
                </ScrollRow>
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
                tool={tool}
                turnColor={turnColor}
                freeColor={freeColor}
                previewLabel={previewLabel}
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
      {/* 棋谱馆盖在棋盘这一页上面，棋盘那套还挂着（局面、分析都不动），回来时是原样 */}
      {libraryPage ? <LibraryPage /> : null}
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
