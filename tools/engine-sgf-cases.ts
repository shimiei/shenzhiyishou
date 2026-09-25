/**
 * 造出一批"送去引擎的局面"，交由 tools/engine-sgf-check.mjs 逐条喂给真 KataGo。
 * 这里只产数据，判断留给那个脚本（它会比对引擎的盘面和行棋方）。
 * 输出 JSON 到 stdout。
 */
import { BLACK, WHITE, type GameTree } from '../src/shared/types';
import { engineSgfFor } from '../src/renderer/core/sgf/engineSgf';
import { addChild, addMoveNode, colorToPlayAt, createTree, positionAt, setProp } from '../src/renderer/core/sgf/tree';

interface Case {
  name: string;
  sgf: string;
  turn: 'B' | 'W';
  /** 19 行，每行 19 个字符：X 黑，O 白，. 空。 */
  board: string[];
}

const blank = (): GameTree => createTree(19, 7.5, 0, 'Chinese');

function boardRows(tree: GameTree, id: number): string[] {
  const p = positionAt(tree, id);
  const rows: string[] = [];
  for (let y = 0; y < p.size; y++) {
    let row = '';
    for (let x = 0; x < p.size; x++) {
      const c = p.cells[y * p.size + x];
      row += c === BLACK ? 'X' : c === WHITE ? 'O' : '.';
    }
    rows.push(row);
  }
  return rows;
}

function record(name: string, tree: GameTree, id: number): Case {
  const turn: 'B' | 'W' = colorToPlayAt(tree, id) === BLACK ? 'B' : 'W';
  return { name, sgf: engineSgfFor(tree, id, turn).sgf, turn, board: boardRows(tree, id) };
}

const cases: Case[] = [];

// 空谱
{
  const t = blank();
  cases.push(record('空谱（新开的棋谱）', t, t.root));
}

// 用户那盘棋：从图片导入到当前棋谱，摆子落在第二个节点上
{
  const r = addChild(blank(), 1, {
    AB: ['dd', 'pp', 'jj'],
    AW: ['dp', 'pd', 'qq']
  });
  cases.push(record('导入图片到当前棋谱（摆子在第二个节点）', r.tree, r.id));
}

// 摆子写在根节点（导入时选"新建棋谱"）
{
  let t = blank();
  t = setProp(t, t.root, 'AB', ['dd', 'pp', 'jj']);
  t = setProp(t, t.root, 'AW', ['dp', 'pd', 'qq']);
  cases.push(record('摆子都在根节点', t, t.root));
}

// 普通对局
{
  let t = blank();
  let id = t.root;
  for (const [color, x, y] of [
    [BLACK, 15, 3],
    [WHITE, 3, 15],
    [BLACK, 15, 15],
    [WHITE, 3, 3],
    [BLACK, 15, 6],
    [WHITE, 2, 3]
  ] as Array<[1 | 2, number, number]>) {
    const r = addMoveNode(t, id, color, y * 19 + x);
    t = r.tree;
    id = r.id;
  }
  cases.push(record('普通对局六手（根节点没有摆子）', t, id));
}

// 手数之后再摆子
{
  const m1 = addMoveNode(blank(), 1, BLACK, 3 * 19 + 15);
  const m2 = addMoveNode(m1.tree, m1.id, WHITE, 15 * 19 + 3);
  const s = addChild(m2.tree, m2.id, { AB: ['qq'], AW: ['cc'] });
  cases.push(record('两手之后再摆子', s.tree, s.id));
}

// 摆子和手数写在同一个节点上
{
  const m1 = addMoveNode(blank(), 1, BLACK, 3 * 19 + 15);
  const t = setProp(m1.tree, m1.id, 'AW', ['pp']);
  cases.push(record('同一节点上手数加摆子', t, m1.id));
}

// 收不干净的：AE 提掉的是前面某一手下的子，只能发纯局面
{
  const m1 = addMoveNode(blank(), 1, BLACK, 3 * 19 + 15);
  const clear = addChild(m1.tree, m1.id, { AE: ['pd'] });
  cases.push(record('AE 提掉前面某一手的子（退化成纯局面）', clear.tree, clear.id));
}

// 让子谱
{
  const t = createTree(19, 0.5, 4, 'Chinese');
  cases.push(record('让四子（根节点摆子，轮白）', t, t.root));
}

// 提子之后接着下：引擎得跟着同一盘棋
{
  let t = blank();
  let id = t.root;
  // 白子(3,4) 被黑 (3,3)(3,5)(4,4) 围住，黑下 (2,4) 提子
  const seq: Array<[1 | 2, number, number]> = [
    [BLACK, 3, 3],
    [WHITE, 3, 4],
    [BLACK, 3, 5],
    [WHITE, 15, 15],
    [BLACK, 4, 4],
    [WHITE, 15, 3],
    [BLACK, 2, 4],
    [WHITE, 16, 16],
    [BLACK, 4, 3],
    [WHITE, 15, 4],
    [BLACK, 4, 2],
    [WHITE, 16, 15]
  ];
  for (const [color, x, y] of seq) {
    const r = addMoveNode(t, id, color, y * 19 + x);
    t = r.tree;
    id = r.id;
  }
  cases.push(record('一串手数（中间提掉一子）', t, id));
}

console.log(JSON.stringify(cases));
