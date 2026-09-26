import { useEffect } from 'react';
import { useStore } from '../state/store';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState();
      if (isTyping(e.target)) return;
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        s.undo();
        return;
      }
      if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        s.redo();
        return;
      }
      // Ctrl+B 在菜单里也有一条加速键，但网页有焦点时只有菜单那条生效，
      // 界面上有焦点时走这里，两边都留着，快捷键才在哪儿按都一样。
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        s.setBrowserOpen(!s.browserOpen);
        return;
      }
      /*
       * Ctrl+W 同理，只是方向相反：菜单里那条加速键在 Windows 上不触发（Ctrl+Shift+W 才触发），
       * 所以界面里这份是主力，网页里那份在主进程用 before-input-event 拦。
       * 只认不带 Shift 的，免得跟菜单里的 Ctrl+Shift+W 撞上关两次。
       */
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        const id = s.activeTabId ?? s.tabs[0]?.id;
        if (id) s.closeBrowserTab(id);
        return;
      }
      if (ctrl) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          s.gotoStep(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          s.gotoStep(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          s.gotoStart();
          break;
        case 'ArrowDown':
          e.preventDefault();
          s.gotoEnd();
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          s.deleteCurrentNode();
          break;
        case ' ':
          e.preventDefault();
          void s.aiMoveNow();
          break;
        case '+':
        case '=':
          s.setZoom(s.zoom + 0.1);
          break;
        case '-':
        case '_':
          s.setZoom(s.zoom - 0.1);
          break;
        default:
          break;
      }

      switch (e.key.toLowerCase()) {
        case 'p':
          s.pass();
          break;
        case 'h':
          void s.doHint();
          break;
        case 'a':
          void s.toggleAnalysis();
          break;
        case 'e':
          s.setDialog('score');
          break;
        case 'm':
          s.toggleAiVsAi();
          break;
        case 'b':
          s.setBrowserOpen(!s.browserOpen);
          break;
        case 'i':
          void window.api.files.openImage().then((img) => {
            if (img) s.openImage({ dataUrl: img.dataUrl, name: img.name });
          });
          break;
        case 'c':
          void s.setSettings({ coords: !s.settings.coords });
          break;
        case 'n':
          void s.setSettings({ moveNumbers: !s.settings.moveNumbers });
          break;
        case 'r':
          s.setDialog('review');
          break;
        case '?':
          s.setDialog('shortcuts');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
