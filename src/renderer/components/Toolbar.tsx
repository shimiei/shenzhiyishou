import { activeWebContentsId, useStore } from '../state/store';
import { serializeSgf } from '../core/sgf/serialize';
import { infoFromTree } from '../core/sgf/tree';

function suggestName(): string {
  const { tree } = useStore.getState();
  const info = infoFromTree(tree);
  const b = info.blackName || '黑';
  const w = info.whiteName || '白';
  const d = info.date
    ? info.date.replace(/[^\d]/g, '').slice(0, 8)
    : new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${b}对${w}_${d}.sgf`;
}

export function Toolbar(): React.ReactElement {
  const zoom = useStore((s) => s.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const setDialog = useStore((s) => s.setDialog);
  const loadSgf = useStore((s) => s.loadSgf);
  const openImage = useStore((s) => s.openImage);
  const setBrowserOpen = useStore((s) => s.setBrowserOpen);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const pass = useStore((s) => s.pass);
  const resign = useStore((s) => s.resign);
  const doHint = useStore((s) => s.doHint);
  const aiMoveNow = useStore((s) => s.aiMoveNow);
  const toggleAnalysis = useStore((s) => s.toggleAnalysis);
  const toast = useStore((s) => s.toast);
  const analyzing = useStore((s) => s.analyzing);
  const thinking = useStore((s) => s.thinking);
  const browserOpen = useStore((s) => s.browserOpen);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const finished = useStore((s) => s.finished);
  const reviewMoves = useStore((s) => s.reviewMoves);
  const reviewRunning = useStore((s) => s.reviewRunning);
  const reviewDone = useStore((s) => s.reviewDone);
  const reviewTotal = useStore((s) => s.reviewTotal);
  const gotoProblem = useStore((s) => s.gotoProblem);

  const save = async (): Promise<void> => {
    const { tree, filePath } = useStore.getState();
    const content = serializeSgf(tree);
    const saved = await window.api.files.saveSgf(filePath ?? suggestName(), content);
    if (saved) {
      useStore.setState({ filePath: saved, dirty: false });
      toast('已保存到 ' + saved, 'success');
    }
  };

  const capture = async (): Promise<void> => {
    // 认当前标签，不是第一个 webview：浏览器栏里可能开着好几张页面
    const id = activeWebContentsId();
    if (id === null) {
      setBrowserOpen(true);
      toast('请先在右侧内置浏览器里打开网页，再点截取', 'info');
      return;
    }
    const dataUrl = await window.api.browser.capture(id);
    if (!dataUrl) {
      toast('截取失败，请确认内置浏览器已经加载了页面', 'error');
      return;
    }
    openImage({ dataUrl, name: '内置浏览器截取' });
  };

  return (
    <div className="toolbar">
      <button className="btn" onClick={() => setDialog('newgame')} title="新建对局（Ctrl+N）">
        新建
      </button>
      <button
        className="btn"
        title="打开棋谱（Ctrl+O）"
        onClick={async () => {
          const res = await window.api.files.openSgf();
          if (res) loadSgf(res.content, res.path);
        }}
      >
        打开
      </button>
      <button className="btn" onClick={() => void save()} title="保存棋谱（Ctrl+S）">
        保存
      </button>
      <div className="tb-sep" />
      <button
        className="btn"
        title="从图片或截图识别棋谱（Ctrl+I）"
        onClick={async () => {
          const img = await window.api.files.openImage();
          if (img) openImage({ dataUrl: img.dataUrl, name: img.name });
        }}
      >
        图片识别
      </button>
      <button className="btn" onClick={() => void capture()} title="截取内置浏览器画面里的棋谱">
        截取棋谱
      </button>
      <button className="btn" onClick={() => setBrowserOpen(true)} title="打开内置浏览器（Ctrl+B）">
        内置浏览器
      </button>
      <div className="tb-sep" />
      <button className="btn" disabled={past === 0} onClick={undo} title="撤销（Ctrl+Z）">
        撤销
      </button>
      <button className="btn" disabled={future === 0} onClick={redo} title="重做（Ctrl+Y）">
        重做
      </button>
      <div className="tb-sep" />
      <button className="btn" disabled={Boolean(finished)} onClick={pass} title="停一手（P）">
        停一手
      </button>
      <button className="btn danger" disabled={Boolean(finished)} onClick={resign} title="认输">
        认输
      </button>
      <div className="tb-sep" />
      <button className="btn" disabled={thinking} onClick={() => void doHint()} title="推荐现在这一方的一手，标明黑白；只给建议，不替你落子（H）">
        提示
      </button>
      <button className="btn" disabled={thinking || Boolean(finished)} onClick={() => void aiMoveNow()} title="让引擎替现在这一方走一手，走完就停；辅助模式下用它当对手（空格）">
        AI 走一手
      </button>
      <button
        className={'btn' + (analyzing ? ' primary' : '')}
        onClick={() => void toggleAnalysis()}
        title="开始或暂停实时分析（A）"
      >
        {analyzing ? '暂停分析' : '实时分析'}
      </button>
      <button className="btn" onClick={() => setDialog('score')} title="形势判断与数子（E）">
        形势判断
      </button>
      <div className="tb-sep" />
      <button
        className={'btn' + (reviewRunning ? ' primary' : '')}
        onClick={() => setDialog('review')}
        title="逐手复盘：让引擎把这一局的每一手都算一遍，找出恶手与失误（R）"
      >
        {reviewRunning ? `复盘 ${reviewDone}/${reviewTotal}` : '复盘'}
      </button>
      <button className="btn" disabled={reviewMoves.length === 0} onClick={() => gotoProblem(-1)} title="跳到上一处问题手">
        上一处问题
      </button>
      <button className="btn" disabled={reviewMoves.length === 0} onClick={() => gotoProblem(1)} title="跳到下一处问题手">
        下一处问题
      </button>
      <div className="spacer" />
      <div className="seg" title="棋盘缩放">
        <button className="seg-item" onClick={() => setZoom(zoom - 0.1)}>
          −
        </button>
        <button className="seg-item" onClick={() => setZoom(1)} title="恢复默认大小">
          {Math.round(zoom * 100)}%
        </button>
        <button className="seg-item" onClick={() => setZoom(zoom + 0.1)}>
          +
        </button>
      </div>
      <button
        className={'btn' + (browserOpen ? ' primary' : '')}
        onClick={() => setBrowserOpen(!browserOpen)}
        title="显示或隐藏内置浏览器（Ctrl+B）"
      >
        分屏
      </button>
      <button className="btn" onClick={() => setDialog('settings')} title="设置（Ctrl+,）">
        设置
      </button>
    </div>
  );
}
