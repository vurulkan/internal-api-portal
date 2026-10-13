import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';
import { queryKeys } from '@/lib/query';
import { Button, Dialog, Field, Input, MultiSelect } from '@/components/ui';
import { useAdminMutation } from '../common';

/**
 * Users → New user → Azure AD: an account that waits for the person's first
 * Microsoft sign-in, so it can be put in groups now. It is bound at that sign-in
 * by sign-in name (UPN) or, failing that, by e-mail.
 */
export function AzurePreregisterDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [upn, setUpn] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [error, setError] = useState('');
  const groups = useQuery({ queryKey: queryKeys.admin.groups, queryFn: async () => (await api.groups()) ?? [] });
  const create = useAdminMutation({
    mutationFn: () =>
      adminApi.preregisterAzure({
        email: email.trim(),
        upn: upn.trim() || undefined,
        displayName: displayName.trim(),
        groupIds,
      }),
    success: (r) =>
      r.sharesEmailWith
        ? t('admin.azurePre.createdBeside', { name: r.username, other: r.sharesEmailWith })
        : t('admin.azurePre.created', { name: r.username }),
    invalidate: [queryKeys.admin.users, queryKeys.admin.groups],
    onSuccess: onClose,
  });
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
      setError(t('admin.azurePre.emailRequired'));
      document.getElementById('azure-pre-email')?.focus();
      return;
    }
    setError('');
    create.mutate(undefined);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('admin.azurePre.title')}
      description={t('admin.azurePre.body')}
      className="max-w-lg"
    >
      <form id="azure-pre-form" noValidate onSubmit={submit} className="space-y-4">
        <Field label={t('admin.users.email')} id="azure-pre-email" required error={error}>
          <Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('admin.azurePre.upn')} id="azure-pre-upn" optional helper={t('admin.azurePre.upnHelper')}>
          <Input
            autoComplete="off"
            placeholder="jdoe@corp.onmicrosoft.com"
            value={upn}
            onChange={(e) => setUpn(e.target.value)}
          />
        </Field>
        <Field label={t('admin.users.displayName')} id="azure-pre-name" optional>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label={t('admin.users.groups')} id="azure-pre-groups" helper={t('admin.users.groupsHelper')}>
          <MultiSelect
            options={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
            value={groupIds}
            onChange={setGroupIds}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            {t('admin.azurePre.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
