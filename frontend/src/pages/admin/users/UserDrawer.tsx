import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, LogOut, Trash2 } from 'lucide-react';
import { api, type User, type UserPayload } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { useAdminSections } from '@/hooks/queries';
import {
  Alert,
  AlertDialog,
  Button,
  Checkbox,
  CopyButton,
  DrawerBody,
  DrawerFooter,
  ErrorState,
  Field,
  Input,
  MultiSelect,
  PasswordInput,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { EditorDrawer, FormSkeleton, sameValue, useAdminMutation, useDirty, useRequestClose } from '../common';
import { EffectivePermissions } from './EffectivePermissions';
import { UserSessions } from './UserSessions';
import type { UserRules } from './rules';

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
export function UserDrawer({
  user,
  rules,
  canManage,
  onClose,
}: {
  user: User | 'new';
  rules: UserRules;
  canManage: boolean;
  onClose: () => void;
}) {
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
    <EditorDrawer
      onClose={onClose}
      title={existing ? t('admin.users.edit', { name: existing.username }) : t('admin.users.new')}
      className="w-[min(100vw,36rem)]"
    >
      {memberOf.isError ? (
        <ErrorState error={memberOf.error} onRetry={() => void memberOf.refetch()} />
      ) : ready ? (
        <UserForm
          existing={existing}
          initial={toForm(existing, memberOf.data ?? [])}
          groupOptions={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
          rules={rules}
          canManage={canManage}
          onClose={onClose}
        />
      ) : (
        <FormSkeleton />
      )}
    </EditorDrawer>
  );
}

function UserForm({
  existing,
  initial,
  groupOptions,
  rules,
  canManage,
  onClose,
}: {
  existing: User | null;
  initial: Form;
  groupOptions: { value: number; label: string }[];
  rules: UserRules;
  canManage: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const sections = useAdminSections();
  const requestClose = useRequestClose();
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [issued, setIssued] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'reset' | null>(null);
  const [tab, setTab] = useState('profile');
  useDirty(!sameValue(form, initial));

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
      const id = f.id ?? (await api.createUser(payload)).id;
      if (f.id) await api.updateUser(f.id, payload);
      if (f.id ? !sameValue(f.groupIds, initial.groupIds) : f.groupIds.length) await api.setUserGroups(id, f.groupIds);
      return id;
    },
    success: (_r, f) => (f.id ? t('admin.users.updated') : t('admin.users.created')),
    // Group member lists change only when the user's groups did.
    invalidate: (f) => [
      queryKeys.admin.users,
      ...(sameValue(f.groupIds, initial.groupIds) ? [] : [queryKeys.admin.groups]),
      ...(f.id ? [queryKeys.admin.userGroups(f.id)] : []),
    ],
    onSuccess: onClose,
  });
  const remove = useAdminMutation({
    mutationFn: (id: number) => api.deleteUser(id),
    success: t('admin.users.deleted'),
    invalidate: [queryKeys.admin.users, queryKeys.admin.groups],
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
    const first = Object.keys(next)[0];
    if (first) {
      setTab('profile');
      requestAnimationFrame(() => document.getElementById(`user-${first}`)?.focus());
      return;
    }
    save.mutate(form);
  }

  const directory = !!existing && existing.authSource !== 'local';
  const statusLock = existing ? rules.statusLock(existing) : undefined;
  const adminLock = existing ? rules.adminLock(existing) : undefined;
  const readOnly = !canManage;

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DrawerBody className="p-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList label={t('admin.users.tabsLabel')}>
            <TabsTrigger value="profile">{t('admin.users.tabs.profile')}</TabsTrigger>
            <TabsTrigger value="access">{t('admin.users.tabs.access')}</TabsTrigger>
            {existing && sections.includes('sessions') && (
              <TabsTrigger value="sessions">{t('admin.users.tabs.sessions')}</TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="profile" className="space-y-4">
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
                disabled={directory || readOnly}
                autoComplete="off"
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('admin.users.displayName')} id="user-displayName" optional>
                <Input
                  value={form.displayName}
                  disabled={directory || readOnly}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                />
              </Field>
              <Field label={t('admin.users.email')} id="user-email" optional>
                <Input
                  type="email"
                  value={form.email}
                  disabled={directory || readOnly}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
            </div>
            {form.authSource === 'local' && !readOnly && (
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
            <div className="space-y-3 rounded-lg border border-border p-3">
              <Checkbox
                label={t('common.active')}
                description={statusLock}
                checked={form.isActive}
                disabled={!!statusLock || readOnly}
                onCheckedChange={(v) => setForm({ ...form, isActive: v })}
              />
              <Checkbox
                label={t('admin.users.admin')}
                description={adminLock ?? t('admin.users.adminHelper')}
                checked={form.isAdmin}
                disabled={!!adminLock || readOnly}
                onCheckedChange={(v) => setForm({ ...form, isAdmin: v })}
              />
              {form.authSource === 'local' && (
                <Checkbox
                  label={t('admin.users.forceChange')}
                  checked={form.mustChangePassword}
                  disabled={readOnly}
                  onCheckedChange={(v) => setForm({ ...form, mustChangePassword: v })}
                />
              )}
            </div>
            {existing && !readOnly && (
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
          </TabsContent>
          <TabsContent value="access" className="space-y-4">
            <Field label={t('admin.users.groups')} id="user-groups" helper={t('admin.users.groupsHelper')}>
              <MultiSelect
                options={groupOptions}
                value={form.groupIds}
                disabled={readOnly}
                onChange={(groupIds) => setForm({ ...form, groupIds })}
              />
            </Field>
            <EffectivePermissions
              userId={existing?.id}
              isAdmin={form.isAdmin}
              groupIds={form.groupIds}
              changed={!sameValue([...form.groupIds].sort(), [...initial.groupIds].sort())}
            />
          </TabsContent>
          {existing && sections.includes('sessions') && (
            <TabsContent value="sessions">
              <UserSessions userId={existing.id} />
            </TabsContent>
          )}
        </Tabs>
      </DrawerBody>
      <DrawerFooter>
        {existing && !readOnly && (
          <Button
            variant="destructive-ghost"
            className="mr-auto"
            disabled={rules.isSelf(existing) || rules.isLastAdmin(existing)}
            title={statusLock}
            onClick={() => setConfirm('delete')}
          >
            <Trash2 aria-hidden="true" />
            {t('common.delete')}
          </Button>
        )}
        <Button onClick={requestClose}>{readOnly ? t('common.close') : t('common.cancel')}</Button>
        {!readOnly && (
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t('common.save')}
          </Button>
        )}
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
