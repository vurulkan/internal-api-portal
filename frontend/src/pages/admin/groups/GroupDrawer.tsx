import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Trash2, UserMinus, UserPlus } from 'lucide-react';
import { api, type Group, type User } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';
import { queryKeys } from '@/lib/query';
import { useAdminSections, useMe } from '@/hooks/queries';
import {
  AlertDialog,
  Badge,
  Button,
  DrawerBody,
  DrawerFooter,
  ErrorState,
  Field,
  Fieldset,
  IconButton,
  Input,
  MultiSelect,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui';
import { GroupPermissions } from './GroupPermissions';
import { EditorDrawer, FormSkeleton, sameValue, useAdminMutation, useDirty, useRequestClose } from '../common';

type Form = {
  id?: number;
  name: string;
  description: string;
  roleIds: number[];
  azureGroupId: string;
  ldapGroupDn: string;
};
const EMPTY: Form = { name: '', description: '', roleIds: [], azureGroupId: '', ldapGroupDn: '' };

export function GroupDrawer({ group, onClose }: { group: Group | 'new'; onClose: () => void }) {
  const { t } = useTranslation();
  const existing = group === 'new' ? null : group;
  const roles = useQuery({ queryKey: queryKeys.admin.roles, queryFn: async () => (await api.roles()) ?? [] });
  const groupRoles = useQuery({
    queryKey: queryKeys.admin.groupRoles(existing?.id ?? 0),
    queryFn: async () => (await api.groupRoles(existing!.id)) ?? [],
    enabled: !!existing,
  });
  const initial: Form = existing
    ? {
        id: existing.id,
        name: existing.name,
        description: existing.description ?? '',
        roleIds: groupRoles.data ?? [],
        azureGroupId: existing.azureGroupId ?? '',
        ldapGroupDn: existing.ldapGroupDn ?? '',
      }
    : EMPTY;
  return (
    <EditorDrawer
      onClose={onClose}
      title={existing ? t('admin.groups.edit', { name: existing.name }) : t('admin.groups.new')}
      className="w-[min(100vw,34rem)]"
    >
      {groupRoles.isError ? (
        <ErrorState error={groupRoles.error} onRetry={() => void groupRoles.refetch()} />
      ) : !existing || groupRoles.isSuccess ? (
        <GroupForm
          existing={existing}
          initial={initial}
          roleOptions={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
          onClose={onClose}
        />
      ) : (
        <FormSkeleton />
      )}
    </EditorDrawer>
  );
}

function GroupForm({
  existing,
  initial,
  roleOptions,
  onClose,
}: {
  existing: Group | null;
  initial: Form;
  roleOptions: { value: number; label: string }[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const requestClose = useRequestClose();
  const [form, setForm] = useState<Form>(initial);
  const [nameError, setNameError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState('details');
  const canSeeUsers = useAdminSections().includes('users');
  useDirty(!sameValue(form, initial));

  const save = useAdminMutation({
    mutationFn: async (f: Form) => {
      const payload = {
        name: f.name.trim(),
        description: f.description.trim(),
        azureGroupId: f.azureGroupId.trim(),
        ldapGroupDn: f.ldapGroupDn.trim(),
      };
      const id = f.id ?? (await api.createGroup(payload)).id;
      if (f.id) await api.updateGroup(f.id, payload);
      if (!sameValue(f.roleIds, initial.roleIds)) await api.setGroupRoles(id, f.roleIds);
    },
    success: (_r, f) => (f.id ? t('admin.groups.updated') : t('admin.groups.created')),
    invalidate: (f) => [
      queryKeys.admin.groups,
      queryKeys.admin.roles,
      ...(f.id ? [queryKeys.admin.groupRoles(f.id), queryKeys.admin.groupPermissions(f.id)] : []),
    ],
    onSuccess: onClose,
  });
  const remove = useAdminMutation({
    mutationFn: (id: number) => api.deleteGroup(id),
    success: t('admin.groups.deleted'),
    invalidate: [queryKeys.admin.groups, queryKeys.admin.users, queryKeys.admin.roles],
    onSuccess: onClose,
  });

  const members = existing?.memberIds?.length ?? 0;
  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim()) {
          setNameError(t('admin.groups.nameRequired'));
          setTab('details');
          requestAnimationFrame(() => document.getElementById('group-name')?.focus());
          return;
        }
        save.mutate(form);
      }}
    >
      <DrawerBody className="p-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList label={t('admin.groups.tabsLabel')}>
            <TabsTrigger value="details">{t('admin.groups.tabs.details')}</TabsTrigger>
            {existing && canSeeUsers && (
              <TabsTrigger value="members">
                {t('admin.groups.tabs.members')}
                <Badge variant="outline">{members}</Badge>
              </TabsTrigger>
            )}
            {existing && <TabsTrigger value="permissions">{t('admin.groups.tabs.permissions')}</TabsTrigger>}
          </TabsList>
          <TabsContent value="details" className="space-y-4">
            <Field label={t('admin.groups.name')} id="group-name" required error={nameError}>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t('admin.groups.description')} id="group-description" optional>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label={t('admin.groups.roles')} id="group-roles" helper={t('admin.groups.rolesHelper')}>
              <MultiSelect
                options={roleOptions}
                value={form.roleIds}
                onChange={(roleIds) => setForm({ ...form, roleIds })}
              />
            </Field>
            <Fieldset legend={t('admin.groups.mappingTitle')} description={t('admin.groups.mappingBody')}>
              <Field label={t('admin.groups.azureGroupId')} id="group-azure" optional>
                <Input
                  className="font-mono text-[13px]"
                  placeholder="00000000-0000-0000-0000-000000000000"
                  value={form.azureGroupId}
                  onChange={(e) => setForm({ ...form, azureGroupId: e.target.value })}
                />
              </Field>
              <Field
                label={t('admin.groups.ldapGroupDn')}
                id="group-ldap"
                optional
                helper={t('admin.groups.ldapGroupDnHelper')}
              >
                <Input
                  className="font-mono text-[13px]"
                  placeholder="CN=API Owners,OU=Groups,DC=corp,DC=example"
                  value={form.ldapGroupDn}
                  onChange={(e) => setForm({ ...form, ldapGroupDn: e.target.value })}
                />
              </Field>
            </Fieldset>
          </TabsContent>
          {existing && canSeeUsers && (
            <TabsContent value="members">
              <GroupMembers group={existing} />
            </TabsContent>
          )}
          {existing && (
            <TabsContent value="permissions">
              <GroupPermissions groupId={existing.id} />
            </TabsContent>
          )}
        </Tabs>
      </DrawerBody>
      <DrawerFooter>
        {existing && (
          <Button variant="destructive-ghost" className="mr-auto" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden="true" />
            {t('common.delete')}
          </Button>
        )}
        <Button onClick={requestClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </DrawerFooter>
      {existing && (
        <AlertDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('admin.groups.deleteTitle', { name: existing.name })}
          description={t('admin.groups.deleteImpact', {
            members: t('admin.groups.memberCount', { count: members }),
            roles: t('admin.groups.roleCount', { count: initial.roleIds.length }),
          })}
          confirmLabel={t('common.delete')}
          confirmText={existing.name}
          onConfirm={() => remove.mutateAsync(existing.id)}
        />
      )}
    </form>
  );
}

/** Members change at once (each add / remove is its own audited request). */
function GroupMembers({ group }: { group: Group }) {
  const { t } = useTranslation();
  const me = useMe();
  const canManage = !!me.data?.capabilities?.canManageUsers || !!me.data?.user.isAdmin;
  const users = useQuery({ queryKey: queryKeys.admin.users, queryFn: async () => (await api.users()) ?? [] });
  const groups = useQuery({ queryKey: queryKeys.admin.groups, queryFn: async () => (await api.groups()) ?? [] });
  // The live member list: the group row refetches after every change.
  const memberIds = groups.data?.find((g) => g.id === group.id)?.memberIds ?? group.memberIds ?? [];
  const [adding, setAdding] = useState<number[]>([]);
  const byId = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u])), [users.data]);
  const members = memberIds.map((id) => byId.get(id)).filter((u): u is User => !!u);
  const mayChange = (u: User) => canManage && (!u.isAdmin || !!me.data?.user.isAdmin);

  const add = useAdminMutation({
    mutationFn: (ids: number[]) => adminApi.addGroupMembers(group.id, ids),
    success: (r) => t('admin.groups.membersAdded', { count: r.added.length }),
    invalidate: [queryKeys.admin.groups, queryKeys.admin.users],
    onSuccess: () => setAdding([]),
  });
  const remove = useAdminMutation({
    mutationFn: (u: User) => adminApi.removeGroupMember(group.id, u.id),
    success: (_r, u) => t('admin.groups.memberRemoved', { name: u.username }),
    invalidate: [queryKeys.admin.groups, queryKeys.admin.users],
  });

  if (users.isError) return <ErrorState error={users.error} onRetry={() => void users.refetch()} />;
  if (!users.data) return <FormSkeleton />;
  const candidates = users.data.filter((u) => !memberIds.includes(u.id) && mayChange(u));
  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('admin.groups.addMembers')} id="group-add-members" className="min-w-0 flex-1">
            <MultiSelect
              options={candidates.map((u) => ({
                value: u.id,
                label: u.displayName ? `${u.username} — ${u.displayName}` : u.username,
              }))}
              value={adding}
              onChange={setAdding}
            />
          </Field>
          <Button disabled={adding.length === 0} loading={add.isPending} onClick={() => add.mutate(adding)}>
            <UserPlus aria-hidden="true" />
            {t('admin.groups.add')}
          </Button>
        </div>
      )}
      {members.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t('admin.groups.noMembers')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {members.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{u.username}</span>
                {u.displayName && <span className="ml-2 text-muted-foreground">{u.displayName}</span>}
              </span>
              {!u.isActive && <Badge variant="destructive">{t('common.disabled')}</Badge>}
              {u.isAdmin && <Badge variant="info">{t('admin.users.admin')}</Badge>}
              {mayChange(u) && (
                <IconButton
                  label={t('admin.groups.removeMember', { name: u.username })}
                  icon={<UserMinus aria-hidden="true" />}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(u)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
