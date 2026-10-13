// Catalog filtering. The state lives in the URL (?q=&tag=&owner=&status=&sort=&view=)
// so a filtered view is a shareable link and the back button works. The view (cards /
// list) and the sort order are also remembered in this browser: opening the catalog
// without them in the URL adds the last choice (see CatalogPage).
import type { ApiSummary } from './api';
import { readPref, writePref } from './storage';

const VIEW_KEY = 'portal.catalog.view';
const SORT_KEY = 'portal.catalog.sort';

/** A spec older than this is shown as stale. */
export const STALE_DAYS = 7;

export const STATUS_FILTERS = ['favorites', 'invoke', 'manage', 'specError', 'specStale', 'inactive'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const SORTS = ['name', 'viewed', 'refreshed'] as const;
export type Sort = (typeof SORTS)[number];
export type View = 'grid' | 'list';

export type CatalogFilters = {
  q: string;
  tags: string[];
  owners: string[];
  status: StatusFilter[];
  sort: Sort;
  view: View;
};

/** Remembers the view and sort order chosen last. */
export function rememberLayout(patch: Partial<Pick<CatalogFilters, 'view' | 'sort'>>) {
  if (patch.view) writePref(VIEW_KEY, patch.view);
  if (patch.sort) writePref(SORT_KEY, patch.sort);
}

/** The view and sort chosen last in this browser (defaults when none). */
export function rememberedLayout(): Pick<CatalogFilters, 'view' | 'sort'> {
  const sort = readPref(SORT_KEY);
  return {
    view: readPref(VIEW_KEY) === 'list' ? 'list' : 'grid',
    sort: (SORTS as readonly string[]).includes(sort ?? '') ? (sort as Sort) : 'name',
  };
}

export function parseFilters(params: URLSearchParams): CatalogFilters {
  const sort = params.get('sort');
  const view = params.get('view');
  return {
    q: params.get('q') ?? '',
    tags: params.getAll('tag'),
    owners: params.getAll('owner'),
    status: params.getAll('status').filter((s): s is StatusFilter => (STATUS_FILTERS as readonly string[]).includes(s)),
    sort: (SORTS as readonly string[]).includes(sort ?? '') ? (sort as Sort) : 'name',
    view: view === 'list' ? 'list' : 'grid',
  };
}

/** Defaults are left out, so the plain catalog is just "/". */
export function filtersToParams(f: CatalogFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  f.tags.forEach((t) => params.append('tag', t));
  f.owners.forEach((o) => params.append('owner', o));
  f.status.forEach((s) => params.append('status', s));
  if (f.sort !== 'name') params.set('sort', f.sort);
  if (f.view !== 'grid') params.set('view', f.view);
  return params;
}

export function hasFilters(f: CatalogFilters) {
  return f.q.trim() !== '' || f.tags.length > 0 || f.owners.length > 0 || f.status.length > 0;
}

export type SpecHealth = 'ok' | 'stale' | 'error' | 'missing';

export function specHealth(api: Pick<ApiSummary, 'specState' | 'lastSpecRefreshAt'>, now = Date.now()): SpecHealth {
  if (api.specState === 'error') return 'error';
  if (api.specState === 'missing' || !api.lastSpecRefreshAt) return 'missing';
  const age = now - new Date(api.lastSpecRefreshAt).getTime();
  return age > STALE_DAYS * 86_400_000 ? 'stale' : 'ok';
}

export function accessLevel(api: Pick<ApiSummary, 'canInvoke' | 'canManage' | 'canView'>) {
  return api.canManage ? 'manage' : api.canInvoke ? 'invoke' : api.canView ? 'view' : 'none';
}

/** Case- and accent-insensitive "contains", Turkish dotless ı included. */
export function fold(value: string) {
  return value
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ı/g, 'i');
}

function matchesQuery(api: ApiSummary, q: string) {
  const needle = fold(q.trim());
  if (!needle) return true;
  return [api.name, api.slug, api.description, api.ownerTeam, ...(api.tags ?? [])].some(
    (v) => v && fold(v).includes(needle),
  );
}

function matchesStatus(api: ApiSummary, status: StatusFilter, now: number) {
  switch (status) {
    case 'favorites':
      return api.favorite;
    case 'invoke':
      return api.canInvoke && api.tryItEnabled;
    case 'manage':
      return api.canManage;
    case 'specError':
      return specHealth(api, now) === 'error' || specHealth(api, now) === 'missing';
    case 'specStale':
      return specHealth(api, now) === 'stale';
    case 'inactive':
      return !api.isActive;
  }
}

/** Tags and owners: any of the chosen; status filters: all of the chosen. */
export function filterApis(apis: ApiSummary[], f: CatalogFilters, now = Date.now()) {
  return apis.filter(
    (api) =>
      matchesQuery(api, f.q) &&
      (f.tags.length === 0 || f.tags.some((t) => (api.tags ?? []).includes(t))) &&
      (f.owners.length === 0 || f.owners.includes(api.ownerTeam || '')) &&
      f.status.every((s) => matchesStatus(api, s, now)),
  );
}

export function sortApis(apis: ApiSummary[], sort: Sort) {
  // Natural order: "Service 5" before "Service 15".
  const byName = (a: ApiSummary, b: ApiSummary) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  const time = (iso?: string) => (iso ? new Date(iso).getTime() : 0);
  return [...apis].sort((a, b) => {
    if (sort === 'viewed') return time(b.lastViewedAt) - time(a.lastViewedAt) || byName(a, b);
    if (sort === 'refreshed') return time(b.lastSpecRefreshAt) - time(a.lastSpecRefreshAt) || byName(a, b);
    return byName(a, b);
  });
}

/** Facet counts for the filter panel, over the whole catalog. */
export function facetCounts(apis: ApiSummary[], key: (api: ApiSummary) => string[]) {
  const counts = new Map<string, number>();
  apis.forEach((api) => key(api).forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1)));
  return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

/** How many APIs each status filter would show. */
export function countByStatus(apis: ApiSummary[], now = Date.now()) {
  const empty: CatalogFilters = { q: '', tags: [], owners: [], status: [], sort: 'name', view: 'grid' };
  return Object.fromEntries(
    STATUS_FILTERS.map((s) => [s, filterApis(apis, { ...empty, status: [s] }, now).length]),
  ) as Record<StatusFilter, number>;
}
