import { useState, useRef, useEffect } from 'react';
import { useStore, registerWebview, webContentsIdOf } from '../state/store';
import { tabTitle, type BrowserTab } from '../core/browser/tabs';
import { normalizeUrl } from '../core/browser/url';
import type { SplitAxis } from '../core/layout/panes';

interface WebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  getWebContentsId(): number;
  addEventListener(type: string, listener: (e: Event) => void): void;
}

const PRESETS: Array<{ label: string; url: string }> = [
  { label: '在线围棋', url: 'http://220.205.16.22:39681/' },
  { label: 'OGS', url: 'https://online-go.com/' },
  { label: '野狐', url: 'https://www.foxwq.com/' }
];

interface TabState {
  loading: boolean;
  error: string | null;
}

/**
 * 一个标签一份 webview。不活跃的只把显示收起来，不卸载，
 * 否则切回来等于重新加载，正在下的棋就没了。
 */
function TabView({
  tab,
  active,
  home,
  onRegister
}: {
  tab: BrowserTab;
  active: boolean;
  home: string;
  onRegister: (id: string, el: WebviewElement | null) => void;
}): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const updateTab = useStore((s) => s.updateTab);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const el = document.createElement('webview') as WebviewElement;
    el.setAttribute('partition', 'persist:go-browser');
    el.setAttribute('allowpopups', 'false');
    el.className = 'webview-el';
    const initial = tab.url || (home && home !== 'about:blank' ? home : 'about:blank');
    el.setAttribute('src', initial);
    host.appendChild(el);
    registerWebview(tab.id, el);
    onRegister(tab.id, el);

    const syncUrl = (): void => {
      try {
        const now = el.getURL();
        // 跟 store 里的当前值比，别闭包住挂载那一刻的 tab.url，否则每次导航都白刷一遍
        const cur = useStore.getState().tabs.find((t) => t.id === tab.id);
        if (now && now !== (cur?.url ?? '')) updateTab(tab.id, { url: now });
      } catch {
        /* 页面还没就绪 */
      }
    };
    const onTitle = (e: Event): void => {
      const t = (e as unknown as { title?: string }).title;
      if (typeof t === 'string') updateTab(tab.id, { title: t });
    };
    const onFail = (e: Event): void => {
      const ev = e as unknown as { errorCode?: number; errorDescription?: string };
      // -3 是加载被主动打断（比如又点了别的链接），不是错
      if (ev.errorCode === -3) return;
      updateTab(tab.id, { title: ev.errorDescription ? `打不开：${ev.errorDescription}` : '打不开' });
    };

    el.addEventListener('did-navigate', syncUrl);
    el.addEventListener('did-navigate-in-page', syncUrl);
    el.addEventListener('page-title-updated', onTitle);
    el.addEventListener('did-fail-load', onFail);
    // 老事件在新版里已经废弃，留着当兜底：真漏过来的新窗口也开成标签，别弹独立窗口
    el.addEventListener('new-window', (e) => {
      const url = (e as unknown as { url?: string }).url;
      if (url) useStore.getState().openBrowserTab(url);
    });
    return () => {
      registerWebview(tab.id, null);
      onRegister(tab.id, null);
      el.remove();
    };
    // 标签的 id 不变就不该重建 webview；url 变化由 loadURL 走命令，不在这里重挂
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, home]);

  return <div className="browser-view" ref={hostRef} style={{ display: active ? 'block' : 'none' }} />;
}

export function BrowserPanel({
  axis,
  onAxis
}: {
  /** 现在实际用的排布方向，由 App 算好传进来（用户没选过时是自动挑的那个）。 */
  axis: SplitAxis;
  onAxis: (v: SplitAxis) => void;
}): React.ReactElement {
  const viewsRef = useRef(new Map<string, WebviewElement>());
  const [input, setInput] = useState('');
  const [state, setState] = useState<Record<string, TabState>>({});
  const [nav, setNav] = useState({ back: false, forward: false });
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setBrowserOpen = useStore((s) => s.setBrowserOpen);
  const openBrowserTab = useStore((s) => s.openBrowserTab);
  const closeBrowserTab = useStore((s) => s.closeBrowserTab);
  const activateTab = useStore((s) => s.activateTab);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);
  const sync = useStore((s) => s.sync);
  const setLiveCapture = useStore((s) => s.setLiveCapture);
  const setAutoPlay = useStore((s) => s.setAutoPlay);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;
  const activeId = activeTab?.id ?? null;
  const view = activeId ? viewsRef.current.get(activeId) ?? null : null;

  const register = (id: string, el: WebviewElement | null): void => {
    if (el) viewsRef.current.set(id, el);
    else viewsRef.current.delete(id);
  };

  // 切换标签时地址栏跟着换，不然地址栏还停在上一个标签的地址上
  useEffect(() => {
    if (!activeId) {
      setInput('');
      return;
    }
    const el = viewsRef.current.get(activeId);
    setInput(activeTab?.url && activeTab.url !== 'about:blank' ? activeTab.url : '');
    setNav(el ? { back: safeNav(el, 'canGoBack'), forward: safeNav(el, 'canGoForward') } : { back: false, forward: false });
  }, [activeId, activeTab?.url]);

  // 导航按钮的可用状态只在活动标签上维护，切回来时问一次它的实时状态
  useEffect(() => {
    if (!activeId) return;
    const el = viewsRef.current.get(activeId);
    if (!el) return;
    const onStart = (): void => setState((s) => ({ ...s, [activeId]: { loading: true, error: null } }));
    const onStop = (): void => {
      setState((s) => ({ ...s, [activeId]: { loading: false, error: null } }));
      setNav({ back: safeNav(el, 'canGoBack'), forward: safeNav(el, 'canGoForward') });
      try {
        const now = el.getURL();
        if (now) setInput(now === 'about:blank' ? '' : now);
      } catch {
        /* 忽略 */
      }
    };
    const onNav = (): void => setNav({ back: safeNav(el, 'canGoBack'), forward: safeNav(el, 'canGoForward') });
    const onFail = (e: Event): void => {
      const ev = e as unknown as { errorCode?: number; errorDescription?: string };
      if (ev.errorCode === -3) return;
      setState((s) => ({ ...s, [activeId]: { loading: false, error: ev.errorDescription ?? '页面打不开' } }));
    };
    el.addEventListener('did-start-loading', onStart);
    el.addEventListener('did-stop-loading', onStop);
    el.addEventListener('did-navigate', onNav);
    el.addEventListener('did-navigate-in-page', onNav);
    el.addEventListener('did-fail-load', onFail);
    return () => {
      el.removeEventListener('did-start-loading', onStart);
      el.removeEventListener('did-stop-loading', onStop);
      el.removeEventListener('did-navigate', onNav);
      el.removeEventListener('did-navigate-in-page', onNav);
      el.removeEventListener('did-fail-load', onFail);
    };
  }, [activeId]);

  const go = (raw: string): void => {
    const target = normalizeUrl(raw);
    if (!target) return;
    if (view) {
      void view.loadURL(target);
      return;
    }
    openBrowserTab(target);
  };

  const capture = async (): Promise<void> => {
    const id = webContentsIdOf(view);
    if (id === null) {
      toast('页面还没准备好，稍等一下再截', 'error');
      return;
    }
    try {
      const dataUrl = await window.api.browser.capture(id);
      if (!dataUrl) {
        toast('截取失败，页面可能还没加载好', 'error');
        return;
      }
      useStore.getState().openImage({ dataUrl, name: '内置浏览器截取' });
    } catch (e) {
      toast('截取失败：' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  };

  const current = activeId ? state[activeId] : undefined;

  return (
    <div className="browser-pane">
      <div className="browser-tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={'browser-tab' + (t.id === activeId ? ' active' : '')}
            onClick={() => activateTab(t.id)}
            onAuxClick={(e) => {
              // 中键关标签，浏览器的老习惯
              if (e.button === 1) {
                e.preventDefault();
                closeBrowserTab(t.id);
              }
            }}
            title={t.title || t.url}
          >
            <span className="browser-tab-title">{tabTitle(t)}</span>
            <span
              className="browser-tab-close"
              role="button"
              title="关闭标签"
              onClick={(e) => {
                e.stopPropagation();
                closeBrowserTab(t.id);
              }}
            >
              ×
            </span>
          </div>
        ))}
        <button className="browser-tab-new" onClick={() => openBrowserTab('about:blank')} title="新建标签页（Ctrl+T）">
          ＋
        </button>
      </div>
      <div className="browser-bar">
        <button className="btn icon" disabled={!nav.back} onClick={() => view?.goBack()} title="后退">
          ‹
        </button>
        <button className="btn icon" disabled={!nav.forward} onClick={() => view?.goForward()} title="前进">
          ›
        </button>
        <button className="btn icon" onClick={() => view?.reload()} title="刷新">
          ⟳
        </button>
        <input
          className="browser-url"
          value={input}
          placeholder="输入网址，或者直接输入搜索内容"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(input);
          }}
        />
        <button className="btn sm" onClick={() => go(input)}>
          前往
        </button>
        <button className="btn sm primary" onClick={() => void capture()} title="把当前网页画面里的棋盘识别成棋谱">
          截取棋谱
        </button>
        <div className="seg" title="棋盘和浏览器怎么排：左右分栏是竖着切开，上下分栏是横着切开（网页能占满整条宽度，不再是竖着的一条窄缝）">
          <button className={'seg-item' + (axis === 'x' ? ' active' : '')} onClick={() => onAxis('x')}>
            左右
          </button>
          <button className={'seg-item' + (axis === 'y' ? ' active' : '')} onClick={() => onAxis('y')}>
            上下
          </button>
        </div>
        <button className="btn icon" onClick={() => setBrowserOpen(false)} title="关闭分屏">
          ✕
        </button>
      </div>
      <div className="row wrap browser-presets" style={{ padding: '6px 8px 0', gap: 6 }}>
        <button
          className={'chip' + (settings.liveCapture ? ' active' : '')}
          title="每隔两三秒看一眼网页上的棋盘，网页上多出来的那一手会自动接到谱上；对不上的时候只提示，不动你的棋"
          onClick={() => void setLiveCapture(!settings.liveCapture)}
        >
          实时截取
        </button>
        <button
          className={'chip' + (settings.autoPlay ? ' active' : '')}
          title="本程序里落的子会点回网页棋盘上（点之前先核对两边局面，点完再截一次确认；没落上会自动关掉）"
          onClick={() => void setAutoPlay(!settings.autoPlay)}
        >
          自动落子
        </button>
        <span className="tb-sep" />
        {PRESETS.map((p) => (
          <button key={p.label} className="chip" onClick={() => go(p.url)}>
            {p.label}
          </button>
        ))}
        <span className="small faint" style={{ marginLeft: 'auto' }}>
          {sync ? <span className={sync.ok ? 'sync-msg ok' : 'sync-msg err'}>{sync.text}</span> : null}
          {current?.error ? current.error : current?.loading ? '加载中…' : activeTab?.url && activeTab.url !== 'about:blank' ? activeTab.url.slice(0, 64) : '未打开页面'}
        </span>
      </div>
      <div className="browser-views">
        {tabs.map((t) => (
          <TabView key={t.id} tab={t} active={t.id === activeId} home={settings.browserHome} onRegister={register} />
        ))}
      </div>
    </div>
  );
}

function safeNav(el: WebviewElement, fn: 'canGoBack' | 'canGoForward'): boolean {
  try {
    return el[fn]();
  } catch {
    return false;
  }
}
