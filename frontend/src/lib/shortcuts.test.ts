import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { pressed, useShortcuts } from './shortcuts';

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

describe('pressed', () => {
  it('matches by character on any layout and by US position', () => {
    // Turkish Q: "/" is Shift+7, "[" is AltGr+8 (Windows reports AltGr as Ctrl+Alt).
    expect(pressed(key({ key: '/', code: 'Digit7', shiftKey: true }), '/')).toBe(true);
    expect(pressed(key({ key: '[', code: 'Digit8', altKey: true, ctrlKey: true }), '[')).toBe(true);
    // The US "/" position types "." on a Turkish keyboard; it still counts as "/".
    expect(pressed(key({ key: '.', code: 'Slash' }), '/')).toBe(true);
    expect(pressed(key({ key: 'ğ', code: 'BracketLeft' }), '[')).toBe(true);
    expect(pressed(key({ key: '?', code: 'Minus', shiftKey: true }), '?')).toBe(true);
    expect(pressed(key({ key: 'j', code: 'KeyJ' }), 'k')).toBe(false);
  });
});

describe('useShortcuts', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('ignores plain keys while typing but not ⌘ / Ctrl combinations', () => {
    const plain = vi.fn();
    const palette = vi.fn();
    renderHook(() =>
      useShortcuts([
        { keys: 'j', run: plain },
        { keys: 'k', mod: true, run: palette },
      ]),
    );
    const input = document.body.appendChild(document.createElement('input'));
    input.dispatchEvent(key({ key: 'j', code: 'KeyJ' }));
    expect(plain).not.toHaveBeenCalled();
    input.dispatchEvent(key({ key: 'k', code: 'KeyK', ctrlKey: true }));
    expect(palette).toHaveBeenCalledTimes(1);
    window.dispatchEvent(key({ key: 'j', code: 'KeyJ' }));
    expect(plain).toHaveBeenCalledTimes(1);
  });

  it('runs a two-key sequence and AltGr characters, and pauses while a dialog is open', () => {
    const catalog = vi.fn();
    const tab = vi.fn();
    renderHook(() =>
      useShortcuts([
        { keys: 'g c', run: catalog },
        { keys: '[', run: tab },
      ]),
    );
    window.dispatchEvent(key({ key: 'g', code: 'KeyG' }));
    window.dispatchEvent(key({ key: 'c', code: 'KeyC' }));
    expect(catalog).toHaveBeenCalledTimes(1);
    window.dispatchEvent(key({ key: 'c', code: 'KeyC' }));
    expect(catalog).toHaveBeenCalledTimes(1);
    window.dispatchEvent(key({ key: '[', code: 'Digit8', altKey: true, ctrlKey: true }));
    expect(tab).toHaveBeenCalledTimes(1);
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    // Radix: role=dialog + data-state=open, no aria-modal.
    dialog.setAttribute('data-state', 'open');
    window.dispatchEvent(key({ key: '[', code: 'BracketLeft' }));
    expect(tab).toHaveBeenCalledTimes(1);
  });
});
