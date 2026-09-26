import { useState } from 'react';

/**
 * 分栏之间的分隔条。
 *
 * 为什么要盖一层全窗口的遮罩：内置浏览器是个 webview，指针进到它的矩形里
 * 事件就被访客页面吃掉了，父文档收不到 pointermove，拖动会当场卡住。
 * 所以按下之后先铺一张透明的全屏遮罩（z-index 高于 webview），
 * 指针走到哪儿都还在我们自己页面里，拖动才连贯。顺带也挡住了拖动时
 * 棋盘跟着高亮、文字被选中这些噪声。
 */
export function DragHandle({
  title,
  dir = 'x',
  onStart,
  onMove,
  hint,
  onReset
}: {
  title: string;
  /** 分隔条的方向：x 是竖着的竖条（左右分栏），y 是横着的一条（上下分栏）。 */
  dir?: 'x' | 'y';
  /** 按下时记一下起始值，onMove 只给位移。 */
  onStart: () => void;
  /** 移动量：dir 是 x 时给横向位移，y 时给纵向位移。 */
  onMove: (delta: number, ev: PointerEvent) => void;
  /** 拖动途中显示的文字，读当前状态算，别闭包住起始值。 */
  hint: () => string;
  /** 双击复位。 */
  onReset?: () => void;
}): React.ReactElement {
  const [drag, setDrag] = useState<{ text: string; x: number; y: number } | null>(null);
  const horizontal = dir === 'y';

  const down = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    onStart();
    setDrag({ text: hint(), x: e.clientX, y: e.clientY });

    const move = (ev: PointerEvent): void => {
      onMove(horizontal ? ev.clientY - y0 : ev.clientX - x0, ev);
      setDrag({ text: hint(), x: ev.clientX, y: ev.clientY });
    };
    const up = (): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      setDrag(null);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  };

  return (
    <>
      <div
        className={'splitter' + (horizontal ? ' across' : '') + (drag ? ' active' : '')}
        title={title}
        onPointerDown={down}
        onDoubleClick={onReset}
      />
      {drag ? (
        <>
          <div className={'drag-shield' + (horizontal ? ' across' : '')} />
          <div className="drag-hint" style={{ left: drag.x + 14, top: drag.y + 14 }}>
            {drag.text}
          </div>
        </>
      ) : null}
    </>
  );
}
