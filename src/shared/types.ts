/** 应用内通用类型定义，主进程与渲染进程共用。 */

export type Stone = 0 | 1 | 2;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export const PASS = -1;

export type BoardSize = 9 | 13 | 19;
export type ColorName = 'B' | 'W';

export interface Point {
  x: number;
  y: number;
}

/** SGF 属性集合。键为属性标识，值为原始字符串数组。 */
export type SgfProps = Record<string, string[]>;

/** 棋谱树节点，用父子编号表示，方便整体序列化与撤销。 */
export interface TreeNodeData {
  id: number;
  parent: number | null;
  children: number[];
  props: SgfProps;
}

export interface GameTree {
  nodes: Record<number, TreeNodeData>;
  root: number;
  nextId: number;
}

export interface GameInfo {
  size: number;
  komi: number;
  handicap: number;
  rules: string;
  blackName: string;
  whiteName: string;
  blackRank: string;
  whiteRank: string;
  result: string;
  date: string;
  event: string;
  place: string;
  comment: string;
  gameName: string;
}

export interface AnalysisMove {
  move: string;
  visits: number;
  winrate: number;
  scoreLead: number;
  pv: string[];
  order: number;
  prior: number;
}

export interface AnalysisSnapshot {
  nodeId: number;
  turn: ColorName;
  visits: number;
  winrate: number;
  scoreLead: number;
  pv: string[];
  ownership: number[] | null;
  lines: AnalysisMove[];
  isDuringSearch: boolean;
}

export type BackendName = 'opencl' | 'eigenavx2';

export interface ModelEntry {
  id: string;
  name: string;
  file: string;
  sizeBytes: number;
  bundled: boolean;
  strength: number;
  note: string;
  downloaded: boolean;
}

export interface EngineStatus {
  running: boolean;
  starting: boolean;
  ready: boolean;
  backend: BackendName | null;
  modelFile: string | null;
  modelName: string | null;
  error: string | null;
  gtpVersion: string | null;
  name: string | null;
}

export interface EngineParams {
  maxVisits: number;
  maxTimeMs: number;
  threads: number;
  batchSize: number;
  rules: 'chinese' | 'japanese' | 'tromp-taylor' | 'aga' | 'korean' | 'stone-scoring';
  wideRootNoise: number;
  chosenMoveTemperature: number;
  allowResign: boolean;
  ownership: boolean;
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  backend: BackendName | 'auto';
  modelId: string;
  fastModelId: string;
  analyzeVisits: number;
  playVisits: number;
  playTimeMs: number;
  threads: number;
  coords: boolean;
  moveNumbers: boolean;
  sound: boolean;
  browserHome: string;
  /** 实时截取：隔几秒看一眼内置浏览器里的棋盘，把对手刚下的那一手接到谱上。 */
  liveCapture: boolean;
  /** 自动落子：程序里落的子顺手点回网页棋盘。默认关，它真的会动到网页里那盘棋。 */
  autoPlay: boolean;
  recordDir: string;
  /**
   * 上次退出时的窗口尺寸与位置，退出前记下来，下次照着开。
   * 尺寸与坐标每次都会对着当前屏幕再夹一遍，见 main/windowState.ts。
   * x/y 缺失表示没记录过位置，这种情况按默认尺寸居中开。
   */
  window: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    maximized: boolean;
  };
  /** 分栏尺寸。用户拖过分隔条就按用户的值来，没拖过时的默认值见 core/layout/panes.ts。 */
  layout: {
    leftWidth: number;
    rightWidth: number;
    /** 棋盘占中间那块的宽度比例，左右分栏时用，0.25 到 0.75。 */
    splitRatio: number;
    /** 棋盘占中间那块的高度比例，上下分栏时用。 */
    splitRatioY: number;
    /**
     * 中间那块怎么排：x 棋盘在左浏览器在右，y 棋盘在上浏览器在下。
     * auto 表示用户还没自己选过，这时按窗口自己挑一个（见 core/layout/panes.ts 的 pickAxis）。
     */
    splitAxis: 'x' | 'y' | 'auto';
    browserOpen: boolean;
  };
  vision: {
    enabled: boolean;
    endpoint: string;
    apiKey: string;
    model: string;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  backend: 'auto',
  modelId: 'b18c384nbt',
  fastModelId: 'b6c96',
  analyzeVisits: 300,
  playVisits: 400,
  playTimeMs: 3000,
  threads: 2,
  coords: true,
  moveNumbers: false,
  sound: true,
  browserHome: 'about:blank',
  liveCapture: false,
  autoPlay: false,
  recordDir: '',
  window: {
    width: 1500,
    height: 950,
    maximized: false
  },
  layout: {
    leftWidth: 248,
    rightWidth: 316,
    splitRatio: 0.5,
    splitRatioY: 0.55,
    splitAxis: 'auto',
    browserOpen: false
  },
  vision: {
    enabled: false,
    endpoint: '',
    apiKey: '',
    model: ''
  }
};

export interface RecordMeta {
  id: string;
  title: string;
  blackName: string;
  whiteName: string;
  result: string;
  date: string;
  size: number;
  moves: number;
  savedAt: number;
  file: string;
  tags: string[];
}

export interface RecordEntry extends RecordMeta {
  content: string;
}

export interface VisionResult {
  size: number;
  /** 长度 size*size，取值为 0 空 1 黑 2 白。 */
  stones: number[];
  confidence: number;
  message: string;
}
