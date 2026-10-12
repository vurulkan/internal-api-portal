import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { FileSearch } from 'lucide-react';
import { adminApi, type SpecPreview as Preview } from '@/lib/admin-api';
import { formatNumber } from '@/lib/format';
import { Alert, Badge, Button, KeyValueList, MethodBadge } from '@/components/ui';

/**
 * Fetches the spec URL through the portal (the same guarded client a refresh
 * uses) and shows what would be imported. Nothing is saved.
 */
export function SpecPreview({ url, onPreview }: { url: string; onPreview?: (preview: Preview | null) => void }) {
  const { t } = useTranslation();
  const preview = useMutation({
    mutationFn: () => adminApi.specPreview(url.trim()),
    onSuccess: (p) => onPreview?.(p),
    onError: () => onPreview?.(null),
  });
  const data = preview.data;
  return (
    <div className="space-y-3">
      <Button size="sm" disabled={!url.trim()} loading={preview.isPending} onClick={() => preview.mutate()}>
        <FileSearch aria-hidden="true" />
        {t('admin.apis.previewSpec')}
      </Button>
      <div aria-live="polite">
        {preview.isError && (
          <Alert variant="destructive" title={t('admin.apis.previewFailed')}>
            <span className="break-token">{preview.error instanceof Error ? preview.error.message : ''}</span>
          </Alert>
        )}
        {data && !preview.isPending && (
          <div className="rounded-lg border border-border p-3">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {data.title || t('admin.apis.untitledSpec')}
              {data.version && <Badge variant="outline">v{data.version}</Badge>}
              <Badge variant="success">{t('admin.apis.previewOk')}</Badge>
            </p>
            <KeyValueList
              className="mt-2"
              items={[
                {
                  label: t('admin.apis.previewFormat'),
                  value: `OpenAPI ${data.openapi} · ${data.format.toUpperCase()}`,
                },
                { label: t('admin.apis.previewOperations'), value: formatNumber(data.operationCount) },
                { label: t('admin.apis.previewTags'), value: formatNumber(data.tagCount) },
                { label: t('admin.apis.previewSize'), value: `${formatNumber(Math.ceil(data.bytes / 1024))} KB` },
              ]}
            />
            {data.sample.length > 0 && (
              <ul className="mt-2 space-y-1 text-[13px]">
                {data.sample.map((op) => (
                  <li key={`${op.method} ${op.path}`} className="flex min-w-0 items-center gap-2">
                    <MethodBadge method={op.method} />
                    <code className="min-w-0 truncate font-mono text-xs">{op.path}</code>
                    {op.summary && <span className="truncate text-muted-foreground">{op.summary}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
