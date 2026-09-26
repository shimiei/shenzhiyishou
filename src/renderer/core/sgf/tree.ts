import {
  BLACK,
  EMPTY,
  PASS,
  WHITE,
  type GameInfo,
  type GameTree,
  type SgfProps,
  type TreeNodeData
} from '../../../shared/types';
import { Position } from '../go/position';
import { expandRectValues, fromSgfPoint, parseLabel, toSgfPoint } from './codec';

export type MarkType = 'triangle' | 'square' | 'circle' | 'cross' | 'dim' | 'label' | 'territoryB' | 'territoryW';

export interface Mark {
  x: number;
  y: number;
  type: MarkType;
  label?: string;
}

const MARK_KEYS: Array<[MarkType, string]> = [
  ['triangle', 'TR'],
  ['square', 'SQ'],
  ['circle', 'CR'],
  ['cross', 'MA'],
  ['dim', 'SL'],
  ['territoryB', 'TB'],
  ['territoryW', 'TW']
];

const positionCache = new WeakMap<GameTree, Map<number, Position>>();

export function starPoints(size: number): Array<[number, number]> {
  if (size === 19) {
    const pts: Array<[number, number]> = [];
    for (const y of [3, 9, 15]) for (const x of [3, 9, 15]) pts.push([x, y]);
    return pts;
  }
  if (size === 13) {
    return [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]];
  }
  return [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]];
}

export function handicapPoints(size: number, count: number): Array<[number, number]> {
  const edge = size >= 13 ? 3 : 2;
  const far = size - 1 - edge;
  const mid = (size - 1) / 2;
  const order: Array<[number, number]> = [
    [far, edge],
    [edge, far],
    [edge, edge],
    [far, far],
    [mid, mid],
    [far, mid],
    [mid, edge],
    [mid, far],
    [edge, mid]
  ];
  return order.slice(0, Math.max(0, Math.min(9, count)));
}

export function createTree(size: number, komi: number, handicap = 0, rules = 'Chinese', blackName = '', whiteName = ''): GameTree {
  const props: SgfProps = {
    GM: ['1'],
    FF: ['4'],
    CA: ['UTF-8'],
    AP: ['神之一手:1.0'],
    SZ: [String(size)],
    KM: [String(komi)],
    RU: [rules]
  };
  if (blackName) props.PB = [blackName];
  if (whiteName) props.PW = [whiteName];
  if (handicap > 1) {
    props.HA = [String(handicap)];
    props.AB = handicapPoints(size, handicap).map(([x, y]) => toSgfPoint(x, y));
  }
  const root: TreeNodeData = { id: 1, parent: null, children: [], props };
  return { nodes: { 1: root }, root: 1, nextId: 2 };
}

export function node(tree: GameTree, id: number): TreeNodeData | undefined {
  return tree.nodes[id];
}

export function firstProp(tree: GameTree, id: number, key: string): string | null {
  const v = tree.nodes[id]?.props[key];
  return v && v.length > 0 ? v[0] : null;
}

export function propNum(tree: GameTree, id: number, key: string, def: number): number {
  const v = firstProp(tree, id, key);
  if (v === null) return def;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

export function pathTo(tree: GameTree, id: number): number[] {
  const out: number[] = [];
  let cur: number | null = id;
  const guard = new Set<number>();
  while (cur !== null && tree.nodes[cur] && !guard.has(cur)) {
    guard.add(cur);
    out.unshift(cur);
    cur = tree.nodes[cur].parent;
  }
  return out;
}

/**
 * 从根走到这个节点的分支路径：每一层是"在父节点里排第几个孩子"，根是空数组。
 * 记会话时用它代替节点号：棋谱重新解析一遍，节点号会重新排，只有路径还认得路。
 */
export function pathOf(tree: GameTree, id: number): number[] {
  const ids = pathTo(tree, id);
  if (ids.length === 0 || ids[0] !== tree.root) return [];
  const out: number[] = [];
  for (let i = 1; i < ids.length; i++) {
    const parent = tree.nodes[ids[i - 1]];
    const idx = parent ? parent.children.indexOf(ids[i]) : -1;
    if (idx < 0) return out;
    out.push(idx);
  }
  return out;
}

/** pathOf 的反面。路径对不上（棋谱换过、分支被删）就停在能走到的那一层。 */
export function nodeAtPath(tree: GameTree, path: number[]): number {
  let cur = tree.root;
  for (const idx of path) {
    const next = tree.nodes[cur]?.children[idx];
    if (next === undefined) break;
    cur = next;
  }
  return cur;
}

/** 计算某个节点处的局面，带缓存。 */
export function positionAt(tree: GameTree, id: number): Position {
  let map = positionCache.get(tree);
  if (!map) {
    map = new Map();
    positionCache.set(tree, map);
  }
  const hit = map.get(id);
  if (hit) return hit;

  const path = pathTo(tree, id);
  const size = propNum(tree, tree.root, 'SZ', 19);
  const rootColor: 1 | 2 = (firstProp(tree, tree.root, 'PL') ?? 'B') === 'W' ? WHITE : BLACK;
  let pos = new Position(size, rootColor);
  for (const nid of path) {
    pos = applyNode(pos, tree.nodes[nid]);
    map.set(nid, pos);
  }
  return map.get(id) as Position;
}

function applyNode(pos: Position, n: TreeNodeData): Position {
  const p = pos.clone();
  const size = p.size;
  const setup: Array<{ color: 1 | 2; i: number }> = [];
  const ab = n.props.AB ? expandRectValues(n.props.AB) : [];
  const aw = n.props.AW ? expandRectValues(n.props.AW) : [];
  const ae = n.props.AE ? expandRectValues(n.props.AE) : [];
  for (const v of ab) {
    const i = fromSgfPoint(v, size);
    if (i !== PASS) setup.push({ color: BLACK, i });
  }
  for (const v of aw) {
    const i = fromSgfPoint(v, size);
    if (i !== PASS) setup.push({ color: WHITE, i });
  }
  if (setup.length > 0) p.setSetup(setup);
  for (const v of ae) {
    const i = fromSgfPoint(v, size);
    if (i !== PASS && i < p.cells.length) p.cells[i] = EMPTY;
  }
  if (n.props.PL && n.props.PL[0]) p.toPlay = n.props.PL[0].toUpperCase() === 'W' ? WHITE : BLACK;

  const move = moveAt(n, size);
  if (move) {
    const res = p.play(move.color, move.point);
    if (!res.ok) {
      // 棋谱里有非法手（例如让子局面下重复提子记录），强行落子以免整谱打不开
      p.cells[move.point >= 0 ? move.point : 0] = 0;
      if (move.point !== PASS) {
        p.cells[move.point] = move.color;
        for (const nb of p.neighbors(move.point)) {
          if (p.cells[nb] === (3 - move.color)) {
            const g = p.group(nb);
            if (g.liberties.length === 0) for (const st of g.stones) p.cells[st] = EMPTY;
          }
        }
      }
      p.toPlay = (3 - move.color) as 1 | 2;
      if (move.point !== PASS) p.moveNumber += 1;
    }
  }
  return p;
}

/**
 * 某节点处的落子颜色与坐标。size 必须给对：坐标是"行 × 棋盘宽"编出来的，
 * 写死一个宽度会让 19 路上的每一手都落到别的点上去。
 */
export function moveAt(n: TreeNodeData, size: number): { color: 1 | 2; point: number } | null {
  const b = n.props.B;
  const w = n.props.W;
  if (b && b.length > 0) return { color: BLACK, point: fromSgfPoint(b[0], size) };
  if (w && w.length > 0) return { color: WHITE, point: fromSgfPoint(w[0], size) };
  return null;
}

/** 某节点处的落子颜色与坐标，size 从棋谱的 SZ 里取。 */
export function moveAtSized(tree: GameTree, id: number): { color: 1 | 2; point: number } | null {
  const n = tree.nodes[id];
  if (!n) return null;
  return moveAt(n, propNum(tree, tree.root, 'SZ', 19));
}

export function moveNumberAt(tree: GameTree, id: number): number {
  let count = 0;
  for (const nid of pathTo(tree, id)) {
    if (tree.nodes[nid].props.B || tree.nodes[nid].props.W) count += 1;
  }
  return count;
}

export function colorToPlayAt(tree: GameTree, id: number): 1 | 2 {
  const path = pathTo(tree, id);
  let color: 1 | 2 | null = null;
  for (const nid of path) {
    const n = tree.nodes[nid];
    if (n.props.PL && n.props.PL[0]) color = n.props.PL[0].toUpperCase() === 'W' ? WHITE : BLACK;
    const mv = moveAtSized(tree, nid);
    if (mv) color = (3 - mv.color) as 1 | 2;
  }
  if (color === null) {
    const sz = propNum(tree, tree.root, 'SZ', 19);
    const ha = propNum(tree, tree.root, 'HA', 0);
    color = ha > 1 ? WHITE : BLACK;
    void sz;
  }
  return color;
}

/**
 * 这一手到底谁走：界面手动指定过就按指定的，否则按棋谱数。
 *
 * 手动指定只在这盘棋的界面里算数，不写进棋谱文件：棋谱该怎么记还怎么记，
 * 送出去给别人看的时候不会夹带一份"人为的轮次"。落子、提示、实时分析、
 * AI 走一手都从这里取颜色，四处才不会各说各话。
 */
export function turnWithOverride(tree: GameTree, id: number, override: 1 | 2 | null): 1 | 2 {
  return override ?? colorToPlayAt(tree, id);
}

/**
 * 走到这里是不是"双方连续停一手"，也就是对局到头的信号。
 * 摆子节点不算手数，所以只看路径末尾两手的实际落子；只有一手棋、或者末尾不是两手停，都不算。
 */
export function endedByDoublePass(tree: GameTree, id: number): boolean {
  const moves = pathTo(tree, id)
    .map((nid) => moveAtSized(tree, nid))
    .filter((m): m is { color: 1 | 2; point: number } => m !== null);
  if (moves.length < 2) return false;
  return moves[moves.length - 1].point === PASS && moves[moves.length - 2].point === PASS;
}

/** 盘面指纹，只认棋子，不认注释和标记。用来判断手里那条推荐还算不算数。 */
export function positionKey(tree: GameTree, id: number): string {
  const pos = positionAt(tree, id);
  return String(pos.size) + ':' + Array.from(pos.cells).join('');
}

/**
 * "现在轮到谁"能不能手改。有手数时轮次由手数决定（SGF 里也是这样，PL 会被手数盖掉），
 * 所以只有摆子局面（导入的图、自己摆的开局）能改。
 */
export function canSetTurn(tree: GameTree, id: number): { ok: boolean; reason?: string } {
  for (const nid of pathTo(tree, id)) {
    if (moveAtSized(tree, nid)) return { ok: false, reason: '这盘已经有手数了，轮次跟着手数走，改不了' };
  }
  return { ok: true };
}

/** 把轮次写进当前节点，之后 colorToPlayAt 与送引擎的局面都认这个。 */
export function setTurnAt(tree: GameTree, id: number, color: 1 | 2): GameTree {
  return setProp(tree, id, 'PL', [color === BLACK ? 'B' : 'W']);
}

export function marksAt(tree: GameTree, id: number): Mark[] {
  const n = tree.nodes[id];
  if (!n) return [];
  const size = propNum(tree, tree.root, 'SZ', 19);
  const marks: Mark[] = [];
  const seen = new Map<number, Mark>();
  for (const [type, key] of MARK_KEYS) {
    for (const v of expandRectValues(n.props[key] ?? [])) {
      const i = fromSgfPoint(v, size);
      if (i === PASS) continue;
      const m: Mark = { x: i % size, y: Math.floor(i / size), type };
      seen.set(i, m);
      marks.push(m);
    }
  }
  for (const v of n.props.LB ?? []) {
    const { point, text } = parseLabel(v);
    const i = fromSgfPoint(point, size);
    if (i === PASS) continue;
    const m: Mark = { x: i % size, y: Math.floor(i / size), type: 'label', label: text };
    seen.set(i, m);
    marks.push(m);
  }
  return marks;
}

// ---------- 不可变更新 ----------

export function updateNode(tree: GameTree, id: number, fn: (n: TreeNodeData) => TreeNodeData): GameTree {
  const target = tree.nodes[id];
  if (!target) return tree;
  const nodes = { ...tree.nodes };
  nodes[id] = fn(target);
  return { ...tree, nodes };
}

export function setProp(tree: GameTree, id: number, key: string, values: string[] | null): GameTree {
  return updateNode(tree, id, (n) => {
    const props = { ...n.props };
    if (values === null || values.length === 0) delete props[key];
    else props[key] = values.slice();
    return { ...n, props };
  });
}

export function addChild(tree: GameTree, parentId: number, props: SgfProps): { tree: GameTree; id: number } {
  const parent = tree.nodes[parentId];
  if (!parent) return { tree, id: parentId };
  const id = tree.nextId;
  const child: TreeNodeData = { id, parent: parentId, children: [], props };
  const nodes = { ...tree.nodes, [id]: child };
  nodes[parentId] = { ...parent, children: [...parent.children, id] };
  return { tree: { ...tree, nodes, nextId: id + 1 }, id };
}

export function addMoveNode(
  tree: GameTree,
  parentId: number,
  color: 1 | 2,
  point: number,
  opts: { mainLine?: boolean; source?: MoveSource } = {}
): { tree: GameTree; id: number } {
  const size = propNum(tree, tree.root, 'SZ', 19);
  const value = point === PASS ? '' : toSgfPoint(point % size, Math.floor(point / size));
  const key = color === BLACK ? 'B' : 'W';
  const props: SgfProps = { [key]: [value] };
  /*
   * 记下这一手是谁下的，左侧棋谱树上要标"人"还是"机"。
   * 用自定义属性而不是塞进注释：注释是给用户看的，功能性的标记混进去，
   * 用户一编辑注释就把它弄没了。别的工具读不懂这个属性也只会忽略，不影响棋谱本身。
   */
  if (opts.source) props[SOURCE_PROP] = [opts.source];
  const res = addChild(tree, parentId, props);
  if (opts.mainLine === false) return res;
  return { tree: promoteVariation(res.tree, res.id), id: res.id };
}

/**
 * 某一手是谁下的。存在自定义属性 SRC 上，取值 human 或 ai。
 * 没有这个属性就是不知道（导入的棋谱、摆子节点都算不知道），界面上不标。
 */
export type MoveSource = 'human' | 'ai';

export const SOURCE_PROP = 'SRC';

export function moveSourceOf(tree: GameTree, id: number): MoveSource | null {
  const v = tree.nodes[id]?.props[SOURCE_PROP]?.[0]?.toLowerCase();
  return v === 'human' || v === 'ai' ? v : null;
}

/** 把某个节点提到其父节点的第一个子节点，也就是主线位置。 */
export function promoteVariation(tree: GameTree, id: number): GameTree {
  const n = tree.nodes[id];
  if (!n || n.parent === null) return tree;
  const parent = tree.nodes[n.parent];
  if (!parent || parent.children[0] === id) return tree;
  const children = [id, ...parent.children.filter((c) => c !== id)];
  const nodes = { ...tree.nodes };
  nodes[parent.id] = { ...parent, children };
  return { ...tree, nodes };
}

/** 让从根到 id 的整条路径成为主线。 */
export function makeMainLine(tree: GameTree, id: number): GameTree {
  let out = tree;
  for (const nid of pathTo(tree, id)) {
    if (nid !== tree.root) out = promoteVariation(out, nid);
  }
  return out;
}

export function deleteSubtree(tree: GameTree, id: number): GameTree {
  if (id === tree.root) return tree;
  const n = tree.nodes[id];
  if (!n) return tree;
  const nodes = { ...tree.nodes };
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop() as number;
    const node = nodes[cur];
    if (!node) continue;
    stack.push(...node.children);
    delete nodes[cur];
  }
  if (n.parent !== null && nodes[n.parent]) {
    const p = nodes[n.parent];
    nodes[n.parent] = { ...p, children: p.children.filter((c) => c !== id) };
  }
  return { ...tree, nodes };
}

export function countNodes(tree: GameTree, id?: number): number {
  const start = id ?? tree.root;
  let total = 0;
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop() as number;
    const n = tree.nodes[cur];
    if (!n) continue;
    total += 1;
    stack.push(...n.children);
  }
  return total;
}

export function mainLineLength(tree: GameTree): number {
  let cur = tree.root;
  let len = 0;
  const guard = new Set<number>();
  while (cur !== undefined && !guard.has(cur)) {
    guard.add(cur);
    const n = tree.nodes[cur];
    if (!n) break;
    if (n.props.B || n.props.W) len += 1;
    cur = n.children[0];
  }
  return len;
}

/** 主线最后一个节点：从根开始每层都走第一个子节点。复盘和同步都按这条线走。 */
export function mainLineEnd(tree: GameTree): number {
  let cur = tree.root;
  const guard = new Set<number>();
  for (;;) {
    guard.add(cur);
    const kid = (tree.nodes[cur]?.children ?? []).filter((c) => tree.nodes[c] && !guard.has(c));
    if (kid.length === 0) return cur;
    cur = kid[0];
  }
}

/** 收集主线到某个节点为止的着法，用于引擎同步。 */
export function movesUpTo(tree: GameTree, id: number): Array<{ color: 1 | 2; point: number }> {
  const out: Array<{ color: 1 | 2; point: number }> = [];
  for (const nid of pathTo(tree, id)) {
    const mv = moveAtSized(tree, nid);
    if (mv) out.push(mv);
  }
  return out;
}

export function infoFromTree(tree: GameTree): GameInfo {
  const root = tree.nodes[tree.root];
  const g = (key: string, def = ''): string => (root.props[key]?.[0] ?? def);
  return {
    size: parseInt(g('SZ', '19'), 10) || 19,
    komi: parseFloat(g('KM', '7.5')),
    handicap: parseInt(g('HA', '0'), 10) || 0,
    rules: g('RU', 'Chinese'),
    blackName: g('PB'),
    whiteName: g('PW'),
    blackRank: g('BR'),
    whiteRank: g('WR'),
    result: g('RE'),
    date: g('DT'),
    event: g('EV'),
    place: g('PC'),
    comment: g('C'),
    gameName: g('GN')
  };
}

export function applyInfo(tree: GameTree, info: Partial<GameInfo>): GameTree {
  let out = tree;
  const set = (key: string, value: string | number | undefined): void => {
    if (value === undefined) return;
    out = setProp(out, out.root, key, value === '' ? null : [String(value)]);
  };
  if (info.size !== undefined) set('SZ', info.size);
  if (info.komi !== undefined) set('KM', info.komi);
  if (info.handicap !== undefined) set('HA', info.handicap > 1 ? info.handicap : '');
  if (info.rules !== undefined) set('RU', info.rules);
  if (info.blackName !== undefined) set('PB', info.blackName);
  if (info.whiteName !== undefined) set('PW', info.whiteName);
  if (info.blackRank !== undefined) set('BR', info.blackRank);
  if (info.whiteRank !== undefined) set('WR', info.whiteRank);
  if (info.result !== undefined) set('RE', info.result);
  if (info.date !== undefined) set('DT', info.date);
  if (info.event !== undefined) set('EV', info.event);
  if (info.place !== undefined) set('PC', info.place);
  if (info.gameName !== undefined) set('GN', info.gameName);
  if (info.comment !== undefined) out = setProp(out, out.root, 'C', info.comment === '' ? null : [info.comment]);
  return out;
}

/** 生成一个只有局面的棋谱树，用于从图片或截图导入。 */
export function treeFromPosition(
  size: number,
  komi: number,
  stones: number[],
  extra: Partial<GameInfo> = {}
): GameTree {
  let tree = createTree(size, komi, 0, extra.rules ?? 'Chinese', extra.blackName ?? '', extra.whiteName ?? '');
  const ab: string[] = [];
  const aw: string[] = [];
  for (let i = 0; i < stones.length; i++) {
    if (stones[i] === BLACK) ab.push(toSgfPoint(i % size, Math.floor(i / size)));
    else if (stones[i] === WHITE) aw.push(toSgfPoint(i % size, Math.floor(i / size)));
  }
  tree = setProp(tree, tree.root, 'AB', ab.length ? ab : null);
  tree = setProp(tree, tree.root, 'AW', aw.length ? aw : null);
  tree = applyInfo(tree, extra);
  return tree;
}
