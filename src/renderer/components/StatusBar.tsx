import { useStore } from '../state/store';
import { canSetTurn, colorToPlayAt, moveNumberAt, positionAt, propNum } from '../core/sgf/tree';
import { adviceChip, colorName } from '../core/advice';
import { BLACK } from '../../shared/types';

export function StatusBar(): React.ReactElement {
  const tree = useStore((s) => s.tree);
  const current = useStore((s) => s.current);
  const engine = useStore((s) => s.engineStatus);
  const analyzing = useStore((s) => s.analyzing);
  const thinking = useStore((s) => s.thinking);
  const finished = useStore((s) => s.finished);
  const game = useStore((s) => s.game);
  const toggleAiVsAi = useStore((s) => s.toggleAiVsAi);
  const hint = useStore((s) => s.hint);
  const setHint = useStore((s) => s.setHint);
  const setTurn = useStore((s) => s.setTurn);

  const size = propNum(tree, tree.root, 'SZ', 19);
  const komi = propNum(tree, tree.root, 'KM', 7.5);
  const handicap = propNum(tree, tree.root, 'HA', 0);
  const turn = colorToPlayAt(tree, current);
  const moveNo = moveNumberAt(tree, current);
  const pos = positionAt(tree, current);
  // 摆子的局面没有手数，程序不知道轮到谁，得让用户说；有手数时轮次由手数定
  const turnIsManual = canSetTurn(tree, current).ok;

  const modeText =
    game.mode === 'vs-ai'
      ? game.humanColor === BLACK
        ? '人机对局 · 你执黑'
        : '人机对局 · 你执白'
      : game.mode === 'ai-vs-ai'
        ? '机机对局'
        : '辅助模式 · AI 不自己落子';

  return (
    <div className="statusbar">
      <span className="item">
        <span className="turn-pill">
          <span className={'stone-dot ' + (turn === BLACK ? 'black' : 'white')} />
          {colorName(turn)}方行棋
        </span>
      </span>
      {turnIsManual ? (
        <span className="item">
          <button
            className="chip"
            onClick={() => setTurn((3 - turn) as 1 | 2)}
            title="这一局还没有手数，程序按惯例猜的黑先。点一下改成对方先走。"
          >
            换先手
          </button>
        </span>
      ) : null}
      {hint ? (
        <span className="item">
          <button className="chip active" onClick={() => setHint(null)} title="给现在轮到这一方的一手推荐，点一下清掉；按 H 重新算">
            <span className={'stone-dot ' + (hint.color === BLACK ? 'black' : 'white')} />
            {adviceChip(hint)}
          </button>
        </span>
      ) : null}
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
      <span className="item">
        {/* 对弈方式就写在这儿，点一下就能开机机对局，再点一下停：想拿一盘棋去复盘时最顺手 */}
        <button
          className={'chip' + (game.mode === 'ai-vs-ai' ? ' active' : '')}
          onClick={toggleAiVsAi}
          title={
            game.mode === 'ai-vs-ai'
              ? '机机对局开着：双方都由 AI 自动走。点一下停下，回到自己下（M）'
              : '点一下开机机对局：双方都交给 AI 自动走，随时能停。想生成一盘棋来复盘就用它（M）'
          }
        >
          {modeText}
        </button>
      </span>
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
    </div>
  );
}
