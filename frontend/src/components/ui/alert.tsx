import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

const STYLES = {
  info: { classes: 'border-info-subtle-foreground/30 bg-info-subtle text-info-subtle-foreground', Icon: Info },
  success: {
    classes: 'border-success-subtle-foreground/30 bg-success-subtle text-success-subtle-foreground',
    Icon: CircleCheck,
  },
  warning: {
    classes: 'border-warning-subtle-foreground/30 bg-warning-subtle text-warning-subtle-foreground',
    Icon: TriangleAlert,
  },
  destructive: {
    classes: 'border-destructive-subtle-foreground/30 bg-destructive-subtle text-destructive-subtle-foreground',
    Icon: CircleAlert,
  },
};

/** Page-level state (a warning that stays, a form-wide error). Transient feedback is a toast. */
export function Alert({
  variant = 'info',
  title,
  children,
  action,
  className,
  role,
}: {
  variant?: keyof typeof STYLES;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: 'alert' | 'status';
}) {
  const { classes, Icon } = STYLES[variant];
  return (
    <div role={role} className={cn('flex items-start gap-2.5 rounded-lg border p-3 text-sm', classes, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0 flex-1 break-token">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
