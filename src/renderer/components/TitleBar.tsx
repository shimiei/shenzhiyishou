import { useThinking, useStore } from '../state/store';

export function TitleBar(): React.ReactElement {
  const filePath = useStore((s) => s.filePath);
  const dirty = useStore((s) => s.dirty);
  const engine = useStore((s) => s.engineStatus);
  const theme = useStore((s) => s.theme);
  const setSettings = useStore((s) => s.setSettings);
  const thinking = useThinking();
  const analyzing = useStore((s) => s.analyzing);

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : '未命名棋谱';

  return (
    <div className="titlebar">
      <div className="brand">
        <span className="mark" />
        <span>神之一手</span>
      </div>
      <div className="file">
        <span>{fileName}</span>
        {dirty ? <span className="dirty">·</span> : null}
      </div>
      <div className="spacer" />
      <div className="tb-right">
        {thinking ? <span className="badge warn">引擎思考中</span> : null}
        {analyzing ? <span className="badge ok">分析中</span> : null}
        <span
          className={engine.ready ? 'badge ok' : engine.error ? 'badge err' : engine.starting ? 'badge warn' : 'badge'}
          title={
            engine.starting
              ? '首次启动要为显卡调优 OpenCL 内核，可能要十几分钟，引擎日志里有进度'
              : engine.ready
                ? `${engine.backend ?? ''} · ${engine.modelFile ?? ''}`
                : undefined
          }
        >
          <span className={engine.ready ? 'dot ok' : engine.error ? 'dot err' : 'dot'} />
          {engine.ready
            ? engine.modelName ?? '引擎就绪'
            : engine.error
              ? '引擎异常'
              : engine.starting
                ? '引擎启动中'
                : '引擎未启动'}
        </span>
        <button
          className="btn ghost sm"
          title="切换深浅色"
          onClick={() => void setSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
        >
          {theme === 'dark' ? '浅色' : '深色'}
        </button>
      </div>
    </div>
  );
}
