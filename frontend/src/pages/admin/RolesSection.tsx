import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Plus, ShieldCheck } from 'lucide-react';
import { api, type Role } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, type Column } from '@/components/ui';
import { matches, SearchInput, SectionToolbar, TableSkeleton, useAdminMutation } from './common';
import { RoleDrawer } from './roles/RoleDrawer';

export default function RolesSection() {
  const { t } = useTranslation();
  const roles = useQuery({ queryKey: queryKeys.admin.roles, queryFn: async () => (await api.roles()) ?? [] });
  const [search, setSearch] = useState('');
  const groups = useQuery({ queryKey: queryKeys.admin.groups, queryFn: async () => (await api.groups()) ?? [] });
  const groupNames = useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g.name])), [groups.data]);
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const remove = useAdminMutation({
    mutationFn: (id: number) => api.deleteRole(id),
    success: t('admin.roles.deleted'),
    invalidate: [queryKeys.admin.roles, queryKeys.admin.groups],
  });
  const rows = useMemo(
    () => (roles.data ?? []).filter((r) => matches(search, r.name, r.description)),
    [roles.data, search],
  );

  const columns: Column<Role>[] = [
    {
      id: 'name',
      header: t('admin.roles.name'),
      sortValue: (r) => r.name,
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      id: 'description',
      header: t('admin.roles.description'),
      cell: (r) => r.description || '–',
      className: 'text-muted-foreground',
    },
    {
      id: 'scopes',
      header: t('admin.roles.scopes'),
      sortValue: (r) => r.permissionCount ?? 0,
      cell: (r) => <span className="tabular-nums">{r.permissionCount ?? 0}</span>,
    },
    {
      id: 'usedBy',
      header: t('admin.roles.usedByColumn'),
      sortValue: (r) => r.groupIds?.length ?? 0,
      cell: (r) => {
        const names = (r.groupIds ?? []).map((id) => groupNames.get(id) ?? `#${id}`);
        return names.length ? (
          <span className="flex flex-wrap gap-1">
            {names.slice(0, 3).map((n) => (
              <Badge key={n} variant="outline">
                {n}
              </Badge>
            ))}
            {names.length > 3 && <Badge variant="outline">+{names.length - 3}</Badge>}
          </span>
        ) : (
          <span className="text-muted-foreground">{t('admin.roles.unusedShort')}</span>
        );
      },
    },
  ];

  if (roles.isPending) return <TableSkeleton />;
  if (roles.isError)
    return (
      <Card>
        <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
      </Card>
    );

  return (
    <>
      <DataTable
        caption={t('admin.sections.roles')}
        rows={rows}
        columns={columns}
        rowDelete={{
          title: (r) => t('admin.roles.deleteTitle', { name: r.name }),
          description: (r) => {
            const used = (r.groupIds ?? []).map((id) => groupNames.get(id) ?? `#${id}`);
            return used.length
              ? t('admin.roles.deleteUsed', { count: used.length, groups: used.join(', ') })
              : t('admin.roles.deleteBody');
          },
          confirmText: (r) => r.name,
          confirmLabel: t('common.delete'),
          run: (r) => remove.mutateAsync(r.id),
        }}
        rowKey={(r) => String(r.id)}
        onRowClick={(r) => setEditing(r)}
        activeRowKey={editing && editing !== 'new' ? String(editing.id) : undefined}
        toolbar={
          <SectionToolbar
            actions={
              <Button variant="accent" onClick={() => setEditing('new')}>
                <Plus aria-hidden="true" />
                {t('admin.roles.new')}
              </Button>
            }
          >
            <SearchInput value={search} onChange={setSearch} label={t('admin.roles.search')} />
          </SectionToolbar>
        }
        empty={
          search ? (
            <EmptyState
              title={t('admin.noMatch')}
              action={<Button onClick={() => setSearch('')}>{t('admin.clearSearch')}</Button>}
            />
          ) : (
            <EmptyState icon={ShieldCheck} title={t('admin.roles.emptyTitle')} />
          )
        }
      />
      {editing && (
        <RoleDrawer
          key={editing === 'new' ? 'new' : editing.id}
          role={editing}
          roles={roles.data ?? []}
          groups={groups.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
