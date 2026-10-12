import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin-api';
import { formatDateTime, formatNumber } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardHeader,
  ErrorState,
  KeyValueList,
  LoadingRegion,
  Skeleton,
} from '@/components/ui';

function bytes(n: number) {
  if (n < 1024 * 1024) return `${formatNumber(Math.ceil(n / 1024))} KB`;
  return `${formatNumber(Math.round((n / 1024 / 1024) * 10) / 10)} MB`;
}

/** What is running: version, database, encryption key source (never the key). */
export default function SystemInfoPanel() {
  const { t } = useTranslation();
  const info = useQuery({ queryKey: queryKeys.admin.systemInfo, queryFn: adminApi.systemInfo });
  if (info.isError)
    return (
      <Card>
        <ErrorState error={info.error} onRetry={() => void info.refetch()} />
      </Card>
    );
  if (!info.data)
    return (
      <LoadingRegion>
        <Skeleton className="h-72" />
      </LoadingRegion>
    );
  const d = info.data;
  const on = (v: boolean) => <Badge variant={v ? 'success' : 'neutral'}>{v ? t('common.on') : t('common.off')}</Badge>;
  return (
    <Card>
      <CardHeader title={t('admin.settings.systemTitle')} description={t('admin.settings.systemBody')} />
      <CardContent className="space-y-4">
        {d.encryptionKeySource === 'database' && (
          <Alert variant="warning">{t('warnings.encryption_key_in_database')}</Alert>
        )}
        <KeyValueList
          items={[
            { label: t('admin.settings.version'), value: d.version, mono: true },
            { label: t('admin.settings.goVersion'), value: d.goVersion, mono: true },
            { label: t('admin.settings.startedAt'), value: formatDateTime(d.startedAt) },
            { label: t('admin.settings.database'), value: bytes(d.databaseBytes) },
            { label: t('admin.settings.schema'), value: d.schemaVersion, mono: true },
            {
              label: t('admin.settings.keySource'),
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={d.encryptionKeySource === 'environment' ? 'success' : 'warning'}>
                    {t(`admin.settings.keySources.${d.encryptionKeySource}`)}
                  </Badge>
                  <code className="font-mono text-xs text-muted-foreground">{d.encryptionKeyId}</code>
                </span>
              ),
            },
            {
              label: t('admin.settings.specRefresh'),
              value: d.specRefreshMinutes
                ? t('admin.settings.everyMinutes', { count: d.specRefreshMinutes })
                : t('common.off'),
            },
            {
              label: t('admin.settings.auditRetention'),
              value: t('admin.settings.days', { count: d.auditRetentionDays }),
            },
            { label: t('admin.settings.backups'), value: on(d.backupsEnabled) },
            { label: t('admin.settings.metrics'), value: on(d.metricsEnabled) },
            { label: t('admin.settings.timeZone'), value: d.timeZone, mono: true },
          ]}
        />
      </CardContent>
    </Card>
  );
}
