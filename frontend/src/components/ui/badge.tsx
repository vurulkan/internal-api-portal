import type { HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

export const badgeVariants = cva(
  'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      variant: {
        neutral: 'border-border bg-muted text-foreground',
        outline: 'border-border text-muted-foreground',
        success: 'border-transparent bg-success-subtle text-success-subtle-foreground',
        warning: 'border-transparent bg-warning-subtle text-warning-subtle-foreground',
        destructive: 'border-transparent bg-destructive-subtle text-destructive-subtle-foreground',
        info: 'border-transparent bg-info-subtle text-info-subtle-foreground',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

const METHOD_CLASSES: Record<string, string> = {
  GET: 'bg-method-get text-method-get-foreground',
  POST: 'bg-method-post text-method-post-foreground',
  PUT: 'bg-method-put text-method-put-foreground',
  PATCH: 'bg-method-patch text-method-patch-foreground',
  DELETE: 'bg-method-delete text-method-delete-foreground',
};

/** HTTP method, always written out (color is not the only signal). */
export function MethodBadge({ method, className }: { method: string; className?: string }) {
  const upper = method.toUpperCase();
  return (
    <span
      className={cn(
        'inline-flex min-w-[3.25rem] items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide',
        METHOD_CLASSES[upper] ?? 'bg-muted text-foreground',
        className,
      )}
    >
      {upper}
    </span>
  );
}

/** HTTP status: 2xx success, 3xx info, 4xx warning, 5xx destructive, plus the reason phrase. */
export function StatusBadge({ status, className }: { status: number; className?: string }) {
  const { t } = useTranslation();
  const variant = status >= 500 ? 'destructive' : status >= 400 ? 'warning' : status >= 300 ? 'info' : 'success';
  return (
    <Badge variant={variant} className={cn('font-mono tabular-nums', className)}>
      {status || t('common.noResponse')}
    </Badge>
  );
}
