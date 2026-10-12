import { describe, expect, it } from 'vitest';
import { formatCountdown, safeNextPath } from './format';

describe('safeNextPath', () => {
  it('keeps same-origin paths', () => {
    expect(safeNextPath('/apis/3?tab=docs#x')).toBe('/apis/3?tab=docs#x');
  });
  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    '',
    null,
    '/login?next=/x',
  ])('refuses %s', (value) => {
    expect(safeNextPath(value)).toBe('/');
  });
});

describe('formatCountdown', () => {
  it('formats minutes and seconds', () => {
    expect(formatCountdown(299.2)).toBe('5:00');
    expect(formatCountdown(61)).toBe('1:01');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});
