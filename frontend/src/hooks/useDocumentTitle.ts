import { useEffect } from 'react';
import { useBranding } from './queries';

/** "Payments API · Internal API Portal" (brand title from settings). */
export function useDocumentTitle(title?: string) {
  const { brandTitle } = useBranding();
  useEffect(() => {
    document.title = title ? `${title} · ${brandTitle}` : brandTitle;
  }, [title, brandTitle]);
}
