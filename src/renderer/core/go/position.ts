import { BLACK, EMPTY, PASS, WHITE, type Stone } from '../../../shared/types';

export interface GroupInfo {
  stones: number[];
  liberties: number[];
  color: Stone;
}

export interface PlayResult {
  ok: boolean;
  reason?: string;
  captured: number[];
  koPoint: number;
}

export type GoRuleSet = 'chinese' | 'japanese';

export interface ScoreResult {
  black: number;
  white: number;
  territoryBlack: number;
  territoryWhite: number;
  stonesBlack: number;
  stonesWhite: number;
  capturesBlack: number;
  capturesWhite: number;
  dame: number;
  /** 正数代表黑领先。 */
  lead: number;
}

/** 19 路棋盘规则实现：提子、自杀禁手、劫、位置超级劫、数子。 */
export class Position {
  readonly size: number;
  cells: Int8Array;
  toPlay: 1 | 2;
  koPoint: number;
  moveNumber: number;
  capturesByBlack: number;
  capturesByWhite: number;
  private seen: Set<string>;

  constructor(size: number, toPlay: 1 | 2 = BLACK) {
    this.size = size;
    this.cells = new Int8Array(size * size);
    this.toPlay = toPlay;
    this.koPoint = -1;
    this.moveNumber = 0;
    this.capturesByBlack = 0;
    this.capturesByWhite = 0;
    this.seen = new Set();
    this.seen.add(this.hash());
  }

  clone(): Position {
    const p = Object.create(Position.prototype) as Position;
    Object.assign(p, {
      size: this.size,
      cells: this.cells.slice(),
      toPlay: this.toPlay,
      koPoint: this.koPoint,
      moveNumber: this.moveNumber,
      capturesByBlack: this.capturesByBlack,
      capturesByWhite: this.capturesByWhite,
      seen: new Set(this.seen)
    });
    return p;
  }

  idx(x: number, y: number): number {
    return y * this.size + x;
  }

  xy(i: number): [number, number] {
    return [i % this.size, Math.floor(i / this.size)];
  }

  at(x: number, y: number): Stone {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return EMPTY;
    return this.cells[y * this.size + x] as Stone;
  }

  neighbors(i: number): number[] {
    const s = this.size;
    const x = i % s;
    const y = (i / s) | 0;
    const out: number[] = [];
    if (x > 0) out.push(i - 1);
    if (x < s - 1) out.push(i + 1);
    if (y > 0) out.push(i - s);
    if (y < s - 1) out.push(i + s);
    return out;
  }

  group(i: number): GroupInfo {
    const color = this.cells[i] as Stone;
    const stones = [i];
    const libs = new Set<number>();
    const seen = new Set<number>([i]);
    const stack = [i];
    while (stack.length) {
      const cur = stack.pop() as number;
      for (const n of this.neighbors(cur)) {
        const v = this.cells[n] as Stone;
        if (v === EMPTY) libs.add(n);
        else if (v === color && !seen.has(n)) {
          seen.add(n);
          stones.push(n);
          stack.push(n);
        }
      }
    }
    return { stones, liberties: [...libs], color };
  }

  /**
   * 只按棋子分布做键，不带轮次，也就是位置超级劫，与 KataGo 默认的
   * koRule = POSITIONAL 一致。带上轮次看着更严，实际方向是错的：
   * 同一局面轮到不同人时会被判成"重复"，程序就会拒绝一手引擎认为合法的棋。
   */
  hash(): string {
    let s = '';
    for (let i = 0; i < this.cells.length; i++) s += String.fromCharCode(48 + this.cells[i]);
    return s;
  }

  /** 试下一手，返回是否合法以及会造成的结果，不改变自身状态。 */
  check(color: 1 | 2, i: number): PlayResult {
    const s = this.size;
    if (i !== PASS) {
      if (i < 0 || i >= s * s) return { ok: false, reason: '越界', captured: [], koPoint: -1 };
      if (this.cells[i] !== EMPTY) return { ok: false, reason: '该点已有子', captured: [], koPoint: -1 };
      if (i === this.koPoint) return { ok: false, reason: '打劫，不能立即提回', captured: [], koPoint: -1 };
    }
    const trial = this.clone();
    const captured = trial.applyMove(color, i);
    // 自杀要看落子自己那一口气，不能看 cells[i] 还在不在：applyMove 只搬掉对方的死子，
    // 自己这块哪怕一口气不剩也会留在盘上，"格子上有没有子"永远为真，等于没检查。
    if (i !== PASS && trial.group(i).liberties.length === 0) {
      return { ok: false, reason: '自杀手', captured: [], koPoint: -1 };
    }
    // 弃着永远合法，而且不进历史。不特判的话，空盘上连着两次弃着就会
    // 撞上"空盘"这个已经见过的局面，收官时那两手弃着根本下不出去。
    if (i !== PASS && trial.seen.has(trial.hash())) {
      return { ok: false, reason: '违反超级劫（重复局面）', captured: [], koPoint: -1 };
    }
    return { ok: true, captured, koPoint: trial.koPoint };
  }

  isLegal(color: 1 | 2, i: number): boolean {
    return this.check(color, i).ok;
  }

  legalMoves(color: 1 | 2): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.size * this.size; i++) {
      if (this.cells[i] === EMPTY && this.check(color, i).ok) out.push(i);
    }
    return out;
  }

  /** 直接落子，不做合法性检查。返回被提子列表。 */
  private applyMove(color: 1 | 2, i: number): number[] {
    const captured: number[] = [];
    if (i !== PASS) {
      this.cells[i] = color;
      const opp = (3 - color) as 1 | 2;
      for (const n of this.neighbors(i)) {
        if (this.cells[n] === opp) {
          const g = this.group(n);
          if (g.liberties.length === 0) {
            for (const st of g.stones) {
              this.cells[st] = EMPTY;
              captured.push(st);
            }
          }
        }
      }
    }
    if (color === BLACK) this.capturesByBlack += captured.length;
    else this.capturesByWhite += captured.length;

    this.koPoint = -1;
    if (i !== PASS && captured.length === 1) {
      const g = this.group(i);
      if (g.stones.length === 1 && g.liberties.length === 1) this.koPoint = g.liberties[0];
    }
    this.toPlay = (3 - color) as 1 | 2;
    if (i !== PASS) this.moveNumber += 1;
    return captured;
  }

  play(color: 1 | 2, i: number): PlayResult {
    const res = this.check(color, i);
    if (!res.ok) return res;
    const captured = this.applyMove(color, i);
    // 只有真正落在盘上的局面才进历史。记录放进 applyMove 里会出事：
    // check() 是在副本上试下的，那个试下的局面会被副本自己记进 seen，
    // 紧接着的查重必然命中，于是每一手都判成"重复局面"，一手也下不出去。
    // 弃着也不进：空盘连着两次弃着会撞上"空盘"这个已经见过的局面。
    if (i !== PASS) this.seen.add(this.hash());
    return { ok: true, captured, koPoint: this.koPoint };
  }

  /** 落子并返回新对象，用于不可变更新。 */
  played(color: 1 | 2, i: number): Position {
    const p = this.clone();
    p.play(color, i);
    return p;
  }

  setSetup(list: Array<{ color: 1 | 2; i: number }>, clear = false): void {
    if (clear) this.cells.fill(EMPTY);
    for (const s of list) if (s.i >= 0 && s.i < this.cells.length) this.cells[s.i] = s.color;
    this.seen.add(this.hash());
  }

  /** 中国规则数子，死子由调用方指定。 */
  score(dead: Set<number> = new Set(), rules: GoRuleSet = 'chinese', komi = 7.5): ScoreResult {
    const work = this.cells.slice();
    for (const d of dead) work[d] = EMPTY;

    let stonesBlack = 0;
    let stonesWhite = 0;
    for (let i = 0; i < work.length; i++) {
      if (work[i] === BLACK) stonesBlack++;
      else if (work[i] === WHITE) stonesWhite++;
    }

    const visited = new Uint8Array(work.length);
    let territoryBlack = 0;
    let territoryWhite = 0;
    let dame = 0;
    for (let i = 0; i < work.length; i++) {
      if (work[i] !== EMPTY || visited[i]) continue;
      const region: number[] = [i];
      const stack = [i];
      visited[i] = 1;
      let touchB = false;
      let touchW = false;
      while (stack.length) {
        const cur = stack.pop() as number;
        for (const n of this.neighbors(cur)) {
          const v = work[n];
          if (v === EMPTY && !visited[n]) {
            visited[n] = 1;
            region.push(n);
            stack.push(n);
          } else if (v === BLACK) touchB = true;
          else if (v === WHITE) touchW = true;
        }
      }
      if (touchB && !touchW) territoryBlack += region.length;
      else if (touchW && !touchB) territoryWhite += region.length;
      else dame += region.length;
    }

    let black: number;
    let white: number;
    if (rules === 'chinese') {
      black = stonesBlack + territoryBlack;
      white = stonesWhite + territoryWhite + komi;
    } else {
      black = territoryBlack + this.capturesByBlack;
      white = territoryWhite + this.capturesByWhite + komi;
    }
    return {
      black,
      white,
      territoryBlack,
      territoryWhite,
      stonesBlack,
      stonesWhite,
      capturesBlack: this.capturesByBlack,
      capturesWhite: this.capturesByWhite,
      dame,
      lead: black - white
    };
  }

  /** 导出成 GTP 需要的着法列表，配合 kata-set-position 使用。 */
  static gtpVertex(i: number, size: number): string {
    if (i === PASS) return 'pass';
    const letters = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
    const x = i % size;
    const y = Math.floor(i / size);
    return letters[x] + String(size - y);
  }

  static parseVertex(v: string, size: number): number {
    const t = v.trim();
    if (!t || /^pass$/i.test(t) || /^tt$/i.test(t)) return PASS;
    const letters = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
    const x = letters.indexOf(t[0].toUpperCase());
    const num = parseInt(t.slice(1), 10);
    if (x < 0 || Number.isNaN(num)) return PASS;
    const y = size - num;
    if (y < 0 || y >= size || x >= size) return PASS;
    return y * size + x;
  }
}
