import { useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { api, type User } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';
import { formatRelative } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { useMe } from '@/hooks/queries';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  notifyError,
  Select,
  type Column,
  type RowDelete,
} from '@/components/ui';
import { matches, SearchInput, SectionToolbar, TableSkeleton, useAdminMutation } from './common';
import { AzurePreregisterDialog } from './users/AzurePreregisterDialog';
import { LdapImportDrawer } from './users/LdapImportDrawer';
import { NewUserMenu } from './users/NewUserMenu';
import { UserBulkActions } from './users/UserBulkActions';
import { UserDrawer } from './users/UserDrawer';
import { userRules } from './users/rules';

const SOURCES = ['local', 'ldap', 'azuread'] as const;
const STATUSES = ['active', 'inactive', 'admins', 'mustChange'] as const;

export default function UsersSection() {
  const { t } = useTranslation();
  const me = useMe();
  const canManage = !!me.data?.capabilities?.canManageUsers || !!me.data?.user.isAdmin;
  const users = useQuery({ queryKey: queryKeys.admin.users, queryFn: async () => (await api.users()) ?? [] });
  const groups = useQuery({ queryKey: queryKeys.admin.groups, queryFn: async () => (await api.groups()) ?? [] });
  // Filters live in the URL so a filtered list can be shared and survives a reload.
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const source = params.get('source') ?? '';
  const status = params.get('status') ?? '';
  const groupFilter = Number(params.get('group')) || 0;
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const [editing, setEditing] = useState<User | 'new' | null>(() => (params.get('new') && canManage ? 'new' : null));
  // ?import=ldap (the link on Identity providers → LDAP) opens the import at once.
  const [directory, setDirectory] = useState<'ldap' | 'azure' | null>(() =>
    params.get('import') === 'ldap' && canManage ? 'ldap' : null,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const groupNames = useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g.name])), [groups.data]);
  const rules = userRules(users.data ?? [], me.data?.user.id, t);

  const rows = useMemo(
    () =>
      (users.data ?? []).filter(
        (u) =>
          matches(search, u.username, u.displayName, u.email) &&
          (!source || u.authSource === source) &&
          (!groupFilter || (u.groupIds ?? []).includes(groupFilter)) &&
          (!status ||
            (status === 'active' && u.isActive) ||
            (status === 'inactive' && !u.isActive) ||
            (status === 'admins' && u.isAdmin) ||
            (status === 'mustChange' && u.mustChangePassword && u.authSource === 'local')),
      ),
    [users.data, search, source, status, groupFilter],
  );
  const filtered = !!(search || source || status || groupFilter);

  const queryClient = useQueryClient();
  const remove = useAdminMutation({
    mutationFn: (id: number) => api.deleteUser(id),
    success: t('admin.users.deleted'),
    invalidate: [queryKeys.admin.users, queryKeys.admin.groups],
  });
  // Optimistic: the switch flips at once and flips back if the server refuses.
  const toggle = useMutation({
    mutationFn: ({ user, active }: { user: User; active: boolean }) => adminApi.bulkUserStatus([user.id], active),
    onMutate: async ({ user, active }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.admin.users });
      const previous = queryClient.getQueryData<User[]>(queryKeys.admin.users);
      queryClient.setQueryData<User[]>(queryKeys.admin.users, (list) =>
        list?.map((u) => (u.id === user.id ? { ...u, isActive: active } : u)),
      );
      return { previous };
    },
    onError: (error, _v, context) => {
      queryClient.setQueryData(queryKeys.admin.users, context?.previous);
      notifyError(error, t('admin.saveFailed'));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.users }),
  });

  const columns: Column<User>[] = [
    {
      id: 'username',
      header: t('admin.users.username'),
      sortValue: (u) => u.username,
      cell: (u) => (
        <span className="block min-w-0">
          <span className="font-medium">{u.username}</span>
          {u.displayName && <span className="block text-xs text-muted-foreground">{u.displayName}</span>}
        </span>
      ),
    },
    {
      id: 'email',
      header: t('admin.users.email'),
      sortValue: (u) => u.email ?? '',
      cell: (u) => u.email || '–',
      className: 'text-muted-foreground',
    },
    {
      id: 'source',
      header: t('admin.users.source'),
      sortValue: (u) => u.authSource,
      cell: (u) => <Badge variant="outline">{t(`authSource.${u.authSource}`, { defaultValue: u.authSource })}</Badge>,
    },
    {
      id: 'groups',
      header: t('admin.users.groups'),
      sortValue: (u) => u.groupIds?.length ?? 0,
      cell: (u) => {
        const names = (u.groupIds ?? []).map((id) => groupNames.get(id) ?? `#${id}`);
        return names.length ? (
          <span className="tabular-nums" title={names.join(', ')}>
            {t('admin.users.groupCount', { count: names.length })}
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        );
      },
    },
    {
      id: 'lastLogin',
      header: t('admin.users.lastLogin'),
      sortValue: (u) => u.lastLoginAt ?? '',
      cell: (u) =>
        u.lastLoginAt ? (
          <span className="whitespace-nowrap text-[13px]">{formatRelative(u.lastLoginAt)}</span>
        ) : (
          <span className="text-[13px] text-muted-foreground">{t('admin.users.never')}</span>
        ),
    },
    {
      id: 'status',
      header: t('admin.users.status'),
      sortValue: (u) => (u.isActive ? 1 : 0),
      cell: (u) => {
        const lock = rules.statusLock(u);
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            {canManage && (!u.isAdmin || me.data?.user.isAdmin) ? (
              <ActiveSwitch
                user={u}
                lock={lock}
                busy={toggle.isPending && toggle.variables?.user.id === u.id}
                onChange={(active) => toggle.mutate({ user: u, active })}
              />
            ) : (
              <Badge variant={u.isActive ? 'success' : 'destructive'}>
                {u.isActive ? t('common.active') : t('common.disabled')}
              </Badge>
            )}
            {u.isAdmin && <Badge variant="info">{t('admin.users.admin')}</Badge>}
            {u.mustChangePassword && u.authSource === 'local' && (
              <Badge variant="warning">{t('admin.users.mustChange')}</Badge>
            )}
          </span>
        );
      },
    },
  ];

  if (users.isPending) return <TableSkeleton />;
  if (users.isError)
    return (
      <Card>
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      </Card>
    );

  const selectedUsers = (users.data ?? []).filter((u) => selected.includes(String(u.id)));
  const rowDelete: RowDelete<User> | undefined = canManage
    ? {
        can: (u) => !rules.isSelf(u) && !rules.isLastAdmin(u) && (!u.isAdmin || !!me.data?.user.isAdmin),
        title: (u) => t('admin.users.deleteTitle', { name: u.username }),
        description: () => t('admin.users.deleteBody'),
        confirmText: (u) => u.username,
        confirmLabel: t('common.delete'),
        run: (u) => remove.mutateAsync(u.id),
      }
    : undefined;
  return (
    <>
      <DataTable
        caption={t('admin.sections.users')}
        rows={rows}
        columns={columns}
        rowKey={(u) => String(u.id)}
        rowLabel={(u) => u.username}
        selectable={canManage}
        selected={selected}
        onSelectedChange={setSelected}
        rowDelete={rowDelete}
        onRowClick={(u) => setEditing(u)}
        activeRowKey={editing && editing !== 'new' ? String(editing.id) : undefined}
        toolbar={
          <div className="w-full space-y-2">
            <SectionToolbar
              actions={
                canManage && (
                  <NewUserMenu onChoose={(kind) => (kind === 'local' ? setEditing('new') : setDirectory(kind))} />
                )
              }
            >
              <SearchInput value={search} onChange={(v) => setFilter('q', v)} label={t('admin.users.search')} />
              <Select
                aria-label={t('admin.users.source')}
                className="w-full sm:w-40"
                value={source}
                onValueChange={(v) => setFilter('source', v)}
                options={[
                  { value: '', label: t('admin.users.anySource') },
                  ...SOURCES.map((s) => ({ value: s, label: t(`authSource.${s}`) })),
                ]}
              />
              <Select
                aria-label={t('admin.users.status')}
                className="w-full sm:w-44"
                value={status}
                onValueChange={(v) => setFilter('status', v)}
                options={[
                  { value: '', label: t('admin.users.anyStatus') },
                  ...STATUSES.map((s) => ({ value: s, label: t(`admin.users.statusFilter.${s}`) })),
                ]}
              />
              {(groups.data ?? []).length > 0 && (
                <Select
                  aria-label={t('admin.users.groupFilter')}
                  className="w-full sm:w-44"
                  value={groupFilter ? String(groupFilter) : ''}
                  onValueChange={(v) => setFilter('group', v)}
                  options={[
                    { value: '', label: t('admin.users.anyGroup') },
                    ...(groups.data ?? []).map((g) => ({ value: String(g.id), label: g.name })),
                  ]}
                />
              )}
            </SectionToolbar>
            <UserBulkActions
              users={rows}
              selected={selectedUsers}
              groups={groups.data ?? []}
              groupNames={groupNames}
              canManage={canManage}
              rules={rules}
              onDone={() => setSelected([])}
            />
          </div>
        }
        empty={
          filtered ? (
            <EmptyState
              title={t('admin.noMatch')}
              action={<Button onClick={() => setParams({}, { replace: true })}>{t('admin.clearFilters')}</Button>}
            />
          ) : (
            <EmptyState icon={UserRound} title={t('admin.users.emptyTitle')} />
          )
        }
      />
      {directory === 'ldap' && <LdapImportDrawer onClose={() => setDirectory(null)} />}
      {directory === 'azure' && <AzurePreregisterDialog onClose={() => setDirectory(null)} />}
      {editing && (
        <UserDrawer
          key={editing === 'new' ? 'new' : editing.id}
          user={editing}
          rules={rules}
          canManage={canManage}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ActiveSwitch({
  user,
  lock,
  busy,
  onChange,
}: {
  user: User;
  /** Why it can't be switched off (self, last admin). */
  lock?: string;
  busy: boolean;
  onChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const lockId = `lock-${useId()}`;
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={user.isActive}
        aria-label={t('admin.users.activeToggle', { name: user.username })}
        aria-describedby={lock ? lockId : undefined}
        title={lock}
        disabled={!!lock || busy}
        onClick={(e) => {
          // The row click opens the editor.
          e.stopPropagation();
          onChange(!user.isActive);
        }}
        className="group relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-input bg-muted transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 aria-checked:border-accent aria-checked:bg-accent"
      >
        <span className="block size-3.5 translate-x-0.5 rounded-full bg-foreground shadow-sm transition-transform duration-150 group-aria-checked:translate-x-[18px] group-aria-checked:bg-accent-foreground" />
      </button>
      {lock && (
        <span id={lockId} className="sr-only">
          {lock}
        </span>
      )}
    </>
  );
}
