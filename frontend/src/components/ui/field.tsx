import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

type ControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
};

/**
 * Label + control + helper + error. The single child (Input, Textarea, a Select
 * trigger, …) gets id, aria-describedby, aria-invalid and aria-required.
 */
export function Field({
  label,
  helper,
  error,
  required,
  optional,
  className,
  id: idProp,
  children,
}: {
  label: ReactNode;
  helper?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  optional?: boolean;
  className?: string;
  id?: string;
  children: ReactElement<ControlProps>;
}) {
  const { t } = useTranslation();
  const generated = useId();
  const id = idProp ?? `field-${generated}`;
  const helperId = helper ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const child = Children.only(children);
  const describedBy = [child.props['aria-describedby'], helperId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
        {optional && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{t('common.optional')}</span>}
      </label>
      {isValidElement(child)
        ? cloneElement(child, {
            id,
            'aria-describedby': describedBy,
            'aria-invalid': error ? true : child.props['aria-invalid'],
            'aria-required': required || undefined,
          })
        : child}
      {helper && (
        <p id={helperId} className="text-xs text-muted-foreground">
          {helper}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** A group of controls under one heading (radio groups, checkbox lists). */
export function Fieldset({
  legend,
  description,
  children,
  className,
}: {
  legend: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn('min-w-0 space-y-3 rounded-lg border border-border p-3', className)}>
      <legend className="px-1 text-sm font-semibold text-foreground">{legend}</legend>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {children}
    </fieldset>
  );
}
