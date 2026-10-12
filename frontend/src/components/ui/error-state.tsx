import { useTranslation } from 'react-i18next';
import { CircleAlert, Lock, RotateCw, SearchX, WifiOff } from 'lucide-react';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from './button';

/** A failed load: what happened, a retry, and the request id (for support) folded away. */
export function ErrorState({
  error,
  onRetry,
  title,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const apiError = isApiError(error) ? error : null;
  const status = apiError?.status;
  const Icon = status === 403 ? Lock : status === 404 ? SearchX : status === 0 ? WifiOff : CircleAlert;
  const heading =
    title ??
    (status === 403
      ? t('errors.forbiddenTitle')
      : status === 404
        ? t('errors.notFoundTitle')
        : status === 0
          ? t('errors.networkTitle')
          : t('errors.loadFailedTitle'));
  const detail =
    status === 403
      ? t('errors.forbiddenBody')
      : status === 0
        ? t('errors.networkBody')
        : apiError?.message || (error instanceof Error ? error.message : t('errors.unknown'));

  return (
    <div role="alert" className={cn('flex flex-col items-center gap-2 px-4 py-10 text-center', className)}>
      <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-destructive-subtle text-destructive-subtle-foreground">
        <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-foreground">{heading}</p>
      <p className="max-w-md text-[13px] text-muted-foreground break-token">{detail}</p>
      {onRetry && status !== 403 && status !== 404 && (
        <Button className="mt-2" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden="true" />
          {t('common.retry')}
        </Button>
      )}
      {apiError?.requestId && (
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t('errors.details')}</summary>
          <p className="mt-1">
            {t('errors.requestId')}: <code className="font-mono select-all">{apiError.requestId}</code>
          </p>
        </details>
      )}
    </div>
  );
}
