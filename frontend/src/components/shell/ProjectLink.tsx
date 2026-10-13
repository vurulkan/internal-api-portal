import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export const PROJECT_URL = 'https://github.com/vurulkan/internal-api-portal';

/** A quiet link to the project's source, at the bottom of the sign-in page and the app. */
export function ProjectLink({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <footer className={cn('py-4 text-center text-xs text-muted-foreground', className)}>
      <a
        href={PROJECT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        github.com/vurulkan/internal-api-portal
        <span className="sr-only"> ({t('common.opensInNewTab')})</span>
      </a>
    </footer>
  );
}
