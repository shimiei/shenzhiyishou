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
       * Ctrl+W 同理，只是方向相反：菜单里那条加速键在 Windows 上不触发（Ctrl+Shift+W 才触发）。
       * 这里这份管的是棋盘标签（焦点在界面里时按的）；焦点在网页里的时候按键不冒泡到这里，
       * 由主进程 before-input-event 拦下来关浏览器标签，两边各管各的，不会一次关两个。
       */
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        s.closeBoardTab(s.activeBoard);
        return;
      }
      /* 棋盘标签那套键：Ctrl+T 新建、Ctrl+Tab 前后切、Ctrl+1..9 跳、Ctrl+Shift+D 复制一份。
         焦点在网页里时这些键同样不冒泡到这儿（那边归浏览器标签），要浏览器标签请用菜单。 */
      if (ctrl && !e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        s.stepBoardTab(1);
        return;
      }
      if (ctrl && e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        s.stepBoardTab(-1);
        return;
      }
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        s.openBoardTab();
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        s.reopenBoard();
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        s.duplicateBoard();
        return;
      }
      if (ctrl && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        s.nthBoardTab(Number(e.key));
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
