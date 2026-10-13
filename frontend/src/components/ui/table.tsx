import {
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { pressed } from '@/lib/shortcuts';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { AlertDialog } from './dialog';
import { Select } from './select';
import { useScrollFocus } from './use-scroll-focus';

// ── Primitives ───────────────────────────────────────────────────────────────

/** The table scrolls inside its own box; the page never scrolls sideways. */
export function TableContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollFocus(ref);
  return (
    <div
      ref={ref}
      className={cn('relative min-w-0 overflow-auto rounded-lg border border-border', className)}
      {...props}
    />
  );
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-left text-sm', className)} {...props} />;
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('sticky top-0 z-10 bg-muted', className)} {...props} />;
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-border bg-card', className)} {...props} />;
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors duration-150 hover:bg-muted/50', className)} {...props} />;
}

export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('h-9 px-3 text-xs font-medium whitespace-nowrap text-muted-foreground', className)}
      {...props}
    />
  );
}

export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2 align-middle', className)} {...props} />;
}

// ── DataTable ────────────────────────────────────────────────────────────────

export type RowDelete<T> = {
  can?: (row: T) => boolean;
  title: (row: T) => string;
  description: (row: T) => ReactNode;
  /** The user types this (the resource's name) before the button enables. */
  confirmText?: (row: T) => string;
  confirmLabel: string;
  run: (row: T) => Promise<unknown>;
};

export type Column<T> = {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Sortable when given: the value compared. */
  sortValue?: (row: T) => string | number;
  className?: string;
  headerClassName?: string;
};

/**
 * Client-side table: sorting (aria-sort), pagination, optional row selection,
 * sticky header and an empty state.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
  empty,
  pageSizes = [25, 50, 100],
  selectable = false,
  selected,
  onSelectedChange,
  rowLabel,
  toolbar,
  onRowClick,
  activeRowKey,
  rowDelete,
  className,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Visible to screen readers: what the table lists. */
  caption: string;
  empty?: ReactNode;
  pageSizes?: number[];
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (keys: string[]) => void;
  /** Used for the row checkbox label ("Select alice"). */
  rowLabel?: (row: T) => string;
  toolbar?: ReactNode;
  /** Opens a row: the first cell becomes a button (keyboard), the whole row is clickable (mouse). */
  onRowClick?: (row: T) => void;
  activeRowKey?: string;
  /** "d" on a focused row asks to delete it (only rows for which `can` is true). */
  rowDelete?: RowDelete<T>;
  className?: string;
}) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState<T | null>(null);
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(null);
  const [pageSize, setPageSize] = useState(pageSizes[0]);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.id === sort.id);
    if (!column?.sortValue) return rows;
    const value = column.sortValue;
    return [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const result = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? result : -result;
    });
  }, [rows, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const selectedSet = new Set(selected ?? []);
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selectedSet.has(rowKey(row)));
  const someVisibleSelected = visible.some((row) => selectedSet.has(rowKey(row)));

  function toggleSort(id: string) {
    setSort((prev) => (prev?.id !== id ? { id, dir: 'asc' } : prev.dir === 'asc' ? { id, dir: 'desc' } : null));
  }

  function toggleRow(key: string, on: boolean) {
    const next = new Set(selectedSet);
    if (on) next.add(key);
    else next.delete(key);
    onSelectedChange?.(Array.from(next));
  }

  function toggleAll(on: boolean) {
    const next = new Set(selectedSet);
    visible.forEach((row) => (on ? next.add(rowKey(row)) : next.delete(rowKey(row))));
    onSelectedChange?.(Array.from(next));
  }

  const rowHeight = 'h-10';

  return (
    <div className={cn('min-w-0 space-y-2', className)}>
      {toolbar && <div className="flex min-w-0 flex-wrap items-center gap-2">{toolbar}</div>}
      <TableContainer className="max-h-[70vh]">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <THead>
            <tr>
              {selectable && (
                <TH className="w-10">
                  <Checkbox
                    aria-label={t('table.selectAll')}
                    checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                  />
                </TH>
              )}
              {columns.map((column) => {
                const sortedDir = sort?.id === column.id ? sort.dir : undefined;
                return (
                  <TH
                    key={column.id}
                    className={column.headerClassName}
                    aria-sort={
                      column.sortValue
                        ? sortedDir === 'asc'
                          ? 'ascending'
                          : sortedDir === 'desc'
                            ? 'descending'
                            : 'none'
                        : undefined
                    }
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.id)}
                        className="-mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 hover:text-foreground"
                      >
                        {column.header}
                        {sortedDir === 'asc' ? (
                          <ArrowUp className="size-3.5" aria-hidden="true" />
                        ) : sortedDir === 'desc' ? (
                          <ArrowDown className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowUpDown className="size-3.5 opacity-50" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </TH>
                );
              })}
            </tr>
          </THead>
          <TBody
            data-shortcut-list
            onKeyDown={(event) => {
              if (!rowDelete || event.metaKey || event.ctrlKey || event.altKey || !pressed(event.nativeEvent, 'd'))
                return;
              const key = (event.target as HTMLElement).closest('tr')?.dataset.rowKey;
              const row = visible.find((r) => rowKey(r) === key);
              if (row && (rowDelete.can?.(row) ?? true)) {
                event.preventDefault();
                setDeleting(row);
              }
            }}
          >
            {visible.map((row) => {
              const key = rowKey(row);
              return (
                <TR
                  key={key}
                  data-row-key={key}
                  className={cn(
                    rowHeight,
                    onRowClick && 'cursor-pointer',
                    activeRowKey === key && 'bg-muted',
                    selectedSet.has(key) && 'bg-info-subtle/40',
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selectable && (
                    <TD className="w-10" onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        aria-label={t('table.selectRow', { row: rowLabel?.(row) ?? key })}
                        checked={selectedSet.has(key)}
                        onCheckedChange={(on) => toggleRow(key, on)}
                      />
                    </TD>
                  )}
                  {columns.map((column, index) => (
                    <TD key={column.id} className={column.className}>
                      {onRowClick && index === 0 ? (
                        <button
                          type="button"
                          data-shortcut-item
                          className="max-w-full cursor-pointer rounded-sm text-left hover:underline"
                          aria-current={activeRowKey === key ? 'true' : undefined}
                          onClick={(event) => {
                            event.stopPropagation();
                            onRowClick(row);
                          }}
                        >
                          {column.cell(row)}
                        </button>
                      ) : (
                        column.cell(row)
                      )}
                    </TD>
                  ))}
                </TR>
              );
            })}
          </TBody>
        </Table>
        {rows.length === 0 && <div className="border-t border-border bg-card">{empty}</div>}
      </TableContainer>
      {rows.length > pageSizes[0] && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted-foreground">
          <span className="tabular-nums">
            {t('table.range', {
              from: currentPage * pageSize + 1,
              to: Math.min((currentPage + 1) * pageSize, sorted.length),
              total: sorted.length,
            })}
          </span>
          <div className="flex items-center gap-2">
            <Select
              aria-label={t('table.rowsPerPage')}
              className="h-8 w-20"
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(0);
              }}
              options={pageSizes.map((n) => ({ value: String(n), label: String(n) }))}
            />
            <Button
              size="sm"
              data-shortcut="prev-page"
              aria-keyshortcuts="P"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft aria-hidden="true" />
              {t('table.previous')}
            </Button>
            <Button
              size="sm"
              data-shortcut="next-page"
              aria-keyshortcuts="N"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              {t('table.next')}
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
      {rowDelete && deleting && (
        <AlertDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={rowDelete.title(deleting)}
          description={rowDelete.description(deleting)}
          confirmLabel={rowDelete.confirmLabel}
          confirmText={rowDelete.confirmText?.(deleting)}
          onConfirm={() => rowDelete.run(deleting)}
        />
      )}
    </div>
  );
}
