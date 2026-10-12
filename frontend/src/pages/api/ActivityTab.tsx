import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { GitCompare, History } from 'lucide-react';
import { api, auditQuery, type SpecChange } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useAdminSections } from '@/hooks/queries';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingRegion,
  MethodBadge,
  Skeleton,
  StatusBadge,
} from '@/components/ui';
import { useApiWorkspace } from './context';

/** Spec changes (operations added / removed / changed), refresh failures, recent calls. */
export default function ActivityTab() {
  const { t } = useTranslation();
  const { apiDef, ref, base } = useApiWorkspace();
  const manage = !!apiDef.permissions?.manage;
  const canAudit = useAdminSections().includes('audit');
  const history = useQuery({
    queryKey: ['api', ref, 'activity'],
    queryFn: async () => (await api.apiActivity(ref)).items ?? [],
    enabled: manage,
  });
  const calls = useQuery({
    queryKey: ['api', ref, 'calls'],
    queryFn: () =>
      api.auditLogs(
        auditQuery({ targetType: 'api', targetId: String(apiDef.id), action: 'api.invoke' }, { limit: 20 }),
      ),
    enabled: manage && canAudit,
  });
  if (!manage) return <Navigate to={`${base}/overview`} replace />;
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader title={t('api.activity.specHistory')} description={t('api.activity.specHistoryBody')} />
        <CardContent>
          {history.isPending ? (
            <LoadingRegion className="space-y-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </LoadingRegion>
          ) : history.isError ? (
            <ErrorState error={history.error} onRetry={() => void history.refetch()} />
          ) : history.data.length === 0 ? (
            <EmptyState icon={History} title={t('api.activity.noHistory')} className="py-6" />
          ) : (
            <ol className="space-y-3">
              {history.data.map((entry, i) => (
                <ChangeEntry key={`${entry.at}-${i}`} entry={entry} />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
      {canAudit && (
        <Card>
          <CardHeader title={t('api.activity.calls')} description={t('api.activity.callsBody')} />
          <CardContent className="py-1">
            {calls.isPending ? (
              <LoadingRegion className="space-y-2 py-3">
                <Skeleton className="h-9" />
                <Skeleton className="h-9" />
              </LoadingRegion>
            ) : calls.isError ? (
              <ErrorState error={calls.error} onRetry={() => void calls.refetch()} />
            ) : calls.data.items.length === 0 ? (
              <EmptyState title={t('api.activity.noCalls')} className="py-6" />
            ) : (
              <ul className="divide-y divide-border">
                {calls.data.items.map((call) => {
                  let details: { method?: string; path?: string } = {};
                  try {
                    details = JSON.parse(call.detailsJson || '{}');
                  } catch {
                    /* old entries */
                  }
                  return (
                    <li key={call.id} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                      {details.method && <MethodBadge method={details.method} />}
                      {details.path ? (
                        <code className="min-w-0 font-mono text-xs break-token">{details.path}</code>
                      ) : (
                        // Refused before the request was read (rate limit, no permission).
                        <span className="min-w-0 text-xs text-muted-foreground">
                          {call.errorMessage || call.action}
                        </span>
                      )}
                      {call.statusCode ? <StatusBadge status={call.statusCode} /> : null}
                      <span className="ml-auto text-muted-foreground" title={formatDateTime(call.timestamp)}>
                        {call.user} · {formatRelative(call.timestamp)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ChangeEntry({ entry }: { entry: SpecChange }) {
  const { t } = useTranslation();
  const lists: [string, string[], number, 'success' | 'destructive' | 'warning'][] = [
    ['added', entry.added, entry.addedCount, 'success'],
    ['removed', entry.removed, entry.removedCount, 'destructive'],
    ['changed', entry.changed, entry.changedCount, 'warning'],
  ];
  return (
    <li className="rounded-md border border-border p-3">
      <p className="flex flex-wrap items-center gap-2 text-[13px]">
        <GitCompare className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{t(`api.activity.kind.${entry.kind}`)}</span>
        {entry.version && (
          <Badge variant="outline" className="font-mono">
            v{entry.version}
          </Badge>
        )}
        {entry.kind !== 'failed' && (
          <span className="text-muted-foreground">{t('api.operationCount', { count: entry.operationCount })}</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground" title={formatDateTime(entry.at)}>
          {formatRelative(entry.at)}
        </span>
      </p>
      {entry.error && <p className="mt-1 font-mono text-xs text-destructive break-token">{entry.error}</p>}
      {lists.map(([kind, items, count, variant]) =>
        count > 0 ? (
          <details key={kind} className="mt-2">
            <summary className="cursor-pointer text-[13px]">
              <Badge variant={variant}>{t(`api.activity.${kind}`, { count })}</Badge>
            </summary>
            <ul className="mt-1 space-y-0.5 pl-2">
              {items.map((item) => {
                const [method, ...path] = item.split(' ');
                return (
                  <li key={item} className="flex items-center gap-2 text-xs">
                    <MethodBadge method={method} />
                    <code className="font-mono break-token">{path.join(' ')}</code>
                  </li>
                );
              })}
              {count > items.length && (
                <li className="text-xs text-muted-foreground">
                  {t('api.activity.more', { count: count - items.length })}
                </li>
              )}
            </ul>
          </details>
        ) : null,
      )}
    </li>
  );
}
