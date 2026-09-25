import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GtpEngine } from './gtp';
import { modelDef, modelDefByFile, modelPath } from './models';
import { availableBackends, backendDir, engineConfig, katagoBinary, logsDir, tmpDir } from './paths';
import type { AnalysisMove, AnalysisSnapshot, AppSettings, BackendName, EngineStatus } from '../shared/types';
import type { AnalyzeRequest, BenchmarkResult, EngineEvent, GenMoveRequest, GenMoveResult } from '../shared/protocol';

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
  private tempSgf = '';
  private settings: Partial<AppSettings> = {};
  private starting: Promise<EngineStatus> | null = null;

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
      this.synced.clear();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.status = { ...this.status, running: false, starting: false, ready: false, error: `引擎启动失败: ${msg}` };
    }
    this.pushStatus();
    return this.status;
  }

  async stop(): Promise<void> {
    await this.playEngine.quit();
    await this.analyzeEngine.quit();
    this.status = { ...this.status, running: false, ready: false };
    this.synced.clear();
    this.pushStatus();
  }

  private async ensurePlay(): Promise<void> {
    if (!this.playEngine.running) await this.start();
  }

  private async ensureAnalyze(): Promise<GtpEngine> {
    if (this.analyzeEngine.running) return this.analyzeEngine;
    const backend = this.status.backend ?? availableBackends()[0] ?? 'opencl';
    const modelId = this.settings.modelId ?? 'b6c96';
    const modelFile = modelPath(modelId) ?? modelPath('b6c96');
    if (!modelFile) throw new Error('没有可用的网络文件');
    this.status = { ...this.status, backend };
    const args = this.buildArgs(modelFile, { maxVisits: this.settings.analyzeVisits ?? 300 });
    await this.analyzeEngine.start(katagoBinary(backend), args, backendDir(backend));
    return this.analyzeEngine;
  }

  /** 应用运行时参数。 */
  async applyParams(patch: Partial<AppSettings>): Promise<void> {
    this.setSettings(patch);
    const sets: Array<[string, string | number]> = [];
    if (patch.analyzeVisits !== undefined) sets.push(['maxVisits', patch.analyzeVisits]);
    if (patch.threads !== undefined) sets.push(['numSearchThreads', patch.threads]);
    for (const [key, value] of sets) {
      for (const engine of [this.playEngine, this.analyzeEngine]) {
        if (!engine.running) continue;
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
    await this.playEngine.send(`kata-set-param maxTime ${Math.max(0, req.maxTimeMs) / 1000}`, 15000).catch(() => undefined);
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
    }
  }

  async analyze(req: AnalyzeRequest): Promise<{ ok: boolean; error?: string }> {
    this.stopAnalysis();
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
    // 只在排查模式下把引擎原始输出透到界面日志，平时一条都不多打
    const debug = process.env.SZYS_GTP_LOG === '1';
    let rawLines = 0;
    const flush = (duringSearch: boolean, ownership: number[] | null = null): void => {
      if (current.size === 0) return;
      const list = [...current.values()].sort((a, b) => b.visits - a.visits);
      const top = list[0];
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

  async hint(sgf: string, visits: number, color: 'B' | 'W'): Promise<GenMoveResult> {
    return this.genMove({ sgf, color, maxVisits: visits, maxTimeMs: 0, allowResign: false, temperature: 0 });
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
