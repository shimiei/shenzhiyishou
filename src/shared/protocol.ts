import type { AnalysisSnapshot, AppSettings, BackendName, EngineStatus, ModelEntry, RecordEntry, RecordMeta } from './types';

/** 主进程与渲染进程之间的通道名。 */
export const CH = {
  engineStart: 'engine:start',
  engineStop: 'engine:stop',
  engineStatus: 'engine:status',
  engineSetParams: 'engine:setParams',
  engineSync: 'engine:sync',
  engineGenMove: 'engine:genmove',
  engineAnalyzeStart: 'engine:analyzeStart',
  engineAnalyzeStop: 'engine:analyzeStop',
  engineBenchmark: 'engine:benchmark',
  engineHint: 'engine:hint',
  engineEvent: 'engine:event',

  modelsList: 'models:list',
  modelsDownload: 'models:download',
  modelsCancel: 'models:cancel',
  modelsRemove: 'models:remove',
  modelsImport: 'models:import',
  modelsProgress: 'models:progress',

  filesOpenSgf: 'files:openSgf',
  filesSaveSgf: 'files:saveSgf',
  filesOpenImage: 'files:openImage',
  filesSaveText: 'files:saveText',

  libraryList: 'library:list',
  librarySave: 'library:save',
  libraryDelete: 'library:delete',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',

  browserCapture: 'browser:capture',
  browserOpenExternal: 'browser:openExternal',
  browserOpenTab: 'browser:openTab',

  clipReadText: 'clip:readText',
  clipWriteText: 'clip:writeText',

  appInfo: 'app:info',
  appCommand: 'app:command',
  winMinimize: 'win:minimize',
  winMaximize: 'win:maximize',
  winClose: 'win:close'
} as const;

export type AppCommand =
  | 'new'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'importImage'
  | 'captureBrowser'
  | 'undo'
  | 'redo'
  | 'pass'
  | 'resign'
  | 'hint'
  | 'aiMove'
  | 'toggleAnalysis'
  | 'analyzeGame'
  | 'score'
  | 'copySgf'
  | 'settings'
  | 'models'
  | 'library'
  | 'toggleBrowser'
  | 'browserNewTab'
  | 'browserCloseTab'
  | 'browserNextTab'
  | 'browserPrevTab'
  | 'about';

/** 网页点了新标签链接时，主进程把地址交回界面开成标签。 */
export interface OpenTabRequest {
  url: string;
  activate: boolean;
}

export interface EngineEvent {
  type: 'status' | 'info' | 'log' | 'move' | 'error' | 'genmove-done';
  status?: EngineStatus;
  snapshot?: AnalysisSnapshot;
  text?: string;
  move?: string;
}

export interface GenMoveRequest {
  /** 当前局面的 SGF 文本，引擎通过 loadsgf 载入。 */
  sgf: string;
  color: 'B' | 'W';
  maxVisits: number;
  maxTimeMs: number;
  allowResign: boolean;
  temperature: number;
}

export interface GenMoveResult {
  move: string;
  visits: number;
  winrate: number;
  scoreLead: number;
  pv: string[];
  resigned: boolean;
  error?: string;
}

export interface AnalyzeRequest {
  sgf: string;
  visits: number;
  maxTimeMs: number;
  ownership: boolean;
  lines: number;
  /** 局面所在节点，用于让界面丢弃过期结果。 */
  nodeId: number;
  /** 该节点轮到谁走，用于把胜率与目差换算到黑棋视角。 */
  turn: 'B' | 'W';
}

export interface BenchmarkResult {
  backend: BackendName;
  visitsPerSec: number;
  seconds: number;
  error?: string;
}

export interface DownloadProgress {
  id: string;
  received: number;
  total: number;
  done: boolean;
  error?: string;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  resourcesPath: string;
  userDataPath: string;
  bundledModelsDir: string;
  userModelsDir: string;
  recordsDir: string;
  logsDir: string;
  enginesAvailable: BackendName[];
  cpu: { model: string; cores: number; threads: number };
  memoryGB: number;
  gpu: string[];
}

/** preload 暴露给渲染进程的接口。 */
export interface Api {
  engine: {
    status(): Promise<EngineStatus>;
    start(opts?: { backend?: BackendName; modelId?: string }): Promise<EngineStatus>;
    stop(): Promise<void>;
    setParams(p: Partial<AppSettings>): Promise<void>;
    sync(sgf: string): Promise<{ ok: boolean; error?: string }>;
    genMove(req: GenMoveRequest): Promise<GenMoveResult>;
    analyzeStart(req: AnalyzeRequest): Promise<{ ok: boolean; error?: string }>;
    analyzeStop(): Promise<void>;
    benchmark(modelId: string, backend: BackendName): Promise<BenchmarkResult>;
    hint(sgf: string, visits: number, color: 'B' | 'W', maxTimeMs: number): Promise<GenMoveResult>;
    onEvent(cb: (e: EngineEvent) => void): () => void;
  };
  models: {
    list(): Promise<ModelEntry[]>;
    download(id: string): Promise<{ ok: boolean; error?: string }>;
    cancel(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    import(): Promise<ModelEntry | null>;
    onProgress(cb: (p: DownloadProgress) => void): () => void;
  };
  files: {
    openSgf(): Promise<{ name: string; path: string; content: string } | null>;
    openSgfPath(path: string): Promise<{ name: string; path: string; content: string } | null>;
    saveSgf(defaultName: string, content: string): Promise<string | null>;
    openImage(): Promise<{ name: string; path: string; dataUrl: string } | null>;
    saveText(defaultName: string, content: string): Promise<string | null>;
  };
  library: {
    list(): Promise<RecordMeta[]>;
    save(entry: { meta: Partial<RecordMeta>; content: string; id?: string }): Promise<RecordMeta>;
    get(id: string): Promise<RecordEntry | null>;
    delete(id: string): Promise<void>;
  };
  settings: {
    get(): Promise<AppSettings>;
    set(patch: Partial<AppSettings>): Promise<AppSettings>;
  };
  browser: {
    capture(webContentsId: number): Promise<string | null>;
    openExternal(url: string): Promise<void>;
    onOpenTab(cb: (req: OpenTabRequest) => void): () => void;
  };
  clip: {
    readText(): Promise<string>;
    writeText(text: string): Promise<void>;
  };
  app: {
    info(): Promise<AppInfo>;
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
    onCommand(cb: (cmd: AppCommand) => void): () => void;
  };
}

declare global {
  interface Window {
    api: Api;
  }
}
