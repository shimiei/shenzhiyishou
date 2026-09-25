import { useEffect, useMemo, useRef } from 'react';
import { useStore } from './state/store';
import { TitleBar } from './components/TitleBar';
import { Toolbar } from './components/Toolbar';
import { LeftPanel } from './components/LeftPanel';
import { EnginePanel } from './components/EnginePanel';
import { StatusBar } from './components/StatusBar';
import { BrowserPanel } from './components/BrowserPanel';
import { ImageImportDialog } from './components/ImageImport';
import { DialogsHost } from './components/Dialogs';
import { Board, type Candidate } from './components/Board';
import { useShortcuts } from './hooks/useShortcuts';
import { infoFromTree, marksAt, moveAtSized, moveNumberAt, pathTo, positionAt, propNum } from './core/sgf/tree';
import { serializeSgf } from './core/sgf/serialize';
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
  const setSplit = useStore((s) => s.setSplit);
  const settings = useStore((s) => s.settings);
  const zoom = useStore((s) => s.zoom);
  const showOwnership = useStore((s) => s.showOwnership);
  const setShowOwnership = useStore((s) => s.setShowOwnership);
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  const hover = useStore((s) => s.hover);
  const setHover = useStore((s) => s.setHover);
  const hintMove = useStore((s) => s.hintMove);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const thinking = useStore((s) => s.thinking);
  const wsRef = useRef<HTMLDivElement | null>(null);

  useShortcuts();

  useEffect(() => {
    void boot();
  }, [boot]);

  // 引擎事件
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
            const pane = document.querySelector('webview') as (HTMLElement & { getWebContentsId?: () => number }) | null;
            if (!pane?.getWebContentsId) {
              s.setBrowserOpen(true);
              s.toast('请先在内置浏览器里打开网页', 'info');
              return;
            }
            const dataUrl = await window.api.browser.capture(pane.getWebContentsId());
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

  const onSplitterDown = (e: React.PointerEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startRatio = splitRatio;
    const total = wsRef.current?.clientWidth ?? 1000;
    const move = (ev: PointerEvent): void => {
      setSplit(startRatio + (ev.clientX - startX) / total);
    };
    const up = (): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
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
        <LeftPanel />
        <div className="main-col">
          <div style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
            <div
              style={{
                flex: browserOpen ? `${splitRatio} 1 0%` : '1 1 auto',
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
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
                hintMove={hintMove}
                showCoords={settings.coords}
                showNumbers={settings.moveNumbers}
                numbers={numbers}
                zoom={zoom}
                onHover={setHover}
                onPlay={boardClick}
              />
            </div>
            {browserOpen ? (
              <>
                <div className="splitter" onPointerDown={onSplitterDown} title="拖动调整分屏比例" />
                <div style={{ flex: `${1 - splitRatio} 1 0%`, display: 'flex', minWidth: 0 }}>
                  <BrowserPanel />
                </div>
              </>
            ) : null}
          </div>
        </div>
        <EnginePanel
          snapshot={snapshot}
          showOwnership={showOwnership}
          onShowOwnership={setShowOwnership}
          onPickCandidate={(move) => useStore.getState().setHint(move)}
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
