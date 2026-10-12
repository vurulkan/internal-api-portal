import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { LayoutList, Plus, RotateCw, Trash2 } from 'lucide-react';
import { api, type ApiAccess, type ApiDefinition, type ApiDefinitionPayload, type Group } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { useAdminSections, useMe } from '@/hooks/queries';
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  Checkbox,
  ChipInput,
  DataTable,
  Drawer,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  ErrorState,
  Field,
  Fieldset,
  IconButton,
  Input,
  LoadingRegion,
  Select,
  Skeleton,
  Switch,
  Textarea,
  type Column,
} from '@/components/ui';
import { matches, SectionToolbar, useAdminMutation } from './common';
import { SearchInput, TableSkeleton } from './UsersSection';

type Form = {
  id?: number;
  name: string;
  slug: string;
  description: string;
  internalOpenapiUrl: string;
  internalBaseUrl: string;
  isActive: boolean;
  tryItEnabled: boolean;
  allowedMethods: string[];
  allowedPathPrefixes: string[];
  ownerTeam: string;
  tags: string[];
  ownerGroupId: number | null;
  allowedRequestHeaders: string[];
  forwardAllXHeaders: boolean;
  // value '' keeps the stored value of an existing header
  injectHeaders: { name: string; value: string }[];
  rateLimitPerMinute: string;
  timeoutSeconds: string;
  access: ApiAccess[];
};

const EMPTY: Form = {
  name: '',
  slug: '',
  description: '',
  internalOpenapiUrl: '',
  internalBaseUrl: '',
  isActive: true,
  tryItEnabled: true,
  allowedMethods: [],
  allowedPathPrefixes: [],
  ownerTeam: '',
  tags: [],
  ownerGroupId: null,
  allowedRequestHeaders: [],
  forwardAllXHeaders: false,
  injectHeaders: [],
  rateLimitPerMinute: '0',
  timeoutSeconds: '0',
  access: [],
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export default function ApisSection() {
  const { t } = useTranslation();
  const me = useMe();
  const caps = me.data?.capabilities;
  const canCreate = !!caps?.canCreateApi || !!me.data?.user.isAdmin;
  const apis = useQuery({ queryKey: queryKeys.admin.apis, queryFn: async () => (await api.adminApis()) ?? [] });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ApiDefinition | 'new' | null>(null);
  const rows = useMemo(
    () => (apis.data ?? []).filter((a) => matches(search, a.name, a.slug, a.ownerTeam, ...(a.tags ?? []))),
    [apis.data, search],
  );

  const columns: Column<ApiDefinition>[] = [
    {
      id: 'name',
      header: t('admin.apis.name'),
      sortValue: (a) => a.name,
      cell: (a) => (
        <span className="block min-w-0">
          <span className="font-medium">{a.name}</span>
          <span className="block font-mono text-xs text-muted-foreground">{a.slug}</span>
        </span>
      ),
    },
    {
      id: 'owner',
      header: t('catalog.owner'),
      sortValue: (a) => a.ownerTeam ?? '',
      cell: (a) => a.ownerTeam || '–',
      className: 'text-muted-foreground',
    },
    {
      id: 'status',
      header: t('admin.users.status'),
      sortValue: (a) => (a.isActive ? 1 : 0),
      cell: (a) => (
        <span className="flex flex-wrap gap-1">
          <Badge variant={a.isActive ? 'success' : 'destructive'}>
            {a.isActive ? t('common.active') : t('common.inactive')}
          </Badge>
          {!a.tryItEnabled && <Badge variant="outline">{t('admin.apis.tryItOff')}</Badge>}
        </span>
      ),
    },
    {
      id: 'spec',
      header: t('admin.apis.spec'),
      sortValue: (a) => a.lastSpecRefreshAt ?? '',
      cell: (a) =>
        a.lastSpecRefreshAt ? (
          <span className="text-[13px]" title={a.lastSpecStatus}>
            {formatRelative(a.lastSpecRefreshAt)}
            {a.lastSpecStatus && !/^ok/i.test(a.lastSpecStatus) && (
              <Badge variant="warning" className="ml-1.5">
                {a.lastSpecStatus}
              </Badge>
            )}
          </span>
        ) : (
          <Badge variant="warning">{t('api.neverRefreshed')}</Badge>
        ),
    },
  ];

  if (apis.isPending) return <TableSkeleton />;
  if (apis.isError)
    return (
      <Card>
        <ErrorState error={apis.error} onRetry={() => void apis.refetch()} />
      </Card>
    );

  return (
    <>
      <DataTable
        caption={t('admin.sections.apis')}
        rows={rows}
        columns={columns}
        rowKey={(a) => String(a.id)}
        onRowClick={(a) => setEditing(a)}
        activeRowKey={editing && editing !== 'new' ? String(editing.id) : undefined}
        toolbar={
          <SectionToolbar
            actions={
              canCreate && (
                <Button variant="accent" onClick={() => setEditing('new')}>
                  <Plus aria-hidden="true" />
                  {t('admin.apis.new')}
                </Button>
              )
            }
          >
            <SearchInput value={search} onChange={setSearch} label={t('admin.apis.search')} />
          </SectionToolbar>
        }
        empty={
          search ? (
            <EmptyState
              title={t('admin.noMatch')}
              action={<Button onClick={() => setSearch('')}>{t('admin.clearSearch')}</Button>}
            />
          ) : (
            <EmptyState
              icon={LayoutList}
              title={t('admin.apis.emptyTitle')}
              description={canCreate ? t('admin.apis.emptyBody') : t('admin.apis.emptyBodyOwner')}
              action={
                canCreate && (
                  <Button variant="accent" onClick={() => setEditing('new')}>
                    <Plus aria-hidden="true" />
                    {t('admin.apis.new')}
                  </Button>
                )
              }
            />
          )
        }
      />
      {editing && (
        <ApiEditor
          key={editing === 'new' ? 'new' : editing.id}
          apiDef={editing}
          onClose={() => setEditing(null)}
          allApis={apis.data ?? []}
        />
      )}
    </>
  );
}

function toForm(a: ApiDefinition): Form {
  return {
    id: a.id,
    name: a.name,
    slug: a.slug,
    description: a.description ?? '',
    internalOpenapiUrl: a.internalOpenapiUrl ?? '',
    internalBaseUrl: a.internalBaseUrl ?? '',
    isActive: a.isActive,
    tryItEnabled: a.tryItEnabled,
    allowedMethods: a.allowedMethods ?? [],
    allowedPathPrefixes: a.allowedPathPrefixes ?? [],
    ownerTeam: a.ownerTeam ?? '',
    tags: a.tags ?? [],
    ownerGroupId: a.ownerGroupId ?? null,
    allowedRequestHeaders: a.allowedRequestHeaders ?? [],
    forwardAllXHeaders: a.forwardAllXHeaders ?? false,
    injectHeaders: (a.injectHeaderNames ?? []).map((name) => ({ name, value: '' })),
    rateLimitPerMinute: String(a.rateLimitPerMinute ?? 0),
    timeoutSeconds: String(a.timeoutSeconds ?? 0),
    access: [],
  };
}

function ApiEditor({
  apiDef,
  onClose,
  allApis,
}: {
  apiDef: ApiDefinition | 'new';
  onClose: () => void;
  allApis: ApiDefinition[];
}) {
  const { t } = useTranslation();
  const sections = useAdminSections();
  const existing = apiDef === 'new' ? null : apiDef;
  // Groups feed the owner group and the access list (every API manager can list them).
  const groups = useQuery({
    queryKey: queryKeys.admin.groups,
    queryFn: async () => (await api.groups()) ?? [],
    enabled: sections.length > 0,
  });
  const access = useQuery({
    queryKey: queryKeys.admin.apiAccess(existing?.id ?? 0),
    queryFn: async () => (await api.apiAccess(existing!.id)).items ?? [],
    enabled: !!existing,
  });
  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={existing ? t('admin.apis.edit', { name: existing.name }) : t('admin.apis.new')}
      className="w-[min(100vw,44rem)]"
    >
      {access.isError ? (
        <ErrorState error={access.error} onRetry={() => void access.refetch()} />
      ) : !existing || access.isSuccess ? (
        <ApiForm
          existing={existing}
          initial={existing ? { ...toForm(existing), access: access.data ?? [] } : EMPTY}
          groups={groups.data ?? []}
          allApis={allApis}
          onClose={onClose}
        />
      ) : (
        <LoadingRegion className="space-y-4 p-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-40" />
        </LoadingRegion>
      )}
    </Drawer>
  );
}

function ApiForm({
  existing,
  initial,
  groups,
  allApis,
  onClose,
}: {
  existing: ApiDefinition | null;
  initial: Form;
  groups: Group[];
  allApis: ApiDefinition[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const managesAll = !!me.data?.capabilities?.managesAllApis || !!me.data?.user.isAdmin;
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tagSuggestions = useMemo(() => Array.from(new Set(allApis.flatMap((a) => a.tags ?? []))).sort(), [allApis]);
  const prefixSuggestions = useMemo(
    () => Array.from(new Set(allApis.flatMap((a) => a.allowedPathPrefixes ?? []))).sort(),
    [allApis],
  );

  const save = useAdminMutation({
    mutationFn: async (f: Form) => {
      const payload: ApiDefinitionPayload = {
        name: f.name.trim(),
        slug: f.slug.trim(),
        description: f.description.trim(),
        internalOpenapiUrl: f.internalOpenapiUrl.trim(),
        internalBaseUrl: f.internalBaseUrl.trim(),
        isActive: f.isActive,
        tryItEnabled: f.tryItEnabled,
        allowedMethods: f.allowedMethods.map((m) => m.toUpperCase()),
        allowedPathPrefixes: f.allowedPathPrefixes,
        ownerTeam: f.ownerTeam.trim(),
        tags: f.tags,
        ownerGroupId: f.ownerGroupId,
        allowedRequestHeaders: f.allowedRequestHeaders,
        forwardAllXHeaders: f.forwardAllXHeaders,
        injectHeaders: f.injectHeaders
          .filter((h) => h.name.trim())
          .map((h) => ({ name: h.name.trim(), value: h.value })),
        rateLimitPerMinute: Number(f.rateLimitPerMinute) || 0,
        timeoutSeconds: Number(f.timeoutSeconds) || 0,
      };
      if (f.id) {
        await api.updateApi(f.id, payload);
        await api.setApiAccess(f.id, f.access);
        return f.id;
      }
      const created = await api.createApi(payload);
      if (f.access.length) await api.setApiAccess(created.id, f.access);
      return created.id;
    },
    success: (_r, f) => (f.id ? t('admin.apis.updated') : t('admin.apis.created')),
    invalidate: (_f, id) => [
      queryKeys.admin.apis,
      queryKeys.admin.apiAccess(id),
      queryKeys.catalog,
      queryKeys.api(String(id)),
    ],
    onSuccess: onClose,
  });
  const refresh = useAdminMutation({
    mutationFn: (id: number) => api.refreshApiSpec(id),
    success: t('admin.apis.refreshed'),
    invalidate: (id) => [queryKeys.admin.apis, queryKeys.spec(String(id)), queryKeys.api(String(id))],
    errorFallback: t('admin.apis.refreshFailed'),
  });
  const remove = useAdminMutation({
    mutationFn: (id: number) => api.deleteApi(id),
    success: t('admin.apis.deleted'),
    invalidate: [queryKeys.admin.apis, queryKeys.catalog],
    onSuccess: onClose,
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = t('admin.apis.required');
    if (!form.slug.trim()) next.slug = t('admin.apis.required');
    if (!form.internalOpenapiUrl.trim()) next.internalOpenapiUrl = t('admin.apis.required');
    if (!form.internalBaseUrl.trim()) next.internalBaseUrl = t('admin.apis.required');
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      document.getElementById(`api-${first}`)?.focus();
      return;
    }
    save.mutate(form);
  }

  const groupOptions = groups.map((g) => ({ value: String(g.id), label: g.name }));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DrawerBody className="space-y-5 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.apis.name')} id="api-name" required error={errors.name}>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label={t('catalog.slug')} id="api-slug" required error={errors.slug}>
            <Input className="font-mono text-[13px]" value={form.slug} onChange={(e) => set('slug', e.target.value)} />
          </Field>
        </div>
        <Field label={t('admin.apis.description')} id="api-description" optional>
          <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field
          label={t('admin.apis.openapiUrl')}
          id="api-internalOpenapiUrl"
          required
          error={errors.internalOpenapiUrl}
          helper={t('admin.apis.openapiUrlHelper')}
        >
          <Input
            type="url"
            className="font-mono text-[13px]"
            value={form.internalOpenapiUrl}
            onChange={(e) => set('internalOpenapiUrl', e.target.value)}
          />
        </Field>
        <Field
          label={t('admin.apis.baseUrl')}
          id="api-internalBaseUrl"
          required
          error={errors.internalBaseUrl}
          helper={t('admin.apis.baseUrlHelper')}
        >
          <Input
            type="url"
            className="font-mono text-[13px]"
            value={form.internalBaseUrl}
            onChange={(e) => set('internalBaseUrl', e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('catalog.owner')} id="api-ownerTeam" optional>
            <Input value={form.ownerTeam} onChange={(e) => set('ownerTeam', e.target.value)} />
          </Field>
          <Field label={t('admin.apis.ownerGroup')} id="api-ownerGroup" helper={t('admin.apis.ownerGroupHelper')}>
            <Select
              value={form.ownerGroupId ? String(form.ownerGroupId) : ''}
              onValueChange={(v) => set('ownerGroupId', v ? Number(v) : null)}
              disabled={!managesAll}
              options={[{ value: '', label: t('admin.apis.noOwnerGroup') }, ...groupOptions]}
            />
          </Field>
        </div>
        <Field label={t('catalog.tags')} id="api-tags" helper={t('admin.apis.tagsHelper')}>
          <ChipInput suggestions={tagSuggestions} value={form.tags} onChange={(v) => set('tags', v)} />
        </Field>
        <div className="space-y-3 rounded-lg border border-border p-3">
          <Switch
            label={t('admin.apis.active')}
            description={t('admin.apis.activeHelper')}
            checked={form.isActive}
            onCheckedChange={(v) => set('isActive', v)}
          />
          <Switch
            label={t('api.tryIt')}
            description={t('admin.apis.tryItHelper')}
            checked={form.tryItEnabled}
            onCheckedChange={(v) => set('tryItEnabled', v)}
          />
        </div>

        <Fieldset legend={t('admin.apis.policy')} description={t('admin.apis.policyBody')}>
          <Field label={t('api.allowedMethods')} id="api-methods" helper={t('admin.apis.methodsHelper')}>
            <ChipInput
              suggestions={METHODS}
              normalize={(v) => v.toUpperCase()}
              value={form.allowedMethods}
              onChange={(v) => set('allowedMethods', v)}
            />
          </Field>
          <Field label={t('api.allowedPaths')} id="api-paths" helper={t('admin.apis.pathsHelper')}>
            <ChipInput
              suggestions={prefixSuggestions}
              value={form.allowedPathPrefixes}
              onChange={(v) => set('allowedPathPrefixes', v)}
            />
          </Field>
          <Field label={t('admin.apis.allowedHeaders')} id="api-headers" helper={t('admin.apis.allowedHeadersHelper')}>
            <ChipInput
              suggestions={['Authorization', 'X-Api-Key', 'X-Tenant-Id', 'X-Correlation-Id']}
              value={form.allowedRequestHeaders}
              onChange={(v) => set('allowedRequestHeaders', v)}
            />
          </Field>
          <Checkbox
            label={t('admin.apis.forwardAllX')}
            description={t('admin.apis.forwardAllXHelper')}
            checked={form.forwardAllXHeaders}
            onCheckedChange={(v) => set('forwardAllXHeaders', v)}
          />
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('admin.apis.injectHeaders')}</p>
            <p className="text-xs text-muted-foreground">{t('admin.apis.injectHeadersHelper')}</p>
            {form.injectHeaders.map((header, index) => (
              <div key={index} className="flex items-start gap-2">
                <Input
                  aria-label={t('admin.apis.headerName', { index: index + 1 })}
                  className="font-mono text-[13px]"
                  placeholder="X-Api-Key"
                  value={header.name}
                  onChange={(e) =>
                    set(
                      'injectHeaders',
                      form.injectHeaders.map((h, i) => (i === index ? { ...h, name: e.target.value } : h)),
                    )
                  }
                />
                <Input
                  aria-label={t('admin.apis.headerValue', { index: index + 1 })}
                  type="password"
                  autoComplete="off"
                  placeholder={form.id ? t('admin.apis.unchanged') : t('admin.apis.value')}
                  value={header.value}
                  onChange={(e) =>
                    set(
                      'injectHeaders',
                      form.injectHeaders.map((h, i) => (i === index ? { ...h, value: e.target.value } : h)),
                    )
                  }
                />
                <IconButton
                  label={t('admin.apis.removeHeader', { name: header.name || index + 1 })}
                  icon={<Trash2 aria-hidden="true" />}
                  onClick={() =>
                    set(
                      'injectHeaders',
                      form.injectHeaders.filter((_, i) => i !== index),
                    )
                  }
                />
              </div>
            ))}
            <Button size="sm" onClick={() => set('injectHeaders', [...form.injectHeaders, { name: '', value: '' }])}>
              <Plus aria-hidden="true" />
              {t('admin.apis.addHeader')}
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.apis.rateLimit')} id="api-rate" helper={t('admin.apis.rateLimitHelper')}>
              <Input
                type="number"
                min={0}
                max={10000}
                inputMode="numeric"
                value={form.rateLimitPerMinute}
                onChange={(e) => set('rateLimitPerMinute', e.target.value)}
              />
            </Field>
            <Field label={t('admin.apis.timeout')} id="api-timeout" helper={t('admin.apis.timeoutHelper')}>
              <Input
                type="number"
                min={0}
                max={300}
                inputMode="numeric"
                value={form.timeoutSeconds}
                onChange={(e) => set('timeoutSeconds', e.target.value)}
              />
            </Field>
          </div>
        </Fieldset>

        <Fieldset legend={t('admin.apis.access')} description={t('admin.apis.accessBody')}>
          {form.access.length === 0 && <p className="text-[13px] text-muted-foreground">{t('admin.apis.noAccess')}</p>}
          {form.access.map((entry, index) => {
            const name = groups.find((g) => g.id === entry.groupId)?.name ?? entry.groupName ?? `#${entry.groupId}`;
            return (
              <div key={entry.groupId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                <Select
                  aria-label={t('admin.apis.accessLevel', { group: name })}
                  className="w-36"
                  value={entry.level}
                  onValueChange={(v) =>
                    set(
                      'access',
                      form.access.map((a, i) => (i === index ? { ...a, level: v as ApiAccess['level'] } : a)),
                    )
                  }
                  options={[
                    { value: 'view', label: t('catalog.accessLevel.view') },
                    { value: 'invoke', label: t('catalog.accessLevel.invoke') },
                  ]}
                />
                <IconButton
                  label={t('admin.apis.removeAccess', { group: name })}
                  icon={<Trash2 aria-hidden="true" />}
                  onClick={() =>
                    set(
                      'access',
                      form.access.filter((_, i) => i !== index),
                    )
                  }
                />
              </div>
            );
          })}
          <Field label={t('admin.apis.grantGroup')} id="api-grant">
            <Select
              value=""
              placeholder={t('admin.apis.grantPlaceholder')}
              onValueChange={(v) => v && set('access', [...form.access, { groupId: Number(v), level: 'view' }])}
              options={groupOptions.filter((g) => !form.access.some((a) => String(a.groupId) === g.value))}
            />
          </Field>
        </Fieldset>
      </DrawerBody>
      <DrawerFooter>
        {existing && (
          <>
            <Button variant="destructive-ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden="true" />
              {t('common.delete')}
            </Button>
            <Button className="mr-auto" onClick={() => refresh.mutate(existing.id)} loading={refresh.isPending}>
              <RotateCw aria-hidden="true" />
              {t('admin.apis.refresh')}
            </Button>
          </>
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
          title={t('admin.apis.deleteTitle', { name: existing.name })}
          description={t('admin.apis.deleteBody')}
          confirmLabel={t('common.delete')}
          confirmText={existing.slug}
          onConfirm={() => remove.mutateAsync(existing.id)}
        />
      )}
    </form>
  );
}
