import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Layers, Plus, Trash2 } from 'lucide-react';
import { api, type Group } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  DataTable,
  Drawer,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  ErrorState,
  Field,
  Fieldset,
  Input,
  LoadingRegion,
  MultiSelect,
  Skeleton,
  Textarea,
  type Column,
} from '@/components/ui';
import { matches, SectionToolbar, useAdminMutation } from './common';
import { SearchInput, TableSkeleton } from './UsersSection';

type Form = {
  id?: number;
  name: string;
  description: string;
  roleIds: number[];
  azureGroupId: string;
  ldapGroupDn: string;
};
const EMPTY: Form = { name: '', description: '', roleIds: [], azureGroupId: '', ldapGroupDn: '' };

export default function GroupsSection() {
  const { t } = useTranslation();
  const groups = useQuery({ queryKey: queryKeys.admin.groups, queryFn: async () => (await api.groups()) ?? [] });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
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
        <GroupEditor key={editing === 'new' ? 'new' : editing.id} group={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function GroupEditor({ group, onClose }: { group: Group | 'new'; onClose: () => void }) {
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
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={existing ? t('admin.groups.edit', { name: existing.name }) : t('admin.groups.new')}
      className="w-[min(100vw,32rem)]"
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
        <LoadingRegion className="space-y-4 p-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-20" />
        </LoadingRegion>
      )}
    </Drawer>
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
  const [form, setForm] = useState<Form>(initial);
  const [nameError, setNameError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      await api.setGroupRoles(id, f.roleIds);
    },
    success: (_r, f) => (f.id ? t('admin.groups.updated') : t('admin.groups.created')),
    invalidate: (f) => [queryKeys.admin.groups, ...(f.id ? [queryKeys.admin.groupRoles(f.id)] : [])],
    onSuccess: onClose,
  });
  const remove = useAdminMutation({
    mutationFn: (id: number) => api.deleteGroup(id),
    success: t('admin.groups.deleted'),
    invalidate: [queryKeys.admin.groups],
    onSuccess: onClose,
  });

  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim()) {
          setNameError(t('admin.groups.nameRequired'));
          document.getElementById('group-name')?.focus();
          return;
        }
        save.mutate(form);
      }}
    >
      <DrawerBody className="space-y-4 p-4">
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
      </DrawerBody>
      <DrawerFooter>
        {existing && (
          <Button variant="destructive-ghost" className="mr-auto" onClick={() => setConfirmDelete(true)}>
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
        <AlertDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('admin.groups.deleteTitle', { name: existing.name })}
          description={t('admin.groups.deleteBody')}
          confirmLabel={t('common.delete')}
          confirmText={existing.name}
          onConfirm={() => remove.mutateAsync(existing.id)}
        />
      )}
    </form>
  );
}
