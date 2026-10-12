import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '@/lib/cn';

/** An on/off setting. The state is also written out ("On" / "Off"), not only shown by color. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const id = `sw-${useId()}`;
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-foreground">
          {label}
        </label>
        {description && (
          <p id={`${id}-description`} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="w-8 text-right text-xs text-muted-foreground" aria-hidden="true">
          {checked ? t('common.on') : t('common.off')}
        </span>
        <SwitchPrimitive.Root
          id={id}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-describedby={description ? `${id}-description` : undefined}
          className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-input bg-muted transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent"
        >
          <SwitchPrimitive.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-foreground shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent-foreground" />
        </SwitchPrimitive.Root>
      </div>
    </div>
  );
}
