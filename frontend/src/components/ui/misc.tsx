import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[11px] text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Label / value pairs (profile data, API metadata). */
export function KeyValueList({
  items,
  className,
}: {
  items: { label: ReactNode; value: ReactNode; mono?: boolean }[];
  className?: string;
}) {
  return (
    <dl className={cn('divide-y divide-border text-sm', className)}>
      {items.map((item, index) => (
        <div key={index} className="grid gap-1 py-2 sm:grid-cols-[minmax(8rem,1fr)_2fr] sm:gap-3">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className={cn('min-w-0 text-foreground break-token', item.mono && 'font-mono text-[13px]')}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type Crumb = { label: string; to?: string };

export function Breadcrumbs({ items, label }: { items: Crumb[]; label?: string }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <nav aria-label={label ?? t('shell.breadcrumb')} className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              <li className="min-w-0 truncate">
                {item.to && !last ? (
                  <Link to={item.to} className="hover:text-foreground hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current={last ? 'page' : undefined} className={cn(last && 'text-foreground')}>
                    {item.label}
                  </span>
                )}
              </li>
              {!last && (
                <li aria-hidden="true">
                  <ChevronRight className="size-3.5" strokeWidth={1.75} />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/** Title row of a page: breadcrumbs, h1, description and the page's actions. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  meta?: ReactNode;
}) {
  return (
    <header className="mb-5 space-y-2">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground break-token">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-1.5">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
