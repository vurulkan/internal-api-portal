import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, LogOut, Plus, Trash2, UserRound } from 'lucide-react';
import { api, type User, type UserPayload } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { useMe } from '@/hooks/queries';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Card,
  Checkbox,
  CopyButton,
  DataTable,
  Drawer,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingRegion,
  MultiSelect,
  PasswordInput,
  Skeleton,
  type Column,
} from '@/components/ui';
import { matches, SectionToolbar, useAdminMutation } from './common';

type Form = {
  id?: number;
  username: string;
  displayName: string;
  email: string;
  password: string;
  authSource: string;
  mustChangePassword: boolean;
  isActive: boolean;
  isAdmin: boolean;
  groupIds: number[];
};

const EMPTY: Form = {
  username: '',
  displayName: '',
  email: '',
  password: '',
  authSource: 'local',
  mustChangePassword: true,
  isActive: true,
  isAdmin: false,
  groupIds: [],
};

export default function UsersSection() {
  const { t } = useTranslation();
  const users = useQuery({ queryKey: queryKeys.admin.users, queryFn: async () => (await api.users()) ?? [] });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<User | 'new' | null>(null);

  const rows = useMemo(
    () => (users.data ?? []).filter((u) => matches(search, u.username, u.displayName, u.email)),
    [users.data, search],
  );

  const columns: Column<User>[] = [
    {
      id: 'username',
      header: t('admin.users.username'),
      sortValue: (u) => u.username,
      cell: (u) => (
        <span className="font-medium">
          {u.username}
          {u.displayName && <span className="ml-2 font-normal text-muted-foreground">{u.displayName}</span>}
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
      id: 'status',
      header: t('admin.users.status'),
      sortValue: (u) => (u.isActive ? 1 : 0),
      cell: (u) => (
        <span className="flex flex-wrap gap-1">
          <Badge variant={u.isActive ? 'success' : 'destructive'}>
            {u.isActive ? t('common.active') : t('common.disabled')}
          </Badge>
          {u.isAdmin && <Badge variant="info">{t('admin.users.admin')}</Badge>}
          {u.mustChangePassword && u.authSource === 'local' && (
            <Badge variant="warning">{t('admin.users.mustChange')}</Badge>
          )}
        </span>
      ),
    },
  ];

  if (users.isPending) return <TableSkeleton />;
  if (users.isError)
    return (
      <Card>
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      </Card>
    );

  return (
    <>
      <DataTable
        caption={t('admin.sections.users')}
        rows={rows}
        columns={columns}
        rowKey={(u) => String(u.id)}
        onRowClick={(u) => setEditing(u)}
        activeRowKey={editing && editing !== 'new' ? String(editing.id) : undefined}
        toolbar={
          <SectionToolbar
            actions={
              <Button variant="accent" onClick={() => setEditing('new')}>
                <Plus aria-hidden="true" />
                {t('admin.users.new')}
              </Button>
            }
          >
            <SearchInput value={search} onChange={setSearch} label={t('admin.users.search')} />
          </SectionToolbar>
        }
        empty={
          search ? (
            <EmptyState
              title={t('admin.noMatch')}
              action={<Button onClick={() => setSearch('')}>{t('admin.clearSearch')}</Button>}
            />
          ) : (
            <EmptyState icon={UserRound} title={t('admin.users.emptyTitle')} />
          )
        }
      />
      {editing && (
        <UserEditor key={editing === 'new' ? 'new' : editing.id} user={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

export function SearchInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <Input
      type="search"
      aria-label={label}
      placeholder={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full max-w-xs"
    />
  );
}

export function TableSkeleton() {
  return (
    <LoadingRegion className="space-y-2">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-9" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-9" />
      ))}
    </LoadingRegion>
  );
}

function toForm(user: User | null, groupIds: number[]): Form {
  if (!user) return EMPTY;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? '',
    email: user.email ?? '',
    password: '',
    authSource: user.authSource,
    mustChangePassword: user.mustChangePassword,
    isActive: user.isActive,
    isAdmin: user.isAdmin,
    groupIds,
  };
}

/** Mounted while open; the form starts once the user's groups are loaded. */
function UserEditor({ user, onClose }: { user: User | 'new'; onClose: () => void }) {
  const { t } = useTranslation();
  const existing = user === 'new' ? null : user;
  const groups = useQuery({ queryKey: queryKeys.admin.groups, queryFn: async () => (await api.groups()) ?? [] });
  const memberOf = useQuery({
    queryKey: queryKeys.admin.userGroups(existing?.id ?? 0),
    queryFn: async () => (await api.userGroups(existing!.id)) ?? [],
    enabled: !!existing,
  });
  const ready = !existing || memberOf.isSuccess;
  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={existing ? t('admin.users.edit', { name: existing.username }) : t('admin.users.new')}
      className="w-[min(100vw,32rem)]"
    >
      {memberOf.isError ? (
        <ErrorState error={memberOf.error} onRetry={() => void memberOf.refetch()} />
      ) : ready ? (
        <UserForm
          existing={existing}
          initial={toForm(existing, memberOf.data ?? [])}
          groupOptions={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
          onClose={onClose}
        />
      ) : (
        <LoadingRegion className="space-y-4 p-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </LoadingRegion>
      )}
    </Drawer>
  );
}

function UserForm({
  existing,
  initial,
  groupOptions,
  onClose,
}: {
  existing: User | null;
  initial: Form;
  groupOptions: { value: number; label: string }[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [issued, setIssued] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'reset' | null>(null);

  const save = useAdminMutation({
    mutationFn: async (f: Form) => {
      const payload: UserPayload = {
        username: f.username.trim(),
        displayName: f.displayName.trim(),
        email: f.email.trim(),
        password: f.password || undefined,
        authSource: f.authSource,
        mustChangePassword: f.mustChangePassword,
        isActive: f.isActive,
        isAdmin: f.isAdmin,
      };
      if (f.id) {
        await api.updateUser(f.id, payload);
        await api.setUserGroups(f.id, f.groupIds);
        return f.id;
      }
      const created = await api.createUser(payload);
      await api.setUserGroups(created.id, f.groupIds);
      return created.id;
    },
    success: (_r, f) => (f.id ? t('admin.users.updated') : t('admin.users.created')),
    invalidate: (f) => [queryKeys.admin.users, ...(f.id ? [queryKeys.admin.userGroups(f.id)] : [])],
    onSuccess: onClose,
  });

  const remove = useAdminMutation({
    mutationFn: (id: number) => api.deleteUser(id),
    success: t('admin.users.deleted'),
    invalidate: [queryKeys.admin.users],
    onSuccess: onClose,
  });

  const revokeSessions = useAdminMutation({
    mutationFn: (id: number) => api.revokeUserSessions(id),
    success: (r) => t('admin.users.sessionsEnded', { count: r.sessionsRevoked }),
    invalidate: [queryKeys.admin.sessions],
  });

  const reset = useAdminMutation({
    mutationFn: (id: number) => api.resetPassword(id),
    success: t('admin.users.passwordReset'),
    invalidate: [queryKeys.admin.users, queryKeys.admin.sessions],
    onSuccess: (r) => setIssued(r.temporaryPassword),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!form.username.trim()) next.username = t('admin.users.usernameRequired');
    if (!form.id && form.authSource === 'local' && !form.password) next.password = t('admin.users.passwordRequired');
    setErrors(next);
    if (Object.keys(next).length) {
      document.getElementById(`user-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    save.mutate(form);
  }

  const directory = !!existing && existing.authSource !== 'local';
  const isSelf = existing?.id === me.data?.user.id;

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DrawerBody className="space-y-4 p-4">
        {issued && (
          <Alert variant="warning" title={t('admin.users.temporaryPassword', { name: existing?.username })}>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="rounded bg-card px-1.5 py-0.5 font-mono text-sm text-foreground select-all">
                {issued}
              </code>
              <CopyButton value={issued} />
            </div>
            <p className="mt-1 text-xs">{t('admin.users.temporaryPasswordHint')}</p>
          </Alert>
        )}
        {directory && (
          <Alert variant="info">
            {t('admin.users.directoryManaged', {
              source: t(`authSource.${existing!.authSource}`, { defaultValue: existing!.authSource }),
            })}
          </Alert>
        )}
        <Field label={t('admin.users.username')} id="user-username" required error={errors.username}>
          <Input
            value={form.username}
            disabled={directory}
            autoComplete="off"
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </Field>
        <Field label={t('admin.users.displayName')} id="user-displayName" optional>
          <Input
            value={form.displayName}
            disabled={directory}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </Field>
        <Field label={t('admin.users.email')} id="user-email" optional>
          <Input
            type="email"
            value={form.email}
            disabled={directory}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        {form.authSource === 'local' && (
          <Field
            label={form.id ? t('admin.users.newPassword') : t('admin.users.password')}
            id="user-password"
            required={!form.id}
            optional={!!form.id}
            helper={form.id ? t('admin.users.newPasswordHelper') : undefined}
            error={errors.password}
          >
            <PasswordInput
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
        )}
        <Field label={t('admin.users.groups')} id="user-groups" helper={t('admin.users.groupsHelper')}>
          <MultiSelect
            options={groupOptions}
            value={form.groupIds}
            onChange={(groupIds) => setForm({ ...form, groupIds })}
          />
        </Field>
        <div className="space-y-3 rounded-lg border border-border p-3">
          <Checkbox
            label={t('common.active')}
            checked={form.isActive}
            disabled={isSelf}
            onCheckedChange={(v) => setForm({ ...form, isActive: v })}
          />
          <Checkbox
            label={t('admin.users.admin')}
            description={t('admin.users.adminHelper')}
            checked={form.isAdmin}
            disabled={isSelf}
            onCheckedChange={(v) => setForm({ ...form, isAdmin: v })}
          />
          {form.authSource === 'local' && (
            <Checkbox
              label={t('admin.users.forceChange')}
              checked={form.mustChangePassword}
              onCheckedChange={(v) => setForm({ ...form, mustChangePassword: v })}
            />
          )}
        </div>
        {existing && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {existing.authSource === 'local' && (
              <Button size="sm" onClick={() => setConfirm('reset')} loading={reset.isPending}>
                <KeyRound aria-hidden="true" />
                {t('admin.users.resetPassword')}
              </Button>
            )}
            <Button size="sm" onClick={() => revokeSessions.mutate(existing.id)} loading={revokeSessions.isPending}>
              <LogOut aria-hidden="true" />
              {t('admin.users.endSessions')}
            </Button>
          </div>
        )}
      </DrawerBody>
      <DrawerFooter>
        {existing && (
          <Button
            variant="destructive-ghost"
            className="mr-auto"
            disabled={isSelf}
            onClick={() => setConfirm('delete')}
          >
            <Trash2 aria-hidden="true" />
            {t('common.delete')}
          </Button>
        )}
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </DrawerFooter>
      {existing && (
        <>
          <AlertDialog
            open={confirm === 'delete'}
            onOpenChange={(open) => !open && setConfirm(null)}
            title={t('admin.users.deleteTitle', { name: existing.username })}
            description={t('admin.users.deleteBody')}
            confirmLabel={t('common.delete')}
            confirmText={existing.username}
            onConfirm={() => remove.mutateAsync(existing.id)}
          />
          <AlertDialog
            open={confirm === 'reset'}
            onOpenChange={(open) => !open && setConfirm(null)}
            title={t('admin.users.resetTitle', { name: existing.username })}
            description={t('admin.users.resetBody')}
            confirmLabel={t('admin.users.resetPassword')}
            onConfirm={() => reset.mutateAsync(existing.id)}
          />
        </>
      )}
    </form>
  );
}
