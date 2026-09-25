import type { GameTree, SgfProps, TreeNodeData } from '../../../shared/types';
import { escapeValue } from './codec';

const ORDER = [
  'GM', 'FF', 'CA', 'AP', 'ST', 'SZ', 'RU', 'KM', 'HA', 'TM', 'OT',
  'PB', 'BR', 'PW', 'WR', 'DT', 'EV', 'RO', 'PC', 'GN', 'ON', 'RE', 'US', 'SO', 'CP', 'AN', 'C'
];

const MOVE_KEYS = new Set(['B', 'W']);

function propOrder(a: string, b: string): number {
  const ia = ORDER.indexOf(a);
  const ib = ORDER.indexOf(b);
  if (MOVE_KEYS.has(a) && !MOVE_KEYS.has(b)) return -1;
  if (MOVE_KEYS.has(b) && !MOVE_KEYS.has(a)) return 1;
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function writeProps(props: SgfProps): string {
  const keys = Object.keys(props).filter((k) => props[k] && props[k].length > 0);
  keys.sort(propOrder);
  let out = '';
  for (const k of keys) {
    for (const v of props[k]) out += k + '[' + escapeValue(v) + ']';
  }
  return out;
}

function writeNode(tree: GameTree, id: number): string {
  const node = tree.nodes[id];
  if (!node) return '';
  let out = ';' + writeProps(node.props);
  const kids = node.children.filter((c) => tree.nodes[c]);
  if (kids.length === 0) return out;
  if (kids.length === 1) return out + writeNode(tree, kids[0]);
  for (const c of kids) out += '(' + writeNode(tree, c) + ')';
  return out;
}

export function serializeSgf(tree: GameTree): string {
  const body = writeNode(tree, tree.root);
  return '(' + body + '\n)\n';
}

/** 只序列化到某个节点为止的主线，用于导出当前对局。 */
export function serializeMainLineTo(tree: GameTree, endId: number): string {
  const path: number[] = [];
  let cur: number | null = endId;
  while (cur !== null) {
    path.unshift(cur);
    cur = tree.nodes[cur]?.parent ?? null;
  }
  let prefix = '';
  if (path[0] !== tree.root) prefix = ';';
  const chain = path.map((id) => ';' + writeProps(tree.nodes[id]?.props ?? {})).join('');
  return '(' + prefix + chain + '\n)\n';
}

export function cloneTree(tree: GameTree): GameTree {
  const nodes: Record<number, TreeNodeData> = {};
  for (const k of Object.keys(tree.nodes)) {
    const n = tree.nodes[Number(k)];
    const props: SgfProps = {};
    for (const pk of Object.keys(n.props)) props[pk] = n.props[pk].slice();
    nodes[n.id] = { id: n.id, parent: n.parent, children: n.children.slice(), props };
  }
  return { nodes, root: tree.root, nextId: tree.nextId };
}
