import { forwardRef } from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { controlClasses } from './input';

export type SelectOption = { value: string; label: string; disabled?: boolean; description?: string };

// Radix Select doesn't allow an empty item value; "" (e.g. "any") maps to this.
const EMPTY = '__empty__';

type Props = {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
};

/** Single choice from a short list. Keyboard: arrows, type-ahead, Enter, Esc. */
export const Select = forwardRef<HTMLButtonElement, Props>(function Select(
  { value, onValueChange, options, placeholder, disabled, className, name, ...aria },
  ref,
) {
  const hasEmpty = options.some((o) => o.value === '');
  return (
    <SelectPrimitive.Root
      value={value === '' ? (hasEmpty ? EMPTY : '') : value}
      onValueChange={(next) => onValueChange(next === EMPTY ? '' : next)}
      disabled={disabled}
      name={name}
    >
      <SelectPrimitive.Trigger
        ref={ref}
        className={cn(
          controlClasses,
          'flex h-9 cursor-pointer items-center justify-between gap-2 text-left data-[placeholder]:text-muted-foreground',
          className,
        )}
        {...aria}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 opacity-70" strokeWidth={1.75} aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          data-animate
          className="z-55 max-h-[min(var(--radix-select-content-available-height),320px)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-lg"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value || EMPTY}
                value={option.value === '' ? EMPTY : option.value}
                disabled={option.disabled}
                className="relative flex cursor-pointer select-none items-start gap-2 rounded-sm py-1.5 pr-2 pl-7 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 top-2">
                  <Check className="size-3.5" strokeWidth={2} aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
                <span className="flex flex-col">
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  {option.description && <span className="text-xs text-muted-foreground">{option.description}</span>}
                </span>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
});
