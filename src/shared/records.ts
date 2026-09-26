/**
 * 棋谱馆里那些不动磁盘的规矩：标题怎么起、导出叫什么名字、列表怎么搜怎么排、
 * 目录里多出来的文件认哪些。
 *
 * 放在 shared 里是因为主进程和界面都要用：主进程管目录与索引，界面管展示与挑选。
 * "标题默认写什么""同一个名字撞了怎么加序号"这类规矩只该有一处出处，
 * 两边各写一套的话，用户看到的和存下来的迟早不一样。
 */

import type { RecordMeta } from './types';

/** 索引文件名。目录里除了棋谱就是它，别把它当成一盘棋。 */
export const LIBRARY_FILE = 'library.json';
/** 老版本用的索引名。读到它就搬一次家，搬完写进 library.json。 */
export const LEGACY_INDEX_FILE = 'index.json';

export function isSgfFile(name: string): boolean {
  return /\.sgf$/i.test(name);
}

/** 文件名里不该出现的字符：Windows 不让用，别的系统上也会惹麻烦；控制字符一并去掉。 */
const BAD_NAME_CHARS = /[\u0000-\u001f\\/:*?"<>|]/g;

/** 把标题变成能当文件名的样子：不要的字符换成空格，收尾的点与空格去掉（Windows 上会被吃掉）。 */
export function safeFileName(title: string, fallback = '棋谱'): string {
  const cleaned = title
    .replace(BAD_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return (cleaned || fallback).slice(0, 80);
}

/**
 * 一个不撞别人的文件名。已用的名字按大小写不敏感地比，Windows 上 a.sgf 与 A.sgf 是一回事。
 * 撞了就加 -2、-3，不覆盖别人的东西。
 */
export function uniqueFileName(base: string, taken: Iterable<string>, ext = '.sgf'): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const stem = safeFileName(base);
  let name = stem + ext;
  for (let i = 2; used.has(name.toLowerCase()); i += 1) name = `${stem}-${i}${ext}`;
  return name;
}

/** 棋谱的默认标题：有名字写名字，没有就写"黑""白"，有日期带上日期。 */
export function defaultTitle(info: { blackName?: string; whiteName?: string; date?: string }): string {
  const black = (info.blackName ?? '').trim() || '黑';
  const white = (info.whiteName ?? '').trim() || '白';
  const date = (info.date ?? '').trim();
  return date ? `${black} 对 ${white} ${date}` : `${black} 对 ${white}`;
}

/** 另存为时给文件框里填的名字：标题去掉不能当文件名的字符，补上 .sgf。 */
export function suggestSgfName(info: { blackName?: string; whiteName?: string; date?: string }): string {
  return safeFileName(defaultTitle(info)) + '.sgf';
}

/** 排序用的日期键：只看数字，2024-3-5 与 20240305 排在一起。 */
export function dateKey(date: string): string {
  const parts = date.match(/\d+/g) ?? [];
  // SGF 里日期写成 2024-03-05 或 20240305 都有，月份还可能是 3 这种一位数
  if (parts.length >= 3) {
    const [year, month, day] = parts as [string, string, string];
    return `${year.padStart(4, '0')}${month.padStart(2, '0')}${day.padStart(2, '0')}`.slice(0, 8);
  }
  return (parts.join('') || '').slice(0, 8).padEnd(8, '0');
}

export type LibrarySort = 'savedAt' | 'date' | 'moves' | 'title';

/** 列表右上角那个排序框里的几项。 */
export const LIBRARY_SORTS: Array<{ key: LibrarySort; label: string }> = [
  { key: 'savedAt', label: '保存时间' },
  { key: 'date', label: '对局日期' },
  { key: 'moves', label: '手数' },
  { key: 'title', label: '标题' }
];

/** 排一份出来，不动原来那一份。同分的按保存时间兜底，顺序才是稳的。 */
export function sortRecords(list: readonly RecordMeta[], sort: LibrarySort): RecordMeta[] {
  const out = list.slice();
  out.sort((a, b) => {
    switch (sort) {
      case 'date':
        return dateKey(b.date).localeCompare(dateKey(a.date)) || b.savedAt - a.savedAt;
      case 'moves':
        return b.moves - a.moves || b.savedAt - a.savedAt;
      case 'title':
        return a.title.localeCompare(b.title, 'zh-Hans-CN') || b.savedAt - a.savedAt;
      default:
        return b.savedAt - a.savedAt;
    }
  });
  return out;
}

/**
 * 搜索：标题、双方、结果、日期、标签一起找。
 * 空格分开的几段要都命中才算，这样"柯洁 2024"能把范围收窄。
 */
export function matchRecord(meta: RecordMeta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [meta.title, meta.blackName, meta.whiteName, meta.result, meta.date, ...(meta.tags ?? [])]
    .join(' ')
    .toLowerCase();
  return q.split(/\s+/).every((part) => hay.includes(part));
}

export type ResultKind = 'black' | 'white' | 'draw' | 'unknown';

/** 结果那一栏写的是 "B+R" 这种机器写法，这里读成人话要的那一类。 */
export function resultKind(result: string): ResultKind {
  const r = (result ?? '').trim().toUpperCase();
  if (!r) return 'unknown';
  if (r.startsWith('B')) return 'black';
  if (r.startsWith('W')) return 'white';
  if (r === '0' || r.startsWith('D') || r.includes('和')) return 'draw';
  return 'unknown';
}

/** "B+R" → 黑中盘胜，"W+3.5" → 白胜 3.5 目，空着就说未记结果。 */
export function resultLabel(result: string): string {
  const r = (result ?? '').trim();
  if (!r) return '未记结果';
  const kind = resultKind(r);
  if (kind === 'draw') return '和棋';
  if (kind === 'unknown') return r;
  const who = kind === 'black' ? '黑' : '白';
  const tail = /^[BW]\+?/.test(r) ? r.replace(/^[BW]\+?/, '').trim() : '';
  if (!tail) return `${who}胜`;
  if (/^R$/i.test(tail)) return `${who}中盘胜`;
  if (/^T$/i.test(tail)) return `${who}超时胜`;
  if (/^F$/i.test(tail)) return `${who}犯规胜`;
  if (/^\d+(\.\d+)?$/.test(tail)) return `${who}胜 ${tail} 目`;
  return `${who}胜 ${tail}`;
}

export interface LibraryFilter {
  query?: string;
  /** 选中的标签，得全中才算（多选是"都要有"） */
  tags?: string[];
  result?: ResultKind | '';
  /** 只看几路的盘，null 表示不限 */
  size?: number | null;
  /** 只看最近多少天，0 表示不限 */
  days?: number;
  /** 算"最近"用的当下时间，传进来才好写断言 */
  now?: number;
}

export function filterRecords(list: readonly RecordMeta[], f: LibraryFilter): RecordMeta[] {
  const tags = (f.tags ?? []).filter(Boolean);
  const since = f.days && f.days > 0 ? (f.now ?? Date.now()) - f.days * 86400000 : 0;
  return list.filter((m) => {
    if (!matchRecord(m, f.query ?? '')) return false;
    if (tags.length && !tags.every((t) => (m.tags ?? []).includes(t))) return false;
    if (f.result && resultKind(m.result) !== f.result) return false;
    if (f.size && m.size !== f.size) return false;
    if (since && m.savedAt < since) return false;
    return true;
  });
}

/** 馆里用过的标签，次数多的排前面，次数一样按名字排。截图那一栏的下拉用它。 */
export function allTags(list: readonly RecordMeta[]): Array<{ tag: string; count: number }> {
  const count = new Map<string, number>();
  for (const m of list) for (const t of m.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()]
    .map(([tag, n]) => ({ tag, count: n }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'));
}

export interface ScanPlan {
  /** 目录里有、索引里没有的：收编进来 */
  added: string[];
  /** 索引里有、目录里已经不在了的：标成丢失，或者把索引记录清掉 */
  missing: string[];
}

/**
 * 目录里现在有什么、索引里记着什么，两头对一下。
 * 名字按大小写不比，别的文件（包括索引自己、临时文件）一概不看。
 */
export function planScan(index: readonly RecordMeta[], files: readonly string[]): ScanPlan {
  const onDisk = new Map<string, string>();
  for (const f of files) if (isSgfFile(f) && f !== LIBRARY_FILE) onDisk.set(f.toLowerCase(), f);
  const known = new Set<string>();
  const missing: string[] = [];
  for (const meta of index) {
    const key = (meta.file ?? '').toLowerCase();
    if (onDisk.has(key)) known.add(key);
    else missing.push(meta.file);
  }
  const added = [...onDisk.entries()].filter(([key]) => !known.has(key)).map(([, name]) => name);
  added.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  return { added, missing };
}

/** 生成一个没被用过的编号。同一毫秒里连着存几份也不会撞。 */
export function makeRecordId(existing: Iterable<string>, now: number): string {
  const used = new Set(existing);
  const stem = 'r' + now.toString(36);
  if (!used.has(stem)) return stem;
  for (let i = 2; ; i += 1) {
    const id = `${stem}-${i}`;
    if (!used.has(id)) return id;
  }
}

/**
 * 把索引里的一条读成能用的样子。
 *
 * 索引文件是程序自己写的，可它在用户看得见的目录里：手改过、被别的工具动过、
 * 或者是老版本留下的少几栏，都可能。缺什么补什么，缺了 id 或文件名这种没法猜的
 * 就整条丢掉（那条也没法定位到磁盘上的文件）。
 */
export function normalizeMeta(raw: unknown): RecordMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<RecordMeta>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const file = typeof r.file === 'string' ? r.file.trim() : '';
  if (!id || !file) return null;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const num = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  return {
    id,
    file,
    title: str(r.title).trim() || file.replace(/\.sgf$/i, ''),
    blackName: str(r.blackName),
    whiteName: str(r.whiteName),
    result: str(r.result),
    date: str(r.date),
    size: num(r.size, 19),
    moves: num(r.moves, 0),
    savedAt: num(r.savedAt, 0),
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '') : []
  };
}

export interface AdoptedFile {
  file: string;
  meta: Partial<RecordMeta>;
}/**
 * 把扫描到的文件补进索引（文件已经在目录里了，一个字节都不用再写）。
 * 索引里已经有同名的就跳过，不覆盖用户自己改过的标题。
 */
export function mergeAdopted(
  index: readonly RecordMeta[],
  adopted: readonly AdoptedFile[],
  now: number
): { list: RecordMeta[]; added: number } {
  const list = index.slice();
  const ids = new Set(list.map((m) => m.id));
  const files = new Set(list.map((m) => (m.file ?? '').toLowerCase()));
  let added = 0;
  for (const item of adopted) {
    if (files.has(item.file.toLowerCase())) continue;
    const id = makeRecordId(ids, now + added);
    ids.add(id);
    files.add(item.file.toLowerCase());
    list.push({
      id,
      title: item.meta.title?.trim() || item.file.replace(/\.sgf$/i, ''),
      blackName: item.meta.blackName ?? '',
      whiteName: item.meta.whiteName ?? '',
      result: item.meta.result ?? '',
      date: item.meta.date ?? '',
      size: item.meta.size ?? 19,
      moves: item.meta.moves ?? 0,
      savedAt: item.meta.savedAt ?? now,
      file: item.file,
      tags: item.meta.tags ?? []
    });
    added += 1;
  }
  return { list, added };
}
