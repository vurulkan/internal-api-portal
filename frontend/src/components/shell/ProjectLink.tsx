import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useMe, usePublicSettings } from '@/hooks/queries';
import { Tooltip } from '@/components/ui';

export const PROJECT_URL = 'https://github.com/vurulkan/internal-api-portal';
export const PRODUCT_NAME = 'Internal API Portal';

/** Off with SHOW_PROJECT_LINK=false (known from /me when signed in, else the public settings). */
export function useProjectLink() {
  const me = useMe();
  const pub = usePublicSettings();
  if (me.data) return me.data.projectLink !== false;
  // Not before the server has answered: with SHOW_PROJECT_LINK=false it must not flash.
  if (!pub.data || pub.isPlaceholderData) return false;
  return pub.data.projectLink !== false;
}

/** The GitHub mark (the brand's own shape, drawn with the current text colour). */
export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn('size-4 fill-current', className)}>
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38l-.01-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const external = { target: '_blank', rel: 'noopener noreferrer', href: PROJECT_URL } as const;

/** Sign-in page: a quiet line under the form. No version before sign-in. */
export function ProjectLink({ className }: { className?: string }) {
  const { t } = useTranslation();
  if (!useProjectLink()) return null;
  return (
    <p className={cn('text-center text-xs text-muted-foreground', className)}>
      <a
        {...external}
        className="inline-flex items-center gap-1.5 rounded-sm underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        <GitHubMark className="size-3.5" />
        {PRODUCT_NAME} · GitHub
        <span className="sr-only"> ({t('common.opensInNewTab')})</span>
      </a>
    </p>
  );
}

/** The navigation rail's foot: the mark, with the version in the tooltip. */
export function RailProjectLink() {
  const { t } = useTranslation();
  const me = useMe();
  if (!useProjectLink()) return null;
  const label = `${PRODUCT_NAME} ${me.data?.version ?? ''} · GitHub`.replace('  ', ' ');
  return (
    <Tooltip content={label} side="right">
      <a
        {...external}
        aria-label={`${label} (${t('common.opensInNewTab')})`}
        className="flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <GitHubMark className="size-[18px]" />
      </a>
    </Tooltip>
  );
}

/** One line with the version (and the link): the mobile menu and the shortcuts window. */
export function VersionLine({ className }: { className?: string }) {
  const { t } = useTranslation();
  const me = useMe();
  const show = useProjectLink();
  const version = me.data?.version;
  if (!version && !show) return null;
  return (
    <p className={cn('flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground', className)}>
      {version && <span>{t('help.version', { version })}</span>}
      {version && show && <span aria-hidden="true">·</span>}
      {show && (
        <a {...external} className="inline-flex items-center gap-1 rounded-sm hover:text-foreground hover:underline">
          <GitHubMark className="size-3.5" />
          GitHub
          <span className="sr-only"> ({t('common.opensInNewTab')})</span>
        </a>
      )}
    </p>
  );
}
