import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PlugZap } from 'lucide-react';
import { api, type AzureADConfig } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import {
  Alert,
  CopyButton,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  ErrorState,
  Field,
  Input,
  LoadingRegion,
  notifyError,
  notifySuccess,
  PasswordInput,
  Skeleton,
  Switch,
  Textarea,
} from '@/components/ui';
import { splitList, useAdminMutation } from './common';

export default function AzureSection() {
  const config = useQuery({ queryKey: queryKeys.admin.azureAd, queryFn: api.azureAd });
  if (config.isError)
    return (
      <Card>
        <ErrorState error={config.error} onRetry={() => void config.refetch()} />
      </Card>
    );
  if (!config.data) {
    return (
      <LoadingRegion>
        <Skeleton className="h-96" />
      </LoadingRegion>
    );
  }
  return (
    <AzureForm
      key={config.dataUpdatedAt}
      initial={{ ...config.data, clientSecret: '', allowedGroups: config.data.allowedGroups ?? [] }}
    />
  );
}

function AzureForm({ initial }: { initial: AzureADConfig }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<AzureADConfig>(initial);

  const save = useAdminMutation({
    mutationFn: (value: AzureADConfig) => api.updateAzureAd(value),
    success: t('admin.azure.saved'),
    invalidate: [queryKeys.admin.azureAd, queryKeys.authProviders],
  });
  const test = useMutation({
    mutationFn: (value: AzureADConfig) => api.testAzureAd(value),
    onSuccess: () => notifySuccess(t('admin.azure.testOk')),
    onError: (error) => notifyError(error, t('admin.azure.testFailed')),
  });

  const set = <K extends keyof AzureADConfig>(key: K, value: AzureADConfig[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const callback = `${window.location.origin}/api/auth/azure/callback`;

  return (
    <Card>
      <CardHeader title={t('admin.azure.title')} description={t('admin.azure.body')} />
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(form);
        }}
      >
        <CardContent className="space-y-4">
          <Switch
            label={t('admin.azure.enabled')}
            description={t('admin.azure.enabledHelper')}
            checked={form.enabled}
            onCheckedChange={(v) => set('enabled', v)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.azure.tenantId')} id="azure-tenant">
              <Input
                className="font-mono text-[13px]"
                value={form.tenantId}
                onChange={(e) => set('tenantId', e.target.value)}
              />
            </Field>
            <Field label={t('admin.azure.clientId')} id="azure-client">
              <Input
                className="font-mono text-[13px]"
                value={form.clientId}
                onChange={(e) => set('clientId', e.target.value)}
              />
            </Field>
          </div>
          <Field
            label={t('admin.azure.clientSecret')}
            id="azure-secret"
            helper={form.passwordConfigured ? t('admin.keepSecret') : undefined}
          >
            <PasswordInput
              autoComplete="off"
              value={form.clientSecret ?? ''}
              onChange={(e) => set('clientSecret', e.target.value)}
            />
          </Field>
          <div className="flex items-start gap-2">
            <Field
              label={t('admin.azure.redirectUrl')}
              id="azure-redirect"
              className="min-w-0 flex-1"
              helper={t('admin.azure.redirectUrlHelper', { url: callback })}
            >
              <Input
                type="url"
                className="font-mono text-[13px]"
                value={form.redirectUrl}
                onChange={(e) => set('redirectUrl', e.target.value)}
              />
            </Field>
            {/* Beside the field, not inside it: the Field labels its single child. */}
            <div className="pt-[26px]">
              <CopyButton value={form.redirectUrl || callback} label={t('admin.azure.copyRedirect')} />
            </div>
          </div>
          <Field
            label={t('admin.azure.allowedGroups')}
            id="azure-groups"
            optional
            helper={t('admin.azure.allowedGroupsHelper')}
          >
            <Textarea
              rows={3}
              className="font-mono text-[13px]"
              value={(form.allowedGroups ?? []).join('\n')}
              onChange={(e) => set('allowedGroups', splitList(e.target.value))}
            />
          </Field>
          <Alert variant="info">{t('admin.azure.note')}</Alert>
        </CardContent>
        <CardFooter>
          <Button onClick={() => test.mutate(form)} loading={test.isPending}>
            <PlugZap aria-hidden="true" />
            {t('admin.azure.test')}
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
