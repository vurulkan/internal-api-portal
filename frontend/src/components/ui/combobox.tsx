import { forwardRef, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { Check, Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ComboOption = { value: string; label: string };

type Props = {
  options: ComboOption[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Free values may be added (tags, path prefixes); otherwise only options. */
  creatable?: boolean;
  normalize?: (value: string) => string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
  'aria-label'?: string;
};

type Row = { value: string; label: string; create?: boolean };

/**
 * Multi-value combobox (WAI-ARIA combobox + multi-select listbox). Keyboard:
 * typing filters, ↓/↑ move, Enter toggles (or adds a new value), Esc closes,
 * Backspace in an empty input removes the last value.
 */
export const MultiCombobox = forwardRef<HTMLInputElement, Props>(function MultiCombobox(
  {
    options,
    value,
    onChange,
    creatable = false,
    normalize = (v) => v,
    placeholder,
    disabled,
    className,
    id: idProp,
    ...aria
  },
  ref,
) {
  const { t } = useTranslation();
  const generated = useId();
  const id = idProp ?? `combo-${generated}`;
  const listId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const labels = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options]);
  const selected = useMemo(() => new Set(value), [value]);
  const typed = normalize(query.trim());

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const matching = options.filter(
      (o) => !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
    const list: Row[] = matching;
    if (creatable && typed && !selected.has(typed) && !options.some((o) => o.value === typed)) {
      list.push({ value: typed, label: typed, create: true });
    }
    return list;
  }, [options, query, creatable, typed, selected]);

  const activeIndex = Math.min(active, Math.max(rows.length - 1, 0));
  const activeRow = open ? rows[activeIndex] : undefined;

  function toggle(row: Row) {
    if (selected.has(row.value)) {
      onChange(value.filter((v) => v !== row.value));
    } else {
      onChange([...value, row.value]);
    }
    if (row.create || creatable) setQuery('');
  }

  function remove(item: string) {
    onChange(value.filter((v) => v !== item));
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) setOpen(true);
        else setActive((i) => Math.min(i + 1, rows.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        if (open) {
          event.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (open) {
          event.preventDefault();
          setActive(rows.length - 1);
        }
        break;
      case 'Enter':
        if (open && activeRow) {
          event.preventDefault();
          toggle(activeRow);
        } else if (creatable && typed) {
          event.preventDefault();
          if (!selected.has(typed)) onChange([...value, typed]);
          setQuery('');
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        break;
      case 'Backspace':
        if (!query && value.length > 0) remove(value[value.length - 1]);
        break;
    }
  }

  return (
    <PopoverPrimitive.Root open={open && !disabled} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <div
          className={cn(
            'flex min-h-9 w-full min-w-0 cursor-text flex-wrap items-center gap-1 rounded-md border border-input bg-card px-1.5 py-1 transition-colors focus-within:border-ring focus-within:outline-2 focus-within:outline-ring/40',
            aria['aria-invalid'] && 'border-destructive',
            disabled && 'cursor-not-allowed bg-muted opacity-70',
            className,
          )}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              inputRef.current?.focus();
              setOpen(true);
            }
          }}
        >
          {value.map((item) => (
            <span
              key={item}
              className="inline-flex max-w-full items-center gap-0.5 rounded bg-muted py-0.5 pr-0.5 pl-1.5 text-xs font-medium text-foreground"
            >
              <span className="truncate">{labels.get(item) ?? item}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(item)}
                className="flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-card hover:text-foreground"
                aria-label={t('combobox.remove', { item: labels.get(item) ?? item })}
              >
                <X className="size-3" strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          ))}
          <input
            ref={(node) => {
              inputRef.current = node;
              if (typeof ref === 'function') ref(node);
              else if (ref) ref.current = node;
            }}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeRow ? `${id}-opt-${activeIndex}` : undefined}
            autoComplete="off"
            disabled={disabled}
            value={query}
            placeholder={value.length === 0 ? (placeholder ?? t('combobox.placeholder')) : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className="h-7 min-w-24 flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            {...aria}
          />
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          // Radix gives the popover role="dialog", which needs a name.
          aria-label={aria['aria-label'] ?? t('combobox.options')}
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target instanceof Node && inputRef.current?.parentElement?.contains(event.target)) {
              event.preventDefault();
            }
          }}
          data-animate
          className="z-40 w-[var(--radix-popover-trigger-width)] min-w-56 rounded-md border border-border bg-card p-1 text-card-foreground shadow-lg"
        >
          <ul
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={aria['aria-label'] ?? t('combobox.options')}
            className="max-h-60 overflow-y-auto"
          >
            {rows.length === 0 && (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">{t('combobox.noOptions')}</li>
            )}
            {rows.map((row, index) => {
              const isSelected = selected.has(row.value);
              return (
                // Options are never focused (aria-activedescendant); the input handles the keyboard.
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                <li
                  key={`${row.create ? 'new:' : ''}${row.value}`}
                  id={`${id}-opt-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => toggle(row)}
                  onMouseMove={() => setActive(index)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                    index === activeIndex && 'bg-muted',
                  )}
                >
                  {row.create ? (
                    <Plus className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-sm border border-input',
                        isSelected && 'border-primary bg-primary text-primary-foreground',
                      )}
                    >
                      {isSelected && <Check className="size-3" strokeWidth={3} />}
                    </span>
                  )}
                  <span className="truncate">{row.create ? t('combobox.add', { value: row.label }) : row.label}</span>
                </li>
              );
            })}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
});

/** Multi-select of ids (groups, roles). */
export const MultiSelect = forwardRef<
  HTMLInputElement,
  Omit<Props, 'options' | 'value' | 'onChange' | 'creatable' | 'normalize'> & {
    options: { value: number; label: string }[];
    value: number[];
    onChange: (value: number[]) => void;
  }
>(function MultiSelect({ options, value, onChange, ...props }, ref) {
  const stringOptions = useMemo(() => options.map((o) => ({ value: String(o.value), label: o.label })), [options]);
  return (
    <MultiCombobox
      ref={ref}
      options={stringOptions}
      value={value.map(String)}
      onChange={(next) => onChange(next.map(Number))}
      {...props}
    />
  );
});

/** Free values with suggestions (tags, methods, header names). */
export const ChipInput = forwardRef<
  HTMLInputElement,
  Omit<Props, 'options' | 'creatable'> & { suggestions?: string[] }
>(function ChipInput({ suggestions = [], value, normalize, ...props }, ref) {
  const options = useMemo(
    () =>
      Array.from(new Set(suggestions.map((s) => (normalize ? normalize(s) : s))))
        .filter((s) => !value.includes(s))
        .map((s) => ({ value: s, label: s })),
    [suggestions, value, normalize],
  );
  return <MultiCombobox ref={ref} creatable options={options} value={value} normalize={normalize} {...props} />;
});
