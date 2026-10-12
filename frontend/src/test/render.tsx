import { render } from '@testing-library/react';
import { createQueryClient, markSessionEstablished } from '@/lib/query';
import { createTestRouter } from '@/router';
import { App, wireSessionEnd } from '@/app';

/** The whole app (routes, providers, session handling) at a path, in memory. */
export function renderApp(path = '/') {
  markSessionEstablished(false);
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  const router = createTestRouter(path);
  wireSessionEnd(router, queryClient);
  const view = render(<App router={router} queryClient={queryClient} />);
  return { ...view, router, queryClient };
}
