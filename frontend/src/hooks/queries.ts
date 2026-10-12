import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { markSessionEstablished, queryKeys } from '@/lib/query';

const DEFAULT_BRANDING = { brandTitle: 'Internal API Portal', logoDataUrl: '' };

/** The signed-in user. A 401 here just means "not signed in" (no toast). */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      // A 401 after sign-in is handled by the query cache (session ended).
      const me = await api.me();
      markSessionEstablished(true);
      return {
        ...me,
        permissions: me.permissions ?? [],
        groupIds: me.groupIds ?? [],
        warnings: me.warnings ?? [],
      };
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function usePublicSettings() {
  return useQuery({
    queryKey: queryKeys.publicSettings,
    queryFn: api.publicSettings,
    staleTime: 5 * 60_000,
    placeholderData: DEFAULT_BRANDING,
  });
}

/** Branding of the signed-in view falls back to the public one. */
export function useBranding() {
  const me = useMe();
  const pub = usePublicSettings();
  const brandTitle = me.data?.branding?.brandTitle || pub.data?.brandTitle || DEFAULT_BRANDING.brandTitle;
  const logoDataUrl = me.data?.branding?.logoDataUrl || pub.data?.logoDataUrl || '';
  return { brandTitle, logoDataUrl };
}

export function useAuthProviders() {
  return useQuery({ queryKey: queryKeys.authProviders, queryFn: api.authProviders, staleTime: 5 * 60_000 });
}

export function useFeatures() {
  return useQuery({ queryKey: queryKeys.features, queryFn: api.features, staleTime: 5 * 60_000 });
}

export function useCatalog(enabled = true) {
  return useQuery({ queryKey: queryKeys.catalog, queryFn: async () => (await api.catalog()) ?? [], enabled });
}

export function useApiDetails(id: string) {
  return useQuery({ queryKey: queryKeys.api(id), queryFn: () => api.apiDetails(id) });
}

export function useApiSpec(id: string) {
  return useQuery({ queryKey: queryKeys.spec(id), queryFn: () => api.apiSpec(id), staleTime: 5 * 60_000 });
}

export function useMySessions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.mySessions,
    queryFn: async () => (await api.mySessions()).items ?? [],
    enabled,
  });
}

/** Admin console opens for anyone with at least one admin section, not only isAdmin. */
export function useAdminSections() {
  const me = useMe();
  const sections = me.data?.capabilities?.adminSections ?? (me.data?.user.isAdmin ? ALL_ADMIN_SECTIONS : []);
  return sections;
}

export const ALL_ADMIN_SECTIONS = [
  'users',
  'groups',
  'roles',
  'apis',
  'ldap',
  'azureAd',
  'sessionSettings',
  'sessions',
  'audit',
  'system',
];
