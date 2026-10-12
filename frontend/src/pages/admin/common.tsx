import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query';
import { AlertDialog, Drawer, Input, LoadingRegion, notifyError, notifySuccess, Skeleton } from '@/components/ui';

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

export function SearchInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <Input
      type="search"
      aria-label={label}
      placeholder={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full max-w-xs"
    />
  );
}

export function TableSkeleton() {
  return (
    <LoadingRegion className="space-y-2">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-9" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-9" />
      ))}
    </LoadingRegion>
  );
}

export function FormSkeleton() {
  return (
    <LoadingRegion className="space-y-4 p-4">
      <Skeleton className="h-9" />
      <Skeleton className="h-9" />
      <Skeleton className="h-40" />
    </LoadingRegion>
  );
}

// ── Editor drawers that don't lose unsaved changes ───────────────────────────

const DirtyContext = createContext<(dirty: boolean) => void>(() => {});
const CloseContext = createContext<() => void>(() => {});

/**
 * A drawer for an editor form. The form reports unsaved changes with useDirty;
 * Escape, the close button, the overlay and useRequestClose() then ask before
 * discarding them. A successful save calls onClose directly.
 */
export function EditorDrawer({
  onClose,
  title,
  description,
  className,
  children,
}: {
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const dirty = useRef(false);
  const [asking, setAsking] = useState(false);
  const report = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const requestClose = useCallback(() => (dirty.current ? setAsking(true) : onClose()), [onClose]);
  return (
    <DirtyContext.Provider value={report}>
      <CloseContext.Provider value={requestClose}>
        <Drawer
          open
          onOpenChange={(open) => !open && requestClose()}
          title={title}
          description={description}
          className={className}
        >
          {children}
        </Drawer>
        <AlertDialog
          open={asking}
          onOpenChange={setAsking}
          title={t('admin.discardTitle')}
          description={t('admin.discardBody')}
          confirmLabel={t('admin.discard')}
          onConfirm={onClose}
        />
      </CloseContext.Provider>
    </DirtyContext.Provider>
  );
}

/** Reports whether the form inside an EditorDrawer has unsaved changes. */
export function useDirty(dirty: boolean) {
  const report = useContext(DirtyContext);
  useEffect(() => report(dirty), [dirty, report]);
}

/** Close the surrounding EditorDrawer, asking first when there are unsaved changes. */
export function useRequestClose() {
  return useContext(CloseContext);
}

/** Structural equality for form state (plain data only). */
export function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Downloads text as a file (CSV exports built in the browser). */
export function downloadText(filename: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** One CSV cell; formula-looking values are prefixed so spreadsheets don't run them. */
export function csvCell(value: unknown) {
  let text = value === undefined || value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
