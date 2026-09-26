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
  engineReviewStart: 'engine:reviewStart',
  engineReviewStop: 'engine:reviewStop',
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
  libraryGet: 'library:get',
  librarySave: 'library:save',
  libraryDelete: 'library:delete',
  libraryUpdate: 'library:update',
  libraryExport: 'library:export',
  libraryScan: 'library:scan',
  libraryAdopt: 'library:adopt',
  libraryChooseDir: 'library:chooseDir',
  librarySetDir: 'library:setDir',
  libraryReveal: 'library:reveal',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',

  sessionGet: 'session:get',
  sessionSet: 'session:set',

  visionChat: 'vision:chat',

  browserCapture: 'browser:capture',
  browserClick: 'browser:click',
  browserOpenExternal: 'browser:openExternal',
  browserOpenTab: 'browser:openTab',

  desktopList: 'desktop:list',
  desktopPick: 'desktop:pick',
  desktopMark: 'desktop:mark',
  desktopClear: 'desktop:clear',
  desktopClick: 'desktop:click',
  desktopGeom: 'desktop:geom',

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
  | 'toggleAiVsAi'
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
  /** 棋盘标签：开、复制、关、前后切、重开刚关掉的。 */
  | 'boardNew'
  | 'boardDuplicate'
  | 'boardClose'
  | 'boardCloseOthers'
  | 'boardCloseAll'
  | 'boardNext'
  | 'boardPrev'
  | 'boardReopen'
  /** 第 1 到 9 个棋盘，菜单里一人一条。 */
  | `boardN${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | 'about';

/** 网页点了新标签链接时，主进程把地址交回界面开成标签。 */
export interface OpenTabRequest {
  url: string;
  activate: boolean;
}

/** 窗口列表里的一项（选"盯住哪个窗口"时用）。 */
export interface DesktopWindow {
  /** 抓帧用的源 id（window:句柄:0 这种），交给主进程去开视频流。 */
  id: string;
  /** 窗口句柄，主进程读位置、点鼠标都靠它。 */
  hwnd: number;
  title: string;
  /** 进程名。窗口标题会随对局变，认窗口靠它。 */
  proc: string;
  iconic: boolean;
}

/** 目标窗口的实时几何，主进程隔一会儿推一次（落点叠层要跟着窗口走）。 */
export interface DesktopGeom {
  hwnd: number;
  /** 整窗矩形，屏幕物理像素。 */
  win: { x: number; y: number; w: number; h: number };
  /** 客户区矩形（去掉标题栏与边框），同样是屏幕物理像素。 */
  client: { x: number; y: number; w: number; h: number };
  iconic: boolean;
  visible: boolean;
  foreground: boolean;
  /**
   * 读窗口那个助手进程的 DPI 感知（2 = 每显示器感知）。
   * 上面两个矩形是不是物理像素全看它：不是 2 就说明跟 DWM 报的那一套混着了，缩放不是 100% 时会点偏。
   */
  dpi?: number;
  /** 窗口已经没了（关掉了）。 */
  gone: boolean;
}

/** 在目标窗口上标一个点，给人看"这一手要点这儿"。frame 与 point 都是抓帧画面的像素。 */
export interface DesktopMark {
  frame: { width: number; height: number };
  point: { x: number; y: number };
  /** 1 黑 2 白，只影响环的颜色。 */
  color: 1 | 2;
  /** 多久之后自己消失（毫秒）。不给就一直留着，直到下一次 mark 或 clear。 */
  ttlMs?: number;
}

/** 真点一下的结果。没点成要有说得清的原因。 */
export interface DesktopClickResult {
  ok: boolean;
  /** 没点成的原因（中文，直接可以显示给用户）。 */
  reason?: string;
  /** 真的点到的屏幕物理坐标。 */
  screen?: { x: number; y: number };
  /** 点完把前台窗口还给本程序了吗。 */
  focusBack?: boolean;
}

export interface EngineEvent {
  type: 'status' | 'info' | 'log' | 'move' | 'error' | 'genmove-done' | 'review' | 'reviewEnd' | 'analysisStopped';
  /**
   * 这条消息是哪一盘棋的事。
   *
   * 开了多个棋盘之后，"跑着的分析是给谁算的"必须说清楚：界面上不止一盘，
   * 收错了盘子会把结论画到别人的棋盘上。对局引擎的实时战报、分析快照、
   * 复盘结果、以及那句"你的分析被顶掉了"都带它。状态与日志是全局的，不带。
   */
  board?: string;
  status?: EngineStatus;
  snapshot?: AnalysisSnapshot;
  text?: string;
  move?: string;
  /** 复盘：刚算完的一个局面。 */
  review?: ReviewPointWire;
  /** 复盘：已经算完几个、一共几个。 */
  reviewProgress?: { done: number; total: number };
  /**
   * 复盘结束的原因。cancelled 是用户点了取消，replaced 是被别的分析挤掉，
   * error 是引擎出错，done 是整局算完了。前三种都保留已经算出来的那部分。
   */
  reviewEnd?: { reason: 'done' | 'cancelled' | 'replaced' | 'error'; error?: string };
  /**
   * 这一盘的实时分析被另一盘顶掉了。
   *
   * 分析引擎一次只能服务一盘棋，所以这件事一定会发生。发一条明确的告诉界面，
   * 那盘才能把"分析中"收干净，而不是留一个看着在转、其实早就断了的圈。
   */
  analysisStopped?: { reason: 'replaced' };
}

/** 主进程算完一个局面后回给界面的结果。胜率一律换算成黑棋视角。 */
export interface ReviewPointWire {
  /** 这分结果是给哪一盘算的。 */
  board: string;
  nodeId: number;
  ply: number;
  turn: 'B' | 'W';
  blackWinrate: number;
  blackScoreLead: number;
  visits: number;
  bestMove: string;
  candidates: Array<{ move: string; blackWinrate: number; visits: number }>;
}

export interface ReviewRequest {
  /** 这盘棋的标签号：复盘结果、被顶掉的说明都要送回它自己那一盘。 */
  board: string;
  /**
   * 按手顺排好的局面，起始局面在最前面。每个都带一份完整 SGF：
   * 切棋谱是照树切的，那是渲染进程那边 core/sgf 的事，主进程不重复一份解析器。
   */
  positions: Array<{ nodeId: number; sgf: string; turn: 'B' | 'W'; ply: number }>;
  /** 每个局面算到多少次访问就收手。 */
  visits: number;
  /** 每个局面的时间上限（毫秒），0 表示只按访问量收手。 */
  maxTimeMs: number;
  /** 每个局面最多记几个候选点。 */
  lines: number;
}

/** 请视觉大模型看一张棋盘的图。整件事在主进程发，渲染进程只负责说"要什么"。 */
export interface VisionRequest {
  endpoint: string;
  model: string;
  apiKey: string;
  /** data:image/png;base64,... 形式的图。 */
  imageDataUrl: string;
  /** 棋盘几路，提示里要写清楚。 */
  size: number;
}

/** 主进程把正文带回来，或者把失败的原因带回来。 */
export interface VisionResult {
  ok: boolean;
  /** 模型输出的正文（ok 为真时才有）。 */
  content?: string;
  /** HTTP 状态码，接口报错时有。 */
  status?: number;
  error?: string;
  /** 出错时服务端原话的前几百个字。 */
  body?: string;
}

export interface GenMoveRequest {
  /** 谁要的这一手：战报要送对盘，打断分析时也只能打断它自己那盘。 */
  board: string;
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
  /** 这盘棋的标签号：快照要落到它自己那一盘上。 */
  board: string;
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
  /** 棋谱馆目录（用户自己挑的，没挑过就是默认那个）。 */
  libraryDir: string;
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
    /** 停掉某一盘的分析：正在跑的是别的盘就不动它。 */
    analyzeStop(board: string): Promise<void>;
    /** 复盘：把一整局的局面排队逐个分析，结果通过 onEvent 的 review 事件回来。 */
    reviewStart(req: ReviewRequest): Promise<{ ok: boolean; error?: string }>;
    reviewStop(board: string): Promise<void>;
    benchmark(modelId: string, backend: BackendName): Promise<BenchmarkResult>;
    hint(sgf: string, visits: number, color: 'B' | 'W', maxTimeMs: number, board: string): Promise<GenMoveResult>;
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
    /** 馆里有哪些棋谱，以及这个馆在哪个文件夹。 */
    list(): Promise<{ dir: string; records: RecordMeta[] }>;
    get(id: string): Promise<RecordEntry | null>;
    /** 存一份。给了 id 就是更新原来那一条（文件名不动）。 */
    save(entry: { meta: Partial<RecordMeta>; content: string; id?: string }): Promise<RecordMeta>;
    /** 删几条，返回真的删掉了几条。 */
    delete(ids: string[]): Promise<number>;
    /** 改标题或标签：只动索引，不动磁盘上的文件名。 */
    update(id: string, patch: { title?: string; tags?: string[] }): Promise<RecordMeta | null>;
    /** 导出到别的文件夹。不给 dir 就弹一个选文件夹的对话框；返回的 dir 为 null 表示用户取消了。 */
    export(
      ids: string[],
      dir?: string
    ): Promise<{ dir: string | null; exported: number; skipped: number; names: string[] }>;
    /** 扫一遍目录：哪些文件还没进索引（连正文带回来），索引里哪些文件不见了。 */
    scan(): Promise<{ dir: string; added: Array<{ file: string; content: string }>; missing: string[] }>;
    /** 把扫出来的几份写进索引，返回收编了几份。 */
    adopt(items: Array<{ file: string; meta: Partial<RecordMeta> }>): Promise<number>;
    /** 弹一个"选文件夹"的对话框，返回选中的路径（取消为 null）。搬不搬由界面再问一句。 */
    chooseDir(): Promise<string | null>;
    /** 换棋谱馆目录。move 为真就把现有的棋谱一起搬过去。 */
    setDir(dir: string, move: boolean): Promise<{ dir: string; moved: number; failed: number }>;
    /** 在资源管理器里打开棋谱馆目录；给了 id 就选中那一份。 */
    reveal(id?: string): Promise<void>;
  };
  settings: {
    get(): Promise<AppSettings>;
    set(patch: Partial<AppSettings>): Promise<AppSettings>;
  };
  /**
   * 会话：关掉程序时开着的那几盘棋。内容是渲染进程那边定的格式，
   * 主进程只当它是一包 JSON 存下来（见 core/boards/session.ts）。
   */
  session: {
    get(): Promise<unknown>;
    set(data: unknown): Promise<void>;
  };
  vision: {
    /** 由主进程代发请求：界面自己的 CSP 不放行外部地址。 */
    recognize(req: VisionRequest): Promise<VisionResult>;
  };
  browser: {
    capture(webContentsId: number): Promise<string | null>;
    /** 往网页上点一下。坐标是网页的 CSS 像素，自动落子用来把一手棋点到棋盘上。 */
    click(webContentsId: number, x: number, y: number): Promise<boolean>;
    openExternal(url: string): Promise<void>;
    onOpenTab(cb: (req: OpenTabRequest) => void): () => void;
  };
  /**
   * 程序外面的窗口：原生客户端、远程桌面画面。
   * 认的话是抓帧（主进程按窗口开一路视频流），点的话是真鼠标（搬光标过去按一下再还回来）。
   */
  desktop: {
    list(): Promise<DesktopWindow[]>;
    /** 盯住这个窗口。传 null 就是放开：视频源撤掉、几何不再读、叠层收起来。 */
    pick(win: DesktopWindow | null): Promise<{ ok: boolean; error?: string }>;
    mark(m: DesktopMark): Promise<boolean>;
    clearMark(): Promise<void>;
    clickAt(p: { frame: { width: number; height: number }; point: { x: number; y: number } }): Promise<DesktopClickResult>;
    onGeom(cb: (g: DesktopGeom) => void): () => void;
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
