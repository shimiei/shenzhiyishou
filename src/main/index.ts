import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, net, screen, shell, webContents } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EngineManager } from './engine';
import { deleteRecord, getRecord, listRecords, loadSettings, saveRecord, saveSettings } from './library';
import { cancelDownload, downloadModel, importModel, listModels, openModelsFolder, removeModel } from './models';
import { availableBackends, backendDir, engineRoot, ensureRuntime, logsDir, modelsDir, recordsDir, tmpDir, userDataRoot } from './paths';
import { fitWindow, type Box } from './windowState';
import { visionChat } from './vision';
import { CH, type AppCommand, type AppInfo, type DownloadProgress, type EngineEvent, type VisionRequest } from '../shared/protocol';
import type { AppSettings, BackendName, RecordMeta } from '../shared/types';

// 引擎与网络走 ASCII 路径，避免中文路径在 C++ 引擎里出问题
app.setPath('userData', path.join(app.getPath('appData'), 'shenzhiyishou'));
app.setName('神之一手');

const engine = new EngineManager();
let mainWindow: BrowserWindow | null = null;

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function emitEngine(e: EngineEvent): void {
  send(CH.engineEvent, e);
}

/**
 * 取显卡名字。刚启动那会儿 GPU 进程还没报上来，第一次问经常是空列表，
 * 所以空的时候等一小会儿再问，顺手把软件渲染的兜底设备去掉。
 */
async function gpuNames(): Promise<string[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // 用 complete 而不是 basic：这个 Electron 版本的 gpuDevice 里只有 vendorId / deviceId，
      // 根本没有 deviceString，照它取名字只会得到空列表，界面上就一直写"未识别"。
      // 真正的名字在 auxAttributes.glRenderer 里。
      const info = (await app.getGPUInfo('complete')) as {
        gpuDevice?: Array<{ deviceString?: string }>;
        auxAttributes?: { glRenderer?: string; glVendor?: string };
      };
      const names: string[] = [];
      for (const d of info.gpuDevice ?? []) {
        const n = (d.deviceString ?? '').trim();
        if (n) names.push(n);
      }
      // 形如 "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.101.3959)"
      const raw = info.auxAttributes?.glRenderer ?? '';
      const m = /ANGLE \(([^,]+),\s*(.+)\)\s*$/.exec(raw);
      if (m) {
        const vendor = m[1].trim();
        // 截掉 (0x....) 以及它后面的后端描述，只留下设备名
        const device = m[2].split(',')[0].replace(/\s*\(0x[0-9A-Fa-f]+\)[\s\S]*$/, '').trim();
        if (device) names.push(device.toLowerCase().includes(vendor.toLowerCase()) ? device : `${device}（${vendor}）`);
      }
      const clean = names.filter((n) => n && !/basic render|swiftshader|llvmpipe|软件/i.test(n));
      if (clean.length > 0) return [...new Set(clean)];
    } catch {
      /* 取不到就当没有，界面会显示未识别 */
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return [];
}

const TITLE_OVERLAY = {
  dark: { color: '#14171c', symbolColor: '#c8d0da' },
  light: { color: '#f4f5f7', symbolColor: '#3a3f46' }
};

function applyThemeToWindow(theme: AppSettings['theme']): void {
  if (!mainWindow) return;
  const effective = theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme;
  try {
    mainWindow.setTitleBarOverlay({ ...TITLE_OVERLAY[effective as 'dark' | 'light'], height: 38 });
    mainWindow.setBackgroundColor(effective === 'dark' ? '#14171c' : '#f4f5f7');
  } catch {
    /* 某些平台不支持标题栏覆盖 */
  }
}

// 最小尺寸定得比左右栏加起来略大一点就行。原来给的 1080x700 偏大，
// 小屏笔记本上等于把窗口锁死，用户拖不出更小的窗口，看着就像"窗口没法调整大小"。
const MIN_WIDTH = 960;
const MIN_HEIGHT = 620;
const DEFAULT_WIDTH = 1500;
const DEFAULT_HEIGHT = 950;

/** 工作区列表，主屏排第一：窗口第一次开会落在主屏中间。 */
function workAreas(): Box[] {
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const ordered = [primary, ...all.filter((d) => d.id !== primary.id)];
  return ordered.map((d) => d.workArea);
}

function currentWindowState(): { bounds: Box; maximized: boolean } {
  const saved = loadSettings().window;
  return fitWindow(saved, {
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    defaultWidth: DEFAULT_WIDTH,
    defaultHeight: DEFAULT_HEIGHT,
    workAreas: workAreas()
  });
}

/** 把窗口拉回默认尺寸并居中，当作"我觉得窗口乱了"时的出口。 */
function resetWindowBounds(): void {
  const [area] = workAreas();
  if (!mainWindow || !area) return;
  const width = Math.min(DEFAULT_WIDTH, area.width);
  const height = Math.min(DEFAULT_HEIGHT, area.height);
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  mainWindow.setBounds({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height
  });
  mainWindow.focus();
}

function createWindow(): void {
  const settings = loadSettings();
  const restored = currentWindowState();
  const win = new BrowserWindow({
    ...restored.bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: settings.theme === 'light' ? '#f4f5f7' : '#14171c',
    title: '神之一手',
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...TITLE_OVERLAY.dark, height: 38 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false
    }
  });
  mainWindow = win;

  // 记住用户拖出来的尺寸。拖动时 resize/move 会连着来几十次，攒一下再写盘；
  // 关窗前必须立刻补一次，否则最后一次调整会被丢掉。
  let saveTimer: NodeJS.Timeout | null = null;
  const persist = (): void => {
    if (win.isDestroyed()) return;
    // getBounds 在最大化状态下给的是铺满屏幕的矩形，存下来下次还原就没意义了，
    // getNormalBounds 拿的才是"还原之后应该多大"。
    const b = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
    saveSettings({
      window: {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        maximized: win.isMaximized()
      }
    });
  };
  const schedulePersist = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 400);
  };
  win.on('resize', schedulePersist);
  win.on('move', schedulePersist);
  win.on('maximize', schedulePersist);
  win.on('unmaximize', schedulePersist);

  win.once('ready-to-show', () => {
    win.show();
    // 上次是最大化退出的，这次也最大化；先 show 再最大化，避免闪一下小窗口。
    if (restored.maximized) win.maximize();
    applyThemeToWindow(loadSettings().theme);
  });
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    persist();
  });
  win.on('closed', () => {
    mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // 内置浏览器：统一用持久化分区，禁止 webview 自己开新窗口
  win.webContents.on('will-attach-webview', (_e, webPreferences) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.plugins = true;
    delete (webPreferences as Record<string, unknown>).preload;
  });

  // 网页里的 target=_blank / window.open 以前会另开一个 Electron 窗口，
  // 那个窗口不在我们手里，截取也就无从谈起。现在一律拒掉，把地址发回界面开成新标签。
  win.webContents.on('did-attach-webview', (_e, guest) => {
    guest.setWindowOpenHandler(({ url, disposition }) => {
      if (url && url !== 'about:blank') {
        send(CH.browserOpenTab, { url, activate: disposition !== 'background-tab' });
      }
      return { action: 'deny' };
    });
    /*
     * 只有 Ctrl+W 在这儿接，别的标签快捷键交给主菜单的加速键（焦点在网页里也照样触发）。
     * 分开处理是有原因的：实测 Ctrl+W 的加速键在 Windows 上根本不触发（Ctrl+T、Ctrl+Tab 都正常），
     * 而 iframe 之外的按键又不会冒泡到界面，所以网页里的 Ctrl+W 只能在这一层拦。
     * 别顺手把 Ctrl+T 也搬到这儿：加速键和这里会各响应一次，一次按键开出两个标签。
     */
    guest.on('before-input-event', (_ev, input) => {
      if (input.type !== 'keyDown' || !input.control || input.shift || input.alt || input.meta) return;
      if (input.key.toLowerCase() === 'w') send(CH.appCommand, 'browserCloseTab' satisfies AppCommand);
    });
  });

  if (process.env.NODE_ENV === 'development' && process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (process.env.NODE_ENV === 'development') {
    void win.loadURL('http://localhost:5199');
  } else {
    void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

function buildMenu(): void {
  const cmd = (id: AppCommand) => () => send(CH.appCommand, id);
  const template: Parameters<typeof Menu.buildFromTemplate>[0] = [
    {
      label: '文件',
      submenu: [
        { label: '新建对局', accelerator: 'CmdOrCtrl+N', click: cmd('new') },
        { type: 'separator' },
        { label: '打开棋谱…', accelerator: 'CmdOrCtrl+O', click: cmd('open') },
        { label: '从图片导入…', accelerator: 'CmdOrCtrl+I', click: cmd('importImage') },
        { label: '截取内置浏览器画面', accelerator: 'CmdOrCtrl+Shift+C', click: cmd('captureBrowser') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: cmd('save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: cmd('saveAs') },
        { label: '存入棋谱库', click: cmd('library') },
        { type: 'separator' },
        { label: '复制 SGF 到剪贴板', click: cmd('copySgf') },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '对局',
      submenu: [
        { label: '停一手', accelerator: 'CmdOrCtrl+P', click: cmd('pass') },
        { label: '认输', click: cmd('resign') },
        { type: 'separator' },
        { label: '提示一手（只建议，不落子）', accelerator: 'CmdOrCtrl+H', click: cmd('hint') },
        { label: '让 AI 走一手', click: cmd('aiMove') },
        { label: '机机对局（双方自动走，随时开关）', accelerator: 'CmdOrCtrl+M', click: cmd('toggleAiVsAi') },
        { label: '开始 / 暂停分析', accelerator: 'CmdOrCtrl+Shift+A', click: cmd('toggleAnalysis') },
        { label: '全谱分析', click: cmd('analyzeGame') },
        { label: '形势判断', accelerator: 'CmdOrCtrl+E', click: cmd('score') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '显示 / 隐藏内置浏览器', accelerator: 'CmdOrCtrl+B', click: cmd('toggleBrowser') },
        // 焦点在网页里的时候键盘事件不冒泡到界面，标签页那几条键得靠加速键送进来
        { label: '新建标签页', accelerator: 'CmdOrCtrl+T', click: cmd('browserNewTab') },
        { label: '关闭标签页', accelerator: 'CmdOrCtrl+Shift+W', click: cmd('browserCloseTab') },
        { label: '下一个标签页', accelerator: 'CmdOrCtrl+Tab', click: cmd('browserNextTab') },
        { label: '上一个标签页', accelerator: 'CmdOrCtrl+Shift+Tab', click: cmd('browserPrevTab') },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        // 无边框窗口的状态栏按钮是系统画的，位置在最右上角。这里再给一份菜单命令，
        // 一是给键盘用，二是窗口万一被拖到屏幕外或者一直最大化，有个明确的地方能拉回来。
        { label: '最小化', click: () => mainWindow?.minimize() },
        {
          label: '最大化 / 还原',
          click: () => {
            if (!mainWindow) return;
            if (mainWindow.isMaximized()) mainWindow.unmaximize();
            else mainWindow.maximize();
          }
        },
        { label: `窗口恢复为 ${DEFAULT_WIDTH}×${DEFAULT_HEIGHT} 并居中`, click: resetWindowBounds },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' }
      ]
    },
    {
      label: '设置',
      submenu: [
        { label: '偏好设置…', accelerator: 'CmdOrCtrl+,', click: cmd('settings') },
        { label: '引擎与网络…', click: cmd('models') },
        { label: '打开棋谱库目录', click: () => void shell.openPath(recordsDir()) },
        { label: '打开日志目录', click: () => void shell.openPath(logsDir()) }
      ]
    },
    {
      label: '帮助',
      submenu: [{ label: '关于神之一手', click: cmd('about') }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  engine.init({ emit: emitEngine });

  ipcMain.handle(CH.engineStatus, () => engine.getStatus());
  ipcMain.handle(CH.engineStart, async (_e, opts: { backend?: BackendName; modelId?: string } | undefined) => {
    const settings = loadSettings();
    engine.setSettings(settings as Partial<AppSettings>);
    return engine.start(opts);
  });
  ipcMain.handle(CH.engineStop, async () => {
    await engine.stop();
  });
  ipcMain.handle(CH.engineSetParams, async (_e, patch: Partial<AppSettings>) => {
    const next = saveSettings(patch as Record<string, unknown>);
    engine.setSettings(next as Partial<AppSettings>);
    await engine.applyParams(patch);
    if (patch.theme) applyThemeToWindow(patch.theme);
    return next;
  });
  ipcMain.handle(CH.engineSync, async (_e, sgf: string) => engine.sync(sgf));
  ipcMain.handle(CH.engineGenMove, async (_e, req: Parameters<EngineManager['genMove']>[0]) => engine.genMove(req));
  ipcMain.handle(CH.engineHint, async (_e, sgf: string, visits: number, color: 'B' | 'W', maxTimeMs: number) =>
    engine.hint(sgf, visits, color, maxTimeMs)
  );
  ipcMain.handle(CH.engineAnalyzeStart, async (_e, req: Parameters<EngineManager['analyze']>[0]) => engine.analyze(req));
  ipcMain.handle(CH.engineAnalyzeStop, async () => {
    engine.stopAnalysis();
  });
  ipcMain.handle(CH.engineReviewStart, async (_e, req: Parameters<EngineManager['review']>[0]) => engine.review(req));
  ipcMain.handle(CH.engineReviewStop, async () => {
    engine.stopReview('cancelled');
  });
  ipcMain.handle(CH.engineBenchmark, async (_e, modelId: string, backend: BackendName) => engine.benchmark(modelId, backend));

  ipcMain.handle(CH.modelsList, () => listModels());
  ipcMain.handle(CH.modelsDownload, async (_e, id: string) => {
    return downloadModel(id, (p: DownloadProgress) => send(CH.modelsProgress, p));
  });
  ipcMain.handle(CH.modelsCancel, async (_e, id: string) => {
    cancelDownload(id);
  });
  ipcMain.handle(CH.modelsRemove, async (_e, id: string) => {
    removeModel(id);
  });
  ipcMain.handle(CH.modelsImport, async () => importModel());
  ipcMain.handle('models:openFolder', async () => openModelsFolder());

  ipcMain.handle(CH.filesOpenSgf, async () => {
    const res = await dialog.showOpenDialog({
      title: '打开棋谱',
      filters: [
        { name: 'SGF 棋谱', extensions: ['sgf'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const p = res.filePaths[0];
    return { name: path.basename(p), path: p, content: readFileSync(p, 'utf8') };
  });
  ipcMain.handle(CH.filesOpenImage, async () => {
    const res = await dialog.showOpenDialog({
      title: '选择棋盘图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const p = res.filePaths[0];
    const ext = path.extname(p).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    const data = readFileSync(p);
    return { name: path.basename(p), path: p, dataUrl: `data:image/${mime};base64,${data.toString('base64')}` };
  });
  const saveDialog = async (defaultName: string, filters: Electron.FileFilter[]): Promise<string | null> => {
    const res = await dialog.showSaveDialog({ title: '保存', defaultPath: defaultName, filters });
    return res.canceled || !res.filePath ? null : res.filePath;
  };
  ipcMain.handle(CH.filesSaveSgf, async (_e, defaultName: string, content: string) => {
    const p = await saveDialog(defaultName, [{ name: 'SGF 棋谱', extensions: ['sgf'] }]);
    if (!p) return null;
    writeFileSync(p, content, 'utf8');
    return p;
  });
  ipcMain.handle(CH.filesSaveText, async (_e, defaultName: string, content: string) => {
    const p = await saveDialog(defaultName, [{ name: '文本', extensions: ['txt', 'csv'] }]);
    if (!p) return null;
    writeFileSync(p, content, 'utf8');
    return p;
  });

  ipcMain.handle(CH.libraryList, () => listRecords());
  ipcMain.handle(CH.librarySave, async (_e, entry: { meta: Partial<RecordMeta>; content: string; id?: string }) =>
    saveRecord(entry)
  );
  ipcMain.handle('library:get', async (_e, id: string) => getRecord(id));
  ipcMain.handle(CH.libraryDelete, async (_e, id: string) => {
    deleteRecord(id);
  });

  ipcMain.handle(CH.settingsGet, () => loadSettings());
  ipcMain.handle(CH.settingsSet, async (_e, patch: Partial<AppSettings>) => {
    const next = saveSettings(patch as Record<string, unknown>);
    engine.setSettings(next as Partial<AppSettings>);
    if (patch.theme) applyThemeToWindow(patch.theme);
    return next;
  });

  /*
   * 视觉大模型那一问由主进程代发。界面自己的 CSP 是 connect-src 'self'，
   * 在渲染进程里直接 fetch 外部接口只会得到一句 Failed to fetch。
   * net.fetch 走 Chromium 的网络栈，系统代理和证书都照常。
   */
  ipcMain.handle(CH.visionChat, async (_e, req: VisionRequest) =>
    visionChat(req, { fetchImpl: (url, init) => net.fetch(url, init) })
  );

  ipcMain.handle(CH.browserCapture, async (_e, webContentsId: number) => {
    const target = webContents.fromId(webContentsId);
    if (!target) return null;
    const image = await target.capturePage();
    if (image.isEmpty()) return null;
    return image.toDataURL();
  });
  /*
   * 往网页里点一下（自动落子用）。坐标是网页的 CSS 像素，跟截图上的像素一一对应。
   * 先把指针移过去再按下抬起：只发按下抬起的话，有些页面靠 mouseover/hover
   * 才认得出落点的棋盘（canvas 里点哪儿算哪儿的虽然不看这个，但移一下更接近真人操作）。
   */
  ipcMain.handle(CH.browserClick, async (_e, webContentsId: number, x: number, y: number) => {
    const target = webContents.fromId(webContentsId);
    if (!target) return false;
    const px = Math.round(x);
    const py = Math.round(y);
    target.sendInputEvent({ type: 'mouseMove', x: px, y: py });
    target.sendInputEvent({ type: 'mouseDown', x: px, y: py, button: 'left', clickCount: 1 });
    target.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 });
    return true;
  });
  ipcMain.handle(CH.browserOpenExternal, async (_e, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle(CH.clipReadText, () => clipboard.readText());
  ipcMain.handle(CH.clipWriteText, async (_e, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle(CH.appInfo, async (): Promise<AppInfo> => {
    const cpus = os.cpus();
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      resourcesPath: engineRoot(),
      userDataPath: userDataRoot(),
      bundledModelsDir: modelsDir(),
      userModelsDir: modelsDir(),
      recordsDir: recordsDir(),
      logsDir: logsDir(),
      enginesAvailable: availableBackends(),
      cpu: { model: cpus[0]?.model?.trim() ?? '未知', cores: cpus.length, threads: cpus.length },
      memoryGB: Math.round(os.totalmem() / 1024 ** 3),
      gpu: await gpuNames()
    };
  });

  ipcMain.handle(CH.winMinimize, () => mainWindow?.minimize());
  ipcMain.handle(CH.winMaximize, () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle(CH.winClose, () => mainWindow?.close());
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    ensureRuntime();
    mkdirSync(tmpDir(), { recursive: true });
    mkdirSync(logsDir(), { recursive: true });
    engine.setSettings(loadSettings() as Partial<AppSettings>);
    registerIpc();
    buildMenu();
    createWindow();
    nativeTheme.on('updated', () => {
      if (loadSettings().theme === 'system') applyThemeToWindow('system');
    });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    void engine.stop().finally(() => {
      if (process.platform !== 'darwin') app.quit();
    });
  });

  app.on('before-quit', () => {
    engine.stopAnalysis();
  });
}
