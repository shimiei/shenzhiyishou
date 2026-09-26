import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { BLACK, WHITE, type AnalysisMove, type AnalysisSnapshot } from '../../shared/types';

function blackView(snapshot: AnalysisSnapshot | null): { winrate: number; lead: number } {
  if (!snapshot) return { winrate: 0.5, lead: 0 };
  const w = snapshot.turn === 'B' ? snapshot.winrate : 1 - snapshot.winrate;
  const l = snapshot.turn === 'B' ? snapshot.scoreLead : -snapshot.scoreLead;
  return { winrate: w, lead: l };
}

export interface EnginePanelProps {
  snapshot: AnalysisSnapshot | null;
  onShowOwnership: (v: boolean) => void;
  showOwnership: boolean;
  onPickCandidate: (c: AnalysisMove) => void;
  style?: React.CSSProperties;
}

export function EnginePanel({ snapshot, onShowOwnership, showOwnership, onPickCandidate, style }: EnginePanelProps): React.ReactElement {
  const engine = useStore((s) => s.engineStatus);
  const analyzing = useStore((s) => s.analyzing);
  const thinking = useStore((s) => s.thinking);
  const logs = useStore((s) => s.engineLogs);
  const toggleAnalysis = useStore((s) => s.toggleAnalysis);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [showLogs, setShowLogs] = useState(false);
  const [bench, setBench] = useState<string>('');

  const { winrate, lead } = useMemo(() => blackView(snapshot), [snapshot]);
  const blackPct = Math.round(winrate * 1000) / 10;
  const candidates = snapshot?.lines?.slice(0, 8) ?? [];
  const maxVisits = candidates.length ? Math.max(...candidates.map((c) => c.visits), 1) : 1;

  const startEngine = async (): Promise<void> => {
    toast('正在启动引擎，首次运行做 OpenCL 调优可能要等一会儿…');
    const st = await window.api.engine.start();
    useStore.getState().setEngineStatus(st);
    if (st.ready) toast(`引擎就绪：${st.modelName}（${st.backend}）`, 'success');
    else toast(st.error ?? '引擎启动失败', 'error');
  };

  const runBench = async (): Promise<void> => {
    setBench('测速中，第一次跑 OpenCL 调优可能要几分钟…');
    const res = await window.api.engine.benchmark(settings.modelId, engine.backend ?? 'opencl');
    setBench(
      res.visitsPerSec > 0
        ? `${engine.backend ?? 'opencl'} 约 ${res.visitsPerSec.toFixed(1)} 次访问/秒（用时 ${res.seconds.toFixed(0)} 秒）`
        : res.error ?? '测速失败'
    );
  };

  return (
    <div className="side right" style={style}>
      <div className="panel">
        <div className="panel-head">
          <span className="title">引擎</span>
          <div className="spacer" />
          <span className={engine.ready ? 'badge ok' : engine.error ? 'badge err' : engine.starting ? 'badge warn' : 'badge'}>
            <span className={thinking || analyzing || engine.starting ? 'dot busy' : engine.ready ? 'dot ok' : engine.error ? 'dot err' : 'dot'} />
            {engine.starting ? '启动中' : thinking ? '思考中' : analyzing ? '分析中' : engine.ready ? '就绪' : '未启动'}
          </span>
        </div>
        <div className="wr-block">
          <div className="wr-top">
            <div>
              <div className="wr-value">{blackPct.toFixed(1)}%</div>
              <div className="wr-sub">黑棋胜率</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="wr-value" style={{ fontSize: 17 }}>
                {lead >= 0 ? '+' : ''}
                {lead.toFixed(1)}
              </div>
              <div className="wr-sub">黑棋目差</div>
            </div>
          </div>
          <div className="wr-bar">
            <div className="wr-fill black" style={{ width: `${Math.max(2, Math.min(98, winrate * 100))}%` }} />
            <div className="wr-fill white" style={{ flex: 1 }} />
          </div>
          <div className="wr-marks">
            <span>白 {whitePctLabel(winrate)}</span>
            <span>{snapshot ? `${snapshot.visits} 次访问` : '暂无数据'}</span>
          </div>
        </div>
        <div className="stats">
          <div className="stat">
            <div className="label">后端</div>
            <div className="value">{engine.backend ?? '—'}</div>
          </div>
          <div className="stat">
            <div className="label">网络</div>
            <div className="value" style={{ fontSize: 12 }} title={engine.modelName ?? ''}>
              {(engine.modelName ?? '—').split(' ')[0]}
            </div>
          </div>
          <div className="stat">
            <div className="label">线程</div>
            <div className="value">{settings.threads}</div>
          </div>
        </div>
        <div className="row wrap" style={{ padding: '0 10px 10px' }}>
          {!engine.ready ? (
            <button className="btn primary sm" onClick={() => void startEngine()}>
              启动引擎
            </button>
          ) : (
            <button
              className="btn sm"
              onClick={async () => {
                await window.api.engine.stop();
                useStore.getState().setEngineStatus(await window.api.engine.status());
              }}
            >
              停止引擎
            </button>
          )}
          <button className={'btn sm' + (analyzing ? ' primary' : '')} onClick={() => void toggleAnalysis()}>
            {analyzing ? '暂停分析' : '实时分析'}
          </button>
          <button className={'chip' + (showOwnership ? ' active' : '')} onClick={() => onShowOwnership(!showOwnership)}>
            显示形势
          </button>
          <button className="btn sm ghost" onClick={() => setShowLogs((v) => !v)}>
            {showLogs ? '收起日志' : '引擎日志'}
          </button>
        </div>
      </div>

      <div className="panel grow">
        <div className="panel-head">
          <span className="title">候选点</span>
          <div className="spacer" />
          <span className="small faint">点一下画到棋盘上</span>
        </div>
        <div className="panel-body flush" style={{ flex: 1, minHeight: 0 }}>
          {candidates.length === 0 ? (
            <div className="empty">
              还没有分析数据。
              <br />
              点上面的“实时分析”开始，或者按 A。
            </div>
          ) : (
            <div className="candidates">
              {candidates.map((c, i) => (
                <div key={c.move + i} className={'cand' + (i === 0 ? ' top' : '')} onClick={() => onPickCandidate(c)}>
                  <span className="move">{c.move}</span>
                  <span className="bar">
                    <i style={{ width: `${Math.round((c.visits / maxVisits) * 100)}%` }} />
                  </span>
                  <span className="visits">{(c.winrate * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}
          {showLogs ? (
            <div style={{ padding: 10 }}>
              <div className="log-box">{logs.slice(-60).join('\n') || '暂无日志'}</div>
              <div className="row wrap" style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={() => void runBench()}>
                  测速
                </button>
                <button className="btn sm" onClick={() => useStore.getState().setDialog('models')}>
                  管理网络
                </button>
              </div>
              {bench ? <div className="small faint" style={{ marginTop: 6 }}>{bench}</div> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="title">对局强度</span>
        </div>
        <div className="panel-body pad">
          <div className="field">
            <label>每步访问量 {settings.playVisits}</label>
            <input
              type="range"
              min={20}
              max={3000}
              step={20}
              value={settings.playVisits}
              onChange={(e) => void setSettings({ playVisits: Number(e.target.value) })}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>每步限时 {(settings.playTimeMs / 1000).toFixed(1)} 秒</label>
            <input
              type="range"
              min={0}
              max={30000}
              step={500}
              value={settings.playTimeMs}
              onChange={(e) => void setSettings({ playTimeMs: Number(e.target.value) })}
            />
            <div className="hint">访问量与限时同时生效，先到为准。核显上把访问量降到 100 以内会明显更快。</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function whitePctLabel(blackWinrate: number): string {
  const w = (1 - blackWinrate) * 100;
  return `${w.toFixed(1)}%`;
}

export function TurnIndicator({ turn }: { turn: number }): React.ReactElement {
  return (
    <span className="turn-pill">
      <span className={'stone-dot ' + (turn === BLACK ? 'black' : 'white')} />
      {turn === BLACK ? '黑方行棋' : '白方行棋'}
    </span>
  );
}

export { WHITE };
