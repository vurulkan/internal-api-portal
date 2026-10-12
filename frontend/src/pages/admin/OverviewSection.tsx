import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Activity, CircleCheck, KeyRound, LayoutList, Plus, ShieldAlert, TriangleAlert, Users } from 'lucide-react';
import { adminApi, type AttentionItem } from '@/lib/admin-api';
import { cn } from '@/lib/cn';
import { formatNumber, formatRelative } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { useAdminSections, useMe } from '@/hooks/queries';
import { Button, Card, CardContent, CardHeader, ErrorState, LoadingRegion, Skeleton } from '@/components/ui';

/**
 * The admin console's first page: counts, the last 24 hours, and what needs
 * attention. Each block appears only for the section the viewer may open.
 */
export default function OverviewSection() {
  const { t } = useTranslation();
  const me = useMe();
  const sections = useAdminSections();
  const overview = useQuery({
    queryKey: queryKeys.admin.overview,
    queryFn: adminApi.overview,
    refetchInterval: 60_000,
  });
  if (overview.isError)
    return (
      <Card>
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      </Card>
    );
  if (!overview.data)
    return (
      <LoadingRegion className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-48" />
      </LoadingRegion>
    );
  const { apis, users, activity, activeSessions, attention } = overview.data;
  const canCreateApi = !!me.data?.capabilities?.canCreateApi || !!me.data?.user.isAdmin;
  const canManageUsers = !!me.data?.capabilities?.canManageUsers || !!me.data?.user.isAdmin;
  const invokes = activity?.invokes ?? {};
  const invokeTotal = (invokes.success ?? 0) + (invokes.denied ?? 0) + (invokes.failed ?? 0);

  return (
    <div className="space-y-6">
      {(canCreateApi || (canManageUsers && sections.includes('users'))) && (
        <div className="flex flex-wrap gap-2">
          {canCreateApi && sections.includes('apis') && (
            <Button asChild variant="accent">
              <Link to="/admin/apis?new=1">
                <Plus aria-hidden="true" />
                {t('admin.apis.new')}
              </Link>
            </Button>
          )}
          {canManageUsers && sections.includes('users') && (
            <Button asChild>
              <Link to="/admin/users?new=1">
                <Plus aria-hidden="true" />
                {t('admin.users.new')}
              </Link>
            </Button>
          )}
        </div>
      )}

      <section aria-labelledby="overview-stats">
        <h2 id="overview-stats" className="sr-only">
          {t('admin.overview.stats')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {apis && (
            <Stat
              icon={LayoutList}
              label={t('admin.overview.apis')}
              value={apis.active}
              to="/admin/apis"
              detail={t('admin.overview.apisDetail', { total: apis.total })}
              alert={apis.specErrors > 0 ? t('admin.overview.specErrors', { count: apis.specErrors }) : undefined}
            />
          )}
          {users && (
            <Stat
              icon={Users}
              label={t('admin.overview.activeUsers')}
              value={users.active}
              to="/admin/users"
              detail={t('admin.overview.usersDetail', { count: users.signedIn24h, total: users.total })}
            />
          )}
          {activeSessions !== undefined && (
            <Stat
              icon={KeyRound}
              label={t('admin.overview.sessions')}
              value={activeSessions}
              to="/admin/sessions"
              detail={t('admin.overview.sessionsDetail')}
            />
          )}
          {activity && (
            <Stat
              icon={Activity}
              label={t('admin.overview.invokes')}
              value={invokeTotal}
              to="/admin/audit?range=24h&action=api.invoke"
              detail={t('admin.overview.invokesDetail', {
                success: formatNumber(invokes.success ?? 0),
                denied: formatNumber(invokes.denied ?? 0),
                failed: formatNumber(invokes.failed ?? 0),
              })}
            />
          )}
          {activity && (
            <Stat
              icon={ShieldAlert}
              label={t('admin.overview.denied')}
              value={activity.denied}
              to="/admin/audit?range=24h&outcome=denied"
              detail={t('admin.overview.deniedDetail', { count: activity.logins.denied ?? 0 })}
              alert={activity.denied > 0 ? t('admin.overview.reviewDenied') : undefined}
            />
          )}
        </div>
      </section>

      <Card>
        <CardHeader title={t('admin.overview.attention')} description={t('admin.overview.attentionBody')} />
        <CardContent>
          {attention.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleCheck className="size-4 text-success" aria-hidden="true" />
              {t('admin.overview.allClear')}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {attention.map((item, i) => (
                <AttentionRow key={`${item.kind}-${item.apiId ?? i}`} item={item} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        {t('admin.overview.generated', { when: formatRelative(overview.data.generatedAt) })}
      </p>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  detail,
  to,
  alert,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  detail: ReactNode;
  to: string;
  alert?: string;
}) {
  return (
    <Link
      to={to}
      className="group block rounded-xl border border-border bg-card p-4 text-card-foreground transition-colors hover:border-input hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </span>
      <span className="mt-2 block text-2xl font-semibold tabular-nums">{formatNumber(value)}</span>
      <span className="mt-1 block text-xs text-muted-foreground">{detail}</span>
      {alert && (
        <span className="mt-2 flex items-center gap-1 text-xs font-medium text-warning-subtle-foreground">
          <TriangleAlert className="size-3.5" aria-hidden="true" />
          {alert}
        </span>
      )}
    </Link>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const { t } = useTranslation();
  const link =
    item.kind === 'ldap_skip_verify'
      ? '/admin/identity?tab=ldap'
      : item.apiId
        ? `/admin/apis?edit=${item.apiId}`
        : undefined;
  return (
    <li className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
      <TriangleAlert
        className={cn(
          'mt-0.5 size-4 shrink-0',
          item.severity === 'danger' ? 'text-destructive' : 'text-warning-subtle-foreground',
        )}
        aria-label={t(`admin.overview.severity.${item.severity}`)}
      />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{t(`admin.overview.kinds.${item.kind}`, { name: item.apiName ?? '' })}</p>
        {item.detail && <p className="mt-0.5 font-mono text-xs text-muted-foreground break-token">{item.detail}</p>}
        {item.kind === 'encryption_key_in_database' && (
          <p className="mt-0.5 text-xs text-muted-foreground">{t('warnings.encryption_key_in_database')}</p>
        )}
        {item.since && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('admin.overview.since', { when: formatRelative(item.since) })}
          </p>
        )}
      </div>
      {link && (
        <Button asChild size="sm">
          <Link to={link}>{t('admin.overview.open')}</Link>
        </Button>
      )}
    </li>
  );
}
