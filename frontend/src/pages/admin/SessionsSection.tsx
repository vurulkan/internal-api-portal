import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MonitorSmartphone, RotateCw } from 'lucide-react';
import { api, type Session } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { AlertDialog, Badge, Button, Card, DataTable, EmptyState, ErrorState, type Column } from '@/components/ui';
import { deviceLabel } from '../AccountPage';
import { matches, SectionToolbar, useAdminMutation } from './common';
import { SearchInput, TableSkeleton } from './UsersSection';

export default function SessionsSection() {
  const { t } = useTranslation();
  const sessions = useQuery({
    queryKey: queryKeys.admin.sessions,
    queryFn: async () => (await api.sessions()).items ?? [],
  });
  const [search, setSearch] = useState('');
  const [ending, setEnding] = useState<Session | null>(null);
  const rows = useMemo(
    () => (sessions.data ?? []).filter((s) => matches(search, s.username, s.ip, s.authSource)),
    [sessions.data, search],
  );
  const end = useAdminMutation({
    mutationFn: (s: Session) => api.revokeSession(s.id),
    success: (_r, s) => t('admin.sessions.ended', { name: s.username }),
    invalidate: [queryKeys.admin.sessions],
  });

  const columns: Column<Session>[] = [
    {
      id: 'user',
      header: t('admin.sessions.user'),
      sortValue: (s) => s.username ?? '',
      cell: (s) => (
        <span className="flex items-center gap-2 font-medium">
          {s.username}
          {s.current && <Badge variant="success">{t('admin.sessions.you')}</Badge>}
        </span>
      ),
    },
    {
      id: 'device',
      header: t('admin.sessions.device'),
      cell: (s) => <span title={s.userAgent}>{deviceLabel(s.userAgent, t)}</span>,
    },
    {
      id: 'source',
      header: t('admin.users.source'),
      sortValue: (s) => s.authSource,
      cell: (s) => t(`authSource.${s.authSource}`, { defaultValue: s.authSource }),
    },
    {
      id: 'ip',
      header: t('admin.sessions.address'),
      sortValue: (s) => s.ip,
      cell: (s) => <span className="font-mono text-xs">{s.ip}</span>,
    },
    {
      id: 'active',
      header: t('admin.sessions.lastActive'),
      sortValue: (s) => s.lastUsedAt,
      cell: (s) => <span title={formatDateTime(s.lastUsedAt)}>{formatRelative(s.lastUsedAt)}</span>,
    },
    {
      id: 'expires',
      header: t('admin.sessions.expires'),
      sortValue: (s) => s.expiresAt,
      cell: (s) => formatDateTime(s.expiresAt),
      className: 'text-muted-foreground whitespace-nowrap',
    },
    {
      id: 'actions',
      header: <span className="sr-only">{t('common.actions')}</span>,
      cell: (s) =>
        !s.current && (
          <Button size="sm" variant="destructive-ghost" onClick={() => setEnding(s)}>
            {t('admin.sessions.end')}
          </Button>
        ),
      className: 'text-right',
    },
  ];

  if (sessions.isPending) return <TableSkeleton />;
  if (sessions.isError)
    return (
      <Card>
        <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
      </Card>
    );

  return (
    <>
      <DataTable
        caption={t('admin.sections.sessions')}
        rows={rows}
        columns={columns}
        rowKey={(s) => String(s.id)}
        toolbar={
          <SectionToolbar
            actions={
              <Button onClick={() => void sessions.refetch()} loading={sessions.isFetching}>
                <RotateCw aria-hidden="true" />
                {t('common.refresh')}
              </Button>
            }
          >
            <SearchInput value={search} onChange={setSearch} label={t('admin.sessions.search')} />
          </SectionToolbar>
        }
        empty={<EmptyState icon={MonitorSmartphone} title={search ? t('admin.noMatch') : t('admin.sessions.empty')} />}
      />
      <AlertDialog
        open={!!ending}
        onOpenChange={(open) => !open && setEnding(null)}
        title={t('admin.sessions.endTitle', { name: ending?.username })}
        description={t('admin.sessions.endBody')}
        confirmLabel={t('admin.sessions.end')}
        onConfirm={() => (ending ? end.mutateAsync(ending).then(() => undefined) : undefined)}
      />
    </>
  );
}
