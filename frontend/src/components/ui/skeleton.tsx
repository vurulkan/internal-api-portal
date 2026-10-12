import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-shimmer rounded-md bg-muted motion-reduce:animate-none', className)}
    />
  );
}

/** A labelled loading region (announced once) shaped like the content that comes. */
export function LoadingRegion({
  children,
  label,
  className,
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label ?? t('common.loading')}</span>
      {children}
    </div>
  );
}
