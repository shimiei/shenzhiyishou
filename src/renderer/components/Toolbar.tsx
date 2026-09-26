import { useThinking, activeWebContentsId, useStore } from '../state/store';
import { aiSideOf } from '../core/boards/boards';
import { colorName } from '../core/advice';
import { BLACK, WHITE } from '../../shared/types';
import { ScrollRow } from './ScrollRow';

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
  const toggleAiVsAi = useStore((s) => s.toggleAiVsAi);
  const setAiSide = useStore((s) => s.setAiSide);
  const openBoardTab = useStore((s) => s.openBoardTab);
  const duplicateBoard = useStore((s) => s.duplicateBoard);
  const aiVsAi = useStore((s) => s.game.mode === 'ai-vs-ai');
  const aiSide = useStore((s) => aiSideOf(s.game));
  const toggleAnalysis = useStore((s) => s.toggleAnalysis);
  const toast = useStore((s) => s.toast);
  const analyzing = useStore((s) => s.analyzing);
  const thinking = useThinking();
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
    await useStore.getState().saveToLibrary();
  };

  const saveAs = async (): Promise<void> => {
    await useStore.getState().saveAsFile();
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
      <ScrollRow className="main-row">
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
        <button className="btn" onClick={() => void save()} title="保存进棋谱馆（Ctrl+S）：存过一次的那盘按保存是更新原来那条，不会再存出一份">
          保存
        </button>
        <button className="btn" onClick={() => void saveAs()} title="另存为：挑个地方存成散装 .sgf，给别的程序用（Ctrl+Shift+S）">
          另存为
        </button>
        <button className="btn" onClick={() => useStore.getState().setLibraryPage(true)} title="棋谱馆：存在这儿的棋谱都在这儿，能搜、能筛、能打标签、能导出（Ctrl+L）">
          棋谱馆
        </button>
        <div className="tb-sep" />
        <button className="btn" onClick={() => openBoardTab()} title="再开一盘：新标签里是一块空棋盘，手里这盘留着（Ctrl+T）">
          新建标签
        </button>
        <button
          className="btn"
          onClick={() => duplicateBoard()}
          title="复制打开：照现在这一盘再开一份（含分支与复盘结果），改哪边都不动另一边（Ctrl+Shift+D）"
        >
          复制打开
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
          className={'btn' + (aiVsAi ? ' primary' : '')}
          disabled={Boolean(finished) && !aiVsAi}
          onClick={toggleAiVsAi}
          title={
            aiVsAi
              ? '停下机机对局，回到自己下（M）'
              : '机机对局：双方都交给 AI 自动走，从当前局面接着下。随时能开，也随时能停；想看引擎自己下出一盘再拿去复盘，就开它（M）'
          }
        >
          {aiVsAi ? '停机机' : '机机对下'}
        </button>
        {/*
          跟"机机对下"是同一件事的两个方向：那边两边都交给 AI，这边只交一边。
          按同一颗就是收回来（回到辅助模式，AI 一手都不自己走）。
        */}
        <div className="seg" title="固定让 AI 执一方：它只走这一方，另一方你下。再点一下同一颗就收回">
          {([BLACK, WHITE] as const).map((side) => (
            <button
              key={side}
              className={'seg-item' + (aiSide === side ? ' active' : '')}
              disabled={Boolean(finished) && aiSide !== side}
              onClick={() => setAiSide(aiSide === side ? null : side)}
              title={
                aiSide === side
                  ? `AI 正执${colorName(side)}，点一下收回（回到辅助模式，AI 不自己落子）`
                  : `让 AI 执${colorName(side)}：轮到它的时候它自己走，你下${colorName((3 - side) as 1 | 2)}那一方`
              }
            >
              <span className={'stone-dot ' + (side === BLACK ? 'black' : 'white')} />
              AI 执{colorName(side)}
            </button>
          ))}
        </div>
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
      </ScrollRow>
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
