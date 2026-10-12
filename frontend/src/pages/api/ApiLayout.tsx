import { useMemo } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Download, Ellipsis, FileCode2, Pencil, RotateCw, Star } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative } from '@/lib/format';
import { normalizeSpec, type SpecObject } from '@/lib/openapi';
import { queryKeys } from '@/lib/query';
import { specHealth } from '@/lib/catalog';
import { useApiDetails, useApiSpec, useToggleFavorite } from '@/hooks/queries';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorState,
  IconButton,
  LoadingRegion,
  notifyError,
  notifySuccess,
  PageHeader,
  Skeleton,
} from '@/components/ui';
import { operationPath, type ApiWorkspace } from './context';

/** /apis/:ref — header, tabs and the tab's route. */
export default function ApiLayout() {
  const { t } = useTranslation();
  const { ref = '' } = useParams();
  const details = useApiDetails(ref);
  const specQuery = useApiSpec(ref);
  const spec = useMemo(() => (specQuery.data ? normalizeSpec(specQuery.data as SpecObject) : null), [specQuery.data]);
  useDocumentTitle(details.data?.name ?? t('api.title'));

  if (details.isPending) {
    return (
      <LoadingRegion className="space-y-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-9 w-96" />
        <Skeleton className="h-96" />
      </LoadingRegion>
    );
  }
  if (details.isError) {
    return (
      <Card>
        <ErrorState error={details.error} onRetry={() => void details.refetch()} />
      </Card>
    );
  }
  const apiDef = details.data;
  const base = `/apis/${encodeURIComponent(apiDef.slug || String(apiDef.id))}`;
  const manage = !!apiDef.permissions?.manage;
  const context: ApiWorkspace = { apiDef, ref, spec, specQuery, base };
  const tabs = [
    { to: `${base}/overview`, label: t('api.tabs.overview') },
    { to: `${base}/reference`, label: t('api.tabs.reference'), also: `${base}/operations/` },
    { to: `${base}/classic`, label: t('api.tabs.classic') },
    ...(manage
      ? [
          { to: `${base}/access`, label: t('api.tabs.access') },
          { to: `${base}/activity`, label: t('api.tabs.activity') },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('catalog.title'), to: '/' }, { label: apiDef.name }]}
        title={apiDef.name}
        description={apiDef.description}
        meta={<HeaderMeta context={context} />}
        actions={<HeaderActions context={context} />}
      />
      <TabNav tabs={tabs} />
      <div className="pt-4">
        <Outlet context={context} />
      </div>
    </>
  );
}

function TabNav({ tabs }: { tabs: { to: string; label: string; also?: string }[] }) {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <nav aria-label={t('api.sections')} className="flex min-w-0 gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const active = location.pathname === tab.to || (!!tab.also && location.pathname.startsWith(tab.also));
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px inline-flex items-center whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
              active && 'border-foreground text-foreground',
            )}
          >
            {tab.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

function HeaderMeta({ context }: { context: ApiWorkspace }) {
  const { t } = useTranslation();
  const { apiDef } = context;
  const canInvoke = !!apiDef.permissions?.invoke;
  const health = specHealth({ specState: apiDef.specState ?? 'ok', lastSpecRefreshAt: apiDef.lastSpecRefreshAt });
  const when = apiDef.lastSpecRefreshAt ? formatRelative(apiDef.lastSpecRefreshAt) : '';
  const title = [apiDef.lastSpecRefreshAt && formatDateTime(apiDef.lastSpecRefreshAt), apiDef.specError]
    .filter(Boolean)
    .join(' — ');
  return (
    <>
      <Badge variant={apiDef.permissions?.manage ? 'info' : canInvoke ? 'success' : 'neutral'}>
        {t(`catalog.accessLevel.${apiDef.permissions?.manage ? 'manage' : canInvoke ? 'invoke' : 'view'}`)}
      </Badge>
      {apiDef.specVersion && (
        <Badge variant="outline" className="font-mono">
          v{apiDef.specVersion}
        </Badge>
      )}
      {apiDef.ownerTeam && (
        <Link to={`/?owner=${encodeURIComponent(apiDef.ownerTeam)}`} className="rounded-md hover:underline">
          <Badge variant="outline">{apiDef.ownerTeam}</Badge>
        </Link>
      )}
      {(apiDef.tags ?? []).map((tag) => (
        <Link key={tag} to={`/?tag=${encodeURIComponent(tag)}`} className="rounded-md hover:underline">
          <Badge variant="outline">#{tag}</Badge>
        </Link>
      ))}
      {health === 'error' ? (
        <Badge variant="destructive" title={title || undefined}>
          {t('catalog.spec.error')}
        </Badge>
      ) : health === 'missing' ? (
        <Badge variant="warning">{t('catalog.spec.missing')}</Badge>
      ) : (
        <Badge variant={health === 'stale' ? 'warning' : 'neutral'} title={title || undefined}>
          {t('catalog.spec.ok', { when })}
        </Badge>
      )}
    </>
  );
}

function HeaderActions({ context }: { context: ApiWorkspace }) {
  const { t } = useTranslation();
  const { apiDef, ref, base } = context;
  const toggle = useToggleFavorite();
  const queryClient = useQueryClient();
  const on = !!apiDef.favorite;
  const manage = !!apiDef.permissions?.manage;

  async function refresh() {
    try {
      await api.refreshApiSpec(apiDef.id);
      notifySuccess(t('admin.apis.refreshed'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.api(ref) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.spec(ref) }),
        queryClient.invalidateQueries({ queryKey: ['api', ref, 'activity'] }),
      ]);
    } catch (error) {
      notifyError(error, t('admin.apis.refreshFailed'));
    }
  }

  return (
    <>
      <Button aria-pressed={on} onClick={() => toggle.mutate({ id: apiDef.id, favorite: !on })}>
        <Star aria-hidden="true" className={cn(on && 'fill-current text-warning')} />
        {on ? t('catalog.favorited') : t('catalog.addFavorite')}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <FileCode2 aria-hidden="true" />
            {t('api.spec')}
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <a href={api.specDownloadUrl(ref, 'json')} download>
              <Download aria-hidden="true" />
              {t('api.downloadJson')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={api.specDownloadUrl(ref, 'yaml')} download>
              <Download aria-hidden="true" />
              {t('api.downloadYaml')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={`${base}/classic`}>
              <FileCode2 aria-hidden="true" />
              {t('api.openClassic')}
            </Link>
          </DropdownMenuItem>
          {manage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void refresh()}>
                <RotateCw aria-hidden="true" />
                {t('admin.apis.refresh')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {manage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={t('api.more')} icon={<Ellipsis aria-hidden="true" />} variant="secondary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem asChild>
              <Link to={`/admin/apis?edit=${apiDef.id}`}>
                <Pencil aria-hidden="true" />
                {t('api.editDefinition')}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

/**
 * /apis/:ref — the reference, unless the API has no operations. Links from before
 * 2.0.0 (?op=…&tab=…) land on their new place.
 */
export function ApiIndex() {
  const [params] = useSearchParams();
  const { ref = '' } = useParams();
  const specQuery = useApiSpec(ref);
  const details = useApiDetails(ref);
  const base = `/apis/${encodeURIComponent(details.data?.slug || ref)}`;
  const op = params.get('op');
  const tab = params.get('tab');
  if (!details.data || specQuery.isPending) return null;
  if (op) {
    const spec = specQuery.data ? normalizeSpec(specQuery.data as SpecObject) : null;
    const [method, ...rest] = op.split(' ');
    const match = spec?.operations.find((o) => o.method === method && o.path === rest.join(' '));
    return <Navigate to={match ? operationPath(base, match.key) : `${base}/reference`} replace />;
  }
  if (tab === 'docs') return <Navigate to={`${base}/classic`} replace />;
  if (tab === 'details') return <Navigate to={`${base}/overview`} replace />;
  const hasOperations = !!specQuery.data && normalizeSpec(specQuery.data as SpecObject).operations.length > 0;
  return <Navigate to={hasOperations ? `${base}/reference` : `${base}/overview`} replace />;
}
