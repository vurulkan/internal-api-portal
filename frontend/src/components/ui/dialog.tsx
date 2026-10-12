import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertDialog as AlertPrimitive, Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { Input } from './input';

const overlayClasses = 'fixed inset-0 z-50 bg-overlay';

/** Short forms and confirmations. Focus is trapped, Esc closes, focus returns to the trigger. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  trigger,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  trigger?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-animate className={overlayClasses} />
        <DialogPrimitive.Content
          data-animate
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-card text-card-foreground shadow-lg',
            className,
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-1 text-[13px] text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('common.close')}>
                <X aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {children && <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DialogClose = DialogPrimitive.Close;

/** Side panel for editing a record (or the navigation on small screens). */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = 'right',
  className,
  hideTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'left' | 'right';
  className?: string;
  hideTitle?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-animate className={overlayClasses} />
        <DialogPrimitive.Content
          data-animate
          className={cn(
            'fixed inset-y-0 z-50 flex w-[min(100vw,28rem)] flex-col border-border bg-card text-card-foreground shadow-lg',
            side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
            className,
          )}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div
            className={cn(
              'flex items-start justify-between gap-3 border-b border-border px-4 py-3',
              hideTitle && 'sr-only',
            )}
          >
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-0.5 text-[13px] text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('common.close')}>
                <X aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {footer ? (
            <>
              <DrawerBody>{children}</DrawerBody>
              <DrawerFooter>{footer}</DrawerFooter>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Scrolling part of a drawer (when the drawer's content is a form with its own footer). */
export function DrawerBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto', className)}>{children}</div>;
}

export function DrawerFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">{children}</div>
  );
}

/**
 * Confirmation of a destructive action. With confirmText the user types the
 * resource's name before the button enables.
 */
export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  confirmText,
  destructive = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => unknown;
  confirmText?: string;
  destructive?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = confirmText !== undefined && typed !== confirmText;

  async function confirm(event: React.MouseEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // The caller reports the failure (toast); the dialog stays open for a retry.
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped('');
        onOpenChange(next);
      }}
    >
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay data-animate className={overlayClasses} />
        <AlertPrimitive.Content
          data-animate
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-lg"
        >
          <AlertPrimitive.Title className="text-base font-semibold">{title}</AlertPrimitive.Title>
          <AlertPrimitive.Description className="mt-2 text-sm text-muted-foreground">
            {description}
          </AlertPrimitive.Description>
          {children}
          {confirmText !== undefined && (
            <div className="mt-4 space-y-1.5">
              <label htmlFor="confirm-text" className="text-sm">
                {t('confirm.typeToConfirm')} <code className="font-mono font-semibold">{confirmText}</code>
              </label>
              <Input
                id="confirm-text"
                autoComplete="off"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <AlertPrimitive.Cancel asChild>
              <Button disabled={busy}>{t('common.cancel')}</Button>
            </AlertPrimitive.Cancel>
            <AlertPrimitive.Action asChild>
              <Button
                variant={destructive ? 'destructive' : 'primary'}
                disabled={blocked}
                loading={busy}
                onClick={confirm}
              >
                {confirmLabel}
              </Button>
            </AlertPrimitive.Action>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  );
}
