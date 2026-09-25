import { app, dialog, shell } from 'electron';
import { copyFile, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import { modelsDir } from './paths';
import type { ModelEntry } from '../shared/types';
import type { DownloadProgress } from '../shared/protocol';

interface ModelDef {
  id: string;
  name: string;
  /** 相对 models 目录的路径，可能是目录形式的模型。 */
  file: string;
  sizeBytes: number;
  strength: number;
  note: string;
  url?: string;
  bundled: boolean;
  /** 人类风格模型需要和主网络配合使用。 */
  humanStyle?: boolean;
  sizeLabel: string;
}

export const MODEL_DEFS: ModelDef[] = [
  {
    id: 'b6c96',
    name: 'b6c96 轻量网络（内置）',
    file: path.join('b6c96-s175395328-d26788732', 'model.txt.gz'),
    sizeBytes: 4967720,
    strength: 2,
    note: '随程序内置，速度最快，适合快速对局与低配机器',
    bundled: true,
    sizeLabel: '4.7 MB'
  },
  {
    id: 'b18c384nbt',
    name: 'b18c384nbt 最强网络',
    file: 'kata1-b18c384nbt-s9996604416-d4316597426.bin.gz',
    sizeBytes: 97898094,
    strength: 5,
    note: '当前最强档，2630 万参数。核显上每步需要几秒，适合认真对局与复盘',
    url: 'https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz',
    bundled: false,
    sizeLabel: '93 MB'
  },
  {
    id: 'b28c512nbt',
    name: 'b28c512nbt 超大网络',
    file: 'kata1-b28c512nbt-s13255194368-d5935380940.bin.gz',
    sizeBytes: 271440852,
    strength: 6,
    note: '比 b18c384nbt 更强，但核显上慢到不实用，有独显再考虑',
    url: 'https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b28c512nbt-s13255194368-d5935380940.bin.gz',
    bundled: false,
    sizeLabel: '259 MB'
  },
  {
    id: 'humanv0',
    name: '人类风格网络（humanv0）',
    file: 'b18c384nbt-humanv0.bin.gz',
    sizeBytes: 99066230,
    strength: 5,
    note: '模仿人类棋风与人类失误率，配合主网络使用，适合陪练',
    url: 'https://github.com/lightvector/KataGo/releases/download/v1.15.0/b18c384nbt-humanv0.bin.gz',
    bundled: false,
    humanStyle: true,
    sizeLabel: '94 MB'
  }
];

export function modelDef(id: string): ModelDef | undefined {
  return MODEL_DEFS.find((m) => m.id === id);
}

export function modelPath(id: string): string | null {
  const def = modelDef(id);
  if (!def) return null;
  const p = path.join(modelsDir(), def.file);
  return existsSync(p) ? p : null;
}

/**
 * 按真正用上的那个文件反查网络定义。
 * 不能拿"用户想要的那个 id"去查名字：设置里默认是大网络，新装的机器上却只有随包的小网络，
 * 启动时会退回小网络跑。名字要是还显示成大网络，面板就在骗人。
 * 比的是完整路径而不是文件名：内置小网络的定义里带一层子目录（b6c96-…/model.txt.gz），
 * 只比 basename 的话两边永远对不上，退回逻辑就白写了。
 */
export function modelDefByFile(file: string): ModelDef | undefined {
  const full = path.normalize(file);
  return MODEL_DEFS.find((m) => path.normalize(path.join(modelsDir(), m.file)) === full);
}

/** 扫描目录，看看有哪些网络可用（包含用户自己放进来的文件）。 */
export function listModels(): ModelEntry[] {
  const dir = modelsDir();
  const out: ModelEntry[] = [];
  const known = new Set<string>();
  for (const def of MODEL_DEFS) {
    const p = path.join(dir, def.file);
    const has = existsSync(p);
    known.add(path.normalize(def.file));
    out.push({
      id: def.id,
      name: def.name,
      file: def.file,
      sizeBytes: def.sizeBytes,
      bundled: def.bundled,
      strength: def.strength,
      note: def.note,
      downloaded: has
    });
  }
  // 用户手动放进去的其他网络
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.bin.gz') && !name.endsWith('.txt.gz')) continue;
      if (known.has(path.normalize(name))) continue;
      const st = statSync(path.join(dir, name));
      out.push({
        id: 'local:' + name,
        name: name.replace(/\.(bin|txt)\.gz$/, ''),
        file: name,
        sizeBytes: st.size,
        bundled: false,
        strength: 4,
        note: '本地网络文件',
        downloaded: true
      });
    }
  } catch {
    /* 目录可能还不存在 */
  }
  return out;
}

function download(url: string, dst: string, onProgress: (received: number, total: number) => void, isCancelled: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const go = (target: string, depth: number): void => {
      if (depth > 6) {
        reject(new Error('重定向次数过多'));
        return;
      }
      const mod = target.startsWith('http://') ? http : https;
      const req = mod.get(
        target,
        { headers: { 'User-Agent': 'shenzhiyishou/1.0', Accept: '*/*' } },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            go(new URL(res.headers.location, target).toString(), depth + 1);
            return;
          }
          if (status !== 200) {
            res.resume();
            reject(new Error(`下载失败，服务器返回 ${status}`));
            return;
          }
          const total = parseInt(String(res.headers['content-length'] ?? '0'), 10) || 0;
          let received = 0;
          const part = dst + '.part';
          const ws = createWriteStream(part);
          res.on('data', (chunk: Buffer) => {
            received += chunk.length;
            onProgress(received, total);
            if (isCancelled()) {
              res.destroy();
              ws.destroy();
              try {
                rmSync(part, { force: true });
              } catch {
                /* 忽略 */
              }
              reject(new Error('已取消'));
              return;
            }
            if (!ws.write(chunk)) res.pause();
          });
          ws.on('drain', () => res.resume());
          res.on('end', () => {
            ws.end(() => {
              try {
                renameSync(part, dst);
                resolve();
              } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
              }
            });
          });
          res.on('error', (e) => {
            ws.destroy();
            reject(e);
          });
        }
      );
      req.on('error', reject);
    };
    go(url, 0);
  });
}

const cancels = new Map<string, boolean>();

export async function downloadModel(
  id: string,
  emit: (p: DownloadProgress) => void
): Promise<{ ok: boolean; error?: string }> {
  const def = modelDef(id);
  if (!def) return { ok: false, error: '没有这个网络' };
  if (!def.url) return { ok: false, error: '这个网络没有下载地址，请手动放入 models 目录' };
  mkdirSync(modelsDir(), { recursive: true });
  const dst = path.join(modelsDir(), def.file);
  cancels.set(id, false);
  try {
    await download(
      def.url,
      dst,
      (received, total) => emit({ id, received, total: total || def.sizeBytes, done: false }),
      () => cancels.get(id) === true
    );
    emit({ id, received: def.sizeBytes, total: def.sizeBytes, done: true });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit({ id, received: 0, total: def.sizeBytes, done: true, error: msg });
    return { ok: false, error: msg };
  } finally {
    cancels.delete(id);
  }
}

export function cancelDownload(id: string): void {
  cancels.set(id, true);
}

export function removeModel(id: string): void {
  const def = modelDef(id);
  if (!def || def.bundled) return;
  const p = path.join(modelsDir(), def.file);
  if (existsSync(p)) rmSync(p, { force: true });
}

/** 让用户从磁盘上挑一个网络文件，复制进 models 目录。 */
export async function importModel(): Promise<ModelEntry | null> {
  const res = await dialog.showOpenDialog({
    title: '选择 KataGo 网络文件',
    filters: [{ name: 'KataGo 网络', extensions: ['gz'] }],
    properties: ['openFile']
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const src = res.filePaths[0];
  const base = path.basename(src);
  mkdirSync(modelsDir(), { recursive: true });
  const dst = path.join(modelsDir(), base);
  await new Promise<void>((resolve, reject) => {
    copyFile(src, dst, (err) => (err ? reject(err) : resolve()));
  });
  return {
    id: 'local:' + base,
    name: base.replace(/\.(bin|txt)\.gz$/, ''),
    file: base,
    sizeBytes: statSync(dst).size,
    bundled: false,
    strength: 4,
    note: '本地网络文件',
    downloaded: true
  };
}

export async function openModelsFolder(): Promise<void> {
  mkdirSync(modelsDir(), { recursive: true });
  await shell.openPath(modelsDir());
  void app;
}
