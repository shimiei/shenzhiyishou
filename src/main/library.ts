/**
 * 棋谱馆：一个用户自己选的文件夹，里面是普通的 .sgf 文件，再加一份 library.json 记着
 * 标题、对局双方、日期、结果、标签这些索引信息。
 *
 * 选这个形状的原因：目录里的东西别人也打得开，丢进网盘、拷到别的机器都还是棋谱本身，
 * 不像数据库那样把内容锁死在一个文件里。索引丢了也不要紧，扫一遍就能重新认出来。
 *
 * 老版本把棋谱存在 userData/records 下、索引叫 index.json，那个目录就是现在的默认目录：
 * 以前存过的棋谱原样出现在馆里，一条不丢；索引先读老名字，下次写的时候落到新名字上。
 *
 * 这里只管磁盘与索引，SGF 的解析归界面那一层（core/records/meta.ts）：
 * 扫目录时把文件正文交上去，由界面读出标题与手数再交回来收编。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';
import {
  LIBRARY_FILE,
  LEGACY_INDEX_FILE,
  isSgfFile,
  makeRecordId,
  mergeAdopted,
  normalizeMeta,
  planScan,
  safeFileName,
  uniqueFileName,
  type AdoptedFile
} from '../shared/records';
import { DEFAULT_SETTINGS, type AppSettings, type RecordEntry, type RecordMeta } from '../shared/types';
import { recordsDir, settingsFile } from './paths';

type SettingsStore = AppSettings & Record<string, unknown>;

let cached: SettingsStore | null = null;

export function loadSettings(): SettingsStore {
  if (cached) return cached;
  let data: Partial<SettingsStore> = {};
  try {
    if (existsSync(settingsFile())) data = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<SettingsStore>;
  } catch {
    data = {};
  }
  // vision、window、layout 是嵌套对象，只展开外层会把整个子对象顶掉，
  // 于是老版本留下的 settings.json 少一个字段，界面就会拿到 undefined。
  cached = {
    ...DEFAULT_SETTINGS,
    ...data,
    vision: { ...DEFAULT_SETTINGS.vision, ...(data.vision ?? {}) },
    window: { ...DEFAULT_SETTINGS.window, ...(data.window ?? {}) },
    layout: { ...DEFAULT_SETTINGS.layout, ...(data.layout ?? {}) }
  };
  return cached;
}

export function saveSettings(patch: Partial<SettingsStore>): SettingsStore {
  const cur = loadSettings();
  const next: SettingsStore = {
    ...cur,
    ...patch,
    vision: { ...cur.vision, ...(patch.vision ?? {}) },
    window: { ...cur.window, ...(patch.window ?? {}) },
    layout: { ...cur.layout, ...(patch.layout ?? {}) }
  };
  cached = next;
  mkdirSync(path.dirname(settingsFile()), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/** 没挑过目录时的棋谱馆：就是老版本那个 records 目录。 */
export function defaultLibraryDir(): string {
  return recordsDir();
}

export function libraryDir(): string {
  const dir = (loadSettings().recordDir ?? '').trim();
  return dir || defaultLibraryDir();
}

function indexFileIn(dir: string): string {
  return path.join(dir, LIBRARY_FILE);
}

/**
 * 读索引。优先新名字，没有就认老名字 index.json（老版本存的棋谱照旧读得出来）。
 * 读不出来或者格式不对就当空馆：宁可少几条，也不能因为一份坏索引打不开界面。
 */
function readIndexIn(dir: string): RecordMeta[] {
  for (const file of [indexFileIn(dir), path.join(dir, LEGACY_INDEX_FILE)]) {
    if (!existsSync(file)) continue;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (!Array.isArray(data)) continue;
      const list = data.map(normalizeMeta).filter((m): m is RecordMeta => m !== null);
      if (list.length) return list;
    } catch {
      /* 读不动就换下一个候选 */
    }
  }
  return [];
}

function writeIndexIn(dir: string, list: RecordMeta[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(indexFileIn(dir), JSON.stringify(list, null, 2), 'utf8');
}

function readIndex(): RecordMeta[] {
  return readIndexIn(libraryDir());
}

/** 目录里现在有哪些东西，用来给新棋谱挑一个不撞的名字。 */
function filesIn(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function listRecords(): { dir: string; records: RecordMeta[] } {
  const dir = libraryDir();
  const records = readIndex().sort((a, b) => b.savedAt - a.savedAt);
  return { dir, records };
}

export function getRecord(id: string): RecordEntry | null {
  const dir = libraryDir();
  const meta = readIndex().find((r) => r.id === id);
  if (!meta) return null;
  const file = path.join(dir, meta.file);
  if (!existsSync(file)) return null;
  return { ...meta, content: readFileSync(file, 'utf8') };
}

/**
 * 存一份棋谱。给了 id 就是更新原来那一条（文件名不动，只改正文与那几栏），
 * 没给就新收一份：文件名照标题起，撞了加序号，绝不覆盖目录里已有的东西。
 */
export function saveRecord(input: { meta: Partial<RecordMeta>; content: string; id?: string }): RecordMeta {
  const dir = libraryDir();
  mkdirSync(dir, { recursive: true });
  const list = readIndex();
  const existing = input.id ? list.find((r) => r.id === input.id) : undefined;
  const title = (input.meta.title ?? '').trim() || existing?.title || '未命名棋谱';
  const id = existing?.id ?? makeRecordId(list.map((r) => r.id), Date.now());
  const fileName =
    existing?.file ?? uniqueFileName(safeFileName(title), [...filesIn(dir), ...list.map((r) => r.file)]);
  writeFileSync(path.join(dir, fileName), input.content, 'utf8');
  const meta: RecordMeta = {
    id,
    title,
    blackName: input.meta.blackName ?? existing?.blackName ?? '',
    whiteName: input.meta.whiteName ?? existing?.whiteName ?? '',
    result: input.meta.result ?? existing?.result ?? '',
    date: input.meta.date ?? existing?.date ?? '',
    size: input.meta.size ?? existing?.size ?? 19,
    moves: input.meta.moves ?? existing?.moves ?? 0,
    tags: input.meta.tags ?? existing?.tags ?? [],
    savedAt: Date.now(),
    file: fileName
  };
  const next = existing ? list.map((r) => (r.id === id ? meta : r)) : [meta, ...list];
  writeIndexIn(dir, next);
  return meta;
}

/** 删几条。文件与索引一起删，返回真的删掉了几条。 */
export function deleteRecords(ids: string[]): number {
  const dir = libraryDir();
  const list = readIndex();
  const going = new Set(ids);
  let removed = 0;
  for (const meta of list) {
    if (!going.has(meta.id)) continue;
    try {
      const file = path.join(dir, meta.file);
      if (existsSync(file)) rmSync(file, { force: true });
    } catch {
      /* 文件可能已经被用户自己删了，索引照样清掉 */
    }
    removed += 1;
  }
  if (removed) writeIndexIn(dir, list.filter((r) => !going.has(r.id)));
  return removed;
}

/**
 * 改标题或者标签。只动索引，不动磁盘上的文件名：
 * 文件可能正被别的程序打开着，改不动就成了半截状态；导出时自然会按新标题起名字。
 */
export function updateRecord(id: string, patch: { title?: string; tags?: string[] }): RecordMeta | null {
  const dir = libraryDir();
  const list = readIndex();
  const target = list.find((r) => r.id === id);
  if (!target) return null;
  const next: RecordMeta = {
    ...target,
    title: patch.title !== undefined ? patch.title.trim() || target.title : target.title,
    tags: patch.tags !== undefined ? patch.tags.map((t) => t.trim()).filter(Boolean) : target.tags
  };
  writeIndexIn(dir, list.map((r) => (r.id === id ? next : r)));
  return next;
}

/**
 * 导出几份到别的文件夹。名字按标题起，目标目录里已经有的名字不覆盖（加序号）。
 * 哪一份读不出来就跳过去，成功几份、跳了几份都说清楚。
 */
export function exportRecords(ids: string[], targetDir: string): { exported: number; skipped: number; names: string[] } {
  const dir = libraryDir();
  const list = readIndex();
  mkdirSync(targetDir, { recursive: true });
  const taken = filesIn(targetDir);
  const names: string[] = [];
  let skipped = 0;
  for (const id of ids) {
    const meta = list.find((r) => r.id === id);
    if (!meta) {
      skipped += 1;
      continue;
    }
    try {
      const content = readFileSync(path.join(dir, meta.file), 'utf8');
      const name = uniqueFileName(safeFileName(meta.title), taken);
      writeFileSync(path.join(targetDir, name), content, 'utf8');
      taken.push(name);
      names.push(name);
    } catch {
      skipped += 1;
    }
  }
  return { exported: names.length, skipped, names };
}

/** 一份棋谱最多这么大。超过的八成不是棋谱，读进来只是白占内存。 */
const MAX_SGF_BYTES = 4 * 1024 * 1024;

/**
 * 看看目录里有没有不是从这个程序进来的棋谱。
 * 正文一并带回去（标题与手数由界面去认），认完再调 adoptRecords 收编。
 */
export function scanLibrary(): { dir: string; added: Array<{ file: string; content: string }>; missing: string[] } {
  const dir = libraryDir();
  const plan = planScan(readIndex(), filesIn(dir));
  const added: Array<{ file: string; content: string }> = [];
  for (const file of plan.added) {
    const full = path.join(dir, file);
    try {
      if (!isSgfFile(file) || statSync(full).size > MAX_SGF_BYTES) continue;
      added.push({ file, content: readFileSync(full, 'utf8') });
    } catch {
      /* 读不了就当没看见 */
    }
  }
  return { dir, added, missing: plan.missing };
}

/** 把扫出来的那几份写进索引。文件已经在目录里了，一个字节都不用再写。 */
export function adoptRecords(items: AdoptedFile[]): number {
  const dir = libraryDir();
  const { list, added } = mergeAdopted(readIndex(), items, Date.now());
  if (added) writeIndexIn(dir, list);
  return added;
}

/**
 * 换棋谱馆目录。
 *
 * move 为真：把现有的棋谱复制过去再删原件（跨盘也安全，中途失败的话原件还在，
 * 失败几份报回去），索引跟着搬；新目录里已经有同名的加序号，不覆盖人家的东西。
 * move 为假：只换目录，旧的留在原处。
 */
export function setLibraryDir(dir: string, move: boolean): { dir: string; moved: number; failed: number } {
  const next = (dir ?? '').trim();
  if (!next) return { dir: libraryDir(), moved: 0, failed: 0 };
  const from = libraryDir();
  let moved = 0;
  let failed = 0;
  if (move && path.resolve(from) !== path.resolve(next)) {
    mkdirSync(next, { recursive: true });
    const list = readIndex();
    const taken = filesIn(next);
    const out: RecordMeta[] = [];
    const copied: Array<{ from: string; to: string }> = [];
    for (const meta of list) {
      try {
        const src = path.join(from, meta.file);
        if (!existsSync(src)) throw new Error('文件没了');
        const name = taken.includes(meta.file) ? uniqueFileName(meta.file.replace(/\.sgf$/i, ''), taken) : meta.file;
        copyFileSync(src, path.join(next, name));
        taken.push(name);
        copied.push({ from: src, to: path.join(next, name) });
        out.push({ ...meta, file: name });
        moved += 1;
      } catch {
        failed += 1;
        out.push(meta);
      }
    }
    // 索引先落到新目录：写成了才敢删原件，不然删一半失败两边都没有
    writeIndexIn(next, out.length ? out : list);
    if (failed === 0) {
      for (const c of copied) {
        try {
          rmSync(c.from, { force: true });
        } catch {
          /* 删不掉就留着，新目录里那份是好的 */
        }
      }
    }
  }
  // 选的就是默认目录的话，设置里留空：以后默认目录跟着程序走
  saveSettings({ recordDir: path.resolve(next) === path.resolve(defaultLibraryDir()) ? '' : next });
  return { dir: next, moved, failed };
}

/** 在资源管理器里打开棋谱馆目录；给了 id 就选中那一份。 */
export function revealRecord(id?: string): void {
  const dir = libraryDir();
  if (id) {
    const meta = readIndex().find((r) => r.id === id);
    if (meta) {
      const file = path.join(dir, meta.file);
      if (existsSync(file)) {
        shell.showItemInFolder(file);
        return;
      }
    }
  }
  mkdirSync(dir, { recursive: true });
  void shell.openPath(dir);
}
