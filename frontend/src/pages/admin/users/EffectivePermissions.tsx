import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { adminApi, type PermissionSource } from '@/lib/admin-api';
import { queryKeys } from '@/lib/query';
import { useCatalog } from '@/hooks/queries';
import { Alert, Badge, ErrorState, LoadingRegion, Skeleton } from '@/components/ui';

/**
 * What the user may do, and why: every scope with the group (and role) it comes
 * from. While the group selection differs from the saved one it previews the
 * result and marks what the change adds and removes.
 */
export function EffectivePermissions({
  userId,
  isAdmin,
  groupIds,
  changed,
}: {
  userId?: number;
  isAdmin: boolean;
  groupIds: number[];
  changed: boolean;
}) {
  const { t } = useTranslation();
  const sorted = useMemo(() => [...groupIds].sort((a, b) => a - b), [groupIds]);
  const current = useQuery({
    queryKey: queryKeys.admin.userPermissions(userId ?? 0),
    queryFn: () => adminApi.userPermissions(userId!),
    enabled: !!userId,
  });
  const preview = useQuery({
    queryKey: queryKeys.admin.userPermissions(userId ?? 0, sorted),
    queryFn: () => adminApi.userPermissions(userId!, sorted),
    enabled: !!userId && changed,
    placeholderData: keepPreviousData,
  });
  const apiNames = useApiNames();

  if (isAdmin) return <Alert variant="info">{t('admin.users.adminHasAll')}</Alert>;
  if (!userId) return <p className="text-[13px] text-muted-foreground">{t('admin.users.permissionsAfterCreate')}</p>;
  const shown = changed ? preview : current;
  if (shown.isError) return <ErrorState error={shown.error} onRetry={() => void shown.refetch()} />;
  if (!shown.data || (changed && !current.data))
    return (
      <LoadingRegion className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24" />
      </LoadingRegion>
    );

  const before = new Set(current.data?.scopes ?? []);
  const after = new Set(shown.data.scopes);
  const removed = changed ? [...before].filter((s) => !after.has(s)) : [];
  const bySource = new Map<string, PermissionSource[]>();
  for (const src of shown.data.sources) bySource.set(src.scope, [...(bySource.get(src.scope) ?? []), src]);

  return (
    <section aria-labelledby="effective-title" className="space-y-2">
      <h3 id="effective-title" className="text-sm font-semibold">
        {changed ? t('admin.users.permissionsPreview') : t('admin.users.permissions')}
        <span className="ml-2 font-normal text-muted-foreground tabular-nums">
          {t('admin.roles.selected', { count: after.size })}
        </span>
      </h3>
      {after.size === 0 && removed.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t('admin.users.noPermissions')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
          {shown.data.scopes.map((scope) => (
            <li key={scope} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2">
              <span className="flex min-w-0 items-center gap-1.5">
                {changed && !before.has(scope) && (
                  <Badge variant="success">
                    <Plus className="size-3" aria-hidden="true" />
                    {t('admin.users.added')}
                  </Badge>
                )}
                <code className="font-mono text-xs font-semibold break-token">{scope}</code>
                {apiName(scope, apiNames) && <span className="text-muted-foreground">{apiName(scope, apiNames)}</span>}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {(bySource.get(scope) ?? []).map((src) => sourceLabel(src, t)).join(' · ')}
              </span>
            </li>
          ))}
          {removed.map((scope) => (
            <li key={scope} className="flex flex-wrap items-center gap-1.5 px-3 py-2 text-muted-foreground">
              <Badge variant="destructive">
                <Minus className="size-3" aria-hidden="true" />
                {t('admin.users.removed')}
              </Badge>
              <code className="font-mono text-xs line-through">{scope}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function sourceLabel(src: PermissionSource, t: (key: string, options?: Record<string, string>) => string) {
  if (src.via === 'role') return t('admin.users.viaRole', { group: src.groupName, role: src.roleName ?? '' });
  if (src.via === 'owner') return t('admin.users.viaOwner', { group: src.groupName });
  return t('admin.users.viaAccess', { group: src.groupName });
}

/** Names of the APIs the viewer can see, for api:<id>:… scopes. */
function useApiNames() {
  const catalog = useCatalog();
  return useMemo(() => new Map((catalog.data ?? []).map((a) => [a.id, a.name])), [catalog.data]);
}

function apiName(scope: string, names: Map<number, string>) {
  const m = /^api:(\d+):/.exec(scope);
  return m ? names.get(Number(m[1])) : undefined;
}
