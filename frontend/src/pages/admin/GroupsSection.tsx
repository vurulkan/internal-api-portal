import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Layers, Plus } from 'lucide-react';
import { api, type Group } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, type Column } from '@/components/ui';
import { GroupDrawer } from './groups/GroupDrawer';
import { matches, SearchInput, SectionToolbar, TableSkeleton, useAdminMutation } from './common';

export default function GroupsSection() {
  const { t } = useTranslation();
  const groups = useQuery({ queryKey: queryKeys.admin.groups, queryFn: async () => (await api.groups()) ?? [] });
  const [search, setSearch] = useState('');
  const roles = useQuery({ queryKey: queryKeys.admin.roles, queryFn: async () => (await api.roles()) ?? [] });
  const roleNames = useMemo(() => new Map((roles.data ?? []).map((r) => [r.id, r.name])), [roles.data]);
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  const remove = useAdminMutation({
    mutationFn: (id: number) => api.deleteGroup(id),
    success: t('admin.groups.deleted'),
    invalidate: [queryKeys.admin.groups, queryKeys.admin.users, queryKeys.admin.roles],
  });
  const rows = useMemo(
    () => (groups.data ?? []).filter((g) => matches(search, g.name, g.description)),
    [groups.data, search],
  );

  const columns: Column<Group>[] = [
    {
      id: 'name',
      header: t('admin.groups.name'),
      sortValue: (g) => g.name,
      cell: (g) => <span className="font-medium">{g.name}</span>,
    },
    {
      id: 'description',
      header: t('admin.groups.description'),
      cell: (g) => g.description || '–',
      className: 'text-muted-foreground',
    },
    {
      id: 'members',
      header: t('admin.groups.members'),
      sortValue: (g) => g.memberIds?.length ?? 0,
      cell: (g) => <span className="tabular-nums">{g.memberIds?.length ?? 0}</span>,
    },
    {
      id: 'roles',
      header: t('admin.groups.roles'),
      sortValue: (g) => g.roleIds?.length ?? 0,
      cell: (g) => {
        const names = (g.roleIds ?? []).map((id) => roleNames.get(id) ?? `#${id}`);
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
          <span className="text-muted-foreground">–</span>
        );
      },
    },
    {
      id: 'mapping',
      header: t('admin.groups.mapping'),
      cell: (g) => (
        <span className="flex flex-wrap gap-1">
          {g.azureGroupId && <Badge variant="outline">Azure AD</Badge>}
          {g.ldapGroupDn && <Badge variant="outline">LDAP</Badge>}
          {!g.azureGroupId && !g.ldapGroupDn && <span className="text-muted-foreground">–</span>}
        </span>
      ),
    },
  ];

  if (groups.isPending) return <TableSkeleton />;
  if (groups.isError)
    return (
      <Card>
        <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />
      </Card>
    );

  return (
    <>
      <DataTable
        caption={t('admin.sections.groups')}
        rows={rows}
        columns={columns}
        rowDelete={{
          title: (g) => t('admin.groups.deleteTitle', { name: g.name }),
          description: (g) =>
            t('admin.groups.deleteImpact', {
              members: t('admin.groups.memberCount', { count: g.memberIds?.length ?? 0 }),
              roles: t('admin.groups.roleCount', { count: g.roleIds?.length ?? 0 }),
            }),
          confirmText: (g) => g.name,
          confirmLabel: t('common.delete'),
          run: (g) => remove.mutateAsync(g.id),
        }}
        rowKey={(g) => String(g.id)}
        onRowClick={(g) => setEditing(g)}
        activeRowKey={editing && editing !== 'new' ? String(editing.id) : undefined}
        toolbar={
          <SectionToolbar
            actions={
              <Button variant="accent" onClick={() => setEditing('new')}>
                <Plus aria-hidden="true" />
                {t('admin.groups.new')}
              </Button>
            }
          >
            <SearchInput value={search} onChange={setSearch} label={t('admin.groups.search')} />
          </SectionToolbar>
        }
        empty={
          search ? (
            <EmptyState
              title={t('admin.noMatch')}
              action={<Button onClick={() => setSearch('')}>{t('admin.clearSearch')}</Button>}
            />
          ) : (
            <EmptyState icon={Layers} title={t('admin.groups.emptyTitle')} description={t('admin.groups.emptyBody')} />
          )
        }
      />
      {editing && (
        <GroupDrawer key={editing === 'new' ? 'new' : editing.id} group={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
