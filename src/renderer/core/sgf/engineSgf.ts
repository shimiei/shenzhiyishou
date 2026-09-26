import { BLACK, WHITE, type GameTree, type SgfProps } from '../../../shared/types';
import { Position } from '../go/position';
import { expandRectValues, toSgfPoint } from './codec';
import { SOURCE_PROP } from './tree';
import { deepCopyProps, parseSgf } from './parse';
import { writeProps } from './serialize';
import { pathTo, positionAt } from './tree';

const SETUP_KEYS = ['AB', 'AW', 'AE'];

export interface EngineSgf {
  sgf: string;
  /** 只发了局面（根节点列出每一颗子，不带手数）时为 true。 */
  positionOnly: boolean;
}

/**
 * 送去引擎的 SGF。
 *
 * KataGo 的 loadsgf 只认根节点上的摆子，第二个节点往后只要出现 AB/AW/AE 就整谱拒收
 * （"Found stone placements after the root"），而本程序允许把摆子写在任意节点上：
 * 摆子工具改的是当前节点，从图片导入到现有棋谱会另起一个只有摆子的节点。
 * 所以这里把整条路径上的摆子按先后顺序收拢进根节点，并把轮次写死成界面上的轮次
 * （根节点只有摆子、没有手数时，KataGo 按让子惯例算白走，和界面显示的黑走对不上）。
 * 挪完用自己的解析器验算一遍盘面，改动了就不算数，退回纯局面写法：根节点直接列出所有子。
 */
export function engineSgfFor(tree: GameTree, endId: number, turn: 'B' | 'W'): EngineSgf {
  const path = pathTo(tree, endId);
  if (path.length === 0) return { sgf: '', positionOnly: false };
  const laterSetup = path.slice(1).some((id) => hasSetup(tree.nodes[id]?.props));
  if (!laterSetup) return { sgf: mainLine(tree, path, turn), positionOnly: false };
  const hoisted = hoistSetup(tree, path, turn);
  // 验算这一步自己也别把整个提示弄挂：读不回来就当收拢失败，走纯局面
  try {
    if (hoisted) {
      const back = parseSgf(hoisted);
      const last = back.length > 0 ? mainLineEnd(back[0]) : -1;
      if (last >= 0 && sameBoard(positionAt(tree, endId), positionAt(back[0], last))) {
        return { sgf: hoisted, positionOnly: false };
      }
    }
  } catch (e) {
    void e;
  }
  return { sgf: positionOnlySgf(tree, endId, turn), positionOnly: true };
}

/** 快路径：摆子本来就在根节点，照抄主线，只补上轮次。 */
function mainLine(tree: GameTree, path: number[], turn: 'B' | 'W'): string {
  const rootId = path[0];
  const prefix = rootId === tree.root ? '' : ';';
  const chain = path
    .map((id) => {
      const props = deepCopyProps(tree.nodes[id]?.props ?? {});
      if (id === rootId) {
        const cleared = new Set(expandRectValues(props.AE ?? []));
        // 同一个点上 AB 和 AE 都写，KataGo 会当成非法盘面拒收；AE 本来就是清空，直接从 AB 去掉
        props.AB = (props.AB ?? []).filter((v) => !cleared.has(v));
        props.AW = (props.AW ?? []).filter((v) => !cleared.has(v));
        props.PL = [turn];
      } else {
        // 轮次只由根节点决定，中间节点里的 PL 留着只会跟引擎的理解打架
        delete props.PL;
      }
      /*
       * 自己加的那些属性（比如标记这一手是人还是机器下的）跟棋本身无关，
       * 送去引擎之前摘掉：引擎对不认识的属性一般是忽略，但没必要去赌它的脾气。
       */
      delete props[SOURCE_PROP];
      return ';' + writeProps(props);
    })
    .filter((text, i) => i === 0 || text !== ';')
    .join('');
  return '(' + prefix + chain + '\n)\n';
}

/** 把整条路径上的摆子收进根节点，后面的覆盖前面的；收不干净由调用方验算后放弃。 */
function hoistSetup(tree: GameTree, path: number[], turn: 'B' | 'W'): string | null {
  const rootId = path[0];
  const points: string[] = [];
  const color = new Map<string, 1 | 2 | null>();
  const put = (v: string, c: 1 | 2 | null): void => {
    if (!color.has(v)) points.push(v);
    color.set(v, c);
  };
  for (const id of path) {
    const props = tree.nodes[id]?.props;
    if (!props) continue;
    for (const v of expandRectValues(props.AB ?? [])) put(v, BLACK);
    for (const v of expandRectValues(props.AW ?? [])) put(v, WHITE);
    for (const v of expandRectValues(props.AE ?? [])) put(v, null);
  }
  const rootProps = deepCopyProps(tree.nodes[rootId]?.props ?? {});
  rootProps.AB = points.filter((v) => color.get(v) === BLACK);
  rootProps.AW = points.filter((v) => color.get(v) === WHITE);
  delete rootProps.AE;
  delete rootProps[SOURCE_PROP];
  rootProps.PL = [turn];
  const prefix = rootId === tree.root ? '' : ';';
  const chain = path
    .map((id) => {
      if (id === rootId) return ';' + writeProps(rootProps);
      const props = deepCopyProps(tree.nodes[id]?.props ?? {});
      delete props.AB;
      delete props.AW;
      delete props.AE;
      delete props.PL;
      delete props[SOURCE_PROP];
      return ';' + writeProps(props);
    })
    .filter((text, i) => i === 0 || text !== ';')
    .join('');
  return '(' + prefix + chain + '\n)\n';
}

/** 兜底：只发当前局面，根节点列出每一颗子。丢掉手数，也就丢掉了打劫禁着那点信息。 */
function positionOnlySgf(tree: GameTree, endId: number, turn: 'B' | 'W'): string {
  const pos = positionAt(tree, endId);
  const size = pos.size;
  const ab: string[] = [];
  const aw: string[] = [];
  for (let i = 0; i < pos.cells.length; i++) {
    if (pos.cells[i] === BLACK) ab.push(toSgfPoint(i % size, Math.floor(i / size)));
    else if (pos.cells[i] === WHITE) aw.push(toSgfPoint(i % size, Math.floor(i / size)));
  }
  const props = deepCopyProps(tree.nodes[tree.root]?.props ?? {});
  for (const key of ['AB', 'AW', 'AE', 'HA', 'PL', 'B', 'W', SOURCE_PROP]) delete props[key];
  props.SZ = [String(size)];
  if (ab.length > 0) props.AB = ab;
  if (aw.length > 0) props.AW = aw;
  props.PL = [turn];
  return '(;' + writeProps(props) + '\n)\n';
}

function hasSetup(props: SgfProps | undefined): boolean {
  if (!props) return false;
  return SETUP_KEYS.some((k) => (props[k] ?? []).length > 0);
}

function mainLineEnd(tree: GameTree): number {
  let cur = tree.root;
  for (;;) {
    const next = tree.nodes[cur]?.children.filter((c) => tree.nodes[c]);
    if (!next || next.length === 0) return cur;
    cur = next[0];
  }
}

function sameBoard(a: Position, b: Position): boolean {
  if (a.size !== b.size || a.cells.length !== b.cells.length) return false;
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false;
  return true;
}
