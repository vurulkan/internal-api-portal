import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { ApiAccess, ApiDefinition, Group } from '@/lib/api';
import {
  Button,
  Checkbox,
  ChipInput,
  Field,
  Fieldset,
  IconButton,
  Input,
  Select,
  Switch,
  Textarea,
} from '@/components/ui';
import { slugify, type ApiForm, type ApiFormErrors, type SetField } from './form';

// The API form's field groups, shared by the create wizard and the edit drawer.

type Props = { form: ApiForm; set: SetField; errors?: ApiFormErrors };

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function IdentityFields({ form, set, errors = {}, autoSlug }: Props & { autoSlug?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('admin.apis.name')} id="api-name" required error={errors.name}>
          <Input
            value={form.name}
            onChange={(e) => {
              // A new API's slug follows its name until the slug is edited by hand.
              if (autoSlug && form.slug === slugify(form.name)) set('slug', slugify(e.target.value));
              set('name', e.target.value);
            }}
          />
        </Field>
        <Field label={t('catalog.slug')} id="api-slug" required error={errors.slug} helper={t('admin.apis.slugHelper')}>
          <Input className="font-mono text-[13px]" value={form.slug} onChange={(e) => set('slug', e.target.value)} />
        </Field>
      </div>
      <Field label={t('admin.apis.description')} id="api-description" optional>
        <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
    </>
  );
}

export function UrlFields({ form, set, errors = {} }: Props) {
  const { t } = useTranslation();
  return (
    <>
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
          placeholder="http://payments.internal:8080/openapi.json"
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
          placeholder="http://payments.internal:8080"
          value={form.internalBaseUrl}
          onChange={(e) => set('internalBaseUrl', e.target.value)}
        />
      </Field>
    </>
  );
}

export function OwnershipFields({
  form,
  set,
  groups,
  allApis,
  managesAll,
}: Props & { groups: Group[]; allApis: ApiDefinition[]; managesAll: boolean }) {
  const { t } = useTranslation();
  const tagSuggestions = useMemo(() => Array.from(new Set(allApis.flatMap((a) => a.tags ?? []))).sort(), [allApis]);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('catalog.owner')} id="api-ownerTeam" optional>
          <Input value={form.ownerTeam} onChange={(e) => set('ownerTeam', e.target.value)} />
        </Field>
        <Field label={t('admin.apis.ownerGroup')} id="api-ownerGroup" helper={t('admin.apis.ownerGroupHelper')}>
          <Select
            value={form.ownerGroupId ? String(form.ownerGroupId) : ''}
            onValueChange={(v) => set('ownerGroupId', v ? Number(v) : null)}
            disabled={!managesAll}
            options={[
              { value: '', label: t('admin.apis.noOwnerGroup') },
              ...groups.map((g) => ({ value: String(g.id), label: g.name })),
            ]}
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
    </>
  );
}

export function PolicyFields({ form, set, errors = {}, allApis }: Props & { allApis: ApiDefinition[] }) {
  const { t } = useTranslation();
  const prefixSuggestions = useMemo(
    () => Array.from(new Set(allApis.flatMap((a) => a.allowedPathPrefixes ?? []))).sort(),
    [allApis],
  );
  return (
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('admin.apis.rateLimit')}
          id="api-rateLimitPerMinute"
          helper={t('admin.apis.rateLimitHelper')}
          error={errors.rateLimitPerMinute}
        >
          <Input
            type="number"
            min={0}
            max={10000}
            inputMode="numeric"
            value={form.rateLimitPerMinute}
            onChange={(e) => set('rateLimitPerMinute', e.target.value)}
          />
        </Field>
        <Field
          label={t('admin.apis.timeout')}
          id="api-timeoutSeconds"
          helper={t('admin.apis.timeoutHelper')}
          error={errors.timeoutSeconds}
        >
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
  );
}

export function HeaderFields({ form, set }: Props) {
  const { t } = useTranslation();
  const update = (index: number, patch: Partial<{ name: string; value: string }>) =>
    set(
      'injectHeaders',
      form.injectHeaders.map((h, i) => (i === index ? { ...h, ...patch } : h)),
    );
  return (
    <>
      <Fieldset legend={t('admin.apis.userHeaders')} description={t('admin.apis.allowedHeadersHelper')}>
        <Field label={t('admin.apis.allowedHeaders')} id="api-headers">
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
      </Fieldset>
      <Fieldset legend={t('admin.apis.injectHeaders')} description={t('admin.apis.injectHeadersHelper')}>
        {form.injectHeaders.map((header, index) => (
          <div key={index} className="flex items-start gap-2">
            <Input
              aria-label={t('admin.apis.headerName', { index: index + 1 })}
              className="font-mono text-[13px]"
              placeholder="X-Api-Key"
              value={header.name}
              onChange={(e) => update(index, { name: e.target.value })}
            />
            <Input
              aria-label={t('admin.apis.headerValue', { index: index + 1 })}
              type="password"
              autoComplete="off"
              placeholder={form.id ? t('admin.apis.unchanged') : t('admin.apis.value')}
              value={header.value}
              onChange={(e) => update(index, { value: e.target.value })}
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
      </Fieldset>
    </>
  );
}

export function AccessFields({ form, set, groups }: Props & { groups: Group[] }) {
  const { t } = useTranslation();
  return (
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
          options={groups
            .filter((g) => !form.access.some((a) => a.groupId === g.id))
            .map((g) => ({ value: String(g.id), label: g.name }))}
        />
      </Field>
    </Fieldset>
  );
}
