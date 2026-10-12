import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Border, no shadow (DESIGN_SYSTEM: shadows only on overlays). */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('min-w-0 rounded-lg border border-border bg-card text-card-foreground', className)} {...props} />
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
  headingLevel = 2,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
  id?: string;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3', className)}>
      <div className="min-w-0">
        <Heading id={id} className="text-base font-semibold text-foreground">
          {title}
        </Heading>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3', className)}
      {...props}
    />
  );
}
