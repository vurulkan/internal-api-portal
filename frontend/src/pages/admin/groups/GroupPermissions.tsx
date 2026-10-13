import { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi, type PermissionSource } from '@/lib/admin-api';
import { queryKeys } from '@/lib/query';
import { useCatalog } from '@/hooks/queries';
import { Alert, Badge, ErrorState, LoadingRegion, Skeleton } from '@/components/ui';

/**
 * Everything the group's members get through the group, by where it comes from:
 * its roles, the APIs it owns, and API access lists. The last two are given on
 * the API (API definitions → Access / Owner group) and are not part of any role.
 */
export function GroupPermissions({ groupId }: { groupId: number }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: queryKeys.admin.groupPermissions(groupId),
    queryFn: () => adminApi.groupPermissions(groupId),
  });
  const catalog = useCatalog();
  const apiNames = useMemo(() => new Map((catalog.data ?? []).map((a) => [a.id, a.name])), [catalog.data]);

  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data)
    return (
      <LoadingRegion className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24" />
      </LoadingRegion>
    );
  const sources = query.data.sources;
  const byVia = (via: PermissionSource['via']) => sources.filter((s) => s.via === via);
  const apiOf = (scope: string) => {
    const m = /^api:(\d+):(\w+)$/.exec(scope);
    return m ? { id: Number(m[1]), action: m[2] } : null;
  };
  const roles = byVia('role');
  const owned = byVia('owner');
  const access = byVia('access');

  return (
    <div className="space-y-5">
      <Alert variant="info">{t('admin.groups.permissionsIntro')}</Alert>

      <section aria-labelledby="gp-roles" className="space-y-2">
        <h3 id="gp-roles" className="text-sm font-semibold">
          {t('admin.groups.fromRoles')}
        </h3>
        {roles.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t('admin.groups.noRoleScopes')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
            {roles.map((s) => {
              const api = apiOf(s.scope);
              return (
                <li key={`${s.roleId}-${s.scope}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <code className="font-mono text-xs font-semibold">{s.scope}</code>
                  {api && <span className="text-muted-foreground">{apiNames.get(api.id) ?? `#${api.id}`}</span>}
                  <Badge variant="outline" className="ml-auto">
                    {s.roleName}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="gp-direct" className="space-y-2">
        <h3 id="gp-direct" className="text-sm font-semibold">
          {t('admin.groups.directApiAccess')}
        </h3>
        <p className="text-[13px] text-muted-foreground">{t('admin.groups.directApiAccessHelp')}</p>
        {owned.length + access.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t('admin.groups.noDirectAccess')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
            {[...owned, ...access].map((s) => {
              const api = apiOf(s.scope)!;
              return (
                <li key={s.scope} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <Link to={`/admin/apis?edit=${api.id}`} className="font-medium text-link hover:underline">
                    {apiNames.get(api.id) ?? `API #${api.id}`}
                  </Link>
                  <Badge variant={s.via === 'owner' ? 'info' : 'outline'}>
                    {s.via === 'owner' ? t('admin.groups.ownerGroup') : t(`catalog.accessLevel.${api.action}`)}
                  </Badge>
                  <code className="ml-auto font-mono text-xs text-muted-foreground">{s.scope}</code>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
