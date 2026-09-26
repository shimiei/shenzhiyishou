import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Board } from './Board';
import { Position } from '../core/go/position';
import { parseSgf } from '../core/sgf/parse';
import { mainLineEnd, positionAt, propNum } from '../core/sgf/tree';
import { metaFromSgf } from '../core/records/meta';
import {
  LIBRARY_SORTS,
  allTags,
  filterRecords,
  resultLabel,
  sortRecords,
  type LibrarySort,
  type ResultKind
} from '../../shared/records';
import type { RecordMeta } from '../../shared/types';

/** 列表里缩略图的边长（含棋盘外的留白）。行高按它对齐。 */
const THUMB = 54;
/** 预览那边大一点的那张。 */
const PREVIEW = 236;

/**
 * 缩略图缓存：编号 → 摆好的局面。
 *
 * 一页列表里几十上百行，每行都去读一遍文件、解一遍棋谱太浪费，
 * 滚动来回几下就会重复读同一批。缓存就按编号存局面，页面关掉也不清（切回来还是热的）。
 * 存的是局面而不是画布：换尺寸、换主题重画都还是自己那一份。
 */
const thumbCache = new Map<string, { position: Position; size: number } | null>();

function readThumb(id: string): { position: Position; size: number } | null {
  if (thumbCache.has(id)) return thumbCache.get(id) ?? null;
  return null;
}

async function loadThumb(id: string): Promise<{ position: Position; size: number } | null> {
  const cached = thumbCache.get(id);
  if (cached !== undefined) return cached;
  let out: { position: Position; size: number } | null = null;
  try {
    const entry = await window.api.library.get(id);
    if (entry) {
      const trees = parseSgf(entry.content);
      if (trees.length) {
        const tree = trees[0];
        // 缩略图给的是整盘的样子：走到主线末尾，不是当前节点（索引里也不记当前节点）
        out = { position: positionAt(tree, mainLineEnd(tree)), size: propNum(tree, tree.root, 'SZ', 19) };
      }
    }
  } catch {
    out = null;
  }
  thumbCache.set(id, out);
  return out;
}

/** 列表行左边那张小棋盘：出现在视野里才去读盘。 */
function Thumb({ id, box }: { id: string; box: number }): React.ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState(() => readThumb(id));

  useEffect(() => {
    if (data) return;
    const el = host.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void loadThumb(id).then((got) => {
          if (alive) setData(got);
        });
      },
      { rootMargin: '160px' }
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [id, data]);

  return (
    <div className="lib-thumb" ref={host} style={{ width: box, height: box }}>
      {data ? (
        <Board
          size={data.size}
          position={data.position}
          showCoords={false}
          fixedBox={box}
          interactive={false}
          zoom={1}
        />
      ) : null}
    </div>
  );
}

/** 这一份是哪盘的标题，列表与预览共用一处写法。 */
function namesOf(m: RecordMeta): string {
  return `${m.blackName || '黑'} 对 ${m.whiteName || '白'}`;
}

function whenText(at: number): string {
  if (!at) return '';
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 页面里用的小弹窗：确认、改名、加标签都用它，别再各写一套遮罩。 */
function Mini({
  title,
  children,
  footer,
  onClose,
  width = 420
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  width?: number;
}): React.ReactElement {
  return (
    <div className="lib-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lib-mini" style={{ width }}>
        <div className="lib-mini-head">
          <span className="title">{title}</span>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="lib-mini-body">{children}</div>
        {footer ? <div className="lib-mini-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

type Pending =
  | { kind: 'rename'; id: string; title: string }
  | { kind: 'tags'; id: string; tags: string[]; draft: string }
  | { kind: 'delete'; ids: string[] }
  | { kind: 'dir'; dir: string; count: number }
  | { kind: 'scan'; added: Array<{ file: string; content: string }>; missing: string[] };

/**
 * 棋谱馆：一整页的棋谱管理，不是弹窗。
 *
 * 棋盘那一页保持挂载、只是被它盖住，回来时局面一点不变。
 * 一页里管的东西不少（列表、筛选、预览、多选、每条自己的菜单），
 * 所以列表数据放在这一层，不往全局状态里塞：关掉页面就该忘掉的那些事，别的地方不该看得见。
 */
export function LibraryPage(): React.ReactElement {
  const toast = useStore((s) => s.toast);
  const openRecord = useStore((s) => s.openRecord);
  const setLibraryPage = useStore((s) => s.setLibraryPage);

  const [dir, setDir] = useState('');
  const [records, setRecords] = useState<RecordMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<LibrarySort>('savedAt');
  const [tags, setTags] = useState<string[]>([]);
  const [result, setResult] = useState<ResultKind | ''>('');
  const [size, setSize] = useState<number | null>(null);
  const [days, setDays] = useState(0);
  const [multi, setMulti] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    const got = await window.api.library.list();
    setDir(got.dir);
    setRecords(got.records);
    setLoading(false);
    // 挑中的那几条可能是刚被删掉的，落回列表里真正还在的那些
    const alive = new Set(got.records.map((r) => r.id));
    setPicked((prev) => prev.filter((id) => alive.has(id)));
    setFocus((prev) => (prev && alive.has(prev) ? prev : (got.records[0]?.id ?? null)));
  };

  useEffect(() => {
    void refresh();
  }, []);

  // Esc 退出：手上有弹窗先收弹窗，没有就回棋盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (pending) {
        setPending(null);
        return;
      }
      if (menu) {
        setMenu(null);
        return;
      }
      setLibraryPage(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, menu, setLibraryPage]);

  const shown = useMemo(
    () => sortRecords(filterRecords(records, { query, tags, result, size, days }), sort),
    [records, query, tags, result, size, days, sort]
  );
  const tagList = useMemo(() => allTags(records), [records]);
  const sizes = useMemo(
    () => [...new Set(records.map((r) => r.size).filter((n) => n > 0))].sort((a, b) => a - b),
    [records]
  );
  const focused = useMemo(() => records.find((r) => r.id === focus) ?? null, [records, focus]);
  const allShownPicked = shown.length > 0 && shown.every((r) => picked.includes(r.id));

  const togglePick = (id: string, e: React.MouseEvent): void => {
    setPicked((prev) => {
      if (e.shiftKey && focus && prev.length) {
        // Shift 连着选：从上一回到这一点之间的一段全算上
        const from = shown.findIndex((r) => r.id === focus);
        const to = shown.findIndex((r) => r.id === id);
        if (from >= 0 && to >= 0) {
          const [a, b] = from <= to ? [from, to] : [to, from];
          const span = shown.slice(a, b + 1).map((r) => r.id);
          return [...new Set([...prev, ...span])];
        }
      }
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    });
    setFocus(id);
  };

  const reveal = (id?: string): void => {
    void window.api.library.reveal(id);
  };

  const doExport = async (ids: string[]): Promise<void> => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const res = await window.api.library.export(ids);
      // dir 为 null 是用户在选文件夹那一步取消了：什么都不做，也别报成失败
      if (res.dir === null) return;
      const skipped = res.skipped ? `，跳过 ${res.skipped} 份（重名或文件不在）` : '';
      toast(`导出 ${res.exported} 份到 ${res.dir}${skipped}`, 'success');
    } catch (e) {
      toast('导出失败：' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (ids: string[]): Promise<void> => {
    setBusy(true);
    try {
      const n = await window.api.library.delete(ids);
      toast(`已删除 ${n} 份`, 'success');
      setPicked([]);
      await refresh();
    } catch (e) {
      toast('删除失败：' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const doRename = async (id: string, title: string): Promise<void> => {
    const next = title.trim();
    if (!next) return;
    await window.api.library.update(id, { title: next });
    await refresh();
  };

  const doTags = async (id: string, next: string[]): Promise<void> => {
    await window.api.library.update(id, { tags: next });
    await refresh();
  };

  const doImport = async (): Promise<void> => {
    const res = await window.api.files.openSgf();
    if (!res) return;
    const meta = metaFromSgf(res.content, res.name, Date.now());
    if (!meta) {
      toast('这份棋谱读不出来，可能不是 SGF', 'error');
      return;
    }
    setBusy(true);
    try {
      const rec = await window.api.library.save({ meta, content: res.content });
      toast(`已导入棋谱馆：${rec.title}`, 'success');
      await refresh();
      setFocus(rec.id);
    } catch (e) {
      toast('导入失败：' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setBusy(false);
    }
  };

  const doScan = async (): Promise<void> => {
    setBusy(true);
    try {
      const got = await window.api.library.scan();
      if (got.added.length === 0 && got.missing.length === 0) {
        toast('目录里外都对上了，没有要收编的，也没有丢的', 'success');
        return;
      }
      setPending({ kind: 'scan', added: got.added, missing: got.missing });
    } catch (e) {
      toast('扫描失败：' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setBusy(false);
    }
  };

  const adoptScanned = async (added: Array<{ file: string; content: string }>): Promise<void> => {
    const items = [];
    for (const a of added) {
      const meta = metaFromSgf(a.content, a.file, Date.now());
      if (meta) items.push({ file: a.file, meta });
    }
    if (!items.length) {
      toast('这几份都读不出来，没有收编', 'error');
      setPending(null);
      return;
    }
    const n = await window.api.library.adopt(items);
    toast(`收编了 ${n} 份`, 'success');
    setPending(null);
    await refresh();
  };

  const cleanMissing = async (missing: string[]): Promise<void> => {
    const ids = records.filter((r) => missing.includes(r.file)).map((r) => r.id);
    if (ids.length) await window.api.library.delete(ids);
    toast(`清掉 ${ids.length} 条索引`, 'success');
    setPending(null);
    await refresh();
  };

  const chooseDir = async (): Promise<void> => {
    const next = await window.api.library.chooseDir();
    if (!next || next === dir) return;
    setPending({ kind: 'dir', dir: next, count: records.length });
  };

  const applyDir = async (dir2: string, move: boolean): Promise<void> => {
    setBusy(true);
    try {
      const res = await window.api.library.setDir(dir2, move);
      const tail = res.failed ? `，${res.failed} 份没搬动（还在原来的目录里）` : '';
      toast(move ? `已换目录，搬过去 ${res.moved} 份${tail}` : '已换目录', 'success');
      setPending(null);
      thumbCache.clear();
      await refresh();
    } catch (e) {
      toast('换目录失败：' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setBusy(false);
    }
  };

  const rowMenu = (m: RecordMeta): React.ReactNode => (
    <>
      <div className="lib-menu-back" onClick={() => setMenu(null)} />
      {/* 点过任何一项就把菜单收起来：不然选完"重命名"之后，小弹窗后面还摊着一张菜单 */}
      <div
        className="lib-menu"
        onClick={(e) => {
          e.stopPropagation();
          setMenu(null);
        }}
      >
        <button onClick={() => void openRecord(m.id)}>打开</button>
        <button onClick={() => void doExport([m.id])}>导出到…</button>
        <button
          onClick={() => {
            void window.api.library
              .get(m.id)
              .then((e2) => (e2 ? window.api.clip.writeText(e2.content) : null))
              .then(() => toast('SGF 已复制到剪贴板', 'success'));
          }}
        >
          复制 SGF
        </button>
        <button onClick={() => setPending({ kind: 'rename', id: m.id, title: m.title })}>重命名</button>
        <button onClick={() => setPending({ kind: 'tags', id: m.id, tags: m.tags ?? [], draft: '' })}>加标签</button>
        <div className="lib-menu-sep" />
        <button onClick={() => reveal(m.id)}>打开所在文件夹</button>
        <button className="danger" onClick={() => setPending({ kind: 'delete', ids: [m.id] })}>
          删除
        </button>
      </div>
    </>
  );

  return (
    <div className="lib-page">
      <div className="lib-head">
        <button className="btn ghost sm" onClick={() => setLibraryPage(false)} title="回棋盘（Esc）">
          返回
        </button>
        <span className="lib-name">棋谱馆</span>
        <span className="small faint">
          {loading ? '读取中…' : `共 ${records.length} 盘${shown.length === records.length ? '' : `，挑出 ${shown.length} 盘`}`}
        </span>
        <button className="lib-dir" onClick={() => reveal()} title="在资源管理器里打开这个文件夹">
          {dir || '…'}
        </button>
        <div className="spacer" />
        <input
          className="lib-search"
          value={query}
          placeholder="搜标题、对局双方、结果、标签"
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="lib-sort" value={sort} onChange={(e) => setSort(e.target.value as LibrarySort)} title="排序">
          {LIBRARY_SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          className={'btn sm' + (multi ? ' primary' : '')}
          onClick={() => {
            setMulti(!multi);
            setPicked([]);
          }}
          title="多选：勾上几盘一起导出或删除"
        >
          多选
        </button>
        <button className="btn sm" disabled={busy} onClick={() => void doImport()} title="把别处的 .sgf 收进棋谱馆">
          导入 SGF
        </button>
        <button className="btn sm" disabled={busy} onClick={() => void doScan()} title="看看目录里有没有手动丢进来的棋谱，顺便找找索引里已经不在的文件">
          扫描
        </button>
        <button className="btn sm" disabled={busy} onClick={() => void chooseDir()} title="换一个文件夹当棋谱馆">
          更换目录
        </button>
      </div>

      <div className="lib-body">
        <div className="lib-rail">
          <div className="lib-rail-h">筛选</div>
          {tags.length || result || size !== null || days ? (
            <button
              className="btn ghost sm lib-clear"
              onClick={() => {
                setTags([]);
                setResult('');
                setSize(null);
                setDays(0);
              }}
            >
              清空筛选
            </button>
          ) : null}

          <div className="lib-rail-h">结果</div>
          <div className="lib-chips">
            {(
              [
                ['black', '黑胜'],
                ['white', '白胜'],
                ['draw', '和棋'],
                ['unknown', '未记']
              ] as Array<[ResultKind, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                className={'chip' + (result === k ? ' active' : '')}
                onClick={() => setResult(result === k ? '' : k)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="lib-rail-h">路数</div>
          <div className="lib-chips">
            {sizes.length ? (
              sizes.map((n) => (
                <button
                  key={n}
                  className={'chip' + (size === n ? ' active' : '')}
                  onClick={() => setSize(size === n ? null : n)}
                >
                  {n} 路
                </button>
              ))
            ) : (
              <span className="small faint">还没有棋谱</span>
            )}
          </div>

          <div className="lib-rail-h">时间</div>
          <div className="lib-chips">
            {(
              [
                [0, '不限'],
                [7, '七天内'],
                [30, '一个月内'],
                [365, '一年内']
              ] as Array<[number, string]>
            ).map(([n, label]) => (
              <button key={n} className={'chip' + (days === n ? ' active' : '')} onClick={() => setDays(n)}>
                {label}
              </button>
            ))}
          </div>

          <div className="lib-rail-h">标签</div>
          <div className="lib-chips">
            {tagList.length ? (
              tagList.map((t) => (
                <button
                  key={t.tag}
                  className={'chip' + (tags.includes(t.tag) ? ' active' : '')}
                  onClick={() => setTags(tags.includes(t.tag) ? tags.filter((x) => x !== t.tag) : [...tags, t.tag])}
                  title="选了两个标签就是两样都得有"
                >
                  {t.tag}
                  <span className="faint"> {t.count}</span>
                </button>
              ))
            ) : (
              <span className="small faint">还没有标签</span>
            )}
          </div>
        </div>

        <div className="lib-list">
          {multi ? (
            <div className="lib-bar">
              <span>已选 {picked.length} 盘</span>
              <button
                className="btn sm"
                disabled={busy || !picked.length}
                onClick={() => void doExport(picked)}
                title="挑个文件夹，按标题一份份写过去"
              >
                导出到…
              </button>
              <button
                className="btn sm danger"
                disabled={busy || !picked.length}
                onClick={() => setPending({ kind: 'delete', ids: picked })}
              >
                删除
              </button>
              <div className="spacer" />
              <button
                className="btn ghost sm"
                onClick={() => setPicked(allShownPicked ? [] : shown.map((r) => r.id))}
                disabled={!shown.length}
              >
                {allShownPicked ? '取消全选' : '全选'}
              </button>
              <button className="btn ghost sm" onClick={() => setPicked([])} disabled={!picked.length}>
                取消选择
              </button>
            </div>
          ) : null}

          {loading ? (
            <div className="empty">读取中…</div>
          ) : shown.length === 0 ? (
            <div className="empty">
              {records.length === 0
                ? '棋谱馆还是空的。下完一盘按保存（Ctrl+S），或者把别处的 .sgf 用“导入 SGF”收进来。'
                : '没有符合条件的棋谱，换个词或者清空筛选试试。'}
            </div>
          ) : (
            shown.map((m) => (
              <div
                key={m.id}
                className={
                  'lib-row' +
                  (picked.includes(m.id) ? ' picked' : '') +
                  (focus === m.id ? ' focus' : '')
                }
                onClick={(e) => (multi ? togglePick(m.id, e) : setFocus(m.id))}
                onDoubleClick={() => void openRecord(m.id)}
              >
                {multi ? (
                  <span
                    className={'lib-check' + (picked.includes(m.id) ? ' active' : '')}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePick(m.id, e);
                    }}
                  />
                ) : null}
                <Thumb id={m.id} box={THUMB} />
                <div className="lib-main">
                  <div className="lib-row-title">{m.title}</div>
                  <div className="lib-sub">
                    <span>{namesOf(m)}</span>
                    <span className="faint">{resultLabel(m.result)}</span>
                    <span className="faint">{m.date || '没写日期'}</span>
                    <span className="faint">
                      {m.size} 路 · {m.moves} 手
                    </span>
                  </div>
                  {m.tags?.length ? (
                    <div className="lib-tags">
                      {m.tags.map((t) => (
                        <span key={t} className="lib-tag">
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <span className="lib-when faint" title={`存进馆的时间：${new Date(m.savedAt).toLocaleString('zh-CN')}`}>
                  {whenText(m.savedAt)}
                </span>
                <button
                  className="lib-more"
                  title="这一盘还能做什么"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFocus(m.id);
                    setMenu(menu === m.id ? null : m.id);
                  }}
                >
                  ⋯
                </button>
                {menu === m.id ? rowMenu(m) : null}
              </div>
            ))
          )}
        </div>

        <div className="lib-side">
          {focused ? (
            <>
              <Thumb id={focused.id} box={PREVIEW} />
              <div className="lib-side-title">{focused.title}</div>
              <div className="lib-side-line">{namesOf(focused)}</div>
              <div className="lib-side-line faint">
                {resultLabel(focused.result)} · {focused.size} 路 · {focused.moves} 手
              </div>
              <div className="lib-side-line faint">{focused.date || '没写日期'}</div>
              <div className="lib-side-line faint">
                存进馆 {new Date(focused.savedAt).toLocaleString('zh-CN')}
              </div>
              <div className="lib-side-line faint">文件 {focused.file}</div>
              {focused.tags?.length ? (
                <div className="lib-tags">
                  {focused.tags.map((t) => (
                    <span key={t} className="lib-tag">
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="lib-side-acts">
                <button className="btn primary sm" onClick={() => void openRecord(focused.id)}>
                  在棋盘上打开
                </button>
                <button className="btn sm" disabled={busy} onClick={() => void doExport([focused.id])}>
                  导出到…
                </button>
                <button
                  className="btn sm"
                  onClick={() => setPending({ kind: 'rename', id: focused.id, title: focused.title })}
                >
                  重命名
                </button>
                <button
                  className="btn sm"
                  onClick={() => setPending({ kind: 'tags', id: focused.id, tags: focused.tags ?? [], draft: '' })}
                >
                  加标签
                </button>
                <button className="btn sm danger" onClick={() => setPending({ kind: 'delete', ids: [focused.id] })}>
                  删除
                </button>
              </div>
            </>
          ) : (
            <div className="empty">左边挑一盘看看</div>
          )}
        </div>
      </div>

      {pending?.kind === 'rename' ? (
        <Mini
          title="改个标题"
          onClose={() => setPending(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setPending(null)}>
                取消
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  void doRename(pending.id, pending.title);
                  setPending(null);
                }}
              >
                改好
              </button>
            </>
          }
        >
          <input
            className="lib-input"
            autoFocus
            value={pending.title}
            onChange={(e) => setPending({ ...pending, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void doRename(pending.id, pending.title);
                setPending(null);
              }
            }}
          />
          <div className="small faint" style={{ marginTop: 8 }}>
            只改馆里这一栏显示的名字，磁盘上的文件名不动（免得别的程序正占着它）。
          </div>
        </Mini>
      ) : null}

      {pending?.kind === 'tags' ? (
        <Mini
          title="加标签"
          onClose={() => setPending(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setPending(null)}>
                取消
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  const add = pending.draft
                    .split(/[,，\s]+/)
                    .map((t) => t.trim())
                    .filter(Boolean);
                  void doTags(pending.id, [...new Set([...pending.tags, ...add])]);
                  setPending(null);
                }}
              >
                加好
              </button>
            </>
          }
        >
          <input
            className="lib-input"
            autoFocus
            placeholder="打几个字，回车就加；已经有的标签点一下去掉"
            value={pending.draft}
            onChange={(e) => setPending({ ...pending, draft: e.target.value })}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const add = pending.draft
                .split(/[,，\s]+/)
                .map((t) => t.trim())
                .filter(Boolean);
              if (!add.length) return;
              void doTags(pending.id, [...new Set([...pending.tags, ...add])]);
              setPending(null);
            }}
          />
          <div className="lib-chips" style={{ marginTop: 10 }}>
            {pending.tags.length ? (
              pending.tags.map((t) => (
                <button
                  key={t}
                  className="chip active"
                  title="点一下去掉这个标签"
                  onClick={() => void doTags(pending.id, pending.tags.filter((x) => x !== t))}
                >
                  {t} ×
                </button>
              ))
            ) : (
              <span className="small faint">这一盘还没有标签</span>
            )}
          </div>
        </Mini>
      ) : null}

      {pending?.kind === 'delete' ? (
        <Mini
          title="删除棋谱"
          onClose={() => setPending(null)}
          footer={
            <>
              <button className="btn ghost" disabled={busy} onClick={() => setPending(null)}>
                取消
              </button>
              <button className="btn danger" disabled={busy} onClick={() => void doDelete(pending.ids)}>
                删掉
              </button>
            </>
          }
        >
          <div style={{ lineHeight: 1.9 }}>
            要删掉 {pending.ids.length} 份棋谱，连同磁盘上的文件一起，删了就找不回来了。
          </div>
        </Mini>
      ) : null}

      {pending?.kind === 'dir' ? (
        <Mini
          title="换个文件夹"
          width={460}
          onClose={() => setPending(null)}
          footer={
            <>
              <button className="btn ghost" disabled={busy} onClick={() => setPending(null)}>
                取消
              </button>
              <button className="btn" disabled={busy} onClick={() => void applyDir(pending.dir, false)}>
                只换目录
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void applyDir(pending.dir, true)}>
                一起搬过去
              </button>
            </>
          }
        >
          <div style={{ lineHeight: 1.9 }}>
            新目录：<span className="lib-path">{pending.dir}</span>
            <br />
            现在馆里有 {pending.count} 份棋谱。搬过去是把它们复制到新目录、确认写好了再删掉原地那份；
            不搬就只是换个目录，原来那些还留在老地方，之后可以再扫进来。旧目录里的索引文件不动。
          </div>
        </Mini>
      ) : null}

      {pending?.kind === 'scan' ? (
        <Mini
          title="扫描结果"
          width={480}
          onClose={() => setPending(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setPending(null)}>
                关闭
              </button>
              {pending.missing.length ? (
                <button className="btn" onClick={() => void cleanMissing(pending.missing)}>
                  清掉 {pending.missing.length} 条索引
                </button>
              ) : null}
              {pending.added.length ? (
                <button className="btn primary" onClick={() => void adoptScanned(pending.added)}>
                  收编 {pending.added.length} 份
                </button>
              ) : null}
            </>
          }
        >
          <div style={{ lineHeight: 1.9 }}>
            {pending.added.length ? (
              <>
                目录里有 {pending.added.length} 份棋谱还没进馆，收编之后就能在这儿搜到、打标签：
                <div className="lib-filelist">
                  {pending.added.slice(0, 30).map((a) => (
                    <div key={a.file}>{a.file}</div>
                  ))}
                  {pending.added.length > 30 ? <div className="faint">还有 {pending.added.length - 30} 份…</div> : null}
                </div>
              </>
            ) : null}
            {pending.missing.length ? (
              <>
                索引里记着、目录里已经不在的有 {pending.missing.length} 份（可能是在外面删掉或改名了）：
                <div className="lib-filelist">
                  {pending.missing.slice(0, 30).map((f) => (
                    <div key={f}>{f}</div>
                  ))}
                  {pending.missing.length > 30 ? <div className="faint">还有 {pending.missing.length - 30} 份…</div> : null}
                </div>
                清掉索引不会动磁盘上的东西（文件本来就不在了），只是列表里不再挂着它们。
              </>
            ) : null}
          </div>
        </Mini>
      ) : null}
    </div>
  );
}
