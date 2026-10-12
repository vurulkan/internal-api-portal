import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import i18n from './i18n';
import { setSessionEndedHandler } from './lib/query';
import { ThemeProvider } from './lib/theme';
import type { createRouter } from './router';
import { AppErrorBoundary } from './routes/errors';
import { toast, Toaster, TooltipProvider } from './components/ui';

type Router = ReturnType<typeof createRouter>;

/**
 * The session ended (idle timeout, revoked, maximum age): one toast, then the
 * login page, which returns to the same place after signing in.
 */
export function wireSessionEnd(router: Router, queryClient: QueryClient) {
  setSessionEndedHandler(() => {
    const { pathname, search, hash } = router.state.location;
    if (pathname === '/login') return;
    toast.warning(i18n.t('session.expired'), { id: 'session-expired', duration: 8000 });
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'public-settings' });
    const here = pathname + search + hash;
    void router.navigate(here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`, { replace: true });
  });
}

export function App({ router, queryClient }: { router: Router; queryClient: QueryClient }) {
  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={300}>
            <RouterProvider router={router} />
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
