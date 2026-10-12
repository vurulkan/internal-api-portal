import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { api, type Session } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { Badge, ErrorState, IconButton, LoadingRegion, Skeleton } from '@/components/ui';
import { deviceLabel } from '../../AccountPage';
import { useAdminMutation } from '../common';

/** One user's active sessions, each one endable (needs session.manage). */
export function UserSessions({ userId }: { userId: number }) {
  const { t } = useTranslation();
  const sessions = useQuery({
    queryKey: queryKeys.admin.userSessions(userId),
    queryFn: async () => (await adminApi.userSessions(userId)).items ?? [],
  });
  const end = useAdminMutation({
    mutationFn: (s: Session) => api.revokeSession(s.id),
    success: (_r, s) => t('admin.sessions.ended', { name: s.username }),
    invalidate: [queryKeys.admin.sessions],
  });
  if (sessions.isError) return <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />;
  if (!sessions.data)
    return (
      <LoadingRegion className="space-y-2">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </LoadingRegion>
    );
  if (sessions.data.length === 0)
    return <p className="text-[13px] text-muted-foreground">{t('admin.sessions.empty')}</p>;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {sessions.data.map((s) => (
        <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5 font-medium">
              <span title={s.userAgent}>{deviceLabel(s.userAgent, t)}</span>
              {s.current && <Badge variant="success">{t('admin.sessions.you')}</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{s.ip}</span> · {t('admin.sessions.lastActive')}{' '}
              <span title={formatDateTime(s.lastUsedAt)}>{formatRelative(s.lastUsedAt)}</span>
            </p>
          </div>
          <IconButton
            label={t('admin.sessions.end')}
            icon={<LogOut aria-hidden="true" />}
            disabled={end.isPending}
            onClick={() => end.mutate(s)}
          />
        </li>
      ))}
    </ul>
  );
}
