import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Board } from './Board';
import { colorToPlayAt, infoFromTree, moveAtSized, positionAt, propNum } from '../core/sgf/tree';
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
              自由摆谱
            </button>
            <button className={'seg-item' + (mode === 'vs-ai' ? ' active' : '')} onClick={() => setMode('vs-ai')}>
              人机对局
            </button>
            <button className={'seg-item' + (mode === 'ai-vs-ai' ? ' active' : '')} onClick={() => setMode('ai-vs-ai')}>
              机机对局
            </button>
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
            onClick={async () => {
              const st = await window.api.engine.start({ modelId: settings.modelId });
              useStore.getState().setEngineStatus(st);
              toast(st.ready ? '已用新网络重启引擎' : st.error ?? '启动失败', st.ready ? 'success' : 'error');
            }}
          >
            用选中的网络重启引擎
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
                    onClick={() => void setSettings({ modelId: m.id }).then(() => toast('已切换为 ' + m.name))}
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

function LibraryDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const [items, setItems] = useState<Awaited<ReturnType<typeof window.api.library.list>>>([]);
  const loadSgf = useStore((s) => s.loadSgf);
  const toast = useStore((s) => s.toast);
  const refresh = async (): Promise<void> => setItems(await window.api.library.list());
  useEffect(() => {
    void refresh();
  }, []);

  return (
    <Shell title="棋谱库" wide onClose={onClose}>
      {items.length === 0 ? (
        <div className="empty">棋谱库还是空的。对局结束后点「存入棋谱库」，就会存到这里。</div>
      ) : (
        <div className="lib-list">
          {items.map((it) => (
            <div key={it.id} className="lib-item">
              <span className="t">{it.title}</span>
              <div className="row">
                <button
                  className="btn sm"
                  onClick={async () => {
                    const full = await window.api.library.get(it.id);
                    if (full) {
                      loadSgf(full.content);
                      onClose();
                    }
                  }}
                >
                  打开
                </button>
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    await window.api.library.delete(it.id);
                    toast('已删除', 'success');
                    void refresh();
                  }}
                >
                  删除
                </button>
              </div>
              <div className="meta">
                <span>
                  {it.blackName || '黑'} 对 {it.whiteName || '白'}
                </span>
                <span>{it.result || '结果未记'}</span>
                <span>{it.date || ''}</span>
                <span>
                  {it.size} 路 {it.moves} 手
                </span>
                <span>{new Date(it.savedAt).toLocaleString('zh-CN')}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

function ScoreDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const tree = useStore((s) => s.tree);
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
        填好之后，「从图片识别棋谱」里会多一个用大模型识别的按钮，适合拍照变形比较厉害的图。
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
            <br />
            棋谱库目录：{info.recordsDir}
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
    ['空格', '让引擎走一手'],
    ['H', '提示一手'],
    ['A', '开始或暂停实时分析'],
    ['E', '形势判断与数子'],
    ['C', '显示或隐藏坐标'],
    ['N', '显示或隐藏手数'],
    ['Ctrl+B', '显示或隐藏内置浏览器'],
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
    case 'library':
      return <LibraryDialog onClose={close} />;
    case 'score':
      return <ScoreDialog onClose={close} />;
    case 'settings':
      return <SettingsDialog onClose={close} />;
    case 'about':
      return <AboutDialog onClose={close} />;
    case 'shortcuts':
      return <ShortcutsDialog onClose={close} />;
    default:
      return null;
  }
}

export { Board, moveAtSized };
