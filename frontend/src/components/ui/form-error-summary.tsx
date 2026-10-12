import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert } from 'lucide-react';

export type FormErrorItem = { field: string; message: string };

/**
 * Shown after a failed submit: focusable, announced, each error links to its field
 * (the field's id is the form field name).
 */
export function FormErrorSummary({ errors, idPrefix = '' }: { errors: FormErrorItem[]; idPrefix?: string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length) ref.current?.focus();
  }, [errors]);
  if (!errors.length) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive-subtle p-3 text-sm text-destructive-subtle-foreground"
    >
      <p className="flex items-center gap-2 font-medium">
        <CircleAlert className="size-4" strokeWidth={1.75} aria-hidden="true" />
        {t('form.errorSummary', { count: errors.length })}
      </p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-9">
        {errors.map((error) => (
          <li key={error.field}>
            <a
              href={`#${idPrefix}${error.field}`}
              className="underline underline-offset-2"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(`${idPrefix}${error.field}`)?.focus();
              }}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
