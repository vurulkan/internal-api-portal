import { useEffect, useRef } from 'react';

/**
 * Keyboard shortcuts. A key matches by the character it types (event.key) or by its
 * physical position on a US layout (event.code), so `[`, `]` and `/` work on a
 * Turkish keyboard too, where they need AltGr or Shift. Plain keys are ignored while
 * typing in a field and while a dialog is open; ⌘ / Ctrl combinations (`mod`) work
 * while typing too.
 */
export type Shortcut = {
  /** A key ("k", "/", "?", "[", "Enter") or a two-key sequence ("g c"). */
  keys: string;
  mod?: boolean;
  shift?: boolean;
  /** Also while a modal dialog is open. */
  inDialog?: boolean;
  run: (event: KeyboardEvent) => void;
};

const POSITION: Record<string, string> = { '/': 'Slash', '[': 'BracketLeft', ']': 'BracketRight' };

/** Does the event press `key`? Shift is checked by the caller. */
export function pressed(event: KeyboardEvent, key: string) {
  if (key === '?') return event.key === '?';
  if (key === 'Enter') return event.key === 'Enter';
  if (event.key === key || event.key.toLowerCase() === key) return true;
  if (POSITION[key]) return event.code === POSITION[key] && !event.shiftKey;
  return /^[a-z]$/.test(key) && event.code === `Key${key.toUpperCase()}`;
}

export function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable || el.closest?.('.cm-editor')) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(
    (el as HTMLInputElement).type,
  );
}

// Radix marks open dialogs (and popovers) with data-state="open"; it doesn't set aria-modal.
const OPEN_DIALOG = '[role="dialog"][data-state="open"], [role="dialog"][aria-modal="true"], [role="alertdialog"]';

export function dialogOpen() {
  return !!document.querySelector(OPEN_DIALOG);
}

const SEQUENCE_MS = 1200;

/** ⌘ or Ctrl, but not AltGr (which Windows reports as Ctrl + Alt). */
function hasMod(event: KeyboardEvent) {
  return event.metaKey || (event.ctrlKey && !event.altKey);
}

function matches(event: KeyboardEvent, s: Shortcut, key: string) {
  const mod = hasMod(event);
  if (!!s.mod !== mod || (event.altKey && !event.ctrlKey && !s.mod && /^[a-z]$/.test(key))) return false;
  // "?" needs Shift on most layouts; other plain keys must not have it unless asked.
  if (key !== '?' && s.shift !== undefined && s.shift !== event.shiftKey) return false;
  if (key !== '?' && s.shift === undefined && event.shiftKey && /^[a-z]$/.test(key)) return false;
  return pressed(event, key);
}

/** Registers shortcuts while mounted (and `enabled`). */
export function useShortcuts(shortcuts: Shortcut[], enabled = true) {
  const latest = useRef(shortcuts);
  useEffect(() => {
    latest.current = shortcuts;
  });
  useEffect(() => {
    if (!enabled) return;
    let pending: { shortcut: Shortcut; at: number }[] = [];
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const typing = isTyping(event.target);
      const inDialog = dialogOpen();
      const usable = latest.current.filter((s) => (s.mod || !typing) && (!inDialog || s.inDialog));
      // The second key of a sequence started within the last moment.
      const now = Date.now();
      const second = pending.find(
        (p) =>
          now - p.at < SEQUENCE_MS &&
          usable.includes(p.shortcut) &&
          matches(event, p.shortcut, p.shortcut.keys.split(' ')[1]),
      );
      pending = [];
      if (second) {
        event.preventDefault();
        second.shortcut.run(event);
        return;
      }
      for (const s of usable) {
        const [first, next] = s.keys.split(' ');
        if (!matches(event, s, first)) continue;
        if (next) {
          pending.push({ shortcut: s, at: now });
          continue;
        }
        if (event.repeat && !s.mod) return;
        event.preventDefault();
        s.run(event);
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Clicks the first enabled, not hidden element marked data-shortcut="name" in the main area. */
export function clickShortcutTarget(name: string) {
  const el = Array.from(document.querySelectorAll<HTMLElement>(`#main [data-shortcut="${name}"]`)).find(
    (e) => !(e as HTMLButtonElement).disabled && !e.closest('[hidden], [inert], [aria-hidden="true"]'),
  );
  if (!el) return false;
  el.click();
  return true;
}

/** ⌘ on Apple platforms, Ctrl elsewhere (for hints). */
export const modKey =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';

function visible(el: HTMLElement) {
  return !el.closest('[hidden], [inert], [aria-hidden="true"]');
}

/**
 * j / k: moves focus through the items of a list (table rows, the operation tree,
 * catalog cards): the list holding the focus, else the first one on the page.
 * Containers are marked data-shortcut-list, their focusable items data-shortcut-item.
 */
export function moveInList(step: 1 | -1) {
  const active = document.activeElement as HTMLElement | null;
  const list =
    active?.closest<HTMLElement>('[data-shortcut-list]') ??
    // The page's list, else a side panel's (the operation tree).
    Array.from(document.querySelectorAll<HTMLElement>('#main [data-shortcut-list], aside [data-shortcut-list]')).find(
      visible,
    );
  if (!list) return false;
  const items = Array.from(list.querySelectorAll<HTMLElement>('[data-shortcut-item]')).filter(visible);
  if (items.length === 0) return false;
  const index = items.findIndex((item) => item === active || item.contains(active));
  const next =
    index === -1 ? (step === 1 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, index + step));
  items[next].focus();
  items[next].scrollIntoView?.({ block: 'nearest' });
  return true;
}

/** The open dialog, else the main area: where page shortcuts act. */
function scope(): ParentNode {
  const dialogs = document.querySelectorAll<HTMLElement>(OPEN_DIALOG);
  return dialogs[dialogs.length - 1] ?? document.getElementById('main') ?? document;
}

/**
 * [ / ]: the previous / next tab, in the open drawer or else the page: route tabs
 * (a nav marked data-shortcut-tabs, the current link has aria-current="page") or a
 * Radix tab list.
 */
export function moveTab(step: 1 | -1) {
  const root = scope();
  const links = root.querySelector<HTMLElement>('[data-shortcut-tabs]');
  if (links && visible(links)) {
    const items = Array.from(links.querySelectorAll<HTMLAnchorElement>('a[href]'));
    const index = items.findIndex((a) => a.getAttribute('aria-current') === 'page');
    const target = items[(index + step + items.length) % items.length];
    target?.click();
    target?.focus();
    return !!target;
  }
  const list = Array.from(root.querySelectorAll<HTMLElement>('[role="tablist"]')).find(visible);
  if (!list) return false;
  const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).filter(
    (tab) => tab.getAttribute('aria-disabled') !== 'true' && !(tab as HTMLButtonElement).disabled,
  );
  const index = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
  const target = tabs[(index + step + tabs.length) % tabs.length];
  if (!target) return false;
  // Radix selects a tab on mousedown (and on focus by arrow keys).
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  target.focus();
  return true;
}
