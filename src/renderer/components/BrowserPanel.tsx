import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';

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

export function BrowserPanel(): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<WebviewElement | null>(null);
  const [input, setInput] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [nav, setNav] = useState({ back: false, forward: false });
  const setBrowserOpen = useStore((s) => s.setBrowserOpen);
  const openImage = useStore((s) => s.openImage);
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || viewRef.current) return;
    const el = document.createElement('webview') as WebviewElement;
    el.setAttribute('partition', 'persist:go-browser');
    el.setAttribute('allowpopups', 'false');
    el.setAttribute('src', settings.browserHome && settings.browserHome !== 'about:blank' ? settings.browserHome : 'about:blank');
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.display = 'flex';
    el.style.background = '#fff';
    host.appendChild(el);
    viewRef.current = el;

    const sync = (): void => {
      try {
        setUrl(el.getURL());
        setInput(el.getURL());
        setNav({ back: el.canGoBack(), forward: el.canGoForward() });
      } catch {
        /* 页面还没就绪 */
      }
    };
    el.addEventListener('did-start-loading', () => setLoading(true));
    el.addEventListener('did-stop-loading', () => {
      setLoading(false);
      sync();
    });
    el.addEventListener('did-navigate', sync);
    el.addEventListener('did-navigate-in-page', sync);
    el.addEventListener('page-title-updated', sync);
    el.addEventListener('new-window', (e) => {
      const ev = e as unknown as { url: string };
      if (ev.url) void window.api.browser.openExternal(ev.url);
    });
    return () => {
      el.remove();
      viewRef.current = null;
    };
  }, [settings.browserHome]);

  const go = (raw: string): void => {
    const el = viewRef.current;
    if (!el) return;
    let target = raw.trim();
    if (!target) return;
    if (!/^[a-z]+:\/\//i.test(target) && target !== 'about:blank') {
      const looksLikeUrl = /^[\w-]+(\.[\w-]+)+(\/|$|:\d)/.test(target);
      target = looksLikeUrl ? 'http://' + target : 'https://www.bing.com/search?q=' + encodeURIComponent(target);
    }
    void el.loadURL(target);
  };

  const capture = async (): Promise<void> => {
    const el = viewRef.current;
    if (!el) return;
    try {
      const id = el.getWebContentsId();
      const dataUrl = await window.api.browser.capture(id);
      if (!dataUrl) {
        toast('截取失败，页面可能还没加载好', 'error');
        return;
      }
      openImage({ dataUrl, name: '内置浏览器截取' });
    } catch (e) {
      toast('截取失败：' + (e instanceof Error ? e.message : String(e)), 'error');
    }
  };

  return (
    <div className="browser-pane">
      <div className="browser-bar">
        <button className="btn icon" disabled={!nav.back} onClick={() => viewRef.current?.goBack()} title="后退">
          ‹
        </button>
        <button className="btn icon" disabled={!nav.forward} onClick={() => viewRef.current?.goForward()} title="前进">
          ›
        </button>
        <button className="btn icon" onClick={() => viewRef.current?.reload()} title="刷新">
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
        <button className="btn icon" onClick={() => setBrowserOpen(false)} title="关闭分屏">
          ✕
        </button>
      </div>
      <div className="row wrap" style={{ padding: '6px 8px 0', gap: 6 }}>
        {PRESETS.map((p) => (
          <button key={p.label} className="chip" onClick={() => go(p.url)}>
            {p.label}
          </button>
        ))}
        <span className="small faint" style={{ marginLeft: 'auto' }}>
          {loading ? '加载中…' : url ? url.slice(0, 60) : '未打开页面'}
        </span>
      </div>
      <div className="browser-view" ref={hostRef} />
    </div>
  );
}
