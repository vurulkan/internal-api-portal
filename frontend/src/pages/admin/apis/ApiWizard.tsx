import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, type ApiDefinition, type Group } from '@/lib/api';
import type { SpecPreview as Preview } from '@/lib/admin-api';
import { cn } from '@/lib/cn';
import { queryKeys } from '@/lib/query';
import { Alert, Badge, Button, DrawerBody, DrawerFooter, KeyValueList } from '@/components/ui';
import { EditorDrawer, sameValue, useAdminMutation, useDirty, useRequestClose } from '../common';
import { AccessFields, HeaderFields, IdentityFields, OwnershipFields, PolicyFields, UrlFields } from './fields';
import {
  EMPTY_API,
  slugify,
  toPayload,
  validatePolicy,
  validateSource,
  type ApiForm,
  type ApiFormErrors,
  type SetField,
} from './form';
import { SpecPreview } from './SpecPreview';

const STEPS = ['source', 'access', 'review'] as const;
type Step = (typeof STEPS)[number];

/** Registering an API in three steps: where it is, who may use it how, and a review. */
export function ApiWizard({
  groups,
  allApis,
  managesAll,
  onClose,
  onCreated,
}: {
  groups: Group[];
  allApis: ApiDefinition[];
  managesAll: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <EditorDrawer onClose={onClose} title={t('admin.apis.new')} className="w-[min(100vw,44rem)]">
      <Wizard groups={groups} allApis={allApis} managesAll={managesAll} onCreated={onCreated} />
    </EditorDrawer>
  );
}

function Wizard({
  groups,
  allApis,
  managesAll,
  onCreated,
}: {
  groups: Group[];
  allApis: ApiDefinition[];
  managesAll: boolean;
  onCreated: (id: number) => void;
}) {
  const { t } = useTranslation();
  const requestClose = useRequestClose();
  const [form, setForm] = useState<ApiForm>(EMPTY_API);
  const [errors, setErrors] = useState<ApiFormErrors>({});
  const [step, setStep] = useState<Step>('source');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewedUrl, setPreviewedUrl] = useState('');
  useDirty(!sameValue(form, EMPTY_API));
  const set: SetField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const messages = {
    required: t('admin.apis.required'),
    url: t('admin.apis.invalidUrl'),
    slug: t('admin.apis.invalidSlug'),
    range: t('admin.apis.outOfRange'),
  };

  const create = useAdminMutation({
    mutationFn: async (f: ApiForm) => {
      const created = await api.createApi(toPayload(f));
      if (f.access.length) await api.setApiAccess(created.id, f.access);
      return created.id;
    },
    success: t('admin.apis.created'),
    invalidate: [queryKeys.admin.apis, queryKeys.admin.groups, queryKeys.catalog, queryKeys.admin.overview],
    onSuccess: onCreated,
  });

  function next() {
    const found =
      step === 'source' ? validateSource(form, messages) : step === 'access' ? validatePolicy(form, messages) : {};
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`api-${first}`)?.focus();
      return;
    }
    const index = STEPS.indexOf(step);
    if (index < STEPS.length - 1) setStep(STEPS[index + 1]);
    else create.mutate(form);
  }

  const previewCurrent = !!preview && previewedUrl === form.internalOpenapiUrl.trim();
  const index = STEPS.indexOf(step);
  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      {/* The review has nothing focusable: the region itself takes focus so it can be scrolled by keyboard. */}
      <DrawerBody
        className="space-y-5 p-4"
        tabIndex={step === 'review' ? 0 : undefined}
        role={step === 'review' ? 'region' : undefined}
        aria-label={step === 'review' ? t('admin.apis.steps.review') : undefined}
      >
        <ol className="flex flex-wrap items-center gap-2 text-[13px]" aria-label={t('admin.apis.wizardSteps')}>
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2" aria-current={s === step ? 'step' : undefined}>
              <span
                className={cn(
                  'inline-flex size-6 items-center justify-center rounded-full border border-border text-xs tabular-nums',
                  i < index && 'border-success bg-success-subtle text-success-subtle-foreground',
                  s === step && 'border-foreground bg-foreground text-background',
                )}
              >
                {i < index ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span className={cn(s === step ? 'font-medium' : 'text-muted-foreground')}>
                {t(`admin.apis.steps.${s}`)}
              </span>
              {i < STEPS.length - 1 && <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />}
            </li>
          ))}
        </ol>

        {step === 'source' && (
          <>
            <IdentityFields form={form} set={set} errors={errors} autoSlug />
            <UrlFields form={form} set={set} errors={errors} />
            <SpecPreview
              url={form.internalOpenapiUrl}
              onPreview={(p) => {
                setPreview(p);
                setPreviewedUrl(form.internalOpenapiUrl.trim());
                // An empty form takes the spec's title and description.
                if (p && !form.name.trim() && p.title) {
                  setForm((f) => ({ ...f, name: p.title, slug: f.slug || slugify(p.title) }));
                }
              }}
            />
          </>
        )}
        {step === 'access' && (
          <>
            <OwnershipFields form={form} set={set} groups={groups} allApis={allApis} managesAll={managesAll} />
            <PolicyFields form={form} set={set} errors={errors} allApis={allApis} />
            <HeaderFields form={form} set={set} />
            <AccessFields form={form} set={set} groups={groups} />
          </>
        )}
        {step === 'review' && <Review form={form} groups={groups} preview={previewCurrent ? preview : null} />}
      </DrawerBody>
      <DrawerFooter>
        {index > 0 && (
          <Button className="mr-auto" onClick={() => setStep(STEPS[index - 1])}>
            <ChevronLeft aria-hidden="true" />
            {t('admin.apis.back')}
          </Button>
        )}
        <Button onClick={requestClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          {step === 'review' ? t('admin.apis.create') : t('admin.apis.next')}
          {step !== 'review' && <ChevronRight aria-hidden="true" />}
        </Button>
      </DrawerFooter>
    </form>
  );
}

function Review({ form, groups, preview }: { form: ApiForm; groups: Group[]; preview: Preview | null }) {
  const { t } = useTranslation();
  const group = (id: number) => groups.find((g) => g.id === id)?.name ?? `#${id}`;
  const list = (values: string[], none: string) => (values.length ? values.join(', ') : none);
  const injected = form.injectHeaders.filter((h) => h.name.trim());
  return (
    <div className="space-y-4">
      {!preview && <Alert variant="warning">{t('admin.apis.reviewNoPreview')}</Alert>}
      {form.access.length === 0 && !form.ownerGroupId && <Alert variant="info">{t('admin.apis.reviewNoAccess')}</Alert>}
      <KeyValueList
        items={[
          { label: t('admin.apis.name'), value: form.name },
          { label: t('catalog.slug'), value: form.slug, mono: true },
          {
            label: t('admin.apis.spec'),
            value: preview
              ? t('admin.apis.reviewSpec', { count: preview.operationCount, version: preview.version || '–' })
              : '–',
          },
          { label: t('catalog.owner'), value: form.ownerTeam || '–' },
          { label: t('admin.apis.ownerGroup'), value: form.ownerGroupId ? group(form.ownerGroupId) : '–' },
          {
            label: t('admin.users.status'),
            value: (
              <span className="flex flex-wrap gap-1">
                <Badge variant={form.isActive ? 'success' : 'neutral'}>
                  {form.isActive ? t('admin.apis.active') : t('common.inactive')}
                </Badge>
                <Badge variant={form.tryItEnabled ? 'success' : 'neutral'}>
                  {form.tryItEnabled ? t('api.tryIt') : t('admin.apis.tryItOff')}
                </Badge>
              </span>
            ),
          },
          { label: t('api.allowedMethods'), value: list(form.allowedMethods, t('admin.apis.allDocumented')) },
          { label: t('api.allowedPaths'), value: list(form.allowedPathPrefixes, t('admin.apis.allDocumented')) },
          { label: t('admin.apis.allowedHeaders'), value: list(form.allowedRequestHeaders, '–') },
          // Names only: the values are never shown again once typed.
          {
            label: t('admin.apis.injectHeaders'),
            value: list(
              injected.map((h) => h.name.trim()),
              '–',
            ),
          },
          {
            label: t('admin.apis.access'),
            value: list(
              form.access.map((a) => `${group(a.groupId)} (${t(`catalog.accessLevel.${a.level}`)})`),
              '–',
            ),
          },
        ]}
      />
    </div>
  );
}
