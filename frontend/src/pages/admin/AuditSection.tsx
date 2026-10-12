import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, RotateCw, ScrollText } from 'lucide-react';
import { api, auditQuery, type AuditFilter, type AuditLog } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { useMe } from '@/hooks/queries';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CodeBlock,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
  KeyValueList,
  notifyError,
  Select,
  StatusBadge,
  toast,
  type Column,
} from '@/components/ui';
import { TableSkeleton } from './UsersSection';

const PAGE_SIZES = [25, 50, 100];

function outcomeVariant(outcome?: string) {
  return outcome === 'success'
    ? 'success'
    : outcome === 'denied'
      ? 'warning'
      : outcome === 'failed'
        ? 'destructive'
        : 'neutral';
}

export default function AuditSection() {
  const { t } = useTranslation();
  const me = useMe();
  const canExport = !!me.data?.capabilities?.canExportAudit || !!me.data?.user.isAdmin;
  const [draft, setDraft] = useState<AuditFilter>({});
  const [filter, setFilter] = useState<AuditFilter>({});
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

  async function exportCsv() {
    setExporting(true);
    try {
      const { csv, truncated, rows } = await api.exportAuditLogs(filter);
      if (truncated) toast.warning(t('admin.audit.truncated', { count: rows }), { duration: Infinity });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'audit-logs.csv';
      link.click();
      URL.revokeObjectURL(url);
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
      cell: (e) => formatDateTime(e.timestamp),
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
              setOffset(0);
              setFilter(draft);
            }}
          >
            <Field label={t('admin.audit.user')} id="audit-user">
              <Input value={draft.user ?? ''} onChange={(e) => setDraft({ ...draft, user: e.target.value })} />
            </Field>
            <Field label={t('admin.audit.actionPrefix')} id="audit-action">
              <Input
                className="font-mono text-[13px]"
                placeholder="user. · api.invoke"
                value={draft.action ?? ''}
                onChange={(e) => setDraft({ ...draft, action: e.target.value })}
              />
            </Field>
            <Field label={t('admin.audit.outcome')} id="audit-outcome">
              <Select
                value={draft.outcome ?? ''}
                onValueChange={(v) => setDraft({ ...draft, outcome: v })}
                options={[
                  { value: '', label: t('admin.audit.anyOutcome') },
                  { value: 'success', label: t('admin.audit.outcomes.success') },
                  { value: 'denied', label: t('admin.audit.outcomes.denied') },
                  { value: 'failed', label: t('admin.audit.outcomes.failed') },
                ]}
              />
            </Field>
            <Field label={t('admin.audit.from')} id="audit-from">
              <Input
                type="date"
                value={draft.from ?? ''}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </Field>
            <Field label={t('admin.audit.to')} id="audit-to" helper={t('admin.audit.toHelper')}>
              <Input type="date" value={draft.to ?? ''} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit" variant="primary">
                {t('admin.audit.apply')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft({});
                  setFilter({});
                  setOffset(0);
                }}
              >
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
              <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
                <ChevronLeft aria-hidden="true" />
                {t('table.previous')}
              </Button>
              <Button size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
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

function AuditDrawer({ entry, onClose }: { entry: AuditLog | null; onClose: () => void }) {
  const { t } = useTranslation();
  let details = '';
  if (entry?.detailsJson) {
    try {
      details = JSON.stringify(JSON.parse(entry.detailsJson), null, 2);
    } catch {
      details = entry.detailsJson;
    }
  }
  return (
    <Drawer
      open={!!entry}
      onOpenChange={(o) => !o && onClose()}
      title={t('admin.audit.entry')}
      description={entry?.action}
      className="w-[min(100vw,36rem)]"
    >
      {entry && (
        <div className="space-y-4 p-4">
          <KeyValueList
            items={[
              { label: t('admin.audit.time'), value: formatDateTime(entry.timestamp) },
              {
                label: t('admin.audit.user'),
                value: [entry.user, entry.actorSource && `(${entry.actorSource})`].filter(Boolean).join(' ') || '–',
              },
              { label: t('admin.audit.action'), value: entry.action, mono: true },
              {
                label: t('admin.audit.outcome'),
                value: entry.outcome ? (
                  <Badge variant={outcomeVariant(entry.outcome)}>{t(`admin.audit.outcomes.${entry.outcome}`)}</Badge>
                ) : (
                  '–'
                ),
              },
              {
                label: t('admin.audit.target'),
                value:
                  [entry.resourceType, entry.resourceName, entry.resourceId && `#${entry.resourceId}`]
                    .filter(Boolean)
                    .join(' ') || '–',
              },
              {
                label: t('admin.audit.status'),
                value: entry.statusCode ? <StatusBadge status={entry.statusCode} /> : '–',
              },
              { label: t('admin.audit.reason'), value: entry.errorMessage || '–' },
              { label: t('admin.audit.changes'), value: entry.changes || '–', mono: !!entry.changes },
              {
                label: t('admin.audit.duration'),
                value: entry.durationMs ? `${formatNumber(entry.durationMs)} ms` : '–',
              },
              { label: t('admin.audit.sourceIp'), value: entry.sourceIp || '–', mono: true },
              { label: t('admin.audit.userAgent'), value: entry.userAgent || '–' },
              { label: t('errors.requestId'), value: entry.requestId || '–', mono: true },
            ]}
          />
          {details && <CodeBlock code={details} label={t('admin.audit.details')} />}
        </div>
      )}
    </Drawer>
  );
}
