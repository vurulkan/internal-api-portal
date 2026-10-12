import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Boxes, RotateCw, SearchX } from 'lucide-react';
import type { ApiSummary } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useCatalog } from '@/hooks/queries';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { SectionPanel } from '@/components/shell/shell-context';
import { Badge, Button, Checkbox, EmptyState, ErrorState, LoadingRegion, PageHeader, Skeleton } from '@/components/ui';

export default function CatalogPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('catalog.title'));
  const catalog = useCatalog();
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').trim().toLowerCase();
  const selectedTags = params.getAll('tag');
  const apis = useMemo(() => catalog.data ?? [], [catalog.data]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    apis.forEach((api) => (api.tags ?? []).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [apis]);

  const filtered = useMemo(
    () =>
      apis.filter((api) => {
        if (selectedTags.length && !selectedTags.some((tag) => (api.tags ?? []).includes(tag))) return false;
        if (!query) return true;
        return [api.name, api.slug, api.description, api.ownerTeam, ...(api.tags ?? [])]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(query));
      }),
    [apis, selectedTags, query],
  );

  function toggleTag(tag: string, on: boolean) {
    const next = new URLSearchParams(params);
    const tags = new Set(next.getAll('tag'));
    if (on) tags.add(tag);
    else tags.delete(tag);
    next.delete('tag');
    Array.from(tags).forEach((value) => next.append('tag', value));
    setParams(next, { replace: true });
  }

  function clearFilters() {
    setParams(new URLSearchParams(), { replace: true });
  }

  const filtering = selectedTags.length > 0 || query !== '';

  return (
    <>
      <SectionPanel title={t('catalog.filters')}>
        {tagCounts.length === 0 ? (
          <p className="px-2 text-[13px] text-muted-foreground">{t('catalog.noTags')}</p>
        ) : (
          <fieldset className="space-y-1">
            <legend className="px-2 pb-1 text-[13px] font-medium">{t('catalog.tags')}</legend>
            {tagCounts.map(([tag, count]) => (
              <div key={tag} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-muted">
                <Checkbox
                  label={tag}
                  checked={selectedTags.includes(tag)}
                  onCheckedChange={(on) => toggleTag(tag, on)}
                />
                <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
              </div>
            ))}
          </fieldset>
        )}
        {filtering && (
          <Button variant="link" size="sm" className="mt-3 px-2" onClick={clearFilters}>
            {t('catalog.clearFilters')}
          </Button>
        )}
      </SectionPanel>

      <PageHeader
        title={t('catalog.title')}
        description={t('catalog.description')}
        actions={
          <Button onClick={() => void catalog.refetch()} loading={catalog.isFetching && !catalog.isPending}>
            <RotateCw aria-hidden="true" />
            {t('common.refresh')}
          </Button>
        }
      />

      {catalog.isPending ? (
        <LoadingRegion className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </LoadingRegion>
      ) : catalog.isError ? (
        <div className="rounded-lg border border-border bg-card">
          <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
        </div>
      ) : apis.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card">
          <EmptyState icon={Boxes} title={t('catalog.emptyTitle')} description={t('catalog.emptyBody')} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card">
          <EmptyState
            icon={SearchX}
            title={t('catalog.noMatchTitle')}
            description={t('catalog.noMatchBody')}
            action={<Button onClick={clearFilters}>{t('catalog.clearFilters')}</Button>}
          />
        </div>
      ) : (
        <>
          <p className="mb-3 text-[13px] text-muted-foreground" aria-live="polite">
            {filtering
              ? t('catalog.countFiltered', { count: filtered.length, total: apis.length })
              : t('catalog.count', { count: apis.length })}
          </p>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((api) => (
              <li key={api.id} className="min-w-0">
                <ApiCard api={api} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function ApiCard({ api }: { api: ApiSummary }) {
  const { t } = useTranslation();
  const access = api.canInvoke ? 'invoke' : api.canView ? 'view' : 'none';
  return (
    <article
      className={cn(
        'group relative flex h-full flex-col rounded-lg border border-border bg-card p-4 transition-colors duration-150 hover:border-input',
        !api.isActive && 'opacity-80',
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-base font-semibold break-token">
          <Link
            to={`/apis/${api.id}`}
            className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
          >
            {api.name}
          </Link>
        </h2>
        {!api.isActive && <Badge variant="destructive">{t('catalog.inactive')}</Badge>}
      </div>
      <p className="mb-3 line-clamp-2 text-[13px] text-muted-foreground">
        {api.description || t('catalog.noDescription')}
      </p>
      {(api.tags ?? []).length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-1" aria-label={t('catalog.tags')}>
          {api.tags.map((tag) => (
            <li key={tag}>
              <Badge variant="outline">{tag}</Badge>
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-muted-foreground">{t('catalog.owner')}</dt>
        <dd className="truncate">{api.ownerTeam || t('catalog.unassigned')}</dd>
        <dt className="text-muted-foreground">{t('catalog.access')}</dt>
        <dd>
          <Badge variant={access === 'invoke' ? 'success' : access === 'view' ? 'info' : 'neutral'}>
            {t(`catalog.accessLevel.${access}`)}
          </Badge>
        </dd>
        <dt className="text-muted-foreground">{t('catalog.slug')}</dt>
        <dd className="truncate font-mono text-xs leading-5">{api.slug}</dd>
      </dl>
    </article>
  );
}
