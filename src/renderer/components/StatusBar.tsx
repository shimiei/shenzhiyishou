import { useStore } from '../state/store';
import { colorToPlayAt, moveNumberAt, propNum } from '../core/sgf/tree';
import { positionAt } from '../core/sgf/tree';
import { BLACK, PASS } from '../../shared/types';

export function StatusBar(): React.ReactElement {
  const tree = useStore((s) => s.tree);
  const current = useStore((s) => s.current);
  const engine = useStore((s) => s.engineStatus);
  const analyzing = useStore((s) => s.analyzing);
  const thinking = useStore((s) => s.thinking);
  const finished = useStore((s) => s.finished);
  const game = useStore((s) => s.game);

  const size = propNum(tree, tree.root, 'SZ', 19);
  const komi = propNum(tree, tree.root, 'KM', 7.5);
  const handicap = propNum(tree, tree.root, 'HA', 0);
  const turn = colorToPlayAt(tree, current);
  const moveNo = moveNumberAt(tree, current);
  const pos = positionAt(tree, current);

  const modeText =
    game.mode === 'vs-ai'
      ? game.humanColor === BLACK
        ? '人机对局 · 你执黑'
        : '人机对局 · 你执白'
      : game.mode === 'ai-vs-ai'
        ? '机机对局'
        : '自由摆谱';

  return (
    <div className="statusbar">
      <span className="item">
        <span className="turn-pill">
          <span className={'stone-dot ' + (turn === BLACK ? 'black' : 'white')} />
          {turn === BLACK ? '黑方行棋' : '白方行棋'}
        </span>
      </span>
      <span className="item">
        第 <b>{moveNo}</b> 手
      </span>
      <span className="item">
        提子 黑 <b>{pos.capturesByBlack}</b> / 白 <b>{pos.capturesByWhite}</b>
      </span>
      <span className="item">
        {size} 路 · 贴目 <b>{komi}</b>
        {handicap > 1 ? (
          <>
            {' '}
            · 让 <b>{handicap}</b> 子
          </>
        ) : null}
      </span>
      <span className="item">{modeText}</span>
      {finished ? (
        <span className="item">
          <span className="badge ok">{finished}</span>
        </span>
      ) : null}
      <span className="spacer" />
      {thinking ? <span className="item">引擎思考中…</span> : null}
      {analyzing ? <span className="item">分析中</span> : null}
      <span className="item faint">
        {engine.ready ? `${engine.backend} · ${engine.gtpVersion ?? ''}` : engine.error ? '引擎未就绪' : '引擎未启动'}
      </span>
      <span className="item faint">
        <span className="kbd">?</span> 快捷键
      </span>
      <span className="item faint">{PASS === -1 ? '' : ''}</span>
    </div>
  );
}
