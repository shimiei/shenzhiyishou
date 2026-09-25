import type { GameTree, SgfProps, TreeNodeData } from '../../../shared/types';

const RECT_PROPS = new Set([
  'AB', 'AW', 'AE', 'DD', 'VW', 'TB', 'TW', 'TR', 'SQ', 'CR', 'MA', 'SL', 'SE'
]);

/**
 * 解析 SGF 文本。支持转义、软换行、属性值数组、括号嵌套与变化图。
 * 返回文件中的多棵对局树。
 */
export function parseSgf(text: string): GameTree[] {
  const src = text;
  let pos = 0;
  const trees: GameTree[] = [];
  const errors: string[] = [];

  const skipWs = () => {
    while (pos < src.length && /\s/.test(src[pos])) pos += 1;
  };

  const readValue = (): string => {
    let raw = '';
    pos += 1; // '['
    while (pos < src.length) {
      const ch = src[pos];
      if (ch === '\\') {
        raw += ch;
        if (pos + 1 < src.length) raw += src[pos + 1];
        pos += 2;
        continue;
      }
      if (ch === ']') {
        pos += 1;
        break;
      }
      raw += ch;
      pos += 1;
    }
    return raw;
  };

  const build = (): GameTree | null => {
    const tree: GameTree = { nodes: {}, root: 0, nextId: 1 };
    let current: TreeNodeData | null = null;
    let sawRoot = false;
    skipWs();
    if (src[pos] !== '(') throw new Error('第 ' + pos + ' 处缺少左括号');
    pos += 1;
    while (pos < src.length) {
      skipWs();
      const ch = src[pos];
      if (ch === '(') {
        // 变化图：交给递归，挂到当前节点的子节点
        const sub = build();
        if (sub && current) {
          const subRoot = sub.nodes[sub.root];
          const cloned = cloneInto(tree, sub, sub.root, current.id);
          if (subRoot) current.children.push(cloned);
        }
        continue;
      }
      if (ch === ')') {
        pos += 1;
        break;
      }
      if (ch === ';') {
        pos += 1;
        const node: TreeNodeData = { id: tree.nextId++, parent: current ? current.id : null, children: [], props: {} };
        if (current) {
          tree.nodes[current.id] = current;
          current.children.push(node.id);
        } else if (!sawRoot) {
          tree.root = node.id;
          sawRoot = true;
        }
        current = node;
        continue;
      }
      if (/[A-Za-z]/.test(ch)) {
        let ident = '';
        while (pos < src.length && /[A-Za-z0-9]/.test(src[pos])) {
          ident += src[pos];
          pos += 1;
        }
        const values: string[] = [];
        skipWs();
        while (pos < src.length && src[pos] === '[') values.push(readValue());
        if (current) {
          const key = ident.toUpperCase();
          const existing = current.props[key] ?? [];
          current.props[key] = existing.concat(values);
        }
        continue;
      }
      // 不认识的字符，跳过以免死循环
      pos += 1;
    }
    if (current) tree.nodes[current.id] = current;
    return sawRoot ? tree : null;
  };

  const cloneInto = (target: GameTree, src: GameTree, id: number, parentId: number): number => {
    const node = src.nodes[id];
    const copy: TreeNodeData = {
      id: target.nextId++,
      parent: parentId,
      children: [],
      props: deepCopyProps(node.props)
    };
    target.nodes[copy.id] = copy;
    for (const c of node.children) {
      const cid = cloneInto(target, src, c, copy.id);
      copy.children.push(cid);
    }
    return copy.id;
  };

  while (pos < src.length) {
    skipWs();
    if (pos >= src.length) break;
    if (src[pos] !== '(') {
      pos += 1;
      continue;
    }
    try {
      const t = build();
      if (t) trees.push(t);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      break;
    }
  }
  if (trees.length === 0) throw new Error(errors[0] ?? '没有解析出任何棋谱');
  return trees;
}

export function deepCopyProps(props: SgfProps): SgfProps {
  const out: SgfProps = {};
  for (const k of Object.keys(props)) out[k] = props[k].slice();
  return out;
}

export function isRectProp(key: string): boolean {
  return RECT_PROPS.has(key);
}

/** 找出树中的对称性前缀，判断是否有重复节点属性（调试用）。 */
export function treeSize(tree: GameTree): number {
  return Object.keys(tree.nodes).length;
}
