import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiDefinition, type ApiSummary } from '@/lib/api';
import { notifyError } from '@/components/ui/toaster';
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

/** Operation + API search, 200 ms after the last keystroke, cancelled when superseded. */
export function useSearch(query: string) {
  const q = useDebounced(query.trim(), 200);
  return useQuery({
    queryKey: queryKeys.search(q),
    queryFn: ({ signal }) => api.search(q, signal),
    enabled: q.length >= 2,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function isApiDefinition(value: unknown): value is ApiDefinition {
  return !!value && typeof value === 'object' && 'id' in value && 'slug' in value && 'permissions' in value;
}

/** Star / unstar an API; the catalog updates at once and rolls back on failure. */
export function useToggleFavorite() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ id, favorite }: { id: number; favorite: boolean }) => api.setFavorite(id, favorite),
    onMutate: async ({ id, favorite }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.catalog });
      const previous = queryClient.getQueryData<ApiSummary[]>(queryKeys.catalog);
      queryClient.setQueryData<ApiSummary[]>(queryKeys.catalog, (list) =>
        list?.map((item) => (item.id === id ? { ...item, favorite } : item)),
      );
      // The API page is cached under its slug or id; match by the API's id.
      queryClient.setQueriesData<unknown>({ queryKey: ['api'] }, (item: unknown) =>
        isApiDefinition(item) && item.id === id ? { ...item, favorite } : item,
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.catalog, context.previous);
      notifyError(error, t('catalog.favoriteFailed'));
    },
    onSettled: (_r, _e, { id }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalog });
      void queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === 'api' && q.queryKey.length === 2 && isApiDefinition(q.state.data) && q.state.data.id === id,
      });
    },
  });
}
