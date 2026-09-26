/**
 * 棋盘标签条：手里这几盘棋一人一个标签，像浏览器那样切来切去。
 *
 * 放在棋盘工具行的上方。只有一盘的时候整条收起来（那时它只是白占一行），
 * 两盘以上才出现。
 *
 * 每个标签上写着：名字（存过盘就是文件名）、有没有改动没保存、这一盘正跑着什么
 * （分析 / 复盘 / 机机）。悬停能看到路数、贴目、手数和现在的对弈方式。
 */

import React from 'react';
import { boardBadges, boardTitle, boardTooltip, hasUnsaved } from '../core/boards/boards';
import { useStore } from '../state/store';

const BADGE_CLASS: Record<string, string> = {
  分析: '',
  复盘: 'review',
  机机: 'engine'
};

export function BoardTabs(): React.ReactElement | null {
  const boards = useStore((s) => s.boards);
  const activeBoard = useStore((s) => s.activeBoard);
  /*
   * 当前那盘的状态摊在 store 顶层，boards 里存的那份是切走时留下的旧值。
   * 标签上的名字、未保存点子、角标、提示都要看"现在"这一份，所以在这里补上。
   */
  const live = {
    filePath: useStore((s) => s.filePath),
    dirty: useStore((s) => s.dirty),
    analyzing: useStore((s) => s.analyzing),
    reviewRunning: useStore((s) => s.reviewRunning),
    game: useStore((s) => s.game),
    tree: useStore((s) => s.tree),
    current: useStore((s) => s.current),
    // 存进棋谱馆之后标签上要立刻改叫馆里的标题，不能等切走再切回来
    record: useStore((s) => s.record)
  };
  const activateBoard = useStore((s) => s.activateBoard);
  const closeBoardTab = useStore((s) => s.closeBoardTab);
  const openBoardTab = useStore((s) => s.openBoardTab);

  if (boards.length <= 1) return null;

  return (
    <div className="board-tabs">
      {boards.map((raw) => {
        const t = raw.id === activeBoard ? { ...raw, slice: { ...raw.slice, ...live } } : raw;
        const active = t.id === activeBoard;
        const unsaved = hasUnsaved(t);
        const badges = boardBadges(t);
        return (
          <div
            key={t.id}
            className={'board-tab' + (active ? ' active' : '')}
            title={boardTooltip(t)}
            onClick={() => activateBoard(t.id)}
            onAuxClick={(e) => {
              // 中键关标签，浏览器的老习惯
              if (e.button === 1) {
                e.preventDefault();
                closeBoardTab(t.id);
              }
            }}
          >
            {unsaved ? <span className="board-tab-dot" title="有改动没保存" /> : null}
            <span className="board-tab-title">{boardTitle(t)}</span>
            {badges.length ? (
              <span className="board-tab-badges">
                {badges.map((b) => (
                  <span key={b} className={'board-tab-badge ' + (BADGE_CLASS[b] ?? '')}>
                    {b}
                  </span>
                ))}
              </span>
            ) : null}
            <span
              className="board-tab-close"
              role="button"
              title="关闭这个棋盘（Ctrl+W）"
              onClick={(e) => {
                e.stopPropagation();
                closeBoardTab(t.id);
              }}
            >
              ×
            </span>
          </div>
        );
      })}
      <button className="board-tab-new" onClick={() => openBoardTab()} title="新建棋盘（Ctrl+T）">
        ＋
      </button>
    </div>
  );
}
