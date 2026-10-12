import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';

export function CopyButton({ value, label, className }: { value: string; label?: string; className?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size="sm"
      variant="ghost"
      className={className}
      onClick={async () => {
        await navigator.clipboard?.writeText(value);
        setCopied(true);
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span aria-live="polite">{copied ? t('common.copied') : (label ?? t('common.copy'))}</span>
    </Button>
  );
}

/** Monospace block with a copy button; scrolls inside itself, never the page. */
export function CodeBlock({
  code,
  label,
  className,
  maxHeight = 'max-h-96',
}: {
  code: string;
  label?: string;
  className?: string;
  maxHeight?: string;
}) {
  return (
    <div className={cn('min-w-0 overflow-hidden rounded-lg border border-border bg-muted', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border py-1 pr-1 pl-3">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        <CopyButton value={code} />
      </div>
      <pre
        className={cn('overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-token', maxHeight)}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
