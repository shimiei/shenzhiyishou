/**
 * 从一份 SGF 里读出棋谱馆索引要的那几项。
 *
 * 解析棋谱这件事归界面这一层（主进程从来只当它是纯文本），所以扫目录收编
 * 手动丢进来的棋谱、"收藏当前这盘"都要经过这里，索引里那几栏才不会两处各写一套。
 */

import { defaultTitle } from '../../../shared/records';
import type { RecordMeta } from '../../../shared/types';
import { parseSgf } from '../sgf/parse';
import { infoFromTree, mainLineEnd, moveNumberAt, propNum } from '../sgf/tree';

/** 读不出来就返回 null（空文件、坏棋谱），调用方跳过它就完了。 */
export function metaFromSgf(content: string, file: string, savedAt: number): Omit<RecordMeta, 'id' | 'tags'> | null {
  try {
    const trees = parseSgf(content);
    if (!trees.length) return null;
    const tree = trees[0];
    const info = infoFromTree(tree);
    return {
      title: defaultTitle(info),
      blackName: info.blackName,
      whiteName: info.whiteName,
      result: info.result,
      date: info.date,
      size: propNum(tree, tree.root, 'SZ', 19),
      // 手数只数主线：摆子不算，分支里试的着法也不算
      moves: moveNumberAt(tree, mainLineEnd(tree)),
      savedAt,
      file
    };
  } catch {
    return null;
  }
}
