import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CH, type AnalyzeRequest, type Api, type AppCommand, type DownloadProgress, type EngineEvent, type GenMoveRequest, type OpenTabRequest, type ReviewRequest, type VisionRequest } from './shared/protocol';
import type { AppSettings, BackendName, RecordMeta } from './shared/types';

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: Api = {
  engine: {
    status: () => ipcRenderer.invoke(CH.engineStatus),
    start: (opts) => ipcRenderer.invoke(CH.engineStart, opts),
    stop: () => ipcRenderer.invoke(CH.engineStop),
    setParams: (p) => ipcRenderer.invoke(CH.engineSetParams, p),
    sync: (sgf: string) => ipcRenderer.invoke(CH.engineSync, sgf),
    genMove: (req: GenMoveRequest) => ipcRenderer.invoke(CH.engineGenMove, req),
    analyzeStart: (req: AnalyzeRequest) => ipcRenderer.invoke(CH.engineAnalyzeStart, req),
    analyzeStop: (board: string) => ipcRenderer.invoke(CH.engineAnalyzeStop, board),
    reviewStart: (req: ReviewRequest) => ipcRenderer.invoke(CH.engineReviewStart, req),
    reviewStop: (board: string) => ipcRenderer.invoke(CH.engineReviewStop, board),
    benchmark: (modelId: string, backend: BackendName) => ipcRenderer.invoke(CH.engineBenchmark, modelId, backend),
    hint: (sgf: string, visits: number, color: 'B' | 'W', maxTimeMs: number, board: string) =>
      ipcRenderer.invoke(CH.engineHint, sgf, visits, color, maxTimeMs, board),
    onEvent: (cb: (e: EngineEvent) => void) => on<EngineEvent>(CH.engineEvent, cb)
  },
  models: {
    list: () => ipcRenderer.invoke(CH.modelsList),
    download: (id: string) => ipcRenderer.invoke(CH.modelsDownload, id),
    cancel: (id: string) => ipcRenderer.invoke(CH.modelsCancel, id),
    remove: (id: string) => ipcRenderer.invoke(CH.modelsRemove, id),
    import: () => ipcRenderer.invoke(CH.modelsImport),
    onProgress: (cb: (p: DownloadProgress) => void) => on<DownloadProgress>(CH.modelsProgress, cb)
  },
  files: {
    openSgf: () => ipcRenderer.invoke(CH.filesOpenSgf),
    openSgfPath: (p: string) => ipcRenderer.invoke(CH.filesOpenSgf, p),
    saveSgf: (defaultName: string, content: string) => ipcRenderer.invoke(CH.filesSaveSgf, defaultName, content),
    openImage: () => ipcRenderer.invoke(CH.filesOpenImage),
    saveText: (defaultName: string, content: string) => ipcRenderer.invoke(CH.filesSaveText, defaultName, content)
  },
  library: {
    list: () => ipcRenderer.invoke(CH.libraryList),
    save: (entry: { meta: Partial<RecordMeta>; content: string; id?: string }) => ipcRenderer.invoke(CH.librarySave, entry),
    get: (id: string) => ipcRenderer.invoke('library:get', id),
    delete: (id: string) => ipcRenderer.invoke(CH.libraryDelete, id)
  },
  settings: {
    get: () => ipcRenderer.invoke(CH.settingsGet),
    set: (patch) => ipcRenderer.invoke(CH.settingsSet, patch)
  },
  session: {
    get: () => ipcRenderer.invoke(CH.sessionGet),
    set: (data: unknown) => ipcRenderer.invoke(CH.sessionSet, data)
  },
  vision: {
    recognize: (req: VisionRequest) => ipcRenderer.invoke(CH.visionChat, req)
  },
  browser: {
    capture: (webContentsId: number) => ipcRenderer.invoke(CH.browserCapture, webContentsId),
    click: (webContentsId: number, x: number, y: number) => ipcRenderer.invoke(CH.browserClick, webContentsId, x, y),
    openExternal: (url: string) => ipcRenderer.invoke(CH.browserOpenExternal, url),
    onOpenTab: (cb: (req: OpenTabRequest) => void) => on<OpenTabRequest>(CH.browserOpenTab, cb)
  },
  clip: {
    readText: () => ipcRenderer.invoke(CH.clipReadText),
    writeText: (text: string) => ipcRenderer.invoke(CH.clipWriteText, text)
  },
  app: {
    info: () => ipcRenderer.invoke(CH.appInfo),
    minimize: () => ipcRenderer.invoke(CH.winMinimize),
    maximize: () => ipcRenderer.invoke(CH.winMaximize),
    close: () => ipcRenderer.invoke(CH.winClose),
    onCommand: (cb: (cmd: AppCommand) => void) => on<AppCommand>(CH.appCommand, cb)
  }
};

contextBridge.exposeInMainWorld('api', api);
