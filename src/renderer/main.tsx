import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './state/store';
import './styles.css';

const el = document.getElementById('root');

// 预加载脚本没跑起来的话 window.api 就是空的，这时给一句能看懂的提示，
// 而不是留一个全黑的窗口让人猜。
function fatal(message: string): void {
  if (!el) return;
  el.innerHTML =
    '<div style="padding:48px;font:14px/1.7 system-ui,sans-serif;color:#c9ccd4">' +
    '<h2 style="color:#d9a441;margin:0 0 12px">界面没能启动</h2>' +
    '<p>' + message + '</p>' +
    '<p style="color:#7b828d">如果反复出现，请重新安装，或把这条信息反馈给作者。</p>' +
    '</div>';
}

if (!el) {
  // 正常情况下不会发生，index.html 里就有这个节点
} else if (typeof window.api !== 'object' || window.api === null) {
  fatal('预加载脚本没有加载成功，程序内部通信不可用。');
} else {
  createRoot(el).render(<App />);
  // 排查问题时可以在开发者工具里用 __szys.getState() 看当前状态，
  // 也可以直接调里面的动作，省得为了复现一个界面状态点半天。
  (window as unknown as { __szys: typeof useStore }).__szys = useStore;
}
