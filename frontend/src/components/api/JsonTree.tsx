import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

const PAGE = 200;

/** A JSON value as expandable lists (keyboard: Tab to a toggle, Enter / Space). */
export function JsonTree({ value }: { value: unknown }) {
  return (
    <div className="overflow-auto rounded-md border border-border bg-muted p-2 font-mono text-[12.5px]">
      <JsonNode name={null} value={value} depth={0} />
    </div>
  );
}

function Scalar({ value }: { value: unknown }) {
  if (typeof value === 'string') return <span className="text-syntax-string break-token">{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span className="text-syntax-number">{String(value)}</span>;
  return <span className="text-syntax-literal">{String(value)}</span>;
}

function JsonNode({ name, value, depth }: { name: string | null; value: unknown; depth: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(depth < 2);
  const [shown, setShown] = useState(PAGE);
  const label = name !== null && <span className="text-syntax-key">{JSON.stringify(name)}: </span>;
  if (value === null || typeof value !== 'object') {
    return (
      <div className="pl-5">
        {label}
        <Scalar value={value} />
      </div>
    );
  }
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const [openChar, closeChar] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-0.5 rounded-sm text-left hover:bg-card"
      >
        <ChevronRight
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          aria-hidden="true"
        />
        {label}
        <span className="text-syntax-punct">
          {openChar}
          {!open && ` ${t('json.items', { count: entries.length })} ${closeChar}`}
        </span>
      </button>
      {open && (
        <div className="border-l border-border pl-3" style={{ marginLeft: 7 }}>
          {entries.slice(0, shown).map(([k, v]) => (
            <JsonNode key={k} name={Array.isArray(value) ? null : k} value={v} depth={depth + 1} />
          ))}
          {entries.length > shown && (
            <button
              type="button"
              className="cursor-pointer pl-5 text-link hover:underline"
              onClick={() => setShown(shown + PAGE)}
            >
              {t('json.more', { count: entries.length - shown })}
            </button>
          )}
        </div>
      )}
      {open && <div className="pl-5 text-syntax-punct">{closeChar}</div>}
    </div>
  );
}
