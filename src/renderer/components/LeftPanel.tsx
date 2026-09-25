import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { marksAt, moveAtSized, moveNumberAt, pathTo, propNum } from '../core/sgf/tree';
import { BLACK, PASS } from '../../shared/types';

function vertexOf(point: number, size: number): string {
  if (point === PASS) return '停一手';
  const letters = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
  return letters[point % size] + String(size - Math.floor(point / size));
}

type Tab = 'tree' | 'moves' | 'comment';

export function LeftPanel({ style }: { style?: React.CSSProperties }): React.ReactElement {
  const tree = useStore((s) => s.tree);
  const current = useStore((s) => s.current);
  const goto = useStore((s) => s.goto);
  const deleteCurrentNode = useStore((s) => s.deleteCurrentNode);
  const promoteCurrent = useStore((s) => s.promoteCurrent);
  const setComment = useStore((s) => s.setComment);
  const setDialog = useStore((s) => s.setDialog);
  const [tab, setTab] = useState<Tab>('tree');
  const size = propNum(tree, tree.root, 'SZ', 19);

  const flat = useMemo(() => {
    const out: Array<{ id: number; depth: number; branch: boolean; isFirst: boolean }> = [{ id: tree.root, depth: 0, branch: false, isFirst: true }];
    const walk = (id: number, depth: number): void => {
      const node = tree.nodes[id];
      if (!node) return;
      node.children.forEach((kid, i) => {
        out.push({ id: kid, depth: depth + (i > 0 ? 1 : 0), branch: i > 0, isFirst: i === 0 });
        walk(kid, depth + (i > 0 ? 1 : 0));
      });
    };
    walk(tree.root, 0);
    return out.slice(0, 4000);
  }, [tree]);

  const mainLine = useMemo(() => {
    const ids = pathTo(tree, current);
    return ids;
  }, [tree, current]);

  const comment = tree.nodes[current]?.props.C?.[0] ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? comment;

  const currentMove = moveAtSized(tree, current);

  return (
    <div className="side left" style={style}>
      <div className="panel grow" style={{ borderBottom: 'none' }}>
        <div className="panel-head">
          <div className="seg">
            <button className={'seg-item' + (tab === 'tree' ? ' active' : '')} onClick={() => setTab('tree')}>
              结构
            </button>
            <button className={'seg-item' + (tab === 'moves' ? ' active' : '')} onClick={() => setTab('moves')}>
              手数
            </button>
            <button className={'seg-item' + (tab === 'comment' ? ' active' : '')} onClick={() => setTab('comment')}>
              注释
            </button>
          </div>
          <div className="spacer" />
          <button className="btn ghost sm" title="对局信息" onClick={() => setDialog('gameinfo')}>
            对局信息
          </button>
        </div>

        {tab === 'tree' ? (
          <div className="panel-body flush" style={{ flex: 1, minHeight: 0 }}>
            <div className="tree">
              {flat.map((row) => {
                const node = tree.nodes[row.id];
                const mv = moveAtSized(tree, row.id);
                const num = mv ? moveNumberAt(tree, row.id) : 0;
                const hasComment = Boolean(node.props.C?.[0]);
                const markCount = marksAt(tree, row.id).length;
                const name = node.props.N?.[0];
                return (
                  <div
                    key={row.id}
                    className={'tree-row' + (row.id === current ? ' active' : '')}
                    style={{ paddingLeft: 6 + row.depth * 13 }}
                    onClick={() => goto(row.id)}
                    title={hasComment ? node.props.C[0] : undefined}
                  >
                    <span className="num">{mv ? (mv.color === BLACK ? num + '.' : num + '…') : '—'}</span>
                    <span className="mv">
                      {mv ? vertexOf(mv.point, size) : name ?? '起始'}
                    </span>
                    {row.branch ? <span className="branch-tag">分支</span> : null}
                    {hasComment ? <span className="branch-tag">注</span> : null}
                    {markCount > 0 ? <span className="branch-tag">标</span> : null}
                    <span className="spacer" />
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {tab === 'moves' ? (
          <div className="panel-body flush" style={{ flex: 1, minHeight: 0 }}>
            <div className="moves">
              {mainLine.map((id) => {
                const mv = moveAtSized(tree, id);
                if (!mv) return null;
                const num = moveNumberAt(tree, id);
                return (
                  <div
                    key={id}
                    className={'mv-cell' + (id === current ? ' active' : '')}
                    onClick={() => goto(id)}
                  >
                    <span className="n">{num}</span>
                    <span>{vertexOf(mv.point, size)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {tab === 'comment' ? (
          <div className="panel-body flush" style={{ flex: 1, minHeight: 0 }}>
            <div className="comment-box">
              <textarea
                value={shown}
                placeholder="给当前这一手写点注释，保存为 SGF 的 C 属性"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  if (draft !== null && draft !== comment) setComment(draft);
                  setDraft(null);
                }}
              />
              <div className="row small faint" style={{ marginTop: 6 }}>
                当前节点：{currentMove ? vertexOf(currentMove.point, size) : '起始局面'}
              </div>
            </div>
          </div>
        ) : null}

        <div className="dialog-foot" style={{ padding: '8px 10px', background: 'transparent', borderTop: '1px solid var(--border-soft)' }}>
          <button
            className="btn sm"
            disabled={current === tree.root}
            onClick={promoteCurrent}
            title="把当前这条分支设为唯一的主线"
          >
            设为主线
          </button>
          <button className="btn sm danger" disabled={current === tree.root} onClick={deleteCurrentNode} title="删除当前这一手及其后续">
            删除
          </button>
          <div className="spacer" />
          <span className="small faint">{flat.length} 个节点</span>
        </div>
      </div>
    </div>
  );
}
