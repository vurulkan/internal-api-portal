import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { fold } from '@/lib/catalog';
import { cn } from '@/lib/cn';
import { operationsByTag, type NormalizedSpec, type Operation } from '@/lib/openapi';
import { Input, MethodBadge } from '@/components/ui';
import { operationPath } from '../context';

type Row = { kind: 'group'; label: string; count: number } | { kind: 'op'; op: Operation };

/** Above this many rows only the visible part is rendered. */
const VIRTUALIZE_AFTER = 150;

export function OperationTree({ spec, base, selected }: { spec: NormalizedSpec; base: string; selected?: string }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const rows = useMemo<Row[]>(() => {
    const q = fold(filter.trim());
    const match = (op: Operation) =>
      !q || fold(`${op.method} ${op.path} ${op.summary} ${op.operationId ?? ''}`).includes(q);
    const out: Row[] = [];
    const live = { ...spec, operations: spec.operations.filter((op) => !op.deprecated && match(op)) };
    for (const [tag, ops] of operationsByTag(live, t('api.untagged'))) {
      out.push({ kind: 'group', label: tag, count: ops.length });
      ops.forEach((op) => out.push({ kind: 'op', op }));
    }
    const deprecated = spec.operations.filter((op) => op.deprecated && match(op));
    if (deprecated.length) {
      out.push({ kind: 'group', label: t('api.deprecatedGroup'), count: deprecated.length });
      deprecated.forEach((op) => out.push({ kind: 'op', op }));
    }
    return out;
  }, [spec, filter, t]);

  const total = rows.filter((r) => r.kind === 'op').length;
  return (
    <div className="space-y-2">
      <div className="px-1">
        <label htmlFor="operation-filter" className="sr-only">
          {t('api.filterOperations')}
        </label>
        <Input
          id="operation-filter"
          type="search"
          data-page-search
          className="h-8"
          placeholder={t('api.filterOperations')}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <p className="mt-1 px-1 text-xs text-muted-foreground" aria-live="polite">
          {t('api.operationCount', { count: total })}
        </p>
      </div>
      {total === 0 ? (
        <p className="px-2 text-[13px] text-muted-foreground">{t('api.noOperationMatch')}</p>
      ) : rows.length > VIRTUALIZE_AFTER ? (
        <VirtualRows rows={rows} base={base} selected={selected} />
      ) : (
        <ul aria-label={t('api.operations')} data-shortcut-list>
          {rows.map((row, i) => (
            <li key={i}>
              <RowView row={row} base={base} selected={selected} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RowView({ row, base, selected }: { row: Row; base: string; selected?: string }) {
  const { t } = useTranslation();
  if (row.kind === 'group') {
    return (
      <p className="flex items-center justify-between px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">
        <span className="truncate">{row.label}</span>
        <span className="tabular-nums">{row.count}</span>
      </p>
    );
  }
  const { op } = row;
  const active = op.key === selected;
  return (
    <Link
      to={operationPath(base, op.key)}
      data-shortcut-item
      aria-current={active ? 'page' : undefined}
      title={op.summary || undefined}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted',
        active && 'bg-muted font-medium',
      )}
    >
      <MethodBadge method={op.method} className="min-w-[3rem]" />
      <span className="min-w-0 font-mono text-xs break-token">{op.path}</span>
      {op.deprecated && <span className="sr-only">({t('catalog.deprecated')})</span>}
    </Link>
  );
}

/** Rendered rows only; the scroll container is the side panel (or the drawer). */
function VirtualRows({ rows, base, selected }: { rows: Row[]; base: string; selected?: string }) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setScrollEl(listRef.current?.closest<HTMLElement>('[data-panel-scroll]') ?? null);
  }, []);
  // TanStack Virtual returns fresh functions each render; the compiler skips this
  // component, which is fine for a list that re-renders on scroll anyway.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: (i) => (rows[i].kind === 'group' ? 32 : 34),
    overscan: 12,
    // Rows show on the first paint, before the panel has been measured.
    initialRect: { width: 240, height: 800 },
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });
  return (
    <ul
      ref={listRef}
      aria-label={t('api.operations')}
      data-shortcut-list
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => (
        <li
          key={item.key}
          data-index={item.index}
          ref={virtualizer.measureElement}
          className="absolute inset-x-0"
          style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
        >
          <RowView row={rows[item.index]} base={base} selected={selected} />
        </li>
      ))}
    </ul>
  );
}
