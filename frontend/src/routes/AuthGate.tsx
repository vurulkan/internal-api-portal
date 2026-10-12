import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/lib/api';
import { useMe } from '@/hooks/queries';
import { AppShell } from '@/components/shell/AppShell';
import { Button, ErrorState, LoadingRegion, Skeleton } from '@/components/ui';

/** Everything behind sign-in. Not signed in → /login?next=…; a forced password change comes first. */
export function AuthGate() {
  const { t } = useTranslation();
  const me = useMe();
  const location = useLocation();
  const here = location.pathname + location.search + location.hash;

  if (me.isPending) return <ShellSkeleton />;
  if (me.isError) {
    if (isApiError(me.error, 401)) {
      const next = here === '/' ? '' : `?next=${encodeURIComponent(here)}`;
      return <Navigate to={`/login${next}`} replace />;
    }
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-card">
          <ErrorState error={me.error} onRetry={() => void me.refetch()} title={t('errors.startFailedTitle')} />
          <div className="border-t border-border p-3 text-center">
            <Button variant="link" onClick={() => window.location.reload()}>
              {t('errors.reload')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const user = me.data.user;
  const mustChange = user.mustChangePassword && user.authSource === 'local';
  if (mustChange && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  if (!mustChange && location.pathname === '/change-password') {
    return <Navigate to="/account#password" replace />;
  }
  return <AppShell restricted={mustChange} />;
}

export function ShellSkeleton() {
  return (
    <LoadingRegion className="min-h-dvh">
      <div className="flex h-14 items-center gap-3 border-b border-border bg-card px-4">
        <Skeleton className="size-7" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mx-auto h-9 w-full max-w-md" />
        <Skeleton className="size-8 rounded-full" />
      </div>
      <div className="mx-auto max-w-[1440px] space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}
