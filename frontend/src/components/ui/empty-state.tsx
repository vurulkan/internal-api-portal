import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Why it's empty + what to do next. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  headingLevel,
}: {
  /** When the empty state is the whole page (404), its title is the page's h1. */
  headingLevel?: 1 | 2;
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-4 py-10 text-center', className)}>
      {Icon && (
        <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </div>
      )}
      {headingLevel === 1 ? (
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      ) : headingLevel === 2 ? (
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      ) : (
        <p className="text-sm font-medium text-foreground">{title}</p>
      )}
      {description && <p className="max-w-md text-[13px] text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
