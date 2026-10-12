import { useEffect, type RefObject } from 'react';

/**
 * A region that scrolls must be reachable by keyboard (WCAG 2.1.1; axe
 * scrollable-region-focusable) when nothing inside it can take focus. While the
 * element's content overflows it gets tabIndex 0, so arrow keys can scroll it.
 */
export function useScrollFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const scrolls = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
      if (scrolls) el.tabIndex = 0;
      else el.removeAttribute('tabindex');
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(el);
    const mutations = new MutationObserver(update);
    mutations.observe(el, { childList: true, subtree: true });
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [ref]);
}
