import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiError } from './api';

// A 401 from any query or mutation after sign-in means the session ended (idle
// timeout, revoked, maximum age). The shell registers what happens then: one toast
// and a redirect to /login?next=… (see main.tsx).
let onSessionEnded: (() => void) | null = null;
let sessionEstablished = false;

export function setSessionEndedHandler(handler: () => void) {
  onSessionEnded = handler;
}

/** Called when /me succeeds: from now on a 401 means "the session ended". */
export function markSessionEstablished(established: boolean) {
  sessionEstablished = established;
}

function handleError(error: unknown) {
  if (isApiError(error, 401) && sessionEstablished) {
    sessionEstablished = false;
    onSessionEnded?.();
  }
}

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Client errors (401, 403, 404, 400) don't get better by retrying.
        retry: (failureCount, error) =>
          failureCount < 2 && (!isApiError(error) || error.status === 0 || error.status >= 500),
      },
      mutations: { retry: false },
    },
  });
}

export const queryKeys = {
  me: ['me'] as const,
  publicSettings: ['public-settings'] as const,
  authProviders: ['auth-providers'] as const,
  features: ['features'] as const,
  catalog: ['catalog'] as const,
  search: (q: string) => ['search', q] as const,
  api: (id: string) => ['api', id] as const,
  spec: (id: string) => ['api', id, 'spec'] as const,
  mySessions: ['my-sessions'] as const,
  admin: {
    all: ['admin'] as const,
    users: ['admin', 'users'] as const,
    userGroups: (id: number) => ['admin', 'users', id, 'groups'] as const,
    groups: ['admin', 'groups'] as const,
    groupRoles: (id: number) => ['admin', 'groups', id, 'roles'] as const,
    roles: ['admin', 'roles'] as const,
    rolePermissions: (id: number) => ['admin', 'roles', id, 'permissions'] as const,
    scopeCatalog: ['admin', 'scope-catalog'] as const,
    apis: ['admin', 'apis'] as const,
    apiAccess: (id: number) => ['admin', 'apis', id, 'access'] as const,
    ldap: ['admin', 'ldap'] as const,
    azureAd: ['admin', 'azure-ad'] as const,
    sessionSettings: ['admin', 'session-settings'] as const,
    sessions: ['admin', 'sessions'] as const,
    audit: (query: string) => ['admin', 'audit', query] as const,
    system: ['admin', 'system'] as const,
  },
};
