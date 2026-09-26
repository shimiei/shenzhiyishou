import { app } from 'electron';
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { BackendName } from '../shared/types';

/**
 * 引擎运行目录放在用户数据目录下的 ASCII 路径里，原因有两个：
 * 1. KataGo 是 C++ 程序，在 Windows 上打开中文路径不可靠；
 * 2. 安装目录（Program Files）通常只读，而 OpenCL 调优缓存需要可写。
 * 首次启动时把引擎和内置网络从资源目录镜像过来。
 */

const RUNTIME_NAME = 'shenzhiyishou-runtime';

function resourceRoot(): string {
  return app.isPackaged ? process.resourcesPath : app.getAppPath();
}

function bundledEngineRoot(): string {
  return path.join(resourceRoot(), 'engine');
}

function bundledModelsRoot(): string {
  return path.join(resourceRoot(), 'models');
}

export function runtimeRoot(): string {
  return path.join(app.getPath('appData'), RUNTIME_NAME);
}

export function engineRoot(): string {
  return path.join(runtimeRoot(), 'engine');
}

export function userDataRoot(): string {
  return app.getPath('userData');
}

export function modelsDir(): string {
  return path.join(runtimeRoot(), 'models');
}

export function recordsDir(): string {
  return path.join(userDataRoot(), 'records');
}

export function logsDir(): string {
  return path.join(runtimeRoot(), 'logs');
}

export function settingsFile(): string {
  return path.join(userDataRoot(), 'settings.json');
}

/**
 * 会话文件：关掉程序时开着的那几盘棋。
 * 跟 settings.json 分开放：那份是人手动改的偏好，这份是程序自己写的现场，坏了删掉就行。
 */
export function sessionFile(): string {
  return path.join(userDataRoot(), 'session.json');
}

export function libraryIndexFile(): string {
  return path.join(recordsDir(), 'index.json');
}

export function tmpDir(): string {
  return path.join(runtimeRoot(), 'tmp');
}

export function backendDir(backend: BackendName): string {
  return path.join(engineRoot(), backend === 'opencl' ? 'opencl' : 'eigenavx2');
}

export function katagoBinary(backend: BackendName): string {
  const exe = process.platform === 'win32' ? 'katago.exe' : 'katago';
  return path.join(backendDir(backend), exe);
}

export function engineConfig(backend: BackendName): string {
  return path.join(backendDir(backend), 'default_gtp.cfg');
}

export function availableBackends(): BackendName[] {
  const out: BackendName[] = [];
  for (const b of ['opencl', 'eigenavx2'] as BackendName[]) {
    if (existsSync(katagoBinary(b))) out.push(b);
  }
  return out;
}

function copyIfMissing(src: string, dst: string): void {
  if (existsSync(dst)) return;
  if (!existsSync(src)) return;
  cpSync(src, dst, { recursive: true });
}

/** 首次运行把引擎与内置网络镜像到可写的 ASCII 目录。 */
export function ensureRuntime(): { copiedEngine: boolean; copiedModels: boolean } {
  mkdirSync(engineRoot(), { recursive: true });
  mkdirSync(modelsDir(), { recursive: true });
  mkdirSync(recordsDir(), { recursive: true });
  mkdirSync(logsDir(), { recursive: true });
  mkdirSync(tmpDir(), { recursive: true });

  const srcEngine = bundledEngineRoot();
  let copiedEngine = false;
  if (existsSync(srcEngine)) {
    for (const name of readdirSync(srcEngine)) {
      const s = path.join(srcEngine, name);
      if (!statSync(s).isDirectory()) continue;
      const d = path.join(engineRoot(), name);
      if (!existsSync(path.join(d, process.platform === 'win32' ? 'katago.exe' : 'katago'))) {
        cpSync(s, d, { recursive: true });
        copiedEngine = true;
      }
    }
  }

  const srcModels = bundledModelsRoot();
  let copiedModels = false;
  if (existsSync(srcModels)) {
    for (const name of readdirSync(srcModels)) {
      const s = path.join(srcModels, name);
      const d = path.join(modelsDir(), name);
      const dstExists = existsSync(d);
      if (dstExists) continue;
      cpSync(s, d, { recursive: true });
      copiedModels = true;
    }
  }
  return { copiedEngine, copiedModels };
}
