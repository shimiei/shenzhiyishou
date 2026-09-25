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
          void s.playAiMove(true);
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
