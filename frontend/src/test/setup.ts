import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// Lazy routes, axe runs and parallel files make 1 s (the default) too tight for findBy*.
configure({ asyncUtilTimeout: 4000 });

// Node >= 25 defines its own global localStorage, which shadows jsdom's without
// --localstorage-file. Install an in-memory Storage so app code behaves as in a browser.
if (
  typeof globalThis.localStorage === 'undefined' ||
  globalThis.localStorage === null ||
  typeof globalThis.localStorage.getItem !== 'function'
) {
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    key: (i) => Array.from(data.keys())[i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
}

// jsdom lacks these; Radix and the theme code use them. Media queries answer as for
// a 1440px-wide light-mode screen (override window.innerWidth to test others).
if (!window.matchMedia) {
  const evaluate = (query: string) => {
    const width = window.innerWidth >= 1440 ? window.innerWidth : 1440;
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    if (min) return width >= Number(min[1]);
    if (max) return width <= Number(max[1]);
    return false;
  };
  window.matchMedia = (query: string) =>
    ({
      matches: evaluate(query),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => undefined;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => undefined;
// jsdom has no canvas; axe-core probes it.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

await import('../i18n');

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  vi.unstubAllGlobals();
});
