import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GtpEngine } from './gtp';
import { modelDef, modelDefByFile, modelPath } from './models';
import { availableBackends, backendDir, engineConfig, katagoBinary, logsDir, tmpDir } from './paths';
import type { AnalysisMove, AnalysisSnapshot, AppSettings, BackendName, EngineStatus } from '../shared/types';
import type { AnalyzeRequest, BenchmarkResult, EngineEvent, GenMoveRequest, GenMoveResult, ReviewPointWire, ReviewRequest } from '../shared/protocol';

const INFO_KEYS = new Set([
  'move',
  'visits',
  'winrate',
  'scoreLead',
  'scoreMean',
  'scoreStdev',
  'scoreSelfplay',
  'utility',
  'lcb',
  'utilityLcb',
  'order',
  'prior',
  'weight',
  'ownership',
  'pv',
  'info'
]);

interface ParsedInfo {
  move?: string;
  visits?: number;
  winrate?: number;
  scoreLead?: number;
  prior?: number;
  pv?: string[];
  ownership?: number[];
}

/**
 * 解析一次上报。
 *
 * 关键点：引擎把"这一轮的所有候选点"串在同一行里发出来，形如
 *   info move Q16 visits 1373 ... pv Q16 D4 ... info move R16 visits 44 ... ownership 0.03 -0.12 ...
 * 也就是说一行里有很多个 info move 段，ownership 挂在最后一个段后面，描述的是整个局面。
 * 早先的写法只取第一个 info move 作为 move、却又被后面几段覆盖了 visits/winrate，
 * 于是界面上永远显示"第一个候选、最后一个候选的访问量"（也就是恒定的一访），
 * 看起来像引擎不出结果。这里必须按段切开分别解析。
 */
function parseInfoLine(line: string): { moves: ParsedInfo[]; ownership: number[] | null } {
  const moves: ParsedInfo[] = [];
  let ownership: number[] | null = null;
  if (!line.startsWith('info')) return { moves, ownership };

  for (const seg of line.split(/(?=\binfo move )/)) {
    const tokens = seg.trim().split(/\s+/);
    if (tokens[0] !== 'info') continue;
    const out: ParsedInfo = {};
    let i = 1;
    while (i < tokens.length) {
      const key = tokens[i];
      if (key === 'pv' || key === 'ownership') {
        const values: string[] = [];
        i += 1;
        while (i < tokens.length && !INFO_KEYS.has(tokens[i])) {
          values.push(tokens[i]);
          i += 1;
        }
        if (key === 'pv') out.pv = values;
        else {
          const nums = values.map((v) => parseFloat(v)).filter((v) => Number.isFinite(v));
          if (nums.length) ownership = nums;
        }
        continue;
      }
      const value = tokens[i + 1];
      if (value === undefined) break;
      if (key === 'move') out.move = value;
      else if (key === 'visits') out.visits = parseInt(value, 10);
      else if (key === 'winrate') out.winrate = parseFloat(value);
      else if (key === 'scoreLead') out.scoreLead = parseFloat(value);
      else if (key === 'prior') out.prior = parseFloat(value);
      i += 2;
    }
    if (out.move) moves.push(out);
  }
  return { moves, ownership };
}

function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return String(h) + ':' + text.length;
}

export interface EngineDeps {
  emit: (e: EngineEvent) => void;
}

export class EngineManager {
  private playEngine = new GtpEngine('对局');
  private analyzeEngine = new GtpEngine('分析');
  private emit: (e: EngineEvent) => void = () => {};
  private status: EngineStatus = {
    running: false,
    starting: false,
    ready: false,
    backend: null,
    modelFile: null,
    modelName: null,
    error: null,
    gtpVersion: null,
    name: null
  };
  private synced = new Map<GtpEngine, string>();
  private analysis: { turn: 'B' | 'W'; nodeId: number; stop: (() => void) | null } | null = null;
  /** 正在跑的复盘。它和分析共用分析引擎，所以两者互相挤。 */
  private reviewCtl: { stop: (reason: 'cancelled' | 'replaced') => void } | null = null;
  private tempSgf = '';
  private settings: Partial<AppSettings> = {};
  private starting: Promise<EngineStatus> | null = null;
  /**
   * 两个进程各自现在真正跑的是哪套配置。
   *
   * 光看 settings.modelId 不够：用户改了设置不等于引擎换了网络。GtpEngine.start()
   * 在进程还活着的时候是直接返回的（它只负责"把进程拉起来"），照这个语义去点
   * "用选中的网络重启引擎"，换来的只是状态栏上换了个名字，跑的还是老网络。
   * 要换网络就得先真把旧的停掉，这里记下停之前用的是谁，才好判断该不该停。
   */
  private playTarget: { modelFile: string; backend: BackendName } | null = null;
  private analyzeTarget: { modelFile: string; backend: BackendName } | null = null;

  init(deps: EngineDeps): void {
    this.emit = deps.emit;
    for (const engine of [this.playEngine, this.analyzeEngine]) {
      engine.on('log', (text: string) => this.emit({ type: 'log', text: `[${engine.label}] ${text}` }));
      engine.on('exit', () => {
        if (engine === this.playEngine) {
          this.status = { ...this.status, running: false, ready: false };
          this.synced.delete(engine);
          this.pushStatus();
        }
      });
    }
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  private pushStatus(): void {
    this.emit({ type: 'status', status: this.status });
  }

  setSettings(patch: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...patch };
  }

  private overrides(modelFile: string, extra: Record<string, string | number> = {}): string {
    const cfg: Record<string, string | number> = {
      logDir: logsDir(),
      logToStderr: 'false',
      // 排查引擎行为时可以把 GTP 通信写进日志：设了 SZYS_GTP_LOG=1 再启动应用。
      // 平时关掉，一次分析就能刷出几十 MB。
      logAllGTPCommunication: process.env.SZYS_GTP_LOG === '1' ? 'true' : 'false',
      logSearchInfo: 'false',
      rules: 'chinese',
      maxVisits: this.settings.playVisits ?? 400,
      numSearchThreads: this.settings.threads ?? 2,
      nnMaxBatchSize: 8,
      nnCacheSizePowerOfTwo: 19,
      ponderingEnabled: 'false',
      allowResignation: 'true',
      resignThreshold: -0.9,
      chosenMoveTemperature: 0,
      ...extra
    };
    void modelFile;
    const parts = Object.entries(cfg).map(([k, v]) => `${k}=${v}`);
    return parts.join(',');
  }

  private buildArgs(modelFile: string, extra: Record<string, string | number> = {}, humanFile?: string): string[] {
    const args = ['gtp', '-model', modelFile, '-config', engineConfig(this.status.backend ?? 'opencl')];
    if (humanFile) args.push('-human-model', humanFile);
    args.push('-override-config', this.overrides(modelFile, extra));
    return args;
  }

  async start(opts: { backend?: BackendName; modelId?: string } = {}): Promise<EngineStatus> {
    if (this.starting) return this.starting;
    this.starting = this.doStart(opts).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(opts: { backend?: BackendName; modelId?: string }): Promise<EngineStatus> {
    const backends = availableBackends();
    if (backends.length === 0) {
      this.status = { ...this.status, error: '没有找到 KataGo 引擎文件，程序可能没有安装完整', ready: false };
      this.pushStatus();
      return this.status;
    }
    let backend = opts.backend ?? (this.settings.backend === 'auto' || !this.settings.backend ? backends[0] : this.settings.backend);
    if (!backends.includes(backend)) backend = backends[0];

    const modelId = opts.modelId ?? this.settings.modelId ?? 'b6c96';
    let modelFile = modelPath(modelId);
    let fellBack = false;
    if (!modelFile) {
      const fallback = modelPath('b6c96') ?? modelPath(this.settings.fastModelId ?? 'b6c96');
      modelFile = fallback;
      fellBack = Boolean(fallback);
    }
    if (!modelFile) {
      this.status = { ...this.status, error: '没有可用的网络文件，请在设置里下载或导入网络', ready: false };
      this.pushStatus();
      return this.status;
    }
    if (fellBack) {
      // 新装的机器上只有随包的小网络，而默认设置指向大网络。退回没问题，
      // 但得说出来，否则面板上显示的就是一个根本没在跑的网络名字。
      this.emit({
        type: 'log',
        text: `[启动] 没有找到网络 ${modelId}，改用随包的 ${path.basename(modelFile)}。想用大网络请在"引擎与网络"里下载。`
      });
    }

    const humanId = (this.settings as Record<string, unknown>).humanModelId;
    const humanFile = typeof humanId === 'string' ? modelPath(humanId) ?? undefined : undefined;

    /*
     * 换了网络或后端就得先停掉旧的。不停的话 playEngine.start() 会因为"进程还在"
     * 直接返回成功，状态里写上新网络的名字，跑着的还是老的，用户看着像切了其实没切。
     */
    const running = this.playTarget;
    if (this.playEngine.running && running && (running.modelFile !== modelFile || running.backend !== backend)) {
      this.emit({
        type: 'log',
        text: `[启动] 换到 ${path.basename(modelFile)}，先把正在跑的那个停掉。`
      });
      this.stopAnalysis();
      await this.playEngine.quit();
      this.playTarget = null;
      this.synced.clear();
    }
    // 分析引擎跟着换：它自己拿的是启动时的网络，换了主网络却不换它，
    // 面板上写着新网络，分析出来的还是旧网络的结论。
    if (this.analyzeEngine.running && this.analyzeTarget && (this.analyzeTarget.modelFile !== modelFile || this.analyzeTarget.backend !== backend)) {
      await this.analyzeEngine.quit();
      this.analyzeTarget = null;
    }

    this.status = { ...this.status, starting: true, backend, modelFile, error: null };
    this.pushStatus();
    mkdirSync(logsDir(), { recursive: true });
    mkdirSync(tmpDir(), { recursive: true });
    this.tempSgf = path.join(tmpDir(), 'position.sgf');

    try {
      const args = this.buildArgs(modelFile, {}, humanFile);
      this.emit({
        type: 'log',
        text:
          `[启动] ${backend} 后端，网络 ${path.basename(modelFile)}。` +
          '首次使用要为显卡调优 OpenCL 内核，可能要几分钟，期间下方日志会持续输出进度。'
      });
      await this.playEngine.start(katagoBinary(backend), args, backendDir(backend));
      const version = await this.playEngine.send('version', 30000).catch(() => '');
      const name = await this.playEngine.send('name', 30000).catch(() => '');
      const def = modelDefByFile(modelFile) ?? modelDef(modelId);
      this.status = {
        ...this.status,
        running: true,
        starting: false,
        ready: true,
        backend,
        modelFile,
        modelName: def?.name ?? path.basename(modelFile),
        gtpVersion: version.trim(),
        name: name.trim(),
        error: null
      };
      this.playTarget = { modelFile, backend };
      this.synced.clear();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.status = { ...this.status, running: false, starting: false, ready: false, error: `引擎启动失败: ${msg}` };
    }
    this.pushStatus();
    return this.status;
  }

  async stop(): Promise<void> {
    this.stopReview('cancelled');
    await this.playEngine.quit();
    await this.analyzeEngine.quit();
    this.playTarget = null;
    this.analyzeTarget = null;
    this.status = { ...this.status, running: false, ready: false };
    this.synced.clear();
    this.pushStatus();
  }

  private async ensurePlay(): Promise<void> {
    if (!this.playEngine.running) await this.start();
  }

  private async ensureAnalyze(): Promise<GtpEngine> {
    const backend = this.status.backend ?? availableBackends()[0] ?? 'opencl';
    const modelId = this.settings.modelId ?? 'b6c96';
    const modelFile = modelPath(modelId) ?? modelPath('b6c96');
    if (!modelFile) throw new Error('没有可用的网络文件');
    if (this.analyzeEngine.running) {
      // 网络或后端换过了就把分析引擎重建，否则它会拿着老网络一直算下去
      const t = this.analyzeTarget;
      if (!t || (t.modelFile === modelFile && t.backend === backend)) return this.analyzeEngine;
      await this.analyzeEngine.quit();
      this.analyzeTarget = null;
      this.synced.delete(this.analyzeEngine);
    }
    this.status = { ...this.status, backend };
    const args = this.buildArgs(modelFile, { maxVisits: this.settings.analyzeVisits ?? 300 });
    /*
     * 这一次要等十几秒（要起进程、建 OpenCL 上下文、把网络读进来）。
     * 界面上"点了实时分析却什么都不动"多半就是这个等待，所以先说一声再等。
     */
    this.emit({
      type: 'log',
      text: `[分析] 正在启动分析引擎（网络 ${path.basename(modelFile)}，核显上通常十几秒）…`
    });
    await this.analyzeEngine.start(katagoBinary(backend), args, backendDir(backend));
    this.analyzeTarget = { modelFile, backend };
    return this.analyzeEngine;
  }

  /** 应用运行时参数。 */
  async applyParams(patch: Partial<AppSettings>): Promise<void> {
    this.setSettings(patch);
    const sets: Array<[string, string | number, string]> = [];
    if (patch.analyzeVisits !== undefined) sets.push(['maxVisits', patch.analyzeVisits, '下一次分析开始时生效']);
    if (patch.threads !== undefined) sets.push(['numSearchThreads', patch.threads, '重启引擎后生效']);
    for (const [key, value, note] of sets) {
      for (const engine of [this.playEngine, this.analyzeEngine]) {
        if (!engine.running) continue;
        /*
         * 分析是流式命令，占着队首一直不结束，这时候 send 进去的 kata-set-param
         * 排在它后面，永远轮不上（超时也不会触发，计时器要等到成为当前任务才开始走）。
         * 落子和分析在开始前都会重发自己那几个参数，所以这里忙就跳过，别往队列里塞死信。
         */
        if (engine.busy) {
          this.emit({ type: 'log', text: `[参数] ${key}=${value} 现在正忙，${note}` });
          continue;
        }
        await engine.send(`kata-set-param ${key} ${value}`, 15000).catch(() => undefined);
      }
    }
  }

  /** 把局面同步给引擎。内容没变就跳过。 */
  async sync(sgf: string, engine: GtpEngine = this.playEngine): Promise<{ ok: boolean; error?: string }> {
    const h = hashText(sgf);
    if (this.synced.get(engine) === h) return { ok: true };
    try {
      writeFileSync(this.tempSgf, sgf, 'utf8');
      this.synced.set(engine, h);
      await engine.send(`loadsgf ${this.tempSgf}`, 60000);
      return { ok: true };
    } catch (e) {
      this.synced.delete(engine);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async genMove(req: GenMoveRequest): Promise<GenMoveResult> {
    await this.ensurePlay();
    this.stopAnalysis();
    const synced = await this.sync(req.sgf);
    if (!synced.ok) {
      return { move: 'pass', visits: 0, winrate: 0, scoreLead: 0, pv: [], resigned: false, error: synced.error };
    }
    const color = req.color === 'B' ? 'b' : 'w';
    await this.playEngine
      .send(`kata-set-param maxVisits ${Math.max(1, Math.round(req.maxVisits))}`, 15000)
      .catch(() => undefined);
    /*
     * maxTime 0 在 KataGo 里不是"不限时"，是"立刻停"：实测只出 1 次访问的结论，
     * 胜率目差全是第一个访问的外推值（空盘能报出 99% 和 14 目）。所以不设时限时
     * 写一个足够大的数，同时把上一手留下的时限冲掉；这个参数是留在引擎状态里的。
     */
    const maxTimeSec = req.maxTimeMs > 0 ? req.maxTimeMs / 1000 : 1e9;
    await this.playEngine.send(`kata-set-param maxTime ${maxTimeSec}`, 15000).catch(() => undefined);
    await this.playEngine
      .send(`kata-set-param chosenMoveTemperature ${Math.max(0, req.temperature)}`, 15000)
      .catch(() => undefined);
    await this.playEngine.send(`kata-set-param allowResignation ${req.allowResign ? 'true' : 'false'}`, 15000).catch(() => undefined);

    const deadline = req.maxTimeMs > 0 ? req.maxTimeMs + 90000 : 180000;
    const lines: AnalysisMove[] = [];
    let best: { visits: number; winrate: number; scoreLead: number; pv: string[] } = {
      visits: 0,
      winrate: 0,
      scoreLead: 0,
      pv: []
    };
    const stream = this.playEngine.stream(
      `kata-genmove_analyze ${color} 60`,
      (line) => {
        const { moves } = parseInfoLine(line);
        for (const info of moves) {
          const item: AnalysisMove = {
            move: info.move as string,
            visits: info.visits ?? 0,
            winrate: info.winrate ?? 0,
            scoreLead: info.scoreLead ?? 0,
            pv: info.pv ?? [],
            order: lines.length,
            prior: info.prior ?? 0
          };
          lines.push(item);
          if (item.visits >= best.visits) {
            best = { visits: item.visits, winrate: item.winrate, scoreLead: item.scoreLead, pv: item.pv };
          }
        }
        if (!moves.length) return;
        this.emit({
          type: 'info',
          snapshot: {
            nodeId: -1,
            turn: req.color,
            visits: best.visits,
            winrate: best.winrate,
            scoreLead: best.scoreLead,
            pv: best.pv,
            ownership: null,
            lines: lines.slice(-12),
            isDuringSearch: true
          }
        });
      },
      { timeoutMs: deadline }
    );
    try {
      const text = await stream.promise;
      const all = text.split('\n').map((l) => l.trim()).filter(Boolean);
      // 取最后一行里带落子结论的那条：info 批次和 play 结论可能混在同一个响应里。
      // GTP 的落子响应是 "play Q16"，前缀必须去掉，否则界面按坐标解析会失败。
      const raw =
        [...all].reverse().find((l) => /^(play|pass|resign)\b/i.test(l)) ?? all[all.length - 1] ?? 'pass';
      const move = raw.replace(/^play\s+/i, '').trim() || 'pass';
      const resigned = /^resign$/i.test(move);
      return {
        move,
        visits: best.visits,
        winrate: best.winrate,
        scoreLead: best.scoreLead,
        pv: best.pv,
        resigned
      };
    } catch (e) {
      return {
        move: 'pass',
        visits: best.visits,
        winrate: best.winrate,
        scoreLead: best.scoreLead,
        pv: best.pv,
        resigned: false,
        error: e instanceof Error ? e.message : String(e)
      };
    } finally {
      /*
       * kata-genmove_analyze 会把这一手真的落到引擎自己的那盘棋上，所以缓存的同步标记
       * 到这里就不作数了。同一个局面再问一次（连按两下提示、提示完又让它走一手）必须
       * 重新 loadsgf，否则第二次是在"引擎自己多走了一手"的局面上算出来的，
       * 报出来的胜率目差会离谱到十几目。
       */
      this.synced.delete(this.playEngine);
    }
  }

  async analyze(req: AnalyzeRequest): Promise<{ ok: boolean; error?: string }> {
    this.stopAnalysis();
    // 实时分析和复盘抢同一个分析引擎，用户开始看当前局面，复盘就让位（已算完的留着）
    this.stopReview('replaced');
    let engine: GtpEngine;
    try {
      engine = await this.ensureAnalyze();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    // 分析用独立进程，避免和对局引擎抢占
    const h = hashText(req.sgf);
    if (this.synced.get(engine) !== h) {
      try {
        writeFileSync(this.tempSgf, req.sgf, 'utf8');
        await engine.send(`loadsgf ${this.tempSgf}`, 60000);
        this.synced.set(engine, h);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    await engine.send(`kata-set-param maxVisits ${Math.max(1, Math.round(req.visits))}`, 15000).catch(() => undefined);
    if (req.maxTimeMs > 0) await engine.send(`kata-set-param maxTime ${req.maxTimeMs / 1000}`, 15000).catch(() => undefined);

    const turn: 'B' | 'W' = req.turn;
    const nodeId = req.nodeId;
    // 这个版本的 KataGo 只认 "ownership true"，光写 ownership 会被回 '?'
    // 说是参数无法解析，然后分析就静默地什么都不吐。
    const suffix = req.ownership ? ' ownership true' : '';
    let current = new Map<string, AnalysisMove>();
    let emitted = 0;
    let lastKey = '';
    // 只在排查模式下把引擎原始输出透到界面日志，平时一条都不多打
    const debug = process.env.SZYS_GTP_LOG === '1';
    let rawLines = 0;
    const flush = (duringSearch: boolean, ownership: number[] | null = null): void => {
      if (current.size === 0) return;
      const list = [...current.values()].sort((a, b) => b.visits - a.visits);
      const top = list[0];
      /*
       * 引擎会把同一个结果连着报好几次（带着 ownership 的那些行尤其明显，实测一条结果
       * 能报三遍），一模一样的东西不必反复推给界面：每推一次界面就重画一遍棋盘。
       * 只在"最高候选或访问量真的变了"时才发。
       */
      const key = `${top.move}|${top.visits}|${list.length}`;
      if (key === lastKey) return;
      lastKey = key;
      if (debug) {
        this.emit({
          type: 'log',
          text: `[分析调试] 累计 ${rawLines} 行，本次候选 ${list.length} 个，最高 ${top.move} ${top.visits} 访，胜率 ${top.winrate.toFixed(3)}${ownership ? `，归属点 ${ownership.length} 个` : ''}`
        });
      }
      this.emit({
        type: 'info',
        snapshot: {
          nodeId,
          turn,
          visits: top.visits,
          winrate: top.winrate,
          scoreLead: top.scoreLead,
          pv: top.pv,
          // 归属值描述的是整个局面，属于快照顶层，不挂在某个候选点上
          ownership,
          lines: list.slice(0, req.lines || 10),
          isDuringSearch: duringSearch
        }
      });
      emitted = Date.now();
    };
    const stream = engine.stream(`kata-analyze 60${suffix}`, (line) => {
      const { moves, ownership } = parseInfoLine(line);
      if (!moves.length) return;
      if (debug) {
        rawLines += 1;
        if (rawLines <= 3) this.emit({ type: 'log', text: `[分析调试] 原始行: ${line.slice(0, 180)}` });
      }
      const before = current.size;
      for (const info of moves) {
        const move = info.move as string;
        const existing = current.get(move);
        // 同一个点访问量反而变少，说明引擎把搜索重置了，旧数据整体作废
        if (existing && (info.visits ?? 0) < existing.visits) current = new Map();
        current.set(move, {
          move,
          visits: info.visits ?? 0,
          winrate: info.winrate ?? 0,
          scoreLead: info.scoreLead ?? 0,
          pv: info.pv ?? [],
          order: current.size,
          prior: info.prior ?? 0
        });
      }
      if (ownership) {
        flush(true, ownership);
      } else if (current.size > before && Date.now() - emitted > 140) {
        flush(true);
      }
    });
    const ctl = { stopped: false };
    this.analysis = {
      turn,
      nodeId,
      stop: () => {
        ctl.stopped = true;
        stream.stop();
      }
    };
    // 分析是被拒还是被自己叫停，界面要能分清：否则参数写错时界面只会一直转圈。
    void stream.promise.then(
      () => {
        if (!ctl.stopped && emitted === 0) {
          this.analysis = null;
          this.emit({ type: 'log', text: '[分析] 引擎提前结束，没有给出任何结果。' });
          this.emit({ type: 'error', text: '引擎没有返回分析结果，换个局面或重启引擎再试。' });
        }
      },
      (e: unknown) => {
        if (ctl.stopped) return;
        const msg = e instanceof Error ? e.message : String(e);
        this.analysis = null;
        this.emit({ type: 'log', text: `[分析] ${msg}` });
        this.emit({ type: 'error', text: '分析失败：' + msg });
      }
    );
    return { ok: true };
  }

  stopAnalysis(): void {
    if (this.analysis?.stop) this.analysis.stop();
    this.analysis = null;
  }

  /**
   * 复盘：把一整局的局面排队逐个分析。
   *
   * 为什么放在主进程做而不是界面上一手一手地问：分析引擎同一时刻只能算一个局面，
   * "这一个算够了没有、该不该收手、下一个什么时候发"这套时序放在主进程里只有一份，
   * 界面那边只管收结果。做完一个局面就发一条 review 事件，界面可以边跑边画。
   */
  async review(req: ReviewRequest): Promise<{ ok: boolean; error?: string }> {
    // 复盘和实时分析抢同一个分析引擎，谁开始谁赢，另一个让位
    this.stopAnalysis();
    this.stopReview('replaced');
    if (req.positions.length === 0) return { ok: false, error: '没有可复盘的着手' };
    let engine: GtpEngine;
    try {
      engine = await this.ensureAnalyze();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const ctl = { stopped: false, reason: 'done' as 'done' | 'cancelled' | 'replaced' };
    this.reviewCtl = {
      stop: (reason) => {
        ctl.stopped = true;
        ctl.reason = reason;
      }
    };
    this.emit({ type: 'log', text: `[复盘] 开始，共 ${req.positions.length} 个局面，每个算到 ${req.visits} 次访问。` });
    void this.runReview(engine, req, ctl);
    return { ok: true };
  }

  stopReview(reason: 'cancelled' | 'replaced' = 'cancelled'): void {
    if (this.reviewCtl?.stop) this.reviewCtl.stop(reason);
  }

  private async runReview(
    engine: GtpEngine,
    req: ReviewRequest,
    ctl: { stopped: boolean; reason: 'done' | 'cancelled' | 'replaced' }
  ): Promise<void> {
    let done = 0;
    try {
      for (const pos of req.positions) {
        if (ctl.stopped) break;
        const point = await this.analyzePosition(engine, pos.sgf, {
          visits: req.visits,
          maxTimeMs: req.maxTimeMs,
          lines: req.lines,
          isStopped: () => ctl.stopped
        });
        // 被叫停时手里这一份也可能是半截的，但它前面那几个局面是完整的，照样发出去
        if (!point) break;
        const wire: ReviewPointWire = {
          nodeId: pos.nodeId,
          ply: pos.ply,
          turn: pos.turn,
          // 引擎报的胜率是"轮到的那一方"的，这里统一换成黑棋视角
          blackWinrate: pos.turn === 'B' ? point.winrate : 1 - point.winrate,
          blackScoreLead: pos.turn === 'B' ? point.scoreLead : -point.scoreLead,
          visits: point.visits,
          bestMove: point.bestMove,
          candidates: point.candidates.map((c) => ({
            move: c.move,
            blackWinrate: pos.turn === 'B' ? c.winrate : 1 - c.winrate,
            visits: c.visits
          }))
        };
        done += 1;
        this.emit({ type: 'review', review: wire, reviewProgress: { done, total: req.positions.length } });
      }
      this.reviewCtl = null;
      if (ctl.stopped && ctl.reason !== 'done') {
        this.emit({
          type: 'log',
          text: `[复盘] 已停下，算完了 ${done} / ${req.positions.length} 个局面，已有的结果留着。`
        });
      } else {
        this.emit({ type: 'log', text: `[复盘] 整局算完，${done} 个局面。` });
      }
      this.emit({ type: 'reviewEnd', reviewEnd: { reason: ctl.stopped ? ctl.reason : 'done' } });
    } catch (e) {
      this.reviewCtl = null;
      const msg = e instanceof Error ? e.message : String(e);
      this.emit({ type: 'log', text: `[复盘] ${msg}` });
      this.emit({ type: 'reviewEnd', reviewEnd: { reason: 'error', error: msg } });
    }
  }

  /**
   * 算一个局面，到访问量或时间上限就收手。
   *
   * 和 analyze() 的区别是它要"算完返回"：analyze 是流式的，界面一直在收快照；
   * 复盘得知道这一手算到了什么程度才能翻到下一手，所以这里收满就打断。
   */
  private async analyzePosition(
    engine: GtpEngine,
    sgf: string,
    opts: { visits: number; maxTimeMs: number; lines: number; isStopped: () => boolean }
  ): Promise<{
    winrate: number;
    scoreLead: number;
    visits: number;
    bestMove: string;
    candidates: Array<{ move: string; winrate: number; visits: number }>;
  } | null> {
    const h = hashText(sgf);
    if (this.synced.get(engine) !== h) {
      writeFileSync(this.tempSgf, sgf, 'utf8');
      await engine.send(`loadsgf ${this.tempSgf}`, 60000);
      this.synced.set(engine, h);
    }
    await engine.send(`kata-set-param maxVisits ${Math.max(1, Math.round(opts.visits))}`, 15000).catch(() => undefined);
    /*
     * maxTime 是引擎上的常驻参数，上一轮分析留下的值会一直管着后面的搜索。
     * 复盘只要按访问量收手，所以这里明确给一个很大的数，免得被上一次的限时提前掐断。
     */
    await engine
      .send(`kata-set-param maxTime ${opts.maxTimeMs > 0 ? opts.maxTimeMs / 1000 : 3600}`, 15000)
      .catch(() => undefined);

    return new Promise((resolve, reject) => {
      let candidates = new Map<string, { move: string; winrate: number; visits: number; scoreLead: number }>();
      let top: { move: string; winrate: number; visits: number; scoreLead: number } | null = null;
      let settled = false;
      const started = Date.now();
      /*
       * 到点还没算够也得走：核显上偶发一次搜索卡住，整个复盘不该跟着一起停。
       * 上限按"每手限时"再放宽一截（引擎收尾、报最后一行的余量），最小值 8 秒。
       */
      const ceiling = Math.max(8000, (opts.maxTimeMs > 0 ? opts.maxTimeMs : 0) + 8000);

      const stream = engine.stream('kata-analyze 60', (line) => {
        const { moves } = parseInfoLine(line);
        if (!moves.length) return;
        const before = candidates.size;
        for (const info of moves) {
          const move = info.move as string;
          const existing = candidates.get(move);
          if (existing && (info.visits ?? 0) < existing.visits) candidates = new Map();
          candidates.set(move, {
            move,
            winrate: info.winrate ?? 0,
            scoreLead: info.scoreLead ?? 0,
            visits: info.visits ?? 0
          });
        }
        const list = [...candidates.values()].sort((a, b) => b.visits - a.visits);
        if (list.length) top = list[0];
        const enough = top !== null && top.visits >= opts.visits;
        if (candidates.size > before && (enough || opts.isStopped() || Date.now() - started > ceiling)) finish();
      });

      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        stream.stop();
        if (!top) {
          resolve(null);
          return;
        }
        const list = [...candidates.values()].sort((a, b) => b.visits - a.visits).slice(0, Math.max(1, opts.lines));
        resolve({
          winrate: top.winrate,
          scoreLead: top.scoreLead,
          visits: top.visits,
          bestMove: top.move,
          candidates: list.map((c) => ({ move: c.move, winrate: c.winrate, visits: c.visits }))
        });
      };
      // 引擎一行都不吐（局面非法、参数被拒）时，靠这个兜底别把复盘挂死
      const timer = setInterval(() => {
        if (settled) return;
        if (opts.isStopped() || Date.now() - started > ceiling + 4000) finish();
      }, 500);

      void stream.promise.catch((e: unknown) => {
        clearInterval(timer);
        if (settled) return;
        settled = true;
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  /**
   * 提示一手。跟对局落子走同一套参数，访客量按分析档，但照样带时限：
   * 大网络上一手提示跑几十秒会让人以为卡住，到点就交现有结论。
   */
  async hint(sgf: string, visits: number, color: 'B' | 'W', maxTimeMs: number): Promise<GenMoveResult> {
    return this.genMove({ sgf, color, maxVisits: visits, maxTimeMs, allowResign: false, temperature: 0 });
  }

  async benchmark(modelId: string, backend: BackendName): Promise<BenchmarkResult> {
    const file = modelPath(modelId);
    if (!file) return { backend, visitsPerSec: 0, seconds: 0, error: '找不到网络文件' };
    const exe = katagoBinary(backend);
    const args = [
      'benchmark',
      '-model',
      file,
      '-config',
      engineConfig(backend),
      '-override-config',
      `logDir=${logsDir()},logToStderr=true,rules=chinese`
    ];
    const started = Date.now();
    return new Promise<BenchmarkResult>((resolve) => {
      let out = '';
      let proc: ChildProcess;
      try {
        proc = spawn(exe, args, { cwd: backendDir(backend), windowsHide: true });
      } catch (e) {
        resolve({ backend, visitsPerSec: 0, seconds: 0, error: e instanceof Error ? e.message : String(e) });
        return;
      }
      const timer = setTimeout(() => {
        proc.kill();
      }, 420000);
      proc.stdout?.setEncoding('utf8');
      proc.stderr?.setEncoding('utf8');
      const collect = (chunk: string): void => {
        out += chunk;
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (/visits\/s|Calls\/sec|threads/i.test(line)) this.emit({ type: 'log', text: `[测速] ${line.trim()}` });
        }
      };
      proc.stdout?.on('data', collect);
      proc.stderr?.on('data', collect);
      proc.on('error', (e) => {
        clearTimeout(timer);
        resolve({ backend, visitsPerSec: 0, seconds: 0, error: e.message });
      });
      proc.on('exit', () => {
        clearTimeout(timer);
        const matches = [...out.matchAll(/([\d.]+)\s*visits\/s/g)].map((m) => parseFloat(m[1]));
        const best = matches.length ? Math.max(...matches) : 0;
        resolve({
          backend,
          visitsPerSec: best,
          seconds: (Date.now() - started) / 1000,
          error: best > 0 ? undefined : '没能从输出里读到速度，可能引擎启动失败'
        });
      });
    });
  }
}
