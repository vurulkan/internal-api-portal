import { forwardRef, useId, type ReactNode } from 'react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

type Props = {
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
};

export const Checkbox = forwardRef<HTMLButtonElement, Props>(function Checkbox(
  { checked, onCheckedChange, label, description, disabled, id: idProp, className, ...aria },
  ref,
) {
  const generated = useId();
  const id = idProp ?? `cb-${generated}`;
  const box = (
    <CheckboxPrimitive.Root
      ref={ref}
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(value) => onCheckedChange(value === true)}
      aria-describedby={description ? `${id}-description` : undefined}
      className={cn(
        'peer mt-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-input bg-card text-primary-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        !label && className,
      )}
      {...aria}
    >
      <CheckboxPrimitive.Indicator>
        {checked === 'indeterminate' ? (
          <Minus className="size-3" strokeWidth={3} aria-hidden="true" />
        ) : (
          <Check className="size-3" strokeWidth={3} aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (!label) return box;
  return (
    <div className={cn('flex items-start gap-2', className)}>
      {box}
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm text-foreground peer-disabled:cursor-not-allowed">
          {label}
        </label>
        {description && (
          <p id={`${id}-description`} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );
});
