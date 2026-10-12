import { useState } from 'react';
import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Trash2, Users } from 'lucide-react';
import { api, type ApiAccess, type Group } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  LoadingRegion,
  Select,
  Skeleton,
} from '@/components/ui';
import { useAdminMutation } from '@/pages/admin/common';
import { useApiWorkspace } from './context';

/** Which groups may view or call this API, besides roles (API managers). */
export default function AccessTab() {
  const { apiDef, base } = useApiWorkspace();
  const access = useQuery({
    queryKey: queryKeys.admin.apiAccess(apiDef.id),
    queryFn: async () => (await api.apiAccess(apiDef.id)).items ?? [],
    enabled: !!apiDef.permissions?.manage,
  });
  const groups = useQuery({
    queryKey: queryKeys.admin.groups,
    queryFn: async () => (await api.groups()) ?? [],
    enabled: !!apiDef.permissions?.manage,
  });
  if (!apiDef.permissions?.manage) return <Navigate to={`${base}/overview`} replace />;
  if (access.isError || groups.isError)
    return (
      <Card>
        <ErrorState
          error={access.error ?? groups.error}
          onRetry={() => void Promise.all([access.refetch(), groups.refetch()])}
        />
      </Card>
    );
  if (!access.data || !groups.data)
    return (
      <LoadingRegion>
        <Skeleton className="h-64" />
      </LoadingRegion>
    );
  return <AccessForm key={access.dataUpdatedAt} apiId={apiDef.id} initial={access.data} groups={groups.data} />;
}

function AccessForm({ apiId, initial, groups }: { apiId: number; initial: ApiAccess[]; groups: Group[] }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(initial);
  const save = useAdminMutation({
    mutationFn: (value: ApiAccess[]) => api.setApiAccess(apiId, value),
    success: t('api.accessSaved'),
    invalidate: [queryKeys.admin.apiAccess(apiId), queryKeys.catalog],
  });
  const name = (row: ApiAccess) => groups.find((g) => g.id === row.groupId)?.name ?? row.groupName ?? `#${row.groupId}`;
  const free = groups.filter((g) => !rows.some((r) => r.groupId === g.id));
  return (
    <Card className="max-w-3xl">
      <CardHeader title={t('admin.apis.access')} description={t('admin.apis.accessBody')} />
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <EmptyState icon={Users} title={t('admin.apis.noAccess')} className="py-6" />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row, index) => (
              <li key={row.groupId} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{name(row)}</span>
                <Select
                  aria-label={t('admin.apis.accessLevel', { group: name(row) })}
                  className="w-48"
                  value={row.level}
                  onValueChange={(v) =>
                    setRows(rows.map((r, i) => (i === index ? { ...r, level: v as ApiAccess['level'] } : r)))
                  }
                  options={[
                    { value: 'view', label: t('catalog.accessLevel.view') },
                    { value: 'invoke', label: t('catalog.accessLevel.invoke') },
                  ]}
                />
                <IconButton
                  label={t('admin.apis.removeAccess', { group: name(row) })}
                  icon={<Trash2 aria-hidden="true" />}
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                />
              </li>
            ))}
          </ul>
        )}
        <Field label={t('admin.apis.grantGroup')} id="access-grant">
          <Select
            value=""
            placeholder={t('admin.apis.grantPlaceholder')}
            disabled={free.length === 0}
            onValueChange={(v) => v && setRows([...rows, { groupId: Number(v), level: 'view' }])}
            options={free.map((g) => ({ value: String(g.id), label: g.name }))}
          />
        </Field>
      </CardContent>
      <CardFooter>
        <Button onClick={() => setRows(initial)} disabled={save.isPending}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(rows)}>
          {t('common.save')}
        </Button>
      </CardFooter>
    </Card>
  );
}
