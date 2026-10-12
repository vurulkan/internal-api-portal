import { useTranslation } from 'react-i18next';
import type { AuditLog } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/format';
import { Badge, CodeBlock, Drawer, KeyValueList, StatusBadge } from '@/components/ui';

export function outcomeVariant(outcome?: string) {
  return outcome === 'success'
    ? 'success'
    : outcome === 'denied'
      ? 'warning'
      : outcome === 'failed'
        ? 'destructive'
        : 'neutral';
}

export function AuditDrawer({ entry, onClose }: { entry: AuditLog | null; onClose: () => void }) {
  const { t } = useTranslation();
  let details = '';
  if (entry?.detailsJson) {
    try {
      details = JSON.stringify(JSON.parse(entry.detailsJson), null, 2);
    } catch {
      details = entry.detailsJson;
    }
  }
  return (
    <Drawer
      open={!!entry}
      onOpenChange={(o) => !o && onClose()}
      title={t('admin.audit.entry')}
      description={entry?.action}
      className="w-[min(100vw,36rem)]"
    >
      {entry && (
        <div className="space-y-4 p-4">
          <KeyValueList
            items={[
              { label: t('admin.audit.time'), value: formatDateTime(entry.timestamp) },
              {
                label: t('admin.audit.user'),
                value: [entry.user, entry.actorSource && `(${entry.actorSource})`].filter(Boolean).join(' ') || '–',
              },
              { label: t('admin.audit.action'), value: entry.action, mono: true },
              {
                label: t('admin.audit.outcome'),
                value: entry.outcome ? (
                  <Badge variant={outcomeVariant(entry.outcome)}>{t(`admin.audit.outcomes.${entry.outcome}`)}</Badge>
                ) : (
                  '–'
                ),
              },
              {
                label: t('admin.audit.target'),
                value:
                  [entry.resourceType, entry.resourceName, entry.resourceId && `#${entry.resourceId}`]
                    .filter(Boolean)
                    .join(' ') || '–',
              },
              {
                label: t('admin.audit.status'),
                value: entry.statusCode ? <StatusBadge status={entry.statusCode} /> : '–',
              },
              { label: t('admin.audit.reason'), value: entry.errorMessage || '–' },
              { label: t('admin.audit.changes'), value: entry.changes || '–', mono: !!entry.changes },
              {
                label: t('admin.audit.duration'),
                value: entry.durationMs ? `${formatNumber(entry.durationMs)} ms` : '–',
              },
              { label: t('admin.audit.sourceIp'), value: entry.sourceIp || '–', mono: true },
              { label: t('admin.audit.userAgent'), value: entry.userAgent || '–' },
              { label: t('errors.requestId'), value: entry.requestId || '–', mono: true },
            ]}
          />
          {details && <CodeBlock code={details} label={t('admin.audit.details')} />}
        </div>
      )}
    </Drawer>
  );
}
