import { Toaster as Sonner, toast } from 'sonner';
import { useTheme } from '@/lib/theme';
import { isApiError } from '@/lib/api';
import i18n from '@/i18n';

/** Toasts: aria-live, 4 s; errors stay until closed. */
export function Toaster() {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      position="bottom-right"
      closeButton
      duration={4000}
      toastOptions={{
        classNames: {
          toast: 'font-sans !rounded-lg !border !border-border !bg-card !text-card-foreground !shadow-lg',
          description: '!text-muted-foreground',
          error: '!border-destructive/50',
          success: '!border-success/50',
        },
      }}
    />
  );
}

export function notifySuccess(message: string) {
  toast.success(message);
}

/** A failed action: stays until dismissed, shows the request id for support. */
export function notifyError(error: unknown, fallback: string) {
  const message = error instanceof Error && error.message ? error.message : fallback;
  const requestId = isApiError(error) ? error.requestId : '';
  toast.error(message, {
    duration: Infinity,
    description: requestId ? `${i18n.t('errors.requestId')}: ${requestId}` : undefined,
  });
}

export { toast };
