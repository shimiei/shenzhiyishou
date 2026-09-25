import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { libraryIndexFile, recordsDir, settingsFile } from './paths';
import { DEFAULT_SETTINGS, type AppSettings, type RecordEntry, type RecordMeta } from '../shared/types';

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

function readIndex(): RecordMeta[] {
  try {
    if (!existsSync(libraryIndexFile())) return [];
    const data = JSON.parse(readFileSync(libraryIndexFile(), 'utf8')) as RecordMeta[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeIndex(list: RecordMeta[]): void {
  mkdirSync(recordsDir(), { recursive: true });
  writeFileSync(libraryIndexFile(), JSON.stringify(list, null, 2), 'utf8');
}

export function listRecords(): RecordMeta[] {
  return readIndex().sort((a, b) => b.savedAt - a.savedAt);
}

export function getRecord(id: string): RecordEntry | null {
  const meta = readIndex().find((r) => r.id === id);
  if (!meta) return null;
  const file = path.join(recordsDir(), meta.file);
  if (!existsSync(file)) return null;
  return { ...meta, content: readFileSync(file, 'utf8') };
}

export function saveRecord(input: { meta: Partial<RecordMeta>; content: string; id?: string }): RecordMeta {
  mkdirSync(recordsDir(), { recursive: true });
  const list = readIndex();
  const existing = input.id ? list.find((r) => r.id === input.id) : undefined;
  const id = existing?.id ?? 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fileName = existing?.file ?? `${id}.sgf`;
  writeFileSync(path.join(recordsDir(), fileName), input.content, 'utf8');
  const meta: RecordMeta = {
    id,
    title: input.meta.title ?? existing?.title ?? '未命名棋谱',
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
  writeIndex(next);
  return meta;
}

export function deleteRecord(id: string): void {
  const list = readIndex();
  const target = list.find((r) => r.id === id);
  if (target) {
    const file = path.join(recordsDir(), target.file);
    try {
      if (existsSync(file)) rmSync(file, { force: true });
    } catch {
      /* 文件可能已被删除 */
    }
  }
  writeIndex(list.filter((r) => r.id !== id));
}

/** 导入一个外部 SGF 到棋谱库。 */
export function importSgfToLibrary(filePath: string, content: string): RecordMeta {
  const base = path.basename(filePath).replace(/\.sgf$/i, '');
  return saveRecord({ meta: { title: base }, content });
}

export function recordCount(): number {
  try {
    return readdirSync(recordsDir()).filter((f) => f.endsWith('.sgf')).length;
  } catch {
    return 0;
  }
}
