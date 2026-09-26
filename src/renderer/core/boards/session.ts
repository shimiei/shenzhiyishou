/**
 * 会话文件：关掉程序时这几盘棋长什么样，下次打开照着重建。
 *
 * 只存一盘棋本身（棋谱、看到哪一手、文件路径、未保存标记、对局设置、结局）。
 * 分析结论、复盘结果、正在跑的机机档都不存：那些是动手才算出来的东西，
 * 重开程序不该自己去占显卡。
 *
 * 当前节点按分支路径存，不按节点号：棋谱重新解析一遍，节点号会重新排。
 */

import type { GameTree } from '../../../shared/types';
import { parseSgf } from '../sgf/parse';
import { serializeSgf } from '../sgf/serialize';
import { nodeAtPath, pathOf } from '../sgf/tree';
import { DEFAULT_GAME, emptySlice, newBoardId, type BoardTab, type GameConfig } from './boards';

export interface SessionBoard {
  id: string;
  note: string;
  /** 整棵棋谱，含分支。 */
  sgf: string;
  /** 当前节点从根走下来的分支路径。 */
  path: number[];
  filePath: string | null;
  dirty: boolean;
  game: GameConfig;
  finished: string | null;
  /** 这一盘存在棋谱馆里的哪一条。版本 1 没有这一栏。 */
  record?: { id: string; title: string } | null;
}

export interface Session {
  version: number;
  active: string;
  boards: SessionBoard[];
}

/**
 * 会话版本。2 比 1 多记了"这一盘对应棋谱馆里的哪一条"。
 * 读的时候 1 与 2 都认：升级一次就把用户正开着的那几盘丢掉，是最不能接受的一种坏。
 */
export const SESSION_VERSION = 2;
const READABLE_VERSIONS = [1, 2];

export function toSession(tabs: BoardTab[], activeId: string): Session {
  return {
    version: SESSION_VERSION,
    active: activeId,
    boards: tabs.map((t) => ({
      id: t.id,
      note: t.note,
      sgf: serializeSgf(t.slice.tree),
      path: pathOf(t.slice.tree, t.slice.current),
      filePath: t.slice.filePath,
      dirty: t.slice.dirty,
      game: { ...t.slice.game },
      finished: t.slice.finished,
      record: t.slice.record
    }))
  };
}

/**
 * 会话文件读回来。返回 null 表示这份文件不能用（版本不对、内容读不出来、一盘都没有），
 * 界面就照常开一盘空棋，而不是抱着一份半截的会话发愣。
 * 单盘读不出来（SGF 坏了）就跳过那一盘，其余照收。
 */
export function fromSession(raw: unknown): { tabs: BoardTab[]; activeId: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<Session>;
  if (typeof s.version !== 'number' || !READABLE_VERSIONS.includes(s.version)) return null;
  if (!Array.isArray(s.boards) || s.boards.length === 0) return null;

  const tabs: BoardTab[] = [];
  for (const b of s.boards) {
    if (!b || typeof b.sgf !== 'string') continue;
    let tree: GameTree;
    try {
      const trees = parseSgf(b.sgf);
      if (!trees.length) continue;
      tree = trees[0];
    } catch {
      continue;
    }
    const base = emptySlice({ game: { ...DEFAULT_GAME, ...(b.game ?? {}) } });
    const record =
      b.record && typeof b.record === 'object' && typeof b.record.id === 'string' && b.record.id
        ? { id: b.record.id, title: typeof b.record.title === 'string' ? b.record.title : '' }
        : null;
    tabs.push({
      id: typeof b.id === 'string' && b.id ? b.id : newBoardId(),
      note: typeof b.note === 'string' ? b.note : '',
      slice: {
        ...base,
        tree,
        current: nodeAtPath(tree, Array.isArray(b.path) ? b.path : []),
        filePath: typeof b.filePath === 'string' && b.filePath ? b.filePath : null,
        dirty: Boolean(b.dirty),
        finished: typeof b.finished === 'string' ? b.finished : null,
        record
      }
    });
  }
  if (tabs.length === 0) return null;
  const activeId = tabs.some((t) => t.id === s.active) ? (s.active as string) : tabs[0].id;
  return { tabs, activeId };
}
