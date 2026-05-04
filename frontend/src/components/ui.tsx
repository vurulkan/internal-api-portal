import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

export function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(' ');
}

// ── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-6 w-6';
  return (
    <svg className={cn('animate-spin text-blue-600', s)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ── Alert ─────────────────────────────────────────────────────────────────────
type AlertVariant = 'success' | 'error' | 'warning' | 'info';
const alertCls: Record<AlertVariant, string> = {
  success: 'border-green-200 bg-green-50 text-green-800',
  error:   'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  info:    'border-blue-200 bg-blue-50 text-blue-800',
};
export function Alert({ variant = 'info', children }: { variant?: AlertVariant; children: ReactNode }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', alertCls[variant])}>
      {children}
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
type BadgeVariant = 'green' | 'red' | 'blue' | 'gray' | 'amber' | 'purple';
const badgeCls: Record<BadgeVariant, string> = {
  green:  'bg-green-50 text-green-700 ring-green-600/20',
  red:    'bg-red-50 text-red-700 ring-red-600/20',
  blue:   'bg-blue-50 text-blue-700 ring-blue-700/10',
  gray:   'bg-gray-50 text-gray-600 ring-gray-500/10',
  amber:  'bg-amber-50 text-amber-700 ring-amber-600/20',
  purple: 'bg-purple-50 text-purple-700 ring-purple-700/10',
};
export function Badge({
  variant = 'gray',
  children,
  className,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', badgeCls[variant], className)}>
      {children}
    </span>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

const btnBase = 'inline-flex items-center gap-1.5 rounded-lg font-medium focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 transition-colors';
const btnVariant: Record<ButtonVariant, string> = {
  primary:   'bg-blue-600 text-white shadow-sm hover:bg-blue-700 focus:ring-blue-500',
  secondary: 'border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50 focus:ring-blue-500',
  danger:    'text-red-600 hover:bg-red-50 focus:ring-red-500',
  ghost:     'text-gray-600 hover:bg-gray-100 focus:ring-gray-400',
};
const btnSize: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-sm',
};

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: () => void;
  className?: string;
  children: ReactNode;
};
export function Button({
  variant = 'secondary',
  size = 'md',
  disabled,
  type = 'button',
  onClick,
  className,
  children,
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(btnBase, btnVariant[variant], btnSize[size], className)}
    >
      {children}
    </button>
  );
}

// ── Field helpers ─────────────────────────────────────────────────────────────
export const fieldBase =
  'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 transition-colors';

export function FieldWrap({
  label,
  helperText,
  required,
  children,
}: {
  label?: string;
  helperText?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      {label && (
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {helperText && <p className="mt-1 text-xs text-gray-500">{helperText}</p>}
    </div>
  );
}

// ── Input ─────────────────────────────────────────────────────────────────────
export function Input({
  label,
  helperText,
  required,
  disabled,
  type = 'text',
  value,
  onChange,
  placeholder,
  className,
}: {
  label?: string;
  helperText?: string;
  required?: boolean;
  disabled?: boolean;
  type?: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <FieldWrap label={label} helperText={helperText} required={required}>
      <input
        type={type}
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        className={cn(fieldBase, className)}
      />
    </FieldWrap>
  );
}

// ── Textarea ──────────────────────────────────────────────────────────────────
export function Textarea({
  label,
  helperText,
  required,
  disabled,
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  label?: string;
  helperText?: string;
  required?: boolean;
  disabled?: boolean;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <FieldWrap label={label} helperText={helperText} required={required}>
      <textarea
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className={cn(fieldBase, 'resize-y')}
      />
    </FieldWrap>
  );
}

// ── NativeSelect ──────────────────────────────────────────────────────────────
export function NativeSelect({
  label,
  helperText,
  required,
  disabled,
  value,
  onChange,
  options,
}: {
  label?: string;
  helperText?: string;
  required?: boolean;
  disabled?: boolean;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <FieldWrap label={label} helperText={helperText} required={required}>
      <select
        required={required}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(fieldBase, 'cursor-pointer')}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldWrap>
  );
}

// ── Checkbox ──────────────────────────────────────────────────────────────────
export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );
}

// ── MultiSelect ───────────────────────────────────────────────────────────────
export type MultiSelectOption = { label: string; value: number };

export function MultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Select...',
}: {
  label?: string;
  options: MultiSelectOption[];
  value: MultiSelectOption[];
  onChange: (v: MultiSelectOption[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const selectedIds = useMemo(() => new Set(value.map((v) => v.value)), [value]);
  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function toggle(opt: MultiSelectOption) {
    if (selectedIds.has(opt.value)) {
      onChange(value.filter((v) => v.value !== opt.value));
    } else {
      onChange([...value, opt]);
    }
  }

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);

  return (
    <div ref={ref} className="relative">
      {label && <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>}
      <div
        className={cn(
          'flex min-h-[38px] cursor-pointer flex-wrap gap-1 rounded-lg border bg-white px-2 py-1.5 transition-colors',
          open ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-300 hover:border-gray-400'
        )}
        onClick={() => setOpen((v) => !v)}
      >
        {value.length === 0 && <span className="py-0.5 text-sm text-gray-400">{placeholder}</span>}
        {value.map((item) => (
          <span key={item.value} className="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">
            {item.label}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(value.filter((v) => v.value !== item.value)); }}
              className="ml-0.5 text-gray-400 hover:text-gray-600"
            >×</button>
          </span>
        ))}
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-100 p-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder="Search..."
              autoFocus
              className="w-full rounded border border-gray-200 px-2 py-1 text-xs outline-none focus:border-blue-400"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">No options</p>}
            {filtered.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50"
                onMouseDown={(e) => { e.preventDefault(); toggle(opt); }}
              >
                <span className={cn('flex h-4 w-4 items-center justify-center rounded border text-xs',
                  selectedIds.has(opt.value) ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300'
                )}>
                  {selectedIds.has(opt.value) && '✓'}
                </span>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ChipInput ─────────────────────────────────────────────────────────────────
export function ChipInput({
  label,
  helperText,
  options,
  value,
  onChange,
  normalize,
  placeholder = 'Type to add...',
}: {
  label?: string;
  helperText?: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  normalize?: (v: string) => string;
  placeholder?: string;
}) {
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  const norm = useMemo(() => (normalize ? normalize : (v: string) => v), [normalize]);
  const normalizedInput = norm(inputValue.trim());

  const filteredOptions = useMemo(() => {
    const lower = inputValue.toLowerCase();
    return options.filter(
      (opt) => !value.includes(norm(opt)) && (inputValue === '' || opt.toLowerCase().includes(lower))
    );
  }, [options, value, inputValue, norm]);

  const showAdd =
    normalizedInput.length > 0 &&
    !value.includes(normalizedInput) &&
    !options.some((opt) => norm(opt) === normalizedInput);

  function addItem(item: string) {
    const n = norm(item.trim());
    if (!n || value.includes(n)) return;
    onChange([...value, n]);
    setInputValue('');
  }

  function removeItem(item: string) {
    onChange(value.filter((v) => v !== item));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredOptions.length > 0 && !showAdd) addItem(filteredOptions[0]);
      else if (normalizedInput) addItem(normalizedInput);
      setOpen(false);
    }
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'Backspace' && !inputValue && value.length > 0) removeItem(value[value.length - 1]);
  }

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);

  const dropdownItems = [
    ...filteredOptions.map((opt) => ({ label: opt, value: norm(opt), isCreate: false })),
    ...(showAdd ? [{ label: `Add "${normalizedInput}"`, value: normalizedInput, isCreate: true }] : []),
  ];

  return (
    <div ref={ref} className="relative">
      {label && <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>}
      <div
        className={cn(
          'flex min-h-[38px] cursor-text flex-wrap gap-1 rounded-lg border bg-white px-2 py-1.5 transition-colors',
          open ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-300 hover:border-gray-400'
        )}
        onClick={() => { inputRef.current?.focus(); setOpen(true); }}
      >
        {value.map((item) => (
          <span key={item} className="inline-flex items-center gap-0.5 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
            {item}
            <button type="button" onClick={(e) => { e.stopPropagation(); removeItem(item); }} className="ml-0.5 text-blue-400 hover:text-blue-600">×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="min-w-[120px] flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
          placeholder={value.length === 0 ? placeholder : ''}
        />
      </div>
      {open && dropdownItems.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {dropdownItems.map((item) => (
            <button
              key={item.value}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50"
              onMouseDown={(e) => { e.preventDefault(); addItem(item.value); setOpen(false); }}
            >
              {item.isCreate && <span className="font-medium text-blue-600">+</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
      {helperText && <p className="mt-1 text-xs text-gray-500">{helperText}</p>}
    </div>
  );
}
