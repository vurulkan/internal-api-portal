import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Boxes, Clock, LayoutGrid, List, Play, Plus, RotateCw, SearchX, Star, TriangleAlert, X } from 'lucide-react';
import type { ApiSummary, OperationHit } from '@/lib/api';
import {
  accessLevel,
  countByStatus,
  facetCounts,
  filterApis,
  filtersToParams,
  hasFilters,
  parseFilters,
  sortApis,
  specHealth,
  STATUS_FILTERS,
  type CatalogFilters,
  type Sort,
  type StatusFilter,
} from '@/lib/catalog';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useCatalog, useMe, useSearch, useToggleFavorite } from '@/hooks/queries';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { SectionPanel } from '@/components/shell/shell-context';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  ErrorState,
  Highlight,
  IconButton,
  LoadingRegion,
  MethodBadge,
  PageHeader,
  Select,
  Skeleton,
  type Column,
} from '@/components/ui';

export default function CatalogPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('catalog.title'));
  const me = useMe();
  const catalog = useCatalog();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const apis = useMemo(() => catalog.data ?? [], [catalog.data]);
  const visible = useMemo(() => sortApis(filterApis(apis, filters), filters.sort), [apis, filters]);
  const search = useSearch(filters.q);
  const filtering = hasFilters(filters);
  const canCreate = !!me.data?.capabilities?.canCreateApi || !!me.data?.user.isAdmin;
  const specProblems = apis.filter((a) => ['error', 'missing'].includes(specHealth(a))).length;

  function update(patch: Partial<CatalogFilters>) {
    setParams(filtersToParams({ ...filters, ...patch }), { replace: true });
  }
  function toggle<K extends 'tags' | 'owners' | 'status'>(key: K, value: CatalogFilters[K][number], on: boolean) {
    const current = filters[key] as string[];
    update({ [key]: on ? [...current, value] : current.filter((v) => v !== value) } as Partial<CatalogFilters>);
  }
  function clearFilters() {
    update({ q: '', tags: [], owners: [], status: [] });
  }

  return (
    <>
      <SectionPanel title={t('catalog.filters')}>
        <FilterPanel apis={apis} filters={filters} toggle={toggle} update={update} clear={clearFilters} />
      </SectionPanel>

      <PageHeader
        title={t('catalog.title')}
        description={t('catalog.description')}
        meta={
          catalog.isSuccess && (
            <>
              <span className="text-[13px] text-muted-foreground">{t('catalog.count', { count: apis.length })}</span>
              {specProblems > 0 && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto text-[13px] text-destructive"
                  onClick={() => update({ status: ['specError'] })}
                >
                  <TriangleAlert aria-hidden="true" />
                  {t('catalog.specProblems', { count: specProblems })}
                </Button>
              )}
            </>
          )
        }
        actions={
          <>
            <div
              role="group"
              aria-label={t('catalog.layout')}
              className="flex rounded-md border border-border bg-card p-0.5"
            >
              <IconButton
                size="icon-sm"
                label={t('catalog.grid')}
                icon={<LayoutGrid aria-hidden="true" />}
                aria-pressed={filters.view === 'grid'}
                className={cn(filters.view === 'grid' && 'bg-muted')}
                onClick={() => update({ view: 'grid' })}
              />
              <IconButton
                size="icon-sm"
                label={t('catalog.list')}
                icon={<List aria-hidden="true" />}
                aria-pressed={filters.view === 'list'}
                className={cn(filters.view === 'list' && 'bg-muted')}
                onClick={() => update({ view: 'list' })}
              />
            </div>
            <Button onClick={() => void catalog.refetch()} loading={catalog.isFetching && !catalog.isPending}>
              <RotateCw aria-hidden="true" />
              {t('common.refresh')}
            </Button>
            {canCreate && (
              <Button asChild variant="accent">
                <Link to="/admin/apis?new=1">
                  <Plus aria-hidden="true" />
                  {t('admin.apis.new')}
                </Link>
              </Button>
            )}
          </>
        }
      />

      {catalog.isPending ? (
        <LoadingRegion className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </LoadingRegion>
      ) : catalog.isError ? (
        <div className="rounded-lg border border-border bg-card">
          <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
        </div>
      ) : apis.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card">
          <EmptyState
            icon={Boxes}
            title={t('catalog.emptyTitle')}
            description={canCreate ? t('catalog.emptyBodyAdmin') : t('catalog.emptyBody')}
            action={
              canCreate && (
                <Button asChild variant="accent">
                  <Link to="/admin/apis?new=1">
                    <Plus aria-hidden="true" />
                    {t('catalog.addFirst')}
                  </Link>
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="space-y-5">
          {!filtering && <Shortcuts apis={apis} />}
          {filtering && <ActiveFilters filters={filters} toggle={toggle} update={update} clear={clearFilters} />}
          {filters.q.trim().length >= 2 && <OperationResults query={filters.q} state={search} />}

          <section aria-labelledby="catalog-apis">
            <h2 id="catalog-apis" className="mb-3 text-sm font-semibold">
              {filtering
                ? t('catalog.apisFiltered', { count: visible.length, total: apis.length })
                : t('catalog.allApis', { count: apis.length })}
            </h2>
            {visible.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card">
                <EmptyState
                  icon={SearchX}
                  title={t('catalog.noMatchTitle')}
                  description={t('catalog.noMatchBody')}
                  action={<Button onClick={clearFilters}>{t('catalog.clearFilters')}</Button>}
                />
              </div>
            ) : filters.view === 'list' ? (
              <ApiTable apis={visible} query={filters.q} />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map((api) => (
                  <li key={api.id} className="min-w-0">
                    <ApiCard api={api} query={filters.q} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function FilterPanel({
  apis,
  filters,
  toggle,
  update,
  clear,
}: {
  apis: ApiSummary[];
  filters: CatalogFilters;
  toggle: <K extends 'tags' | 'owners' | 'status'>(key: K, value: CatalogFilters[K][number], on: boolean) => void;
  update: (patch: Partial<CatalogFilters>) => void;
  clear: () => void;
}) {
  const { t } = useTranslation();
  const tags = useMemo(() => facetCounts(apis, (a) => a.tags ?? []), [apis]);
  const owners = useMemo(() => facetCounts(apis, (a) => (a.ownerTeam ? [a.ownerTeam] : [])), [apis]);
  const statusCounts = useMemo(() => countByStatus(apis), [apis]);

  return (
    <div className="space-y-5">
      <div className="px-2">
        <label htmlFor="catalog-sort" className="mb-1.5 block text-[13px] font-medium">
          {t('catalog.sort')}
        </label>
        <Select
          id="catalog-sort"
          className="h-8"
          value={filters.sort}
          onValueChange={(v) => update({ sort: v as Sort })}
          options={[
            { value: 'name', label: t('catalog.sorts.name') },
            { value: 'viewed', label: t('catalog.sorts.viewed') },
            { value: 'refreshed', label: t('catalog.sorts.refreshed') },
          ]}
        />
      </div>
      <FacetGroup
        legend={t('catalog.show')}
        items={STATUS_FILTERS.filter((s) => statusCounts[s] > 0 || filters.status.includes(s)).map((s) => [
          s,
          statusCounts[s],
          t(`catalog.status.${s}`),
        ])}
        selected={filters.status}
        onToggle={(value, on) => toggle('status', value as StatusFilter, on)}
      />
      <FacetGroup
        legend={t('catalog.owner')}
        items={owners.map(([o, n]) => [o, n, o])}
        selected={filters.owners}
        onToggle={(v, on) => toggle('owners', v, on)}
      />
      <FacetGroup
        legend={t('catalog.tags')}
        items={tags.map(([tag, n]) => [tag, n, tag])}
        selected={filters.tags}
        onToggle={(v, on) => toggle('tags', v, on)}
        empty={t('catalog.noTags')}
      />
      {hasFilters(filters) && (
        <Button variant="link" size="sm" className="px-2" onClick={clear}>
          {t('catalog.clearFilters')}
        </Button>
      )}
    </div>
  );
}

function FacetGroup({
  legend,
  items,
  selected,
  onToggle,
  empty,
}: {
  legend: string;
  items: [string, number, string][];
  selected: string[];
  onToggle: (value: string, on: boolean) => void;
  empty?: string;
}) {
  if (items.length === 0 && !empty) return null;
  return (
    <fieldset className="space-y-0.5">
      <legend className="px-2 pb-1 text-[13px] font-medium">{legend}</legend>
      {items.length === 0 && <p className="px-2 text-[13px] text-muted-foreground">{empty}</p>}
      {items.map(([value, count, label]) => (
        <div key={value} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-muted">
          <Checkbox label={label} checked={selected.includes(value)} onCheckedChange={(on) => onToggle(value, on)} />
          <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
        </div>
      ))}
    </fieldset>
  );
}

function ActiveFilters({
  filters,
  toggle,
  update,
  clear,
}: {
  filters: CatalogFilters;
  toggle: <K extends 'tags' | 'owners' | 'status'>(key: K, value: CatalogFilters[K][number], on: boolean) => void;
  update: (patch: Partial<CatalogFilters>) => void;
  clear: () => void;
}) {
  const { t } = useTranslation();
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...(filters.q.trim() ? [{ key: 'q', label: `“${filters.q.trim()}”`, remove: () => update({ q: '' }) }] : []),
    ...filters.status.map((s) => ({
      key: `s:${s}`,
      label: t(`catalog.status.${s}`),
      remove: () => toggle('status', s, false),
    })),
    ...filters.owners.map((o) => ({
      key: `o:${o}`,
      label: `${t('catalog.owner')}: ${o}`,
      remove: () => toggle('owners', o, false),
    })),
    ...filters.tags.map((tag) => ({ key: `t:${tag}`, label: `#${tag}`, remove: () => toggle('tags', tag, false) })),
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={t('catalog.activeFilters')} role="group">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card py-0.5 pr-0.5 pl-2 text-[13px]"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.remove}
            aria-label={t('catalog.removeFilter', { filter: chip.label })}
            className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      ))}
      <Button variant="link" size="sm" onClick={clear}>
        {t('catalog.clearAll')}
      </Button>
    </div>
  );
}

/** Favorites and recently viewed APIs, when nothing is filtered. */
function Shortcuts({ apis }: { apis: ApiSummary[] }) {
  const { t } = useTranslation();
  const favorites = apis.filter((a) => a.favorite).sort((a, b) => a.name.localeCompare(b.name));
  const recent = apis
    .filter((a) => a.lastViewedAt)
    .sort((a, b) => new Date(b.lastViewedAt!).getTime() - new Date(a.lastViewedAt!).getTime())
    .slice(0, 5);
  if (favorites.length === 0 && recent.length === 0) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {favorites.length > 0 && (
        <ShortcutList
          title={t('catalog.favorites')}
          icon={<Star className="size-4 fill-current text-warning" aria-hidden="true" />}
          apis={favorites}
        />
      )}
      {recent.length > 0 && (
        <ShortcutList
          title={t('catalog.recent')}
          icon={<Clock className="size-4 text-muted-foreground" aria-hidden="true" />}
          apis={recent}
          recent
        />
      )}
    </div>
  );
}

function ShortcutList({
  title,
  icon,
  apis,
  recent,
}: {
  title: string;
  icon: React.ReactNode;
  apis: ApiSummary[];
  recent?: boolean;
}) {
  return (
    <section aria-label={title} className="min-w-0 rounded-lg border border-border bg-card p-3">
      <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
        {icon}
        {title}
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {apis.map((api) => (
          <li key={api.id} className="min-w-0">
            <Link
              to={`/apis/${api.id}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[13px] hover:bg-muted"
              title={recent && api.lastViewedAt ? formatDateTime(api.lastViewedAt) : undefined}
            >
              <span className="truncate">{api.name}</span>
              {recent && api.lastViewedAt && (
                <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(api.lastViewedAt)}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OperationResults({ query, state }: { query: string; state: ReturnType<typeof useSearch> }) {
  const { t } = useTranslation();
  const ops = state.data?.operations ?? [];
  return (
    <section aria-labelledby="catalog-operations" aria-busy={state.isFetching}>
      <h2 id="catalog-operations" className="mb-3 text-sm font-semibold">
        {state.isPending ? t('catalog.operations') : t('catalog.operationsFound', { count: ops.length })}
      </h2>
      {state.isPending ? (
        <LoadingRegion className="space-y-1.5">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </LoadingRegion>
      ) : state.isError ? (
        <div className="rounded-lg border border-border bg-card">
          <ErrorState error={state.error} onRetry={() => void state.refetch()} />
        </div>
      ) : ops.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
          {t('catalog.noOperations')}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {ops.slice(0, 20).map((op) => (
            <li key={`${op.apiId} ${op.method} ${op.path}`}>
              <OperationRow op={op} query={query} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OperationRow({ op, query }: { op: OperationHit; query: string }) {
  const { t } = useTranslation();
  const target = `/apis/${op.apiId}?${new URLSearchParams({ op: `${op.method} ${op.path}`, tab: 'try' })}`;
  return (
    <Link to={target} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 hover:bg-muted/60">
      {/* Spaces between the parts keep the link's accessible name readable. */}
      <MethodBadge method={op.method} />{' '}
      <span className={cn('min-w-0 font-mono text-[13px] break-token', op.deprecated && 'line-through')}>
        <Highlight text={op.path} query={query} />
      </span>{' '}
      {op.summary && (
        <span className="min-w-0 text-[13px] text-muted-foreground">
          <Highlight text={op.summary} query={query} />
        </span>
      )}{' '}
      {op.deprecated && <Badge variant="warning">{t('catalog.deprecated')}</Badge>}{' '}
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{op.apiName}</span>
    </Link>
  );
}

function SpecBadge({ api }: { api: ApiSummary }) {
  const { t } = useTranslation();
  const health = specHealth(api);
  const when = api.lastSpecRefreshAt ? formatRelative(api.lastSpecRefreshAt) : '';
  const title = [api.lastSpecRefreshAt && formatDateTime(api.lastSpecRefreshAt), api.specError]
    .filter(Boolean)
    .join(' — ');
  if (health === 'error') {
    return (
      <Badge variant="destructive" title={title || undefined}>
        <TriangleAlert aria-hidden="true" />
        {t('catalog.spec.error')}
      </Badge>
    );
  }
  if (health === 'missing') return <Badge variant="warning">{t('catalog.spec.missing')}</Badge>;
  return (
    <Badge variant={health === 'stale' ? 'warning' : 'outline'} title={title || undefined}>
      {health === 'stale' ? t('catalog.spec.stale', { when }) : t('catalog.spec.ok', { when })}
    </Badge>
  );
}

function AccessBadge({ api }: { api: ApiSummary }) {
  const { t } = useTranslation();
  const level = accessLevel(api);
  return (
    <Badge variant={level === 'manage' ? 'info' : level === 'invoke' ? 'success' : 'neutral'}>
      {t(`catalog.accessLevel.${level}`)}
    </Badge>
  );
}

function FavoriteButton({ api, className }: { api: ApiSummary; className?: string }) {
  const { t } = useTranslation();
  const toggle = useToggleFavorite();
  const label = api.favorite ? t('catalog.unfavorite', { name: api.name }) : t('catalog.favorite', { name: api.name });
  return (
    <IconButton
      size="icon-sm"
      label={label}
      aria-pressed={api.favorite}
      className={className}
      icon={<Star aria-hidden="true" className={cn(api.favorite && 'fill-current text-warning')} />}
      onClick={() => toggle.mutate({ id: api.id, favorite: !api.favorite })}
    />
  );
}

function ApiCard({ api, query }: { api: ApiSummary; query: string }) {
  const { t } = useTranslation();
  const tags = api.tags ?? [];
  const canTry = api.canInvoke && api.tryItEnabled && api.isActive;
  return (
    <article
      className={cn(
        'relative flex h-full flex-col rounded-lg border border-border bg-card p-4 transition-colors duration-150 hover:border-input',
        !api.isActive && 'opacity-80',
      )}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-base font-semibold break-token">
          {/* The whole card opens the API; the star and "Try it" sit above the link layer. */}
          <Link
            to={`/apis/${api.id}`}
            className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
          >
            <Highlight text={api.name} query={query} />
          </Link>
        </h3>
        <FavoriteButton api={api} className="relative z-10 -mt-1 -mr-1" />
      </div>
      <p className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        {api.specVersion && <span className="font-mono">v{api.specVersion}</span>}
        {api.operationCount !== undefined && <span>{t('catalog.operationCount', { count: api.operationCount })}</span>}
        {api.ownerTeam && <span>{api.ownerTeam}</span>}
      </p>
      <p className="mb-3 line-clamp-2 text-[13px] text-muted-foreground" title={api.description || undefined}>
        {api.description ? <Highlight text={api.description} query={query} /> : t('catalog.noDescription')}
      </p>
      {tags.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-1" aria-label={t('catalog.tags')}>
          {tags.slice(0, 3).map((tag) => (
            <li key={tag}>
              <Badge variant="outline">#{tag}</Badge>
            </li>
          ))}
          {tags.length > 3 && (
            <li>
              <Badge
                variant="outline"
                title={tags
                  .slice(3)
                  .map((tag) => `#${tag}`)
                  .join(' ')}
              >
                {t('catalog.moreTags', { count: tags.length - 3 })}
                <span className="sr-only">: {tags.slice(3).join(', ')}</span>
              </Badge>
            </li>
          )}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <AccessBadge api={api} />
        <SpecBadge api={api} />
        {!api.isActive && <Badge variant="destructive">{t('catalog.inactive')}</Badge>}
        {canTry && (
          <Button asChild size="sm" variant="ghost" className="relative z-10 ml-auto">
            <Link to={`/apis/${api.id}?tab=try`} aria-label={t('catalog.tryApi', { name: api.name })}>
              <Play aria-hidden="true" />
              {t('api.tryIt')}
            </Link>
          </Button>
        )}
      </div>
    </article>
  );
}

function ApiTable({ apis, query }: { apis: ApiSummary[]; query: string }) {
  const { t } = useTranslation();
  const columns: Column<ApiSummary>[] = [
    {
      id: 'name',
      header: t('catalog.name'),
      sortValue: (a) => a.name,
      cell: (a) => (
        <span className="block min-w-0">
          <Link to={`/apis/${a.id}`} className="font-medium hover:underline">
            <Highlight text={a.name} query={query} />
          </Link>
          <span className="block font-mono text-xs text-muted-foreground">{a.slug}</span>
        </span>
      ),
    },
    { id: 'owner', header: t('catalog.owner'), sortValue: (a) => a.ownerTeam ?? '', cell: (a) => a.ownerTeam || '–' },
    {
      id: 'version',
      header: t('catalog.version'),
      cell: (a) => (a.specVersion ? <span className="font-mono text-xs">v{a.specVersion}</span> : '–'),
    },
    {
      id: 'ops',
      header: t('catalog.operationsShort'),
      sortValue: (a) => a.operationCount ?? -1,
      cell: (a) => <span className="tabular-nums">{a.operationCount ?? '–'}</span>,
    },
    {
      id: 'access',
      header: t('catalog.access'),
      sortValue: (a) => accessLevel(a),
      cell: (a) => <AccessBadge api={a} />,
    },
    {
      id: 'spec',
      header: t('catalog.specColumn'),
      sortValue: (a) => a.lastSpecRefreshAt ?? '',
      cell: (a) => <SpecBadge api={a} />,
    },
    {
      id: 'tags',
      header: t('catalog.tags'),
      cell: (a) => (
        <span className="text-xs text-muted-foreground">{(a.tags ?? []).map((tag) => `#${tag}`).join(' ') || '–'}</span>
      ),
    },
    {
      id: 'fav',
      header: <span className="sr-only">{t('catalog.favorites')}</span>,
      cell: (a) => <FavoriteButton api={a} />,
      className: 'w-10',
    },
  ];
  return (
    <DataTable
      caption={t('catalog.title')}
      rows={apis}
      columns={columns}
      rowKey={(a) => String(a.id)}
      pageSizes={[50, 100]}
    />
  );
}
