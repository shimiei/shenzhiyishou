import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

interface Task {
  cmd: string;
  stream: boolean;
  onLine?: (line: string) => void;
  resolve: (v: string) => void;
  reject: (e: Error) => void;
  lines: string[];
  started: boolean;
  failed: boolean;
  timeoutMs: number;
  timer: NodeJS.Timeout | null;
}

/** GTP 协议客户端：一次只跑一条命令，支持流式命令（kata-analyze）。 */
export class GtpEngine extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private queue: Task[] = [];
  private current: Task | null = null;
  private quitting = false;

  constructor(public readonly label: string) {
    super();
  }

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  /**
   * 启动引擎并用 version 命令确认就绪。
   * readyTimeoutMs 只当兜底用，给得很宽：OpenCL 后端第一次启动要为显卡搜索并
   * 编译内核，集显上可能要十几分钟，超时太短会被误判成启动失败。
   * 进程真的挂了会走 exit 事件立刻失败，不用靠这个计时器。
   */
  start(exe: string, args: string[], cwd: string, readyTimeoutMs = 1800000): Promise<void> {
    if (this.running) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      const proc = spawn(exe, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.proc = proc;
      this.buffer = '';
      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');
      proc.on('error', (err) => {
        this.emit('log', `引擎启动失败: ${err.message}`);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      proc.stdout.on('data', (chunk: string) => this.onData(chunk));
      proc.stderr.on('data', (chunk: string) => {
        const text = String(chunk).trimEnd();
        if (text) this.emit('log', text);
      });
      proc.on('exit', (code) => {
        this.emit('log', `${this.label} 引擎退出，代码 ${code}`);
        this.proc = null;
        const err = new Error(`引擎已退出（代码 ${code}）`);
        if (this.current) {
          this.finishTask(err);
        }
        for (const t of this.queue.splice(0)) {
          if (t.timer) clearTimeout(t.timer);
          t.reject(err);
        }
        this.emit('exit', code);
      });
      // 用 version 命令确认引擎真正起来了
      this.send('version', readyTimeoutMs)
        .then(() => {
          settled = true;
          resolve();
        })
        .catch((err: Error) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx = this.buffer.indexOf('\n');
    while (idx >= 0) {
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.handleLine(line);
      idx = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    const task = this.current;
    if (!task) {
      // 没有命令在等响应，多半是错位后漏出来的原始输出；截断一下再报，
      // 分析输出的 info 行能有几千字符，整条塞进界面会把日志面板淹掉。
      const t = line.trim();
      if (t) this.emit('log', t.length > 300 ? t.slice(0, 300) + '…' : t);
      return;
    }
    if (line.trim() === '') {
      if (task.started) this.finishTask();
      return;
    }
    let text = line;
    if (!task.started) {
      task.started = true;
      if (text.startsWith('?')) {
        task.failed = true;
        text = text.slice(1).trimStart();
      } else if (text.startsWith('=')) {
        text = text.slice(1).trimStart();
      }
    }
    if (text.length > 0) {
      task.lines.push(text);
      task.onLine?.(text);
    }
  }

  private finishTask(err?: Error): void {
    const task = this.current;
    this.current = null;
    if (!task) return;
    if (task.timer) clearTimeout(task.timer);
    if (err) task.reject(err);
    else if (task.failed) task.reject(new Error(task.lines.join(' ') || '引擎返回错误'));
    else task.resolve(task.lines.join('\n'));
    this.pump();
  }

  private pump(): void {
    if (this.current || this.queue.length === 0) return;
    const task = this.queue.shift() as Task;
    if (!this.proc || this.proc.exitCode !== null) {
      task.reject(new Error('引擎没有运行'));
      this.pump();
      return;
    }
    this.current = task;
    if (task.timeoutMs > 0) {
      task.timer = setTimeout(() => {
        this.emit('log', `命令超时: ${task.cmd}`);
        this.finishTask(new Error(`命令超时: ${task.cmd}`));
      }, task.timeoutMs);
    }
    // 空命令是占位任务，只用来吃掉一条响应，不发任何东西
    if (task.cmd) this.proc.stdin.write(task.cmd + '\n', 'utf8');
  }

  send(cmd: string, timeoutMs = 60000): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, stream: false, resolve, reject, lines: [], started: false, failed: false, timeoutMs, timer: null });
      this.pump();
    });
  }

  /** 流式命令：每行输出回调一次，直到命令结束或被 stop 打断。 */
  stream(
    cmd: string,
    onLine: (line: string) => void,
    opts: { timeoutMs?: number } = {}
  ): { promise: Promise<string>; stop: () => void } {
    const promise = new Promise<string>((resolve, reject) => {
      this.queue.push({
        cmd,
        stream: true,
        onLine,
        resolve,
        reject,
        lines: [],
        started: false,
        failed: false,
        timeoutMs: opts.timeoutMs ?? 0,
        timer: null
      });
      this.pump();
    });
    return { promise, stop: () => this.interrupt('stop') };
  }

  /**
   * 打断当前命令：直接写入（不排队，否则排到正在跑的分析后面就永远发不出去），
   * 但在队首插一个占位任务去接引擎对这条命令的独立响应。
   *
   * 这是必需的：引擎收到 stop 会先结束分析（回一个空行），再为 stop 本身回一条
   * "=" 加空行。没人接的话，这两行会落到下一条命令头上，那条命令会立刻"成功"返回，
   * 之后每条响应都错位一条。表现出来的现象很能唬人：分析一条结果都不出，
   * 而引擎的原始输出全跑到日志里去了。
   */
  private interrupt(cmd: string): void {
    if (!this.proc || this.proc.exitCode !== null) return;
    this.queue.unshift({
      cmd: '',
      stream: true,
      resolve: () => undefined,
      reject: () => undefined,
      lines: [],
      started: false,
      failed: false,
      timeoutMs: 5000,
      timer: null
    });
    this.proc.stdin.write(cmd + '\n', 'utf8');
    this.pump();
  }

  /** 直接写入一行，不排队。只给最底层的收尾流程用，一般不要调。 */
  writeRaw(line: string): void {
    if (!this.proc || this.proc.exitCode !== null) return;
    this.proc.stdin.write(line + '\n', 'utf8');
  }

  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  async quit(): Promise<void> {
    if (!this.proc || this.proc.exitCode !== null) return;
    this.quitting = true;
    this.interrupt('quit');
    const proc = this.proc;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* 进程可能已经退出 */
        }
        resolve();
      }, 1500);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.quitting = false;
  }

  kill(): void {
    if (!this.proc) return;
    try {
      this.proc.kill();
    } catch {
      /* 忽略 */
    }
    this.proc = null;
  }
}
