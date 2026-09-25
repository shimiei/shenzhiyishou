/**
 * 内置浏览器的标签页逻辑。全是纯函数，好在 Node 里直接断言。
 *
 * 抽出来单独放，是因为"关掉当前标签之后该看哪个"这类规则看着简单，
 * 实际边界不少：关中间、关最后一个、关的不是当前那个、新建时要不要跳过去。
 * 这些错了不会崩，只会让人觉得浏览器不对劲。
 */

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

let seq = 0;

export function newTabId(): string {
  seq += 1;
  return `tab-${Date.now().toString(36)}-${seq}`;
}

export function makeTab(url: string, title = ''): BrowserTab {
  return { id: newTabId(), url, title };
}

/**
 * 标签上显示什么。优先用页面标题，没标题就退回主机名，
 * 一长串完整地址挤在标签上谁也认不出来。
 */
export function tabTitle(tab: BrowserTab, max = 18): string {
  const raw = (tab.title || '').trim();
  const text = raw || hostOf(tab.url);
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function hostOf(url: string): string {
  if (!url || url === 'about:blank') return '新标签页';
  try {
    const u = new URL(url);
    if (u.protocol === 'about:') return '新标签页';
    if (u.protocol === 'file:') return u.pathname.split(/[\\/]/).pop() || '本地文件';
    const path = u.pathname === '/' ? '' : u.pathname;
    return u.hostname + path;
  } catch {
    return url;
  }
}

/**
 * 开一个标签。
 * activate 为假表示"在后台开"（中键点链接的习惯），当前标签不动。
 */
export function openTab(
  tabs: BrowserTab[],
  tab: BrowserTab,
  activeId: string | null,
  activate = true
): { tabs: BrowserTab[]; activeId: string | null } {
  return { tabs: [...tabs, tab], activeId: activate || !activeId ? tab.id : activeId };
}

/**
 * 关一个标签。关掉的正好是当前标签时，接管它右边那个；
 * 右边没有就回到左边那个，全关完就没有当前标签。
 */
export function closeTab(
  tabs: BrowserTab[],
  id: string,
  activeId: string | null
): { tabs: BrowserTab[]; activeId: string | null } {
  const index = tabs.findIndex((t) => t.id === id);
  if (index < 0) return { tabs, activeId };
  const rest = tabs.filter((t) => t.id !== id);
  if (rest.length === 0) return { tabs: rest, activeId: null };
  if (activeId !== id) return { tabs: rest, activeId };
  const next = rest[Math.min(index, rest.length - 1)];
  return { tabs: rest, activeId: next.id };
}

/** Ctrl+Tab 轮流切标签，绕圈。只有一个标签时原地不动。 */
export function stepTab(tabs: BrowserTab[], activeId: string | null, dir: 1 | -1): string | null {
  if (tabs.length === 0) return null;
  const index = tabs.findIndex((t) => t.id === activeId);
  if (index < 0) return tabs[0].id;
  return tabs[(index + dir + tabs.length) % tabs.length].id;
}
