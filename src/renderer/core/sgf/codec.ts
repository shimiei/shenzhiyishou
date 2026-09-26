import { PASS } from '../../../shared/types';

export function toSgfPoint(x: number, y: number): string {
  return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
}

/** 解析 SGF 坐标，pass 或非法值返回 PASS。 */
export function fromSgfPoint(s: string, size: number, legacyPass = true): number {
  if (!s) return PASS;
  if (s.length < 2) return PASS;
  const c0 = s.charCodeAt(0);
  const c1 = s.charCodeAt(1);
  const x = c0 >= 97 ? c0 - 97 : c0 >= 65 ? c0 - 65 + 26 : -1;
  const y = c1 >= 97 ? c1 - 97 : c1 >= 65 ? c1 - 65 + 26 : -1;
  if (x < 0 || y < 0) return PASS;
  if (x >= size || y >= size) return PASS;
  // 老式 SGF 用 tt 表示停一手
  if (legacyPass && size <= 19 && x === 19 && y === 19) return PASS;
  return y * size + x;
}

export function pointToXY(i: number, size: number): [number, number] {
  return [i % size, Math.floor(i / size)];
}

/** 展开 SGF 的矩形缩写，如 AB[aa:cc] 展开成 9 个点。 */
export function expandRectValues(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v.includes(':')) {
      const [a, b] = v.split(':');
      if (a.length < 2 || b.length < 2) continue;
      const ax = a.charCodeAt(0) - 97;
      const ay = a.charCodeAt(1) - 97;
      const bx = b.charCodeAt(0) - 97;
      const by = b.charCodeAt(1) - 97;
      for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) {
        for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) out.push(toSgfPoint(x, y));
      }
    } else {
      out.push(v);
    }
  }
  return out;
}

export function unescapeValue(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\') {
      const nx = raw[i + 1];
      if (nx === undefined) break;
      // 反斜杠接换行属于软换行，忽略
      if (nx === '\n') {
        i += 1;
        continue;
      }
      if (nx === '\r') {
        i += raw[i + 2] === '\n' ? 2 : 1;
        continue;
      }
      out += nx;
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

export function escapeValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

/** 手数标签：0 停一手，其余按 sgf 坐标。 */
export function parseLabel(v: string): { point: string; text: string } {
  const ci = v.indexOf(':');
  if (ci < 0) return { point: v, text: '' };
  return { point: v.slice(0, ci), text: v.slice(ci + 1) };
}

/** 拼一条 LB 的值：坐标加冒号加文字。SGF 里没有冒号就是"标了位置但没文字"。 */
export function labelValue(point: string, text: string): string {
  return `${point}:${text}`;
}

/**
 * 摆字母时挑下一个字母：从 A 起找一个这手棋上还没用过的。
 *
 * 用"第一个空位"而不是"比现有的都往后一个"：删掉中间某个标记再摆回去时，
 * 补上那个空位比一路往后排更合手感（摆过 A、C，删掉 A 再摆还是 A）。
 * 26 个用完就回到 A，不去编双字母：盘上的标记越短越看得清。
 */
export function nextLabel(existing: string[]): string {
  const used = new Set(existing.map((v) => parseLabel(v).text).filter((t) => t.length === 1));
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i);
    if (!used.has(ch)) return ch;
  }
  return 'A';
}
