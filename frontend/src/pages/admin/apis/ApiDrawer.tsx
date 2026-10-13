import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { RotateCw, Trash2 } from 'lucide-react';
import { api, type ApiDefinition, type Group } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';
import { queryKeys } from '@/lib/query';
import {
  AlertDialog,
  Button,
  DrawerBody,
  DrawerFooter,
  ErrorState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { EditorDrawer, FormSkeleton, sameValue, useAdminMutation, useDirty, useRequestClose } from '../common';
import { AccessFields, HeaderFields, IdentityFields, OwnershipFields, PolicyFields, UrlFields } from './fields';
import {
  toApiForm,
  toPayload,
  validatePolicy,
  validateSource,
  type ApiForm,
  type ApiFormErrors,
  type SetField,
} from './form';
import { SpecPreview } from './SpecPreview';

/** Editing a registered API, one tab per concern. */
export function ApiDrawer({
  apiDef,
  groups,
  allApis,
  managesAll,
  onClose,
}: {
  apiDef: ApiDefinition;
  groups: Group[];
  allApis: ApiDefinition[];
  managesAll: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const access = useQuery({
    queryKey: queryKeys.admin.apiAccess(apiDef.id),
    queryFn: async () => (await api.apiAccess(apiDef.id)).items ?? [],
  });
  return (
    <EditorDrawer
      onClose={onClose}
      title={t('admin.apis.edit', { name: apiDef.name })}
      className="w-[min(100vw,44rem)]"
    >
      {access.isError ? (
        <ErrorState error={access.error} onRetry={() => void access.refetch()} />
      ) : access.isSuccess ? (
        <EditForm
          apiDef={apiDef}
          initial={toApiForm(apiDef, access.data)}
          groups={groups}
          allApis={allApis}
          managesAll={managesAll}
          onClose={onClose}
        />
      ) : (
        <FormSkeleton />
      )}
    </EditorDrawer>
  );
}

function EditForm({
  apiDef,
  initial,
  groups,
  allApis,
  managesAll,
  onClose,
}: {
  apiDef: ApiDefinition;
  initial: ApiForm;
  groups: Group[];
  allApis: ApiDefinition[];
  managesAll: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const requestClose = useRequestClose();
  const [form, setForm] = useState<ApiForm>(initial);
  const [errors, setErrors] = useState<ApiFormErrors>({});
  const [tab, setTab] = useState('general');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useDirty(!sameValue(form, initial));
  const set: SetField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const messages = {
    required: t('admin.apis.required'),
    url: t('admin.apis.invalidUrl'),
    slug: t('admin.apis.invalidSlug'),
    range: t('admin.apis.outOfRange'),
  };
  const id = apiDef.id;
  // Access and the owner group change what groups (and their members) may do.
  const invalidate = [
    queryKeys.admin.apis,
    queryKeys.admin.groups,
    queryKeys.admin.users,
    queryKeys.admin.apiAccess(id),
    queryKeys.admin.overview,
    queryKeys.catalog,
    queryKeys.api(String(id)),
    queryKeys.api(apiDef.slug),
  ];

  const save = useAdminMutation({
    mutationFn: async (f: ApiForm) => {
      await api.updateApi(id, toPayload(f));
      if (!sameValue(f.access, initial.access)) await api.setApiAccess(id, f.access);
    },
    success: t('admin.apis.updated'),
    invalidate,
    onSuccess: onClose,
  });
  const refresh = useAdminMutation({
    mutationFn: () => api.refreshApiSpec(id),
    success: t('admin.apis.refreshed'),
    invalidate: [...invalidate, queryKeys.spec(String(id))],
    errorFallback: t('admin.apis.refreshFailed'),
  });
  const remove = useAdminMutation({
    mutationFn: () => api.deleteApi(id),
    success: t('admin.apis.deleted'),
    invalidate: [queryKeys.admin.apis, queryKeys.admin.overview, queryKeys.catalog],
    onSuccess: onClose,
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const source = validateSource(form, messages);
    const policy = validatePolicy(form, messages);
    setErrors({ ...source, ...policy });
    const first = Object.keys(source)[0] ?? Object.keys(policy)[0];
    if (first) {
      setTab(Object.keys(source).length ? 'general' : 'tryIt');
      requestAnimationFrame(() => document.getElementById(`api-${first}`)?.focus());
      return;
    }
    save.mutate(form);
  }

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <DrawerBody className="p-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList label={t('admin.apis.tabsLabel')}>
            {(['general', 'tryIt', 'headers', 'access'] as const).map((key) => (
              <TabsTrigger key={key} value={key}>
                {t(`admin.apis.tabs.${key}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="general" className="space-y-4">
            <IdentityFields form={form} set={set} errors={errors} />
            <UrlFields form={form} set={set} errors={errors} />
            {form.internalOpenapiUrl.trim() !== initial.internalOpenapiUrl.trim() && (
              <SpecPreview url={form.internalOpenapiUrl} />
            )}
            <OwnershipFields form={form} set={set} groups={groups} allApis={allApis} managesAll={managesAll} />
          </TabsContent>
          <TabsContent value="tryIt" className="space-y-4">
            <PolicyFields form={form} set={set} errors={errors} allApis={allApis} />
          </TabsContent>
          <TabsContent value="headers" className="space-y-4">
            <HeaderFields form={form} set={set} />
          </TabsContent>
          <TabsContent value="access" className="space-y-4">
            <AccessFields form={form} set={set} groups={groups} />
          </TabsContent>
        </Tabs>
      </DrawerBody>
      <DrawerFooter>
        <Button variant="destructive-ghost" onClick={() => setConfirmDelete(true)}>
          <Trash2 aria-hidden="true" />
          {t('common.delete')}
        </Button>
        <Button className="mr-auto" onClick={() => refresh.mutate(undefined)} loading={refresh.isPending}>
          <RotateCw aria-hidden="true" />
          {t('admin.apis.refresh')}
        </Button>
        <Button onClick={requestClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </DrawerFooter>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('admin.apis.deleteTitle', { name: apiDef.name })}
        description={t('admin.apis.deleteBody')}
        confirmLabel={t('common.delete')}
        confirmText={apiDef.slug}
        onConfirm={() => remove.mutateAsync(undefined)}
      >
        {confirmDelete && <DeleteImpact id={id} />}
      </AlertDialog>
    </form>
  );
}

/** What deleting the API also removes, counted by the server. */
function DeleteImpact({ id }: { id: number }) {
  const { t } = useTranslation();
  const impact = useQuery({ queryKey: queryKeys.admin.apiImpact(id), queryFn: () => adminApi.apiImpact(id) });
  if (impact.isError) return null;
  if (!impact.data) return <Skeleton className="mt-3 h-16" />;
  const rows = [
    t('admin.apis.impactAccess', { count: impact.data.accessGrants }),
    t('admin.apis.impactScopes', { count: impact.data.roleScopes }),
    t('admin.apis.impactFavorites', { count: impact.data.favorites }),
    t('admin.apis.impactOperations', { count: impact.data.operations }),
    t('admin.apis.impactHistory', { count: impact.data.historyEntries }),
  ];
  return (
    <ul className="mt-3 list-disc space-y-0.5 pl-5 text-[13px]" aria-label={t('admin.apis.impactLabel')}>
      {rows.map((row) => (
        <li key={row}>{row}</li>
      ))}
    </ul>
  );
}
