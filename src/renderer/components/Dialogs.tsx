import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Board } from './Board';
import { colorToPlayAt, infoFromTree, moveAtSized, moveSourceOf, positionAt, propNum } from '../core/sgf/tree';
import { GRADE_LABEL, problemMoves, toPercent } from '../core/review/review';
import { LAST_MOVE_MARK_OPTIONS } from '../core/board/marks';
import { endpointHint } from '../core/vision';
import { BLACK, WHITE, type AnalysisSnapshot, type AppSettings, type ModelEntry } from '../../shared/types';
import type { DownloadProgress } from '../../shared/protocol';

function Shell({
  title,
  children,
  footer,
  onClose,
  wide,
  maxWidth
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** 宽弹窗默认 78vw，内容不多的场合收窄一点，免得中间大片留白 */
  maxWidth?: number;
}): React.ReactElement {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'dialog' + (wide ? ' wide' : '')} style={maxWidth ? { maxWidth } : undefined}>
        <div className="dialog-head">
          <span className="title">{title}</span>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

function NewGameDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const newGame = useStore((s) => s.newGame);
  const game = useStore((s) => s.game);
  const settings = useStore((s) => s.settings);
  const info = useStore((s) => s.info);
  const [size, setSize] = useState(19);
  const [komi, setKomi] = useState(7.5);
  const [handicap, setHandicap] = useState(0);
  const [mode, setMode] = useState(game.mode);
  const [humanColor, setHumanColor] = useState<1 | 2>(game.humanColor === WHITE ? WHITE : BLACK);
  const [blackName, setBlackName] = useState('我');
  const [whiteName, setWhiteName] = useState('神之一手');

  return (
    <Shell
      title="新建对局"
      onClose={onClose}
      footer={
        <>
          <span className="small faint">
            当前网络：{settings.modelId} · 推荐每步 {settings.playVisits} 次访问
          </span>
          <div className="spacer" />
          <button
            className="btn primary"
            onClick={() => {
              newGame({ size, komi, handicap, mode, humanColor, visits: settings.playVisits, timeMs: settings.playTimeMs, temperature: 0, allowResign: true });
              const { updateGameInfo } = useStore.getState();
              updateGameInfo({
                blackName: humanColor === BLACK ? blackName : whiteName,
                whiteName: humanColor === BLACK ? whiteName : blackName,
                date: new Date().toISOString().slice(0, 10)
              });
              onClose();
            }}
          >
            开始
          </button>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
        </>
      }
    >
      <div className="grid-2">
        <div className="field">
          <label>棋盘路数</label>
          <div className="seg">
            {[9, 13, 19].map((n) => (
              <button key={n} className={'seg-item' + (size === n ? ' active' : '')} onClick={() => setSize(n)}>
                {n} 路
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>对弈方式</label>
          <div className="seg">
            <button className={'seg-item' + (mode === 'manual' ? ' active' : '')} onClick={() => setMode('manual')}>
              辅助
            </button>
            <button className={'seg-item' + (mode === 'vs-ai' ? ' active' : '')} onClick={() => setMode('vs-ai')}>
              人机对局
            </button>
            <button className={'seg-item' + (mode === 'ai-vs-ai' ? ' active' : '')} onClick={() => setMode('ai-vs-ai')}>
              机机对局
            </button>
          </div>
          <div className="small faint" style={{ marginTop: 6 }}>
            {mode === 'manual'
              ? '辅助：AI 不自己落子，按 H 或点提示拿建议（会标明是给黑方还是白方的），自己下。想让 AI 顶一手就按空格或点 AI 走一手。'
              : mode === 'vs-ai'
                ? '人机对局：AI 自动走你对手那一方，你只下自己那一手。'
                : '机机对局：双方都交给 AI 自动走，拿来看棋。开局之后也能随时按 M 或点"机机对下"开关，从当前局面接着下。'}
          </div>
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>贴目</label>
          <input type="number" step="0.5" value={komi} onChange={(e) => setKomi(Number(e.target.value))} />
        </div>
        <div className="field">
          <label>让子</label>
          <input
            type="number"
            min={0}
            max={9}
            value={handicap}
            onChange={(e) => {
              const h = Math.max(0, Math.min(9, Number(e.target.value)));
              setHandicap(h);
              if (h > 1) setHumanColor(WHITE);
            }}
          />
        </div>
      </div>
      {mode === 'vs-ai' ? (
        <div className="field">
          <label>你执哪一方</label>
          <div className="seg">
            <button className={'seg-item' + (humanColor === BLACK ? ' active' : '')} onClick={() => setHumanColor(BLACK)}>
              执黑先行
            </button>
            <button className={'seg-item' + (humanColor === WHITE ? ' active' : '')} onClick={() => setHumanColor(WHITE)}>
              执白后行
            </button>
          </div>
        </div>
      ) : null}
      <div className="grid-2">
        <div className="field">
          <label>黑方</label>
          <input value={humanColor === BLACK ? blackName : whiteName} onChange={(e) => (humanColor === BLACK ? setBlackName : setWhiteName)(e.target.value)} />
        </div>
        <div className="field">
          <label>白方</label>
          <input value={humanColor === BLACK ? whiteName : blackName} onChange={(e) => (humanColor === BLACK ? setWhiteName : setBlackName)(e.target.value)} />
        </div>
      </div>
      <div className="small faint">
        引擎当前会用 {settings.playVisits} 次访问、每步最多 {(settings.playTimeMs / 1000).toFixed(1)} 秒。
        {info && info.gpu.length ? ` 显卡：${info.gpu[0]}` : ''}
      </div>
    </Shell>
  );
}

function GameInfoDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const tree = useStore((s) => s.tree);
  const updateGameInfo = useStore((s) => s.updateGameInfo);
  const swapColors = useStore((s) => s.swapColors);
  const info = useMemo(() => infoFromTree(tree), [tree]);
  const [draft, setDraft] = useState(info);

  useEffect(() => setDraft(info), [info]);

  const f = (key: keyof typeof draft, label: string, type: 'text' | 'number' = 'text'): React.ReactElement => (
    <div className="field">
      <label>{label}</label>
      <input
        type={type}
        value={String(draft[key] ?? '')}
        onChange={(e) => setDraft({ ...draft, [key]: type === 'number' ? Number(e.target.value) : e.target.value })}
      />
    </div>
  );

  return (
    <Shell
      title="对局信息"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={swapColors}>
            交换黑白
          </button>
          <div className="spacer" />
          <button
            className="btn primary"
            onClick={() => {
              updateGameInfo(draft);
              onClose();
            }}
          >
            应用
          </button>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
        </>
      }
    >
      <div className="grid-2">
        {f('blackName', '黑方姓名')}
        {f('whiteName', '白方姓名')}
      </div>
      <div className="grid-2">
        {f('blackRank', '黑方段位')}
        {f('whiteRank', '白方段位')}
      </div>
      <div className="grid-2">
        {f('result', '结果（如 B+3.5）')}
        {f('date', '日期')}
      </div>
      <div className="grid-2">
        {f('event', '赛事')}
        {f('place', '地点')}
      </div>
      <div className="grid-2">
        {f('gameName', '棋谱名称')}
        {f('rules', '规则')}
      </div>
      <div className="grid-3">
        {f('size', '路数', 'number')}
        {f('komi', '贴目', 'number')}
        {f('handicap', '让子', 'number')}
      </div>
      <div className="small faint">改路数只会改记录信息，不会重新排布已有棋子，注意别和盘上局面不一致。</div>
    </Shell>
  );
}

function ModelsDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);

  const refresh = async (): Promise<void> => setModels(await window.api.models.list());

  useEffect(() => {
    void refresh();
    const off = window.api.models.onProgress((p) => {
      setProgress((cur) => ({ ...cur, [p.id]: p }));
      if (p.done) {
        if (p.error) toast(`下载失败：${p.error}`, 'error');
        else toast('网络下载完成', 'success');
        void refresh();
      }
    });
    return off;
  }, [toast]);

  const mb = (n: number): string => (n / 1024 / 1024).toFixed(1) + ' MB';

  return (
    <Shell
      title="引擎与网络"
      wide
      onClose={onClose}
      footer={
        <>
          <button
            className="btn"
            onClick={async () => {
              const m = await window.api.models.import();
              if (m) {
                toast('已导入 ' + m.name, 'success');
                void refresh();
              }
            }}
          >
            从磁盘导入网络
          </button>
          <div className="spacer" />
          <button
            className="btn primary"
            title="停掉正在跑的引擎，用它加载默认网络重启。首次加载大网络要十几秒到几分钟。"
            onClick={async () => {
              const st = await window.api.engine.start({ modelId: settings.modelId });
              useStore.getState().setEngineStatus(st);
              toast(st.ready ? '已用新网络重启引擎' : st.error ?? '启动失败', st.ready ? 'success' : 'error');
            }}
          >
            立刻换成这个网络
          </button>
          <button className="btn ghost" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="lib-list">
        {models.map((m) => {
          const p = progress[m.id];
          const pct = p && p.total ? Math.round((p.received / p.total) * 100) : 0;
          return (
            <div key={m.id} className="lib-item" style={{ cursor: 'default' }}>
              <div className="row">
                <span className="t">{m.name}</span>
                {m.downloaded ? <span className="badge ok">已就绪</span> : <span className="badge">未下载</span>}
                {settings.modelId === m.id ? <span className="badge warn">当前使用</span> : null}
              </div>
              <div className="row">
                {m.downloaded ? (
                  <button
                    className="btn sm"
                    title="这只是把默认网络换掉，正在跑的引擎要等下次启动或开始分析时才换过来。想马上换，用下面那个“立刻换成这个网络”。"
                    onClick={() =>
                      void setSettings({ modelId: m.id }).then(() => toast('默认网络已设为 ' + m.name + '，下次启动引擎或开始分析时换过来'))
                    }
                  >
                    设为默认
                  </button>
                ) : null}
                {!m.downloaded && m.id !== 'b6c96' ? (
                  <button
                    className="btn sm primary"
                    disabled={Boolean(p) && !p.done}
                    onClick={async () => {
                      const res = await window.api.models.download(m.id);
                      if (!res.ok) toast('下载失败：' + (res.error ?? ''), 'error');
                    }}
                  >
                    {p && !p.done ? `下载中 ${pct}%` : '下载'}
                  </button>
                ) : null}
                {p && !p.done ? (
                  <button className="btn sm ghost" onClick={() => void window.api.models.cancel(m.id)}>
                    取消
                  </button>
                ) : null}
                {!m.bundled && m.downloaded ? (
                  <button
                    className="btn sm danger"
                    onClick={async () => {
                      await window.api.models.remove(m.id);
                      void refresh();
                    }}
                  >
                    删除
                  </button>
                ) : null}
              </div>
              <div className="meta">
                <span>{m.name.split(' ')[0]}</span>
                <span>{mb(m.sizeBytes)}</span>
                <span>{m.strength >= 5 ? '强' : m.strength >= 4 ? '中' : '快'}</span>
                <span>{m.note}</span>
              </div>
              {p && !p.done ? <progress value={p.received} max={p.total || m.sizeBytes} style={{ gridColumn: '1 / -1' }} /> : null}
            </div>
          );
        })}
      </div>
      <div className="small faint" style={{ marginTop: 12, lineHeight: 1.8 }}>
        内置的小网络开箱可用，速度和强度平衡得比较好。b18c384nbt 是当前最强档，核显上每步要等几秒；下载好之后
        在引擎面板里换过来即可。也可以把任何 KataGo 的 .bin.gz 或 .txt.gz 直接丢进网络目录，程序会自动认出来。
      </div>
    </Shell>
  );
}

/**
 * 复盘窗口：左边是整局的评点，右边跟着看选中的那一手。
 *
 * 曲线横轴是手数，纵轴是黑棋胜率（黑在上、白在下），和大多数围棋软件的读法一致；
 * 点一下曲线或列表就把右边的小棋盘换到那个局面，双击直接跳到主棋盘上去。
 */
function ReviewDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const tree = useStore((s) => s.tree);
  const moves = useStore((s) => s.reviewMoves);
  const summary = useStore((s) => s.reviewSummary);
  const running = useStore((s) => s.reviewRunning);
  const done = useStore((s) => s.reviewDone);
  const total = useStore((s) => s.reviewTotal);
  const stopped = useStore((s) => s.reviewStopped);
  const error = useStore((s) => s.reviewError);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const startReview = useStore((s) => s.startReview);
  const stopReview = useStore((s) => s.stopReview);
  const clearReview = useStore((s) => s.clearReview);
  const goto = useStore((s) => s.goto);
  const gotoProblem = useStore((s) => s.gotoProblem);
  const size = propNum(tree, tree.root, 'SZ', 19);

  const [onlyProblems, setOnlyProblems] = useState(true);
  const [sel, setSel] = useState<number | null>(null);

  /** 曲线上的点：第一手之前的胜率，加上每一手之后的胜率。 */
  const curve = useMemo(
    () => (moves.length ? [moves[0].winrateBefore, ...moves.map((m) => m.winrateAfter)] : []),
    [moves]
  );
  const problems = useMemo(() => problemMoves(moves), [moves]);
  const rows = onlyProblems ? problems : moves;

  /** 打开时选中最值得看的那一手：先看最大的一处，没有就从头开始。 */
  useEffect(() => {
    if (sel !== null) return;
    const pick = summary.worst && summary.worst.loss > 0 ? summary.worst : moves[0] ?? null;
    if (pick) setSel(pick.nodeId);
  }, [moves, summary, sel]);

  /** 人和机器各下了几手、平均亏多少。摆出来的子和导入的棋谱没有来源，不计入。 */
  const byWho = useMemo(() => {
    const acc = { human: { n: 0, loss: 0 }, ai: { n: 0, loss: 0 } };
    for (const m of moves) {
      const src = moveSourceOf(tree, m.nodeId);
      if (!src) continue;
      acc[src].n += 1;
      acc[src].loss += Math.max(0, m.loss);
    }
    return acc;
  }, [moves, tree]);

  const selMove = rows.find((m) => m.nodeId === sel) ?? moves.find((m) => m.nodeId === sel) ?? null;
  const selPos = selMove ? positionAt(tree, selMove.nodeId) : positionAt(tree, tree.root);
  const jump = (id: number): void => {
    goto(id);
    onClose();
  };

  const W = 660;
  const H = 132;
  const xy = (i: number, v: number): [number, number] => [
    curve.length > 1 ? (i / (curve.length - 1)) * W : 0,
    H * (1 - Math.max(0, Math.min(1, v)))
  ];
  const line = curve.map((v, i) => xy(i, v).join(',')).join(' ');
  const areaTop = curve.length > 1 ? `0,0 ${line} ${W},0` : '';
  const areaBottom = curve.length > 1 ? `0,${H} ${line} ${W},${H}` : '';

  const plyToNode = (ply: number): number | null => {
    const hit = moves.find((m) => m.ply === ply);
    return hit ? hit.nodeId : null;
  };

  return (
    <Shell
      title="复盘"
      wide
      maxWidth={1180}
      onClose={onClose}
      footer={
        <>
          <span className="small faint">
            {moves.length > 0
              ? `共 ${summary.moves} 手 · 恶手 ${summary.blunder} · 失误 ${summary.mistake} · 小失误 ${summary.inaccuracy}`
              : '还没有复盘数据'}
          </span>
          <div className="spacer" />
          <button className="btn" disabled={moves.length === 0} onClick={() => gotoProblem(-1)}>
            上一处问题
          </button>
          <button className="btn" disabled={moves.length === 0} onClick={() => gotoProblem(1)}>
            下一处问题
          </button>
          <button
            className="btn primary"
            disabled={!selMove}
            onClick={() => selMove && jump(selMove.nodeId)}
            title="把主棋盘跳到选中的这一手，然后关掉这个窗口"
          >
            跳到这一手
          </button>
          <button className="btn ghost" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
        <div style={{ flex: 1, minWidth: 380 }}>
          <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
            {running ? (
              <>
                <button className="btn danger" onClick={() => void stopReview()}>
                  停下
                </button>
                <span className="small">
                  正在算第 {Math.min(done + 1, total)} / {total} 个局面…
                </span>
                <div className="rev-progress">
                  <i style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
                </div>
              </>
            ) : (
              <>
                <button className="btn primary" onClick={() => void startReview()}>
                  {moves.length > 0 ? '接着算' : '开始复盘'}
                </button>
                {moves.length > 0 ? (
                  <button
                    className="btn"
                    title="把已经算出来的结果丢掉，从第一手重新算"
                    onClick={() => {
                      clearReview();
                      void startReview();
                    }}
                  >
                    重算
                  </button>
                ) : null}
                <label className="small" style={{ marginLeft: 6 }}>
                  每手访问量 {settings.reviewVisits}
                  <input
                    type="range"
                    min={20}
                    max={3000}
                    step={10}
                    value={settings.reviewVisits}
                    style={{ width: 130, marginLeft: 8, verticalAlign: 'middle' }}
                    onChange={(e) => void setSettings({ reviewVisits: Number(e.target.value) })}
                  />
                </label>
              </>
            )}
            <div className="spacer" />
            <div className="seg">
              <button className={'seg-item' + (onlyProblems ? ' active' : '')} onClick={() => setOnlyProblems(true)}>
                只看问题手
              </button>
              <button className={'seg-item' + (!onlyProblems ? ' active' : '')} onClick={() => setOnlyProblems(false)}>
                所有着手
              </button>
            </div>
          </div>

          {error ? (
            <div className="small" style={{ color: 'var(--danger, #e05b52)', marginTop: 8 }}>
              复盘出错：{error}
            </div>
          ) : stopped === 'replaced' ? (
            <div className="small faint" style={{ marginTop: 8 }}>
              上一轮复盘被实时分析顶掉了，已经算完的部分留着，点“接着算”可以继续。
            </div>
          ) : null}

          {curve.length > 1 ? (
            <svg
              className="rev-curve"
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientX - box.left) / box.width;
                const node = plyToNode(Math.round(ratio * (curve.length - 1)));
                if (node) setSel(node);
              }}
              onDoubleClick={() => selMove && jump(selMove.nodeId)}
            >
              <rect x={0} y={0} width={W} height={H / 2} className="rev-curve-black" />
              <rect x={0} y={H / 2} width={W} height={H / 2} className="rev-curve-white" />
              <line x1={0} y1={H / 2} x2={W} y2={H / 2} className="rev-curve-mid" />
              <polygon points={areaTop} className="rev-curve-area-b" />
              <polygon points={areaBottom} className="rev-curve-area-w" />
              <polyline points={line} className="rev-curve-line" />
              {problems.map((m) => {
                const [x, y] = xy(m.ply, m.winrateAfter);
                const r = m.grade === 'blunder' ? 4.5 : m.grade === 'mistake' ? 3.4 : 2.6;
                return <circle key={m.nodeId} cx={x} cy={y} r={r} className={'rev-dot ' + m.grade} />;
              })}
              {selMove ? (
                <line x1={xy(selMove.ply, 0)[0]} y1={0} x2={xy(selMove.ply, 0)[0]} y2={H} className="rev-curve-mark" />
              ) : null}
            </svg>
          ) : null}

          <div className="small faint" style={{ margin: '4px 0 8px', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span>上面的深色是黑棋的胜率，下面浅色是白棋</span>
            {byWho.human.n > 0 ? (
              <span>
                人下的 {byWho.human.n} 手平均亏 {((byWho.human.loss / byWho.human.n) * 100).toFixed(1)} 个点
              </span>
            ) : null}
            {byWho.ai.n > 0 ? (
              <span>
                机器下的 {byWho.ai.n} 手平均亏 {((byWho.ai.loss / byWho.ai.n) * 100).toFixed(1)} 个点
              </span>
            ) : null}
          </div>

          <div className="rev-list">
            {rows.length === 0 ? (
              <div className="empty">
                {moves.length === 0
                  ? '点“开始复盘”，引擎会把这一局的每一手都算一遍，然后列出亏得最多的地方。'
                  : '这一局没有明显的问题手。'}
              </div>
            ) : (
              rows.map((m) => (
                <div
                  key={m.nodeId}
                  className={'rev-row' + (m.nodeId === sel ? ' active' : '')}
                  onClick={() => setSel(m.nodeId)}
                  onDoubleClick={() => jump(m.nodeId)}
                  title="点一下看这一手，双击跳到主棋盘"
                >
                  <span className={'rev-color ' + (m.color === BLACK ? 'b' : 'w')}>{m.color === BLACK ? '黑' : '白'}</span>
                  <span className="rev-ply">{m.ply}</span>
                  <span className="rev-vertex">{m.vertex}</span>
                  <span className={'rev-tag ' + m.grade}>{GRADE_LABEL[m.grade]}</span>
                  <span className="rev-loss">{m.loss > 0.005 ? `亏 ${toPercent(m.loss)} 个点` : '不亏'}</span>
                  <span className="rev-best">{m.bestMove && m.bestMove !== m.vertex ? `推荐 ${m.bestMove}` : ''}</span>
                  <div className="spacer" />
                  <span className="rev-src">
                    {moveSourceOf(tree, m.nodeId) === 'ai' ? '机' : moveSourceOf(tree, m.nodeId) === 'human' ? '人' : ''}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={{ flex: '0 0 auto', width: 340 }}>
          <Board
            size={size}
            position={selPos}
            lastMove={selMove && selMove.point >= 0 ? selMove.point : null}
            showCoords={false}
            lastMoveMark={settings.lastMoveMark}
            fixedBox={312}
            interactive={false}
            zoom={1}
          />
          <div className="rev-detail">
            {selMove ? (
              <>
                <div className="rev-detail-head">
                  第 {selMove.ply} 手 {selMove.color === BLACK ? '黑' : '白'} {selMove.vertex}
                </div>
                <div className="small">
                  这一手之前黑棋 {toPercent(selMove.winrateBefore)}%，走完 {toPercent(selMove.winrateAfter)}%
                </div>
                <div className="small">
                  {selMove.loss > 0.005
                    ? `下棋这一方亏了 ${toPercent(selMove.loss)} 个点、${Math.abs(selMove.lossPoints).toFixed(1)} 目`
                    : '这一手没有亏'}
                </div>
                {selMove.bestMove ? (
                  <div className="small">
                    引擎推荐 {selMove.bestMove}
                    {selMove.rank === 1 ? '（就是这一手）' : selMove.rank > 0 ? `（这一手排第 ${selMove.rank}）` : '（这一手不在候选里）'}
                  </div>
                ) : null}
                <div className="small faint">每手算到 {selMove.visits} 次访问</div>
              </>
            ) : (
              <div className="small faint">选一手看看</div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function ScoreDialog({ onClose }: { onClose: () => void }): React.ReactElement {  const tree = useStore((s) => s.tree);
  const current = useStore((s) => s.current);
  const analysis = useStore((s) => s.analysis);
  const updateGameInfo = useStore((s) => s.updateGameInfo);
  const [dead, setDead] = useState<Set<number>>(new Set());
  const [rules, setRules] = useState<'chinese' | 'japanese'>('chinese');
  const size = propNum(tree, tree.root, 'SZ', 19);
  const komi = propNum(tree, tree.root, 'KM', 7.5);
  const pos = useMemo(() => positionAt(tree, current), [tree, current]);
  const result = useMemo(() => pos.score(dead, rules, komi), [pos, dead, rules, komi]);

  const useEngineDead = (): void => {
    if (!analysis?.ownership) return;
    const own = analysis.ownership;
    const next = new Set<number>();
    for (let i = 0; i < pos.cells.length; i++) {
      const c = pos.cells[i];
      if (c === 0) continue;
      const v = own[i] ?? 0;
      const sign = c === BLACK ? 1 : -1;
      if (v * sign < -0.55) next.add(i);
    }
    setDead(next);
  };

  const blackWin = result.lead > 0;
  const margin = Math.abs(result.lead);

  return (
    <Shell
      title="形势判断与数子"
      wide
      maxWidth={1020}
      onClose={onClose}
      footer={
        <>
          <div className="seg">
            <button className={'seg-item' + (rules === 'chinese' ? ' active' : '')} onClick={() => setRules('chinese')}>
              中国规则数子
            </button>
            <button className={'seg-item' + (rules === 'japanese' ? ' active' : '')} onClick={() => setRules('japanese')}>
              日本规则数目
            </button>
          </div>
          <div className="spacer" />
          <button className="btn" onClick={useEngineDead} disabled={!analysis?.ownership}>
            {analysis?.ownership ? '按引擎判断标死子' : '先开实时分析'}
          </button>
          <button
            className="btn primary"
            onClick={() => {
              updateGameInfo({ result: `${blackWin ? 'B' : 'W'}+${margin.toFixed(1)}` });
              useStore.getState().setFinished(`${blackWin ? '黑' : '白'}胜 ${margin.toFixed(1)} 目`);
              onClose();
            }}
          >
            记入结果
          </button>
        </>
      }
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
        {/* 棋盘要显式给尺寸：Board 的量测靠读外层容器，容器若由内容撑开就成了循环依赖，
            最后会退到 240px 的下限，19 路棋盘连交叉点都挤在一起，没法点死子。 */}
        <div style={{ flex: '0 0 auto', width: 372 }}>
          <Board
            size={size}
            position={pos}
            dead={Array.from(dead)}
            showCoords={false}
            fixedBox={344}
            onToggleDead={(p) => {
              const next = new Set(dead);
              if (next.has(p)) next.delete(p);
              else next.add(p);
              setDead(next);
            }}
            onPlay={(p) => {
              const next = new Set(dead);
              if (next.has(p)) next.delete(p);
              else next.add(p);
              setDead(next);
            }}
            zoom={1}
          />
          <div className="small faint" style={{ textAlign: 'center', marginTop: -6 }}>
            点棋子可以标成死子
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="score-grid">
            <div className="score-card">
              <div className="head">
                <span className="stone-dot black" />
                黑棋
              </div>
              <div className="score-line">
                <span>盘上子</span>
                <span>{result.stonesBlack}</span>
              </div>
              <div className="score-line">
                <span>围空</span>
                <span>{result.territoryBlack}</span>
              </div>
              <div className="score-line">
                <span>提子</span>
                <span>{result.capturesBlack}</span>
              </div>
              <div className="score-line total">
                <span>合计</span>
                <span>{result.black.toFixed(1)}</span>
              </div>
            </div>
            <div className="score-card">
              <div className="head">
                <span className="stone-dot white" />
                白棋
              </div>
              <div className="score-line">
                <span>盘上子</span>
                <span>{result.stonesWhite}</span>
              </div>
              <div className="score-line">
                <span>围空</span>
                <span>{result.territoryWhite}</span>
              </div>
              <div className="score-line">
                <span>提子</span>
                <span>{result.capturesWhite}</span>
              </div>
              <div className="score-line total">
                <span>合计</span>
                <span>{result.white.toFixed(1)}</span>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div className="wr-value" style={{ fontSize: 18 }}>
              {blackWin ? '黑棋领先' : '白棋领先'} {margin.toFixed(1)} 目
            </div>
            <div className="small faint" style={{ marginTop: 6, lineHeight: 1.7 }}>
              贴目 {komi}，单官 {result.dame} 个。死子由你标注，标错会直接改变结果，请对着棋盘核一遍。
              {analysis ? (
                <>
                  <br />
                  引擎判断：黑棋目差 {(analysis.turn === 'B' ? analysis.scoreLead : -analysis.scoreLead).toFixed(1)}，
                  胜率 {((analysis.turn === 'B' ? analysis.winrate : 1 - analysis.winrate) * 100).toFixed(1)}%。
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const info = useStore((s) => s.info);
  const toast = useStore((s) => s.toast);
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [visionKey, setVisionKey] = useState(settings.vision.apiKey);
  // 棋谱馆目录是主进程按设置算出来的，不在这份 draft 里，改完就地记一份显示
  const [dir, setDir] = useState(info?.libraryDir ?? '');

  const commit = async (): Promise<void> => {
    await setSettings({ ...draft, vision: { ...draft.vision, apiKey: visionKey } });
    toast('设置已保存', 'success');
    onClose();
  };

  return (
    <Shell
      title="设置"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="small faint">改动立即生效，引擎参数会在下一次请求时应用</span>
          <div className="spacer" />
          <button className="btn primary" onClick={() => void commit()}>
            保存
          </button>
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
        </>
      }
    >
      <div className="grid-2">
        <div>
          <h4 style={{ margin: '0 0 10px' }}>界面</h4>
          <div className="field">
            <label>主题</label>
            <div className="seg">
              {(['dark', 'light', 'system'] as const).map((t) => (
                <button
                  key={t}
                  className={'seg-item' + (draft.theme === t ? ' active' : '')}
                  onClick={() => setDraft({ ...draft, theme: t })}
                >
                  {t === 'dark' ? '深色' : t === 'light' ? '浅色' : '跟随系统'}
                </button>
              ))}
            </div>
          </div>
          <label className="switch">
            <input type="checkbox" checked={draft.coords} onChange={(e) => setDraft({ ...draft, coords: e.target.checked })} />
            显示坐标
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.moveNumbers}
              onChange={(e) => setDraft({ ...draft, moveNumbers: e.target.checked })}
            />
            显示手数
          </label>
          <div className="field" style={{ marginTop: 10 }}>
            <label>最后一手的标记</label>
            {/* 六个短标签，按内容宽度排；不跟着列宽拉伸，免得右边空一大片 */}
            <div className="seg wrap" style={{ alignSelf: 'flex-start' }}>
              {LAST_MOVE_MARK_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  className={'seg-item' + (draft.lastMoveMark === value ? ' active' : '')}
                  onClick={() => setDraft({ ...draft, lastMoveMark: value })}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="hint">
              黑子上画白点、白子上画黑点看得最轻，子多的时候容易找不着；红点、红三角不跟着棋子换色，一眼能认出来。
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>内置浏览器首页</label>
            <input
              value={draft.browserHome}
              onChange={(e) => setDraft({ ...draft, browserHome: e.target.value })}
              placeholder="about:blank"
            />
          </div>
        </div>
        <div>
          <h4 style={{ margin: '0 0 10px' }}>引擎</h4>
          <div className="field">
            <label>计算后端</label>
            <div className="seg">
              <button className={'seg-item' + (draft.backend === 'auto' ? ' active' : '')} onClick={() => setDraft({ ...draft, backend: 'auto' })}>
                自动
              </button>
              <button className={'seg-item' + (draft.backend === 'opencl' ? ' active' : '')} onClick={() => setDraft({ ...draft, backend: 'opencl' })}>
                OpenCL 核显
              </button>
              <button className={'seg-item' + (draft.backend === 'eigenavx2' ? ' active' : '')} onClick={() => setDraft({ ...draft, backend: 'eigenavx2' })}>
                Eigen 纯 CPU
              </button>
            </div>
          </div>
          <div className="field">
            <label>对局每步访问量：{draft.playVisits}</label>
            <input type="range" min={20} max={3000} step={20} value={draft.playVisits} onChange={(e) => setDraft({ ...draft, playVisits: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>分析每步访问量：{draft.analyzeVisits}</label>
            <input type="range" min={20} max={8000} step={20} value={draft.analyzeVisits} onChange={(e) => setDraft({ ...draft, analyzeVisits: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>复盘每手访问量：{draft.reviewVisits}</label>
            <input type="range" min={20} max={3000} step={10} value={draft.reviewVisits} onChange={(e) => setDraft({ ...draft, reviewVisits: Number(e.target.value) })} />
            <div className="hint">复盘要把每一手都算一遍，一整局几百手。核显上先用 100 到 200，跑得动再加。</div>
          </div>
          <div className="field">
            <label>搜索线程：{draft.threads}</label>
            <input type="range" min={1} max={Math.max(2, (info?.cpu.cores ?? 8))} step={1} value={draft.threads} onChange={(e) => setDraft({ ...draft, threads: Number(e.target.value) })} />
            <div className="hint">核显后端线程越多不一定越快，1 到 4 之间试一下手感。</div>
          </div>
          <div className="field">
            <label>对局默认网络</label>
            <select value={draft.modelId} onChange={(e) => setDraft({ ...draft, modelId: e.target.value })}>
              <option value="b6c96">b6c96 轻量（内置，快）</option>
              <option value="b18c384nbt">b18c384nbt 最强（需下载）</option>
              <option value="b28c512nbt">b28c512nbt 超大（需下载）</option>
              <option value="humanv0">humanv0 人类风格（需下载）</option>
            </select>
          </div>
        </div>
      </div>

      <h4 style={{ margin: '18px 0 8px' }}>图片识别</h4>
      <div className="small faint" style={{ marginBottom: 10, lineHeight: 1.7 }}>
        默认用本机算法识别，离线、免费、不传图。下面的接口是可选的备用方案：留空就一直用本地识别；
        接口地址和密钥都填上之后，“从图片识别棋谱”里那个用大模型识别的按钮就能用了，适合拍照变形比较厉害的图。
        <br />
        当前状态：
        {draft.vision.endpoint.trim() && visionKey.trim() ? (
          endpointHint(draft.vision.endpoint) ? (
            <span style={{ color: '#d9903a' }}>{endpointHint(draft.vision.endpoint)}</span>
          ) : (
            <span style={{ color: '#4caf62' }}>已填好，可以直接用</span>
          )
        ) : (
          <span style={{ color: '#d9903a' }}>
            还差{!draft.vision.endpoint.trim() ? '接口地址' : ''}
            {!draft.vision.endpoint.trim() && !visionKey.trim() ? '和' : ''}
            {!visionKey.trim() ? '密钥' : ''}
          </span>
        )}
        {draft.vision.endpoint.trim() && visionKey.trim() && !draft.vision.model.trim() ? '（模型名留空的话，服务端会用它的默认模型）' : ''}
      </div>
      <div className="grid-2">
        <div className="field">
          <label>接口地址（OpenAI 兼容的 chat/completions）</label>
          <input
            value={draft.vision.endpoint}
            placeholder="https://api.example.com/v1/chat/completions"
            onChange={(e) => setDraft({ ...draft, vision: { ...draft.vision, endpoint: e.target.value } })}
          />
        </div>
        <div className="field">
          <label>模型名</label>
          <input value={draft.vision.model} placeholder="gpt-4o 之类" onChange={(e) => setDraft({ ...draft, vision: { ...draft.vision, model: e.target.value } })} />
        </div>
      </div>
      <div className="field">
        <label>密钥</label>
        <input type="password" value={visionKey} onChange={(e) => setVisionKey(e.target.value)} placeholder="sk-…" />
      </div>

      <h4 style={{ margin: '18px 0 8px' }}>棋谱馆</h4>
      <div className="field">
        <label>棋谱放在哪个文件夹</label>
        <div className="row" style={{ gap: 8 }}>
          <input value={dir} readOnly title={dir} />
          <button
            className="btn"
            onClick={async () => {
              const next = await window.api.library.chooseDir();
              if (!next) return;
              /*
               * 这里不搬东西：换目录是棋谱馆那一页里的事，那儿才说清"搬不搬、搬几份"。
               * 设置里只换这个位置，原来那些棋谱还留在老地方，之后到棋谱馆里按"扫描"再收进来。
               */
              await window.api.library.setDir(next, false);
              setDir(next);
              toast('棋谱馆已换到这个文件夹。原来那些棋谱还在老地方，要用的话到棋谱馆里按“扫描”收进来', 'info');
            }}
          >
            更换目录
          </button>
          <button className="btn ghost" onClick={() => void window.api.library.reveal()} disabled={!dir}>
            打开目录
          </button>
        </div>
      </div>

      <h4 style={{ margin: '18px 0 8px' }}>关于本机</h4>
      <div className="small faint" style={{ lineHeight: 1.9 }}>
        {info ? (
          <>
            CPU：{info.cpu.model}，{info.cpu.cores} 核 · 内存 {info.memoryGB} GB
            <br />
            显卡：{info.gpu.join(' / ') || '未识别'}
            <br />
            引擎后端：{info.enginesAvailable.join('、') || '未找到'}
            <br />
            网络目录：{info.userModelsDir}
          </>
        ) : (
          '读取中…'
        )}
      </div>
    </Shell>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const info = useStore((s) => s.info);
  return (
    <Shell title="关于神之一手" onClose={onClose}>
      <div style={{ lineHeight: 1.9 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>神之一手</div>
        <div className="dim">和 AI 下棋、看棋、改棋，也能从图片和网页里把棋谱捡回来。</div>
        <div className="small faint" style={{ marginTop: 12, lineHeight: 2 }}>
          版本 {info?.version ?? '—'} · Electron {info?.electron ?? '—'} · Chromium {info?.chrome ?? '—'}
          <br />
          引擎：KataGo 1.18.1（OpenCL / Eigen 两种后端）
          <br />
          网络：内置 b6c96，可下载 b18c384nbt 等更强网络
          <br />
          识别算法与规则引擎均为本机运行，不联网、不上传任何棋谱。
        </div>
      </div>
    </Shell>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const rows: Array<[string, string]> = [
    ['← →', '上一手 / 下一手'],
    ['↑ ↓', '跳到开局 / 跳到最后'],
    ['Ctrl+Z / Ctrl+Y', '撤销 / 重做'],
    ['P', '停一手'],
    ['空格', '让 AI 替现行棋方走一手'],
    ['H', '提示现行棋方一手（标明黑白，不落子）'],
    ['A', '开始或暂停实时分析'],
    ['R', '打开复盘'],
    ['M', '开或停机机对局（双方都由 AI 自动走）'],
    ['E', '形势判断与数子'],
    ['C', '显示或隐藏坐标'],
    ['N', '显示或隐藏手数'],
    ['Ctrl+B', '显示或隐藏内置浏览器'],
    // 这两套标签键按焦点分流：谁有焦点谁说话。写清楚免得按下去发现关错了
    ['Ctrl+T', '新建棋盘（焦点在网页里时是新建浏览器标签页）'],
    ['Ctrl+W', '关闭当前棋盘（焦点在网页里时是关浏览器标签页）'],
    ['Ctrl+Tab / Ctrl+Shift+Tab', '切换棋盘（焦点在网页里时切换浏览器标签页）'],
    ['Ctrl+1..9', '跳到第 1 到 9 个棋盘'],
    ['Ctrl+Shift+D', '复制打开：照这一盘再开一份，两边互不影响'],
    ['Ctrl+Shift+T', '重开刚关掉的棋盘'],
    ['Ctrl+I', '从图片识别棋谱'],
    ['Ctrl+Shift+C', '截取内置浏览器画面'],
    ['Ctrl+O / Ctrl+S', '打开 / 保存棋谱'],
    ['+ / -', '放大缩小棋盘'],
    ['Delete', '删除当前这一手']
  ];
  return (
    <Shell title="快捷键" onClose={onClose}>
      <div className="shortcut-grid">
        {rows.map(([k, v]) => (
          <>
            <span key={k} className="k">
              {k}
            </span>
            <span key={k + 'v'}>{v}</span>
          </>
        ))}
      </div>
    </Shell>
  );
}

/**
 * 关掉有改动的棋盘之前问一句。
 *
 * 只有"关这一个"才给"保存并关闭"：关一片的时候一盘一盘弹存盘对话框，
 * 点两下就不知道自己在存哪一盘了，所以那边只说清有几盘没保存，让人自己决定。
 */
function CloseBoardDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const pending = useStore((s) => s.pendingClose);
  const boards = useStore((s) => s.boards);
  const activeBoard = useStore((s) => s.activeBoard);
  const dirty = useStore((s) => s.dirty);
  const confirmClose = useStore((s) => s.confirmClose);
  const cancelClose = useStore((s) => s.cancelClose);
  const [busy, setBusy] = useState(false);
  const one = pending?.scope === 'one' ? boards.find((t) => t.id === pending.ids[0]) : undefined;
  const unsaved =
    pending?.ids.filter((id) => (id === activeBoard ? dirty : boards.find((t) => t.id === id)?.slice.dirty)).length ?? 0;

  const run = async (mode: 'save' | 'discard'): Promise<void> => {
    setBusy(true);
    try {
      await confirmClose(mode);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="有改动没保存" onClose={onClose} maxWidth={460}>
      {one ? (
        <div className="field">
          <div className="hint" style={{ fontSize: 12 }}>
            这一盘{one.slice.filePath ? `（${one.slice.filePath}）` : ''}动过之后还没存过。存一份再关，还是直接关掉？
          </div>
        </div>
      ) : (
        <div className="field">
          <div className="hint" style={{ fontSize: 12 }}>
            这 {pending?.ids.length ?? 0} 盘里还有 {unsaved} 盘没保存。直接关掉的话，那些改动就没了（已经算出来的复盘结果也会跟着走）。
          </div>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="btn ghost" disabled={busy} onClick={() => { cancelClose(); onClose(); }}>
          取消
        </button>
        <button className="btn" disabled={busy} onClick={() => void run('discard')} title="不保存，直接关掉">
          {one ? '直接关闭' : '全部关掉'}
        </button>
        {one ? (
          <button className="btn primary" disabled={busy} onClick={() => void run('save')}>
            保存并关闭
          </button>
        ) : null}
      </div>
    </Shell>
  );
}

export function DialogsHost({ snapshot }: { snapshot: AnalysisSnapshot | null }): React.ReactElement | null {
  const dialog = useStore((s) => s.dialog);
  const setDialog = useStore((s) => s.setDialog);
  const turn = useStore((s) => colorToPlayAt(s.tree, s.current));
  void snapshot;
  void turn;

  if (!dialog) return null;
  const close = (): void => setDialog(null);
  switch (dialog) {
    case 'newgame':
      return <NewGameDialog onClose={close} />;
    case 'gameinfo':
      return <GameInfoDialog onClose={close} />;
    case 'models':
      return <ModelsDialog onClose={close} />;
    case 'score':
      return <ScoreDialog onClose={close} />;
    case 'review':
      return <ReviewDialog onClose={close} />;
    case 'settings':
      return <SettingsDialog onClose={close} />;
    case 'about':
      return <AboutDialog onClose={close} />;
    case 'shortcuts':
      return <ShortcutsDialog onClose={close} />;
    case 'closetab':
      return <CloseBoardDialog onClose={close} />;
    default:
      return null;
  }
}

export { Board, moveAtSized };
