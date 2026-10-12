import { forwardRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './icon-button';
import { Input } from './input';

/** Password field with show / hide and a Caps Lock warning. Props go to the <input>. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  function PasswordInput(
    { className, id, onKeyDown, onKeyUp, onBlur, 'aria-describedby': describedBy, ...props },
    ref,
  ) {
    const { t } = useTranslation();
    const [visible, setVisible] = useState(false);
    const [capsLock, setCapsLock] = useState(false);
    const capsId = id ? `${id}-caps` : undefined;

    function track(event: KeyboardEvent<HTMLInputElement>) {
      setCapsLock(event.getModifierState?.('CapsLock') ?? false);
    }

    return (
      <div className="min-w-0">
        <div className="relative">
          <Input
            ref={ref}
            id={id}
            type={visible ? 'text' : 'password'}
            className={cn('pr-10', className)}
            aria-describedby={[describedBy, capsLock ? capsId : ''].filter(Boolean).join(' ') || undefined}
            onKeyDown={(event) => {
              track(event);
              onKeyDown?.(event);
            }}
            onKeyUp={(event) => {
              track(event);
              onKeyUp?.(event);
            }}
            onBlur={(event) => {
              setCapsLock(false);
              onBlur?.(event);
            }}
            {...props}
          />
          <IconButton
            size="icon-sm"
            className="absolute top-0.5 right-0.5"
            label={visible ? t('password.hide') : t('password.show')}
            icon={visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            onClick={() => setVisible((v) => !v)}
            aria-pressed={visible}
            disabled={props.disabled}
          />
        </div>
        {capsLock && (
          <p id={capsId} role="status" className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-warning">
            <ArrowUp className="size-3.5" aria-hidden="true" />
            {t('password.capsLock')}
          </p>
        )}
      </div>
    );
  },
);
