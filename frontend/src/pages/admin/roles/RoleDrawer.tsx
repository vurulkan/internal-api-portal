import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api, type ApiDefinition, type Group, type Role, type ScopeDef } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { useAdminSections } from '@/hooks/queries';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  DrawerBody,
  DrawerFooter,
  ErrorState,
  Field,
  Input,
  MultiSelect,
  notifyError,
  Select,
  Textarea,
} from '@/components/ui';
import { EditorDrawer, FormSkeleton, sameValue, useAdminMutation, useDirty, useRequestClose } from '../common';
import { PermissionMatrix } from './PermissionMatrix';
import { ROLE_TEMPLATES, scopeDiff } from './templates';

type Form = { id?: number; name: string; description: string; scopes: string[]; groupIds: number[] };
const EMPTY: Form = { name: '', description: '', scopes: [], groupIds: [] };

export function RoleDrawer({
  role,
  roles,
  groups,
  onClose,
}: {
  role: Role | 'new';
  roles: Role[];
  /** Every group with its roles (the admin list), to show and change who has the role. */
  groups: Group[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const existing = role === 'new' ? null : role;
  const catalog = useQuery({
    queryKey: queryKeys.admin.scopeCatalog,
    queryFn: async () => (await api.permissionCatalog()).items ?? [],
    staleTime: 10 * 60_000,
  });
  // Only users who may see the API registry get the per-API matrix rows.
  const canSeeApis = useAdminSections().includes('apis');
  const apis = useQuery({
    queryKey: queryKeys.admin.apis,
    queryFn: async () => (await api.adminApis()) ?? [],
    enabled: canSeeApis,
  });
  const permissions = useQuery({
    queryKey: queryKeys.admin.rolePermissions(existing?.id ?? 0),
    queryFn: async () => (await api.permissions(existing!.id)) ?? [],
    enabled: !!existing,
  });
  const error = catalog.error ?? permissions.error;
  const ready = catalog.isSuccess && (!existing || permissions.isSuccess);
  return (
    <EditorDrawer
      onClose={onClose}
      title={existing ? t('admin.roles.edit', { name: existing.name }) : t('admin.roles.new')}
      className="w-[min(100vw,48rem)]"
    >
      {error ? (
        <ErrorState error={error} onRetry={() => void Promise.all([catalog.refetch(), permissions.refetch()])} />
      ) : ready ? (
        <RoleForm
          existing={existing}
          initial={
            existing
              ? {
                  id: existing.id,
                  name: existing.name,
                  description: existing.description ?? '',
                  scopes: (permissions.data ?? []).map((p) => p.scope).sort(),
                  groupIds: [...(existing.groupIds ?? [])].sort((a, b) => a - b),
                }
              : EMPTY
          }
          defs={catalog.data}
          apis={apis.data ?? []}
          apisLoading={apis.isPending && canSeeApis}
          roles={roles.filter((r) => r.id !== existing?.id)}
          groups={groups}
          onClose={onClose}
        />
      ) : (
        <FormSkeleton />
      )}
    </EditorDrawer>
  );
}

function RoleForm({
  existing,
  initial,
  defs,
  apis,
  apisLoading,
  roles,
  groups,
  onClose,
}: {
  existing: Role | null;
  initial: Form;
  defs: ScopeDef[];
  apis: ApiDefinition[];
  apisLoading: boolean;
  roles: Role[];
  groups: Group[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const requestClose = useRequestClose();
  const [form, setForm] = useState<Form>(initial);
  // Groups get roles in group.manage; others see who has the role, read-only.
  const canEditGroups = useAdminSections().includes('groups');
  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? `#${id}`;
  const usedBy = form.groupIds.map(groupName);
  const groupsAdded = form.groupIds.filter((id) => !initial.groupIds.includes(id));
  const groupsRemoved = initial.groupIds.filter((id) => !form.groupIds.includes(id));
  const [nameError, setNameError] = useState('');
  const [confirm, setConfirm] = useState<'delete' | 'save' | null>(null);
  const [copying, setCopying] = useState(false);
  useDirty(!sameValue(form, initial));
  const diff = scopeDiff(initial.scopes, form.scopes);

  function toggle(scope: string, on: boolean) {
    const next = new Set(form.scopes);
    if (on) next.add(scope);
    else next.delete(scope);
    setForm({ ...form, scopes: Array.from(next).sort() });
  }
  async function copyFrom(roleId: string) {
    if (!roleId) return;
    setCopying(true);
    try {
      const perms = (await api.permissions(Number(roleId))) ?? [];
      setForm((f) => ({ ...f, scopes: Array.from(new Set([...f.scopes, ...perms.map((p) => p.scope)])).sort() }));
    } catch (error) {
      notifyError(error, t('admin.roles.copyFailed'));
    } finally {
      setCopying(false);
    }
  }

  const save = useAdminMutation({
    mutationFn: async (f: Form) => {
      const payload = { name: f.name.trim(), description: f.description.trim() };
      const id = f.id ?? (await api.createRole(payload)).id;
      if (f.id) await api.updateRole(f.id, payload);
      if (!f.id || !sameValue(f.scopes, initial.scopes)) await api.replacePermissions(id, f.scopes);
      // Each group whose membership of this role changed gets its role list rewritten.
      for (const groupId of f.groupIds.filter((g) => !initial.groupIds.includes(g))) {
        const current = groups.find((g) => g.id === groupId)?.roleIds ?? [];
        await api.setGroupRoles(groupId, Array.from(new Set([...current, id])));
      }
      for (const groupId of initial.groupIds.filter((g) => !f.groupIds.includes(g))) {
        const current = groups.find((g) => g.id === groupId)?.roleIds ?? [];
        await api.setGroupRoles(
          groupId,
          current.filter((r) => r !== id),
        );
      }
    },
    success: (_r, f) => (f.id ? t('admin.roles.updated') : t('admin.roles.created')),
    invalidate: (f) => [
      queryKeys.admin.roles,
      queryKeys.admin.groups,
      ...(f.id ? [queryKeys.admin.rolePermissions(f.id)] : []),
    ],
    onSuccess: onClose,
  });
  const remove = useAdminMutation({
    mutationFn: (id: number) => api.deleteRole(id),
    success: t('admin.roles.deleted'),
    invalidate: [queryKeys.admin.roles, queryKeys.admin.groups],
    onSuccess: onClose,
  });

  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim()) {
          setNameError(t('admin.roles.nameRequired'));
          document.getElementById('role-name')?.focus();
          return;
        }
        // Changing the scopes of a role in use affects every member of its groups: confirm with the diff.
        if (existing && (diff.added.length || diff.removed.length || groupsAdded.length || groupsRemoved.length))
          setConfirm('save');
        else save.mutate(form);
      }}
    >
      <DrawerBody className="space-y-5 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.roles.name')} id="role-name" required error={nameError}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('admin.roles.description')} id="role-description" optional>
            <Textarea
              rows={1}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={existing ? t('admin.roles.applyTemplate') : t('admin.roles.template')}
            id="role-template"
            helper={t('admin.roles.templateHelper')}
          >
            <Select
              value=""
              placeholder={t('admin.roles.chooseTemplate')}
              onValueChange={(id) => {
                const tpl = ROLE_TEMPLATES.find((x) => x.id === id);
                if (tpl) setForm((f) => ({ ...f, scopes: [...tpl.scopes].sort() }));
              }}
              options={ROLE_TEMPLATES.map((tpl) => ({
                value: tpl.id,
                label: t(`admin.roles.templates.${tpl.id}`),
                description: tpl.scopes.join(', '),
              }))}
            />
          </Field>
          {roles.length > 0 && (
            <Field label={t('admin.roles.copyFrom')} id="role-copy" helper={t('admin.roles.copyFromHelper')}>
              <Select
                value=""
                disabled={copying}
                placeholder={t('admin.roles.chooseRole')}
                onValueChange={(v) => void copyFrom(v)}
                options={roles.map((r) => ({ value: String(r.id), label: r.name }))}
              />
            </Field>
          )}
        </div>
        {canEditGroups ? (
          <Field
            label={t('admin.roles.groupsWithRole')}
            id="role-groups"
            helper={t('admin.roles.groupsWithRoleHelper')}
          >
            <MultiSelect
              options={groups.map((g) => ({ value: g.id, label: g.name }))}
              value={form.groupIds}
              onChange={(ids) => setForm({ ...form, groupIds: [...ids].sort((a, b) => a - b) })}
            />
          </Field>
        ) : (
          existing && (
            <p className="text-[13px] text-muted-foreground">
              {usedBy.length ? (
                <>
                  {t('admin.roles.usedBy')}{' '}
                  {usedBy.map((name) => (
                    <Badge key={name} variant="outline" className="mr-1">
                      {name}
                    </Badge>
                  ))}
                </>
              ) : (
                t('admin.roles.unused')
              )}
            </p>
          )
        )}
        {form.scopes.includes('ldap.manage') && <Alert variant="info">{t('admin.roles.legacyLdap')}</Alert>}
        <PermissionMatrix defs={defs} apis={apis} apisLoading={apisLoading} scopes={form.scopes} onToggle={toggle} />
      </DrawerBody>
      <DrawerFooter>
        {existing && (
          <Button variant="destructive-ghost" className="mr-auto" onClick={() => setConfirm('delete')}>
            <Trash2 aria-hidden="true" />
            {t('common.delete')}
          </Button>
        )}
        <span className="text-[13px] text-muted-foreground tabular-nums" aria-live="polite">
          {t('admin.roles.selected', { count: form.scopes.length })}
          {existing && (diff.added.length > 0 || diff.removed.length > 0) && (
            <> · {t('admin.roles.diffShort', { added: diff.added.length, removed: diff.removed.length })}</>
          )}
        </span>
        <Button onClick={requestClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </DrawerFooter>
      {existing && (
        <>
          <AlertDialog
            open={confirm === 'delete'}
            onOpenChange={(open) => !open && setConfirm(null)}
            title={t('admin.roles.deleteTitle', { name: existing.name })}
            description={
              usedBy.length
                ? t('admin.roles.deleteUsed', { count: usedBy.length, groups: usedBy.join(', ') })
                : t('admin.roles.deleteBody')
            }
            confirmLabel={t('common.delete')}
            confirmText={existing.name}
            onConfirm={() => remove.mutateAsync(existing.id)}
          />
          <AlertDialog
            open={confirm === 'save'}
            onOpenChange={(open) => !open && setConfirm(null)}
            destructive={diff.removed.length > 0}
            title={t('admin.roles.diffTitle', { name: existing.name })}
            description={
              usedBy.length ? t('admin.roles.diffAffects', { count: usedBy.length }) : t('admin.roles.diffUnused')
            }
            confirmLabel={t('common.save')}
            onConfirm={() => save.mutateAsync(form)}
          >
            <ScopeList title={t('admin.roles.diffAdded')} scopes={diff.added} variant="success" />
            <ScopeList title={t('admin.roles.diffRemoved')} scopes={diff.removed} variant="destructive" />
            <ScopeList title={t('admin.roles.groupsAdded')} scopes={groupsAdded.map(groupName)} variant="success" />
            <ScopeList
              title={t('admin.roles.groupsRemoved')}
              scopes={groupsRemoved.map(groupName)}
              variant="destructive"
            />
          </AlertDialog>
        </>
      )}
    </form>
  );
}

function ScopeList({
  title,
  scopes,
  variant,
}: {
  title: string;
  scopes: string[];
  variant: 'success' | 'destructive';
}) {
  if (scopes.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-[13px] font-medium">{title}</p>
      <ul className="mt-1 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
        {scopes.map((s) => (
          <li key={s}>
            <Badge variant={variant} className="font-mono">
              {s}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
