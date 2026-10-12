import { useId, type ReactNode } from 'react';
import { RadioGroup as RadioPrimitive } from 'radix-ui';
import { cn } from '@/lib/cn';

export function RadioGroup({
  value,
  onValueChange,
  options,
  label,
  className,
  orientation = 'vertical',
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: ReactNode; description?: ReactNode; disabled?: boolean }[];
  label: string;
  className?: string;
  orientation?: 'vertical' | 'horizontal';
}) {
  const base = useId();
  return (
    <RadioPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      aria-label={label}
      orientation={orientation}
      className={cn(orientation === 'vertical' ? 'grid gap-2' : 'flex flex-wrap gap-4', className)}
    >
      {options.map((option) => {
        const id = `${base}-${option.value}`;
        return (
          <div key={option.value} className="flex items-start gap-2">
            <RadioPrimitive.Item
              id={id}
              value={option.value}
              disabled={option.disabled}
              className="mt-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full border border-input bg-card disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary"
            >
              <RadioPrimitive.Indicator className="block size-2 rounded-full bg-primary" />
            </RadioPrimitive.Item>
            <div>
              <label htmlFor={id} className="cursor-pointer text-sm text-foreground">
                {option.label}
              </label>
              {option.description && <p className="text-xs text-muted-foreground">{option.description}</p>}
            </div>
          </div>
        );
      })}
    </RadioPrimitive.Root>
  );
}
