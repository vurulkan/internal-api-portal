import { describe, expect, it } from 'vitest';
import { catalog } from '@/test/fixtures';
import { filterApis, filtersToParams, fold, parseFilters, sortApis, specHealth } from './catalog';

describe('catalog filters', () => {
  it('round-trip through the URL and leave defaults out', () => {
    const params = new URLSearchParams(
      'q=pay&tag=core&tag=payments&owner=identity&status=favorites&status=bogus&sort=viewed&view=list',
    );
    const f = parseFilters(params);
    expect(f).toEqual({
      q: 'pay',
      tags: ['core', 'payments'],
      owners: ['identity'],
      status: ['favorites'],
      sort: 'viewed',
      view: 'list',
    });
    expect(filtersToParams(f).toString()).toBe(
      'q=pay&tag=core&tag=payments&owner=identity&status=favorites&sort=viewed&view=list',
    );
    expect(filtersToParams(parseFilters(new URLSearchParams())).toString()).toBe('');
  });

  it('match any tag / owner, but every status filter', () => {
    const base = parseFilters(new URLSearchParams());
    expect(filterApis(catalog, { ...base, tags: ['payments', 'core'] }).length).toBe(2);
    expect(filterApis(catalog, { ...base, status: ['favorites'] }).map((a) => a.name)).toEqual(['Identity API']);
    expect(filterApis(catalog, { ...base, status: ['favorites', 'invoke'] })).toEqual([]);
    expect(filterApis(catalog, { ...base, status: ['specError'] }).map((a) => a.name)).toEqual(['Identity API']);
    expect(filterApis(catalog, { ...base, q: 'REFUND' }).map((a) => a.name)).toEqual(['Payments API']);
  });

  it('sort names naturally', () => {
    const named = ['Service 15', 'Service 5', 'service 100', 'Service 25'].map((name, id) => ({
      ...catalog[0],
      id,
      name,
    }));
    expect(sortApis(named, 'name').map((a) => a.name)).toEqual([
      'Service 5',
      'Service 15',
      'Service 25',
      'service 100',
    ]);
  });

  it('sort by recently viewed, then name', () => {
    expect(sortApis(catalog, 'viewed').map((a) => a.name)).toEqual(['Identity API', 'Payments API']);
    expect(sortApis(catalog, 'name').map((a) => a.name)).toEqual(['Identity API', 'Payments API']);
  });

  it('spec health: ok, stale after 7 days, error, missing', () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    expect(specHealth({ specState: 'ok', lastSpecRefreshAt: '2026-10-11T12:00:00Z' }, now)).toBe('ok');
    expect(specHealth({ specState: 'ok', lastSpecRefreshAt: '2026-10-01T12:00:00Z' }, now)).toBe('stale');
    expect(specHealth({ specState: 'error', lastSpecRefreshAt: '2026-10-11T12:00:00Z' }, now)).toBe('error');
    expect(specHealth({ specState: 'missing' }, now)).toBe('missing');
  });

  it('fold ignores case and accents, Turkish letters included', () => {
    expect(fold('İŞLEM Ödeme')).toBe(fold('islem odeme'));
    expect(fold('KIRMIZI')).toBe('kirmizi');
  });
});
