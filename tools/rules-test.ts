/**
 * 规则引擎自测。棋盘规则是这程序最容易悄悄坏掉的地方：
 * 类型检查看不出"每一手都判违规"这种事，只有真下几手才知道。
 * 由 tools/rules-selftest.mjs 用 esbuild 打包后运行。
 */
import { BLACK, PASS, WHITE } from '../src/shared/types';
import { Position } from '../src/renderer/core/go/position';
import { parseSgf } from '../src/renderer/core/sgf/parse';
import { serializeSgf } from '../src/renderer/core/sgf/serialize';
import { addMoveNode, createTree, moveAtSized, positionAt } from '../src/renderer/core/sgf/tree';

let failed = 0;
let passed = 0;

function ok(cond: boolean, name: string, extra?: unknown): void {
  if (cond) {
    passed++;
    console.log('  ok   ' + name);
  } else {
    failed++;
    console.log('  失败 ' + name + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra)));
  }
}

function eq(actual: unknown, expected: unknown, name: string): void {
  ok(actual === expected, name, { 实际: actual, 期望: expected });
}

function section(title: string): void {
  console.log('\n' + title);
}

/** 按图摆盘：. 空，X 黑，O 白。第一行是最上面一行。 */
function board(rows: string[], toPlay: 1 | 2 = BLACK): Position {
  const size = rows[0].replace(/\s/g, '').length;
  const p = new Position(size, toPlay);
  const stones: Array<{ color: 1 | 2; i: number }> = [];
  rows.forEach((row, y) => {
    row.replace(/\s/g, '').split('').forEach((ch, x) => {
      if (ch === 'X') stones.push({ color: BLACK, i: y * size + x });
      else if (ch === 'O') stones.push({ color: WHITE, i: y * size + x });
    });
  });
  p.setSetup(stones, true);
  return p;
}

function at(p: Position, x: number, y: number): number {
  return y * p.size + x;
}

// ── 落子 ────────────────────────────────────────────────────────────────
section('落子');
{
  const p = new Position(19);
  const r = p.play(BLACK, at(p, 3, 3));
  ok(r.ok, '空盘第一手合法（回归：曾经每一手都被判"违反超级劫"）', r.reason);
  eq(p.cells[at(p, 3, 3)], BLACK, '棋子真的落在盘上了');
  eq(p.moveNumber, 1, '步数加一');
  eq(p.toPlay, WHITE, '轮次交给对方');

  const empty = new Position(19);
  eq(empty.legalMoves(BLACK).length, 361, '空盘黑方有 361 个合法点');

  const seq = new Position(19);
  const opening = [
    [15, 3], [3, 15], [15, 15], [3, 3], [16, 2], [2, 16], [16, 16], [2, 2], [15, 5], [5, 15]
  ];
  let allOk = true;
  let reason = '';
  opening.forEach(([x, y], n) => {
    const color = n % 2 === 0 ? BLACK : WHITE;
    const res = seq.play(color as 1 | 2, at(seq, x, y));
    if (!res.ok) {
      allOk = false;
      reason = `第 ${n + 1} 手 ${x},${y} 被拒：${res.reason}`;
    }
  });
  ok(allOk, '十手普通开局全部合法', reason);
  eq(seq.moveNumber, 10, '十手之后步数是 10');
}

// ── 提子与自杀 ──────────────────────────────────────────────────────────
section('提子与自杀');
{
  const p = board([
    '. X .',
    'X O .',
    '. X .'
  ]);
  const r = p.play(BLACK, at(p, 2, 1));
  ok(r.ok, '围住对方单子的一手合法', r.reason);
  eq(r.captured.length, 1, '提掉一子');
  eq(p.cells[at(p, 1, 1)], 0, '被提的交叉点空了');
  eq(p.capturesByBlack, 1, '黑方提子数加一');

  const jp = p.score(new Set(), 'japanese', 0);
  eq(jp.capturesBlack, 1, '日本规则：提子数计入黑方');
  eq(jp.black, 6, '日本规则：黑 = 5 目空 + 1 提子');
  eq(p.score(new Set(), 'chinese', 0).black, 9, '中国规则：黑 = 4 子 + 5 空（含被提的那一点，提子不另算）');

  const q = board(
    [
      'X X X .',
      'X . X .',
      'X X X .',
      '. . . .'
    ],
    WHITE
  );
  const before = q.cells.slice();
  const suicide = q.play(WHITE, at(q, 1, 1));
  ok(!suicide.ok && suicide.reason === '自杀手', '被围的眼里填子（自杀）被拒', suicide.reason);
  ok(before.every((v, i) => q.cells[i] === v), '拒绝之后棋盘没被改动');
  eq(q.toPlay, WHITE, '拒绝之后还是白方落子');
  eq(q.moveNumber, 0, '拒绝之后步数没涨（摆盘本来就不算步数）');
  eq(q.koPoint, -1, '拒绝之后劫点没被写坏');

  const filled = board(['X . .', '. . .', '. . .'], BLACK);
  const dup = filled.play(BLACK, at(filled, 0, 0));
  ok(!dup.ok && dup.reason === '该点已有子', '已经落子的点不能再下', dup.reason);

  const off = filled.play(BLACK, filled.size * filled.size + 5);
  ok(!off.ok && off.reason === '越界', '越界的点被拒', off.reason);
}

// ── 劫 ──────────────────────────────────────────────────────────────────
section('劫');
{
  const rows = [
    '. . X . .',
    '. X O X .',
    '. O . O .',
    '. . O . .',
    '. . . . .'
  ];
  const p = board(rows);
  const cap = p.play(BLACK, at(p, 2, 2));
  ok(cap.ok, '提劫的那一手合法', cap.reason);
  eq(cap.captured.length, 1, '提劫提掉一子');
  eq(p.koPoint, at(p, 2, 1), '劫点记在刚被提的那一点上');

  const back = p.play(WHITE, at(p, 2, 1));
  ok(!back.ok && /劫/.test(back.reason ?? ''), '不能立即提回（打劫）', back.reason);

  ok(p.play(WHITE, at(p, 4, 4)).ok, '他处落子合法');
  ok(p.play(BLACK, at(p, 4, 3)).ok, '对方应一手合法');
  eq(p.koPoint, -1, '不涉及提子的一手之后劫点清空');
  const retake = p.play(WHITE, at(p, 2, 1));
  ok(retake.ok, '交换两手之后可以提回', retake.reason);
  eq(retake.captured.length, 1, '提回时提掉一子');
}

// ── 超级劫 ──────────────────────────────────────────────────────────────
section('超级劫');
{
  const p = new Position(9);
  ok(p.play(BLACK, PASS).ok, '第一手 pass 合法');
  ok(p.play(WHITE, PASS).ok, '第二手 pass 合法');
  ok(p.play(BLACK, PASS).ok, '第三手 pass 合法（pass 不该被当成重复局面）');
  eq(p.moveNumber, 0, 'pass 不涨步数');

  // 伸手进私有历史里塞一个"未来"的局面：真实对局中要让整盘棋回到同一局面需要双劫循环，
  // 构造那个局面的成本比这条断言本身还高。这里只验证判定逻辑还在，
  // 免得修上面那个"全都判违规"的 bug 时把判负逻辑一起删了。
  const q = new Position(9);
  const target = q.clone();
  target.play(BLACK, at(target, 4, 4));
  (q as unknown as { seen: Set<string> }).seen.add(target.hash());
  const r = q.check(BLACK, at(q, 4, 4));
  ok(!r.ok && /超级劫/.test(r.reason ?? ''), '结局局面已经出现过时，判违反超级劫', r.reason);

  const fresh = new Position(9);
  ok(fresh.check(BLACK, at(fresh, 4, 4)).ok, '没出现过的局面照常允许');
}

// ── 数子 ────────────────────────────────────────────────────────────────
section('数子');
{
  const solid = board([
    'X X X . .',
    'X X X . .',
    'X X X . .',
    '. . . . .',
    '. . . . .'
  ]);
  const cn = solid.score(new Set(), 'chinese', 0);
  eq(cn.stonesBlack, 9, '中国规则：黑子 9');
  eq(cn.territoryBlack, 16, '中国规则：其余 16 个空点只挨着黑，全算黑空');
  eq(cn.black, 25, '中国规则：黑 25');
  eq(cn.white, 0, '中国规则：白 0（贴目设为 0）');
  eq(cn.lead, 25, '中国规则：黑领先 25');

  const withKomi = solid.score(new Set(), 'chinese', 7.5);
  eq(withKomi.lead, 17.5, '贴 7.5 目之后黑领先 17.5');

  const intruder = board([
    'X X X . .',
    'X X X O .',
    'X X X . .',
    '. . . . .',
    '. . . . .'
  ]);
  const alive = intruder.score(new Set(), 'chinese', 0);
  eq(alive.territoryBlack, 0, '活白子把空撑成单官，黑没有空');
  eq(alive.dame, 15, '单官 15 点');
  eq(alive.black, 9, '活白子在场时黑只有 9 个子');
  const dead = intruder.score(new Set([at(intruder, 3, 1)]), 'chinese', 0);
  eq(dead.stonesWhite, 0, '标成死子后白子不计');
  eq(dead.territoryBlack, 16, '死子点归入黑空');
  eq(dead.black, 25, '标死子后黑 25，与没有入侵者时一致');
}

// ── 坐标 ────────────────────────────────────────────────────────────────
section('坐标换算');
{
  const size = 19;
  const cases: Array<[string, number, number]> = [
    ['A19', 0, 0],
    ['T1', 18, 18],
    ['Q16', 15, 3],
    ['D4', 3, 15]
  ];
  for (const [v, x, y] of cases) {
    const i = Position.parseVertex(v, size);
    eq(i, y * size + x, `${v} 解析成 (${x},${y})`);
    eq(Position.gtpVertex(i, size), v, `(${x},${y}) 还原成 ${v}`);
  }
  eq(Position.parseVertex('pass', size), PASS, 'pass 解析成 PASS');
  eq(Position.parseVertex('tt', size), PASS, 'tt 解析成 PASS（老引擎的弃着写法）');
  eq(Position.parseVertex('A20', size), PASS, '越界坐标退化成 PASS');
}

// ── 棋谱到棋盘 ──────────────────────────────────────────────────────────
section('棋谱到棋盘：手数坐标');
{
  // 这一段是回归测试。positionAt 曾经把 B[dd] 这样的坐标按"行 × 52"解开（52 是内部旧写法的棋盘宽度），
  // 于是点上去的子会跑到别的交叉点，靠下半盘的子干脆消失。落子、提子、数子全跟着错，
  // 而类型检查和当时的自测都看不出问题。
  const t = createTree(19, 7.5, 0, 'Chinese');
  const one = addMoveNode(t, t.root, BLACK, at(new Position(19), 3, 3));
  eq(one.id, 2, '第一手挂在根节点下面');
  const p1 = positionAt(one.tree, one.id);
  eq(p1.cells[at(p1, 3, 3)], BLACK, 'B[dd] 摆在左上角星位，不是别的点');
  eq(p1.moveNumber, 1, '手数记上了');
  eq(p1.toPlay, WHITE, '轮到白');

  // 下半盘的子曾经因为解出来的下标超出棋盘而被悄悄丢掉
  const two = addMoveNode(one.tree, one.id, WHITE, at(p1, 15, 15));
  const p2 = positionAt(two.tree, two.id);
  eq(p2.cells[at(p2, 15, 15)], WHITE, '下半盘的 W[pp] 也得落在盘上');
  eq(p2.moveNumber, 2, '两手持平');
  eq(moveAtSized(two.tree, two.id)?.point, at(p2, 15, 15), 'moveAtSized 与 positionAt 用同一套坐标');

  // 一串手数连着读，每一手都要在那里
  let tree = createTree(19, 7.5, 0, 'Chinese');
  let id = tree.root;
  const played: Array<[1 | 2, number, number]> = [
    [BLACK, 3, 15],
    [WHITE, 15, 3],
    [BLACK, 4, 15],
    [WHITE, 15, 4],
    [BLACK, 3, 3],
    [WHITE, 2, 2]
  ];
  for (const [color, x, y] of played) {
    const r = addMoveNode(tree, id, color, y * 19 + x);
    tree = r.tree;
    id = r.id;
  }
  const pos = positionAt(tree, id);
  let allThere = true;
  for (const [color, x, y] of played) if (pos.cells[y * 19 + x] !== color) allThere = false;
  eq(allThere, true, '六手棋都在自己该在的交叉点上');
  eq(pos.moveNumber, played.length, '手数也对得上');
}

// ── 导出再读回 ──────────────────────────────────────────────────────────
section('棋谱往返：导出再解析');
{
  let tree = createTree(19, 7.5, 0, 'Chinese');
  let id = tree.root;
  for (const [color, x, y] of [
    [BLACK, 3, 15],
    [WHITE, 15, 3],
    [BLACK, 3, 3],
    [WHITE, 16, 16]
  ] as Array<[1 | 2, number, number]>) {
    const r = addMoveNode(tree, id, color, y * 19 + x);
    tree = r.tree;
    id = r.id;
  }
  const text = serializeSgf(tree);
  const back = parseSgf(text)[0];
  let cur = back.root;
  for (;;) {
    const kids = back.nodes[cur]?.children ?? [];
    if (kids.length === 0) break;
    cur = kids[0];
  }
  const before = positionAt(tree, id);
  const after = positionAt(back, cur);
  let same = before.cells.length === after.cells.length;
  if (same) for (let i = 0; i < before.cells.length; i++) if (before.cells[i] !== after.cells[i]) same = false;
  eq(same, true, '导出再读回来，盘面一模一样');
  eq(after.moveNumber, before.moveNumber, '手数也一模一样');
}

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
