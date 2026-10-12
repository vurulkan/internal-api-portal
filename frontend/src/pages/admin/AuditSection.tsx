import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, RotateCw, ScrollText } from 'lucide-react';
import { api, auditQuery, type AuditFilter, type AuditLog } from '@/lib/api';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { useMe } from '@/hooks/queries';
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  notifyError,
  Select,
  StatusBadge,
  toast,
  type Column,
} from '@/components/ui';
import { downloadText, TableSkeleton } from './common';
import { AuditDrawer, outcomeVariant } from './audit/AuditDrawer';

const PAGE_SIZES = [25, 50, 100];

const PRESETS = ['1h', '24h', '7d', '30d'] as const;
const PRESET_MS: Record<(typeof PRESETS)[number], number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};
// Suggestions for the action prefix: every area, and the actions people look for most.
const ACTION_SUGGESTIONS = [
  'auth.',
  'auth.login',
  'auth.login.denied',
  'api.',
  'api.invoke',
  'api.invoke.denied',
  'api.create',
  'api.update',
  'api.delete',
  'api.access_set',
  'user.',
  'user.create',
  'user.update',
  'user.bulk_status',
  'group.',
  'group.members_add',
  'role.',
  'role.permissions_set',
  'session.',
  'idp.',
  'settings.',
  'audit.export',
];
const FILTER_KEYS = ['user', 'action', 'outcome', 'from', 'to', 'range'] as const;

/** The filter in the URL; a preset range becomes "from" rounded to the minute (a stable query key). */
function filterFromParams(params: URLSearchParams): AuditFilter {
  const range = params.get('range') as (typeof PRESETS)[number] | null;
  const from =
    range && PRESET_MS[range]
      ? new Date(Math.floor((Date.now() - PRESET_MS[range]) / 60_000) * 60_000).toISOString()
      : (params.get('from') ?? undefined);
  return {
    user: params.get('user') ?? undefined,
    action: params.get('action') ?? undefined,
    outcome: params.get('outcome') ?? undefined,
    from,
    to: range ? undefined : (params.get('to') ?? undefined),
    targetType: params.get('targetType') ?? undefined,
    targetId: params.get('targetId') ?? undefined,
  };
}

export default function AuditSection() {
  const { t } = useTranslation();
  const me = useMe();
  const canExport = !!me.data?.capabilities?.canExportAudit || !!me.data?.user.isAdmin;
  // Filters live in the URL: a filtered view can be linked and survives a reload.
  const [params, setParams] = useSearchParams();
  const filter = filterFromParams(params);
  const [draft, setDraft] = useState<Record<(typeof FILTER_KEYS)[number], string>>(
    () =>
      Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<
        (typeof FILTER_KEYS)[number],
        string
      >,
  );
  const [limit, setLimit] = useState(PAGE_SIZES[0]);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<AuditLog | null>(null);
  const [exporting, setExporting] = useState(false);
  const query = auditQuery(filter, { limit, offset });
  const logs = useQuery({
    queryKey: queryKeys.admin.audit(query),
    queryFn: () => api.auditLogs(query),
    placeholderData: keepPreviousData,
  });

  function apply(next: typeof draft) {
    const out = new URLSearchParams();
    for (const key of ['targetType', 'targetId']) {
      const v = params.get(key);
      if (v) out.set(key, v);
    }
    for (const key of FILTER_KEYS) {
      if (next[key] && !(next.range && (key === 'from' || key === 'to'))) out.set(key, next[key]);
    }
    setOffset(0);
    setParams(out, { replace: true });
  }
  function reset() {
    const empty = Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])) as typeof draft;
    setDraft(empty);
    setOffset(0);
    setParams({}, { replace: true });
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const { csv, truncated, rows } = await api.exportAuditLogs(filter);
      if (truncated) toast.warning(t('admin.audit.truncated', { count: rows }), { duration: Infinity });
      downloadText('audit-logs.csv', csv);
    } catch (error) {
      notifyError(error, t('admin.audit.exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  const columns: Column<AuditLog>[] = [
    {
      id: 'time',
      header: t('admin.audit.time'),
      cell: (e) => (
        <time dateTime={e.timestamp} title={formatDateTime(e.timestamp)}>
          {formatRelative(e.timestamp)}
        </time>
      ),
      className: 'whitespace-nowrap text-[13px] tabular-nums',
    },
    { id: 'user', header: t('admin.audit.user'), cell: (e) => <span className="font-medium">{e.user || '–'}</span> },
    {
      id: 'action',
      header: t('admin.audit.action'),
      cell: (e) => <span className="font-mono text-xs">{e.action}</span>,
    },
    {
      id: 'outcome',
      header: t('admin.audit.outcome'),
      cell: (e) =>
        e.outcome ? <Badge variant={outcomeVariant(e.outcome)}>{t(`admin.audit.outcomes.${e.outcome}`)}</Badge> : '–',
    },
    {
      id: 'target',
      header: t('admin.audit.target'),
      cell: (e) => (
        <span className="break-token">
          {[e.resourceType, e.resourceName || e.resourceId].filter(Boolean).join(' / ') || '–'}
        </span>
      ),
      className: 'max-w-56',
    },
    {
      id: 'status',
      header: t('admin.audit.status'),
      cell: (e) => (e.statusCode ? <StatusBadge status={e.statusCode} /> : '–'),
    },
    {
      id: 'duration',
      header: t('admin.audit.duration'),
      cell: (e) => (e.durationMs ? `${formatNumber(e.durationMs)} ms` : '–'),
      className: 'whitespace-nowrap text-right text-[13px] tabular-nums',
    },
    {
      id: 'ip',
      header: t('admin.audit.sourceIp'),
      cell: (e) => <span className="font-mono text-xs">{e.sourceIp || '–'}</span>,
    },
    {
      id: 'requestId',
      header: t('errors.requestId'),
      cell: (e) =>
        e.requestId ? (
          <span className="font-mono text-xs" title={e.requestId}>
            {e.requestId.slice(0, 8)}
          </span>
        ) : (
          '–'
        ),
    },
    {
      id: 'reason',
      header: t('admin.audit.reason'),
      cell: (e) => (
        <span className="text-xs text-muted-foreground break-token">{e.errorMessage || e.changes || '–'}</span>
      ),
      className: 'max-w-72',
    },
  ];

  const total = logs.data?.total ?? 0;
  const items = logs.data?.items ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
            onSubmit={(event) => {
              event.preventDefault();
              apply(draft);
            }}
          >
            <Field label={t('admin.audit.period')} id="audit-range">
              <Select
                value={draft.range || 'custom'}
                onValueChange={(v) => {
                  const next = { ...draft, range: v === 'custom' ? '' : v };
                  setDraft(next);
                  if (v !== 'custom') apply(next);
                }}
                options={[
                  ...PRESETS.map((p) => ({ value: p, label: t(`admin.audit.presets.${p}`) })),
                  { value: 'custom', label: t('admin.audit.presets.custom') },
                ]}
              />
            </Field>
            {!draft.range && (
              <>
                <Field label={t('admin.audit.from')} id="audit-from">
                  <Input
                    type="date"
                    value={draft.from}
                    onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                  />
                </Field>
                <Field label={t('admin.audit.to')} id="audit-to" helper={t('admin.audit.toHelper')}>
                  <Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
                </Field>
              </>
            )}
            <Field label={t('admin.audit.user')} id="audit-user">
              <Input value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })} />
            </Field>
            <Field label={t('admin.audit.actionPrefix')} id="audit-action" helper={t('admin.audit.actionHelper')}>
              <Input
                className="font-mono text-[13px]"
                list="audit-action-suggestions"
                autoComplete="off"
                placeholder="user. · api.invoke"
                value={draft.action}
                onChange={(e) => setDraft({ ...draft, action: e.target.value })}
              />
            </Field>
            <datalist id="audit-action-suggestions">
              {ACTION_SUGGESTIONS.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
            <Field label={t('admin.audit.outcome')} id="audit-outcome">
              <Select
                value={draft.outcome}
                onValueChange={(v) => setDraft({ ...draft, outcome: v })}
                options={[
                  { value: '', label: t('admin.audit.anyOutcome') },
                  { value: 'success', label: t('admin.audit.outcomes.success') },
                  { value: 'denied', label: t('admin.audit.outcomes.denied') },
                  { value: 'failed', label: t('admin.audit.outcomes.failed') },
                ]}
              />
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit" variant="primary">
                {t('admin.audit.apply')}
              </Button>
              <Button variant="ghost" onClick={reset}>
                {t('admin.audit.reset')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {logs.isPending ? (
        <TableSkeleton />
      ) : logs.isError ? (
        <Card>
          <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
        </Card>
      ) : (
        <>
          <DataTable
            caption={t('admin.sections.audit')}
            rows={items}
            columns={columns}
            rowKey={(e) => String(e.id)}
            pageSizes={[limit]}
            onRowClick={setOpen}
            activeRowKey={open ? String(open.id) : undefined}
            toolbar={
              <>
                <Button size="sm" onClick={() => void logs.refetch()} loading={logs.isFetching}>
                  <RotateCw aria-hidden="true" />
                  {t('common.refresh')}
                </Button>
                {canExport && (
                  <Button size="sm" onClick={() => void exportCsv()} loading={exporting}>
                    <Download aria-hidden="true" />
                    {t('admin.audit.export')}
                  </Button>
                )}
              </>
            }
            empty={
              <EmptyState icon={ScrollText} title={t('admin.audit.empty')} description={t('admin.audit.emptyBody')} />
            }
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
            <span className="tabular-nums">
              {total === 0
                ? t('admin.audit.none')
                : t('table.range', {
                    from: offset + 1,
                    to: Math.min(offset + items.length, total),
                    total: formatNumber(total),
                  })}
            </span>
            <div className="flex items-center gap-2">
              <Select
                aria-label={t('table.rowsPerPage')}
                className="h-8 w-20"
                value={String(limit)}
                onValueChange={(v) => {
                  setLimit(Number(v));
                  setOffset(0);
                }}
                options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
              />
              <Button
                size="sm"
                data-shortcut="prev-page"
                aria-keyshortcuts="P"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                <ChevronLeft aria-hidden="true" />
                {t('table.previous')}
              </Button>
              <Button
                size="sm"
                data-shortcut="next-page"
                aria-keyshortcuts="N"
                disabled={offset + limit >= total}
                onClick={() => setOffset(offset + limit)}
              >
                {t('table.next')}
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        </>
      )}
      <AuditDrawer entry={open} onClose={() => setOpen(null)} />
    </div>
  );
}
