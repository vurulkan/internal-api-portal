import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ImageUp, Trash2 } from 'lucide-react';
import { api, type SystemSettings } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  ErrorState,
  Field,
  Input,
  LoadingRegion,
  Skeleton,
} from '@/components/ui';
import { useAdminMutation } from './common';

export default function SystemSection() {
  const settings = useQuery({ queryKey: queryKeys.admin.system, queryFn: api.system });
  if (settings.isError)
    return (
      <Card>
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      </Card>
    );
  if (!settings.data)
    return (
      <LoadingRegion>
        <Skeleton className="h-72" />
      </LoadingRegion>
    );
  return <SystemForm key={settings.dataUpdatedAt} settings={settings.data} />;
}

function SystemForm({ settings }: { settings: SystemSettings }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(settings.brandTitle);
  const [file, setFile] = useState<File | null>(null);
  const brandingKeys = [queryKeys.admin.system, queryKeys.publicSettings];
  const save = useAdminMutation({
    mutationFn: () => api.updateSystem({ brandTitle: title.trim(), logoDataUrl: settings.logoDataUrl ?? '' }),
    success: t('admin.system.saved'),
    invalidate: brandingKeys,
  });
  const upload = useAdminMutation({
    mutationFn: (logo: File) => api.uploadSystemLogo(logo),
    success: t('admin.system.logoUploaded'),
    invalidate: brandingKeys,
    onSuccess: () => setFile(null),
  });
  const removeLogo = useAdminMutation({
    mutationFn: () => api.deleteSystemLogo(),
    success: t('admin.system.logoRemoved'),
    invalidate: brandingKeys,
  });

  const logo = settings.logoDataUrl;

  return (
    <div className="max-w-2xl space-y-5">
      <Card>
        <CardHeader title={t('admin.system.branding')} description={t('admin.system.brandingBody')} />
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(undefined);
          }}
        >
          <CardContent>
            <Field label={t('admin.system.brandTitle')} id="brand-title" helper={t('admin.system.brandTitleHelper')}>
              <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
            </Field>
          </CardContent>
          <CardFooter>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {t('common.save')}
            </Button>
          </CardFooter>
        </form>
      </Card>
      <Card>
        <CardHeader title={t('admin.system.logo')} description={t('admin.system.logoBody')} />
        <CardContent className="space-y-4">
          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border bg-muted">
            {logo ? (
              <img src={logo} alt={t('admin.system.currentLogo')} className="max-h-16 max-w-[220px] object-contain" />
            ) : (
              <p className="text-[13px] text-muted-foreground">{t('admin.system.noLogo')}</p>
            )}
          </div>
          <Field label={t('admin.system.chooseFile')} id="logo-file" helper={t('admin.system.fileHelper')}>
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="h-auto py-1.5 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-sm file:font-medium file:text-foreground"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
        </CardContent>
        <CardFooter>
          <Button
            variant="destructive-ghost"
            className="mr-auto"
            disabled={!logo}
            loading={removeLogo.isPending}
            onClick={() => removeLogo.mutate(undefined)}
          >
            <Trash2 aria-hidden="true" />
            {t('admin.system.removeLogo')}
          </Button>
          <Button
            variant="primary"
            disabled={!file}
            loading={upload.isPending}
            onClick={() => file && upload.mutate(file)}
          >
            <ImageUp aria-hidden="true" />
            {t('admin.system.upload')}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
