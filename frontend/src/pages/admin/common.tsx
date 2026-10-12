import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query';
import { notifyError, notifySuccess } from '@/components/ui';

/**
 * A write from the admin console: toast on success / failure, then refetch only
 * the queries it changed (and /me, whose capabilities may change).
 */
export function useAdminMutation<TVariables, TResult = unknown>({
  mutationFn,
  success,
  invalidate = [],
  onSuccess,
  errorFallback,
}: {
  mutationFn: (variables: TVariables) => Promise<TResult>;
  success: string | ((result: TResult, variables: TVariables) => string);
  invalidate?: QueryKey[] | ((variables: TVariables, result: TResult) => QueryKey[]);
  onSuccess?: (result: TResult, variables: TVariables) => void;
  errorFallback?: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (result, variables) => {
      notifySuccess(typeof success === 'function' ? success(result, variables) : success);
      const keys = typeof invalidate === 'function' ? invalidate(variables, result) : invalidate;
      await Promise.all([
        ...keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
      ]);
      onSuccess?.(result, variables);
    },
    onError: (error) => notifyError(error, errorFallback ?? t('admin.saveFailed')),
  });
}

/** Two-column toolbar row above a table: search on the left, actions on the right. */
export function SectionToolbar({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function splitList(value: string) {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function matches(query: string, ...values: (string | undefined | null)[]) {
  const q = query.trim().toLowerCase();
  return !q || values.some((v) => v?.toLowerCase().includes(q));
}
