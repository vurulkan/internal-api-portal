import { useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Kbd } from '@/components/ui';

/** Filters the catalog, or opens it filtered from elsewhere. "/" focuses it when the page has no search of its own. */
export function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const onCatalog = location.pathname === '/';
  // On the catalog the URL (?q=) is the value; elsewhere it's local until Enter.
  const [draft, setDraft] = useState('');
  const value = onCatalog ? (params.get('q') ?? '') : draft;
  const inputRef = useRef<HTMLInputElement>(null);

  function update(next: string) {
    setDraft(next);
    if (onCatalog) {
      const nextParams = new URLSearchParams(params);
      if (next) nextParams.set('q', next);
      else nextParams.delete('q');
      // The first keystroke is a history entry (Back clears the search); the rest
      // replace it, so Back doesn't step through every letter.
      setParams(nextParams, { replace: params.has('q') });
    }
  }

  return (
    <form
      role="search"
      aria-label={t('shell.searchLabel')}
      className="relative w-full max-w-md"
      onSubmit={(event) => {
        event.preventDefault();
        if (!onCatalog) {
          navigate(value ? `/?q=${encodeURIComponent(value)}` : '/');
          setDraft('');
        }
      }}
    >
      <label htmlFor="global-search" className="sr-only">
        {t('shell.searchLabel')}
      </label>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        id="global-search"
        type="search"
        aria-keyshortcuts="/"
        value={value}
        onChange={(event) => update(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            update('');
            inputRef.current?.blur();
          }
        }}
        placeholder={t('shell.searchPlaceholder')}
        className="h-9 w-full rounded-md border border-input bg-background pr-12 pl-8 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40"
      />
      <Kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 md:inline-flex">/</Kbd>
    </form>
  );
}
