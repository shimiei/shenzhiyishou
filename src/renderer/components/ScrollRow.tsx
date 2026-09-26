import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 一条能左右推的横排按钮。
 *
 * 窗口不宽、右边又分给内置浏览器的时候，一排按钮总会被右边裁掉几个，够不着的
 * 恰好是最后那几件（叉、字母就在最右边）。这里给横排配两个箭头和滚轮：箭头只在
 * 真的挤不下时才露出来，宽屏上看不出区别。
 */
export function ScrollRow({
  children,
  revealKey,
  className
}: {
  children: React.ReactNode;
  /** 这个值一变，就把当前选中那件挪进视野（换工具、换颜色时用） */
  revealKey?: unknown;
  /** 给这一排起个名（验收驱动按名字找它） */
  className?: string;
}): React.ReactElement {
  const strip = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback((): void => {
    const el = strip.current;
    if (!el) return;
    const rest = el.scrollWidth - el.clientWidth;
    setMore({ left: el.scrollLeft > 2, right: rest > 2 && el.scrollLeft < rest - 2 });
  }, []);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // 排里的东西也会变（选了"自由落子"就多出一排黑白），变了就重量一次
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    // 竖着滚也能横着推：手上多半只有一个滚轮，比非要去够箭头顺手
    const onWheel = (e: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth + 2) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (d === 0) return;
      e.preventDefault();
      el.scrollLeft += d;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    // 一排里可能有不止一处选中（"自由落子"本身 + 它的黑白），靠右那件才是刚挑的
    const picked = el.querySelectorAll<HTMLElement>('.active');
    const active = picked[picked.length - 1];
    if (!active) return;
    // 用画在屏幕上的位置算，不用 offsetLeft：那一族数字是相对定位祖先的，
    // 这一排本身没有定位，拿到的原点会是别人的
    const pad = 8;
    const box = el.getBoundingClientRect();
    const r = active.getBoundingClientRect();
    const room = el.scrollWidth - el.clientWidth;
    if (r.left - pad < box.left) {
      el.scrollLeft = Math.max(0, el.scrollLeft + (r.left - pad - box.left));
    } else if (r.right + pad > box.right) {
      el.scrollLeft = Math.min(room, el.scrollLeft + (r.right + pad - box.right));
    }
  }, [revealKey]);

  const nudge = (dir: number): void => {
    const el = strip.current;
    if (!el) return;
    // 一次翻一整屏、只留一小截搭头：挪太少要按好几下，挪太多会看漏中间那几件。
    // 不用平滑滚动：动画途中读到的位置是半截的，落点也不好对
    const step = Math.max(110, el.clientWidth - 20);
    el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + dir * step));
  };

  const overflowing = more.left || more.right;
  const cls =
    'scroll-row' + (className ? ' ' + className : '') + (more.left ? ' cut-left' : '') + (more.right ? ' cut-right' : '');
  return (
    <div className={cls}>
      {overflowing ? (
        <button
          className={'scroll-nudge' + (more.left ? '' : ' resting')}
          tabIndex={-1}
          onClick={() => nudge(-1)}
          title="往左看：这边还有按钮"
        >
          ‹
        </button>
      ) : null}
      <div className="scroll-strip" ref={strip} onScroll={measure}>
        {children}
      </div>
      {overflowing ? (
        <button
          className={'scroll-nudge' + (more.right ? '' : ' resting')}
          tabIndex={-1}
          onClick={() => nudge(1)}
          title="往右看：这边还有按钮"
        >
          ›
        </button>
      ) : null}
    </div>
  );
}
