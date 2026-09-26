import { BLACK, WHITE } from '../../shared/types';

/**
 * 把视觉大模型返回的正文读成棋盘。
 *
 * 模型嘴上说"只输出 19 行"，实际经常带一堆解释、代码块围栏、行首的行号。
 * 这里的规矩是：先把每行里不是 X/O/. 的字符剔掉，剩下长度刚好等于路数的才算一行；
 * 凑不够 size 行就当它没按规矩来，返回 null，由界面把原文摆出来给人看。
 * 不猜、不补空行，免得把模型的一段废话当成一张空盘。
 */
export function parseVisionGrid(content: string, size: number): number[] | null {
  if (!Number.isFinite(size) || size <= 0) return null;
  const rows = String(content ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/[^XO.]/gi, '').toUpperCase())
    .filter((line) => line.length === size);
  if (rows.length !== size) return null;
  const grid = new Array<number>(size * size).fill(0);
  rows.forEach((row, y) => {
    for (let x = 0; x < size; x++) {
      const c = row[x];
      grid[y * size + x] = c === 'X' ? BLACK : c === 'O' ? WHITE : 0;
    }
  });
  return grid;
}

/** 检查接口地址填得对不对时用得上：地址栏里常见的几种写法都提醒一下。 */
export function endpointHint(endpoint: string): string | null {
  const url = String(endpoint ?? '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return '接口地址要以 http:// 或 https:// 开头';
  if (!/chat\/completions/i.test(url)) return '接口地址应该是 OpenAI 兼容的 chat/completions 地址';
  return null;
}
