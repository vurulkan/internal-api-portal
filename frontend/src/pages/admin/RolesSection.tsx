import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Plus, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { api, type ApiDefinition, type Role, type ScopeDef } from '@/lib/api';
import { cn } from '@/lib/cn';
import { queryKeys } from '@/lib/query';
import { useAdminSections } from '@/hooks/queries';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Drawer,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingRegion,
  Skeleton,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  type Column,
} from '@/components/ui';
import { matches, SectionToolbar, useAdminMutation } from './common';
import { SearchInput, TableSkeleton } from './UsersSection';

const PER_API_ACTIONS = ['view', 'invoke', 'manage', 'delete'] as const;
type Form = { id?: number; name: string; description: string; scopes: string[] };
const EMPTY: Form = { name: '', description: '', scopes: [] };

const FAMILY_VARIANT: Record<ScopeDef['family'], 'neutral' | 'warning' | 'destructive'> = {
  read: 'neutral',
  write: 'warning',
  destructive: 'destructive',
};

export default function RolesSection() {
  const { t } = useTranslation();
  const roles = useQuery({ queryKey: queryKeys.admin.roles, queryFn: async () => (await api.roles()) ?? [] });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
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
        <RoleEditor key={editing === 'new' ? 'new' : editing.id} role={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function RoleEditor({ role, onClose }: { role: Role | 'new'; onClose: () => void }) {
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
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
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
                }
              : EMPTY
          }
          defs={catalog.data}
          apis={apis.data ?? []}
          apisLoading={apis.isPending && canSeeApis}
          onClose={onClose}
        />
      ) : (
        <LoadingRegion className="space-y-4 p-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-64" />
        </LoadingRegion>
      )}
    </Drawer>
  );
}

function RoleForm({
  existing,
  initial,
  defs,
  apis,
  apisLoading,
  onClose,
}: {
  existing: Role | null;
  initial: Form;
  defs: ScopeDef[];
  apis: ApiDefinition[];
  apisLoading: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Form>(initial);
  const [nameError, setNameError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scopes = useMemo(() => new Set(form.scopes), [form.scopes]);
  const groups = Array.from(new Set(defs.filter((d) => !d.perApi).map((d) => d.group)));

  function toggle(scope: string, on: boolean) {
    const next = new Set(form.scopes);
    if (on) next.add(scope);
    else next.delete(scope);
    setForm({ ...form, scopes: Array.from(next).sort() });
  }

  const save = useAdminMutation({
    mutationFn: async (f: Form) => {
      const payload = { name: f.name.trim(), description: f.description.trim() };
      const id = f.id ?? (await api.createRole(payload)).id;
      if (f.id) await api.updateRole(f.id, payload);
      await api.replacePermissions(id, f.scopes);
    },
    success: (_r, f) => (f.id ? t('admin.roles.updated') : t('admin.roles.created')),
    invalidate: (f) => [queryKeys.admin.roles, ...(f.id ? [queryKeys.admin.rolePermissions(f.id)] : [])],
    onSuccess: onClose,
  });
  const remove = useAdminMutation({
    mutationFn: (id: number) => api.deleteRole(id),
    success: t('admin.roles.deleted'),
    invalidate: [queryKeys.admin.roles],
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
        save.mutate(form);
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
        {scopes.has('ldap.manage') && <Alert variant="info">{t('admin.roles.legacyLdap')}</Alert>}
        {groups.map((group) => (
          <fieldset key={group} className="min-w-0">
            <legend className="mb-2 text-sm font-semibold">{group}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {defs
                .filter((d) => !d.perApi && d.group === group)
                .map((def) => (
                  <div
                    key={def.scope}
                    className={cn(
                      'rounded-md border border-border p-2',
                      scopes.has(def.scope) && 'border-input bg-muted/60',
                    )}
                  >
                    <Checkbox
                      checked={scopes.has(def.scope)}
                      onCheckedChange={(on) => toggle(def.scope, on)}
                      label={
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-semibold">{def.scope}</span>
                          <Badge variant={FAMILY_VARIANT[def.family]}>{t(`admin.roles.family.${def.family}`)}</Badge>
                        </span>
                      }
                      description={def.description}
                    />
                  </div>
                ))}
            </div>
          </fieldset>
        ))}
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t('admin.roles.perApi')}</h3>
          <TableContainer>
            <Table>
              <caption className="sr-only">{t('admin.roles.perApi')}</caption>
              <THead>
                <tr>
                  <TH>{t('admin.roles.api')}</TH>
                  {PER_API_ACTIONS.map((action) => {
                    const def = defs.find((d) => d.perApi && d.action === action);
                    return (
                      <TH key={action} className="text-center" title={def?.description}>
                        <span className="inline-flex items-center gap-1">
                          {t(`admin.roles.action.${action}`)}
                          {def?.family === 'destructive' && (
                            <TriangleAlert
                              className="size-3.5 text-destructive"
                              aria-label={t('admin.roles.family.destructive')}
                            />
                          )}
                        </span>
                      </TH>
                    );
                  })}
                </tr>
              </THead>
              <TBody>
                {apis.map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <p className="font-medium">{item.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{item.slug}</p>
                    </TD>
                    {PER_API_ACTIONS.map((action) => {
                      const scope = `api:${item.id}:${action}`;
                      return (
                        <TD key={scope} className="text-center">
                          <span className="inline-flex justify-center">
                            <Checkbox
                              aria-label={t('admin.roles.apiAction', {
                                api: item.name,
                                action: t(`admin.roles.action.${action}`),
                              })}
                              checked={scopes.has(scope)}
                              onCheckedChange={(on) => toggle(scope, on)}
                            />
                          </span>
                        </TD>
                      );
                    })}
                  </TR>
                ))}
              </TBody>
            </Table>
            {apis.length === 0 && !apisLoading && (
              <EmptyState className="border-t border-border py-6" title={t('admin.roles.noApis')} />
            )}
          </TableContainer>
        </div>
      </DrawerBody>
      <DrawerFooter>
        {existing && (
          <Button variant="destructive-ghost" className="mr-auto" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden="true" />
            {t('common.delete')}
          </Button>
        )}
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {t('admin.roles.selected', { count: form.scopes.length })}
        </span>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </DrawerFooter>
      {existing && (
        <AlertDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('admin.roles.deleteTitle', { name: existing.name })}
          description={t('admin.roles.deleteBody')}
          confirmLabel={t('common.delete')}
          confirmText={existing.name}
          onConfirm={() => remove.mutateAsync(existing.id)}
        />
      )}
    </form>
  );
}
