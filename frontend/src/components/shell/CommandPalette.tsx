import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  ArrowRight,
  Braces,
  Clock,
  Keyboard,
  Languages,
  LayoutGrid,
  LogOut,
  Monitor,
  Moon,
  Search,
  ShieldCheck,
  Sun,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { visibleAdminSections } from '@/lib/admin-sections';
import { cn } from '@/lib/cn';
import { fuzzyFilter } from '@/lib/fuzzy';
import { readPref, writePref } from '@/lib/storage';
import { useTheme } from '@/lib/theme';
import { setLocale } from '@/i18n';
import { useAdminSections, useCatalog, useSearch } from '@/hooks/queries';
import { Kbd, MethodBadge } from '@/components/ui';

type Item = {
  id: string;
  group: 'recent' | 'apis' | 'operations' | 'navigate' | 'actions';
  label: string;
  /** Extra text matched by the filter (tags, slug, path). */
  keywords?: string;
  detail?: ReactNode;
  icon?: LucideIcon;
  method?: string;
  href?: string;
  run?: () => void;
};

const RECENT_KEY = 'portal.palette.recent';
const RECENT_MAX = 5;

type Recent = { id: string; label: string; href?: string; method?: string };

function readRecent(): Recent[] {
  try {
    const parsed = JSON.parse(readPref(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.id === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/**
 * ⌘K: jump to an API, an operation or an admin section, or run an action (theme,
 * language, help, sign out). The input is a combobox over one listbox of grouped
 * options; ↑ ↓ move, Enter runs, Esc closes and focus returns where it was.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onShowHelp,
  onSignOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowHelp: () => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-animate className="fixed inset-0 z-50 bg-overlay" />
        <DialogPrimitive.Content
          data-animate
          aria-describedby={undefined}
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[min(36rem,76vh)] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg"
        >
          <DialogPrimitive.Title className="sr-only">{t('palette.title')}</DialogPrimitive.Title>
          {open && <Palette onDone={() => onOpenChange(false)} onShowHelp={onShowHelp} onSignOut={onSignOut} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Palette({
  onDone,
  onShowHelp,
  onSignOut,
}: {
  onDone: () => void;
  onShowHelp: () => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setPreference } = useTheme();
  const allowed = useAdminSections();
  const catalog = useCatalog();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const search = useSearch(query);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [recent] = useState(readRecent);

  const items = useMemo(() => {
    const apis = (catalog.data ?? []).filter((a) => a.canView);
    const lastViewed = [...apis]
      .filter((a) => a.lastViewedAt)
      .sort((a, b) => (b.lastViewedAt ?? '').localeCompare(a.lastViewedAt ?? ''))[0];
    const navigateItems: Item[] = [
      { id: 'nav:catalog', group: 'navigate', label: t('nav.catalog'), icon: LayoutGrid, href: '/' },
      ...visibleAdminSections(allowed).map<Item>((s) => ({
        id: `nav:admin:${s.id}`,
        group: 'navigate',
        label: `${t('nav.admin')} · ${t(`admin.sections.${s.id}`)}`,
        icon: ShieldCheck,
        href: `/admin/${s.path}`,
      })),
      { id: 'nav:account', group: 'navigate', label: t('shell.account'), icon: UserRound, href: '/account' },
    ];
    const actions: Item[] = [
      ...(lastViewed
        ? [
            {
              id: 'action:last-api',
              group: 'actions' as const,
              label: t('palette.backTo', { name: lastViewed.name }),
              icon: Clock,
              href: `/apis/${encodeURIComponent(lastViewed.slug)}`,
            },
          ]
        : []),
      {
        id: 'action:theme-light',
        group: 'actions',
        label: t('palette.themeLight'),
        icon: Sun,
        run: () => setPreference('light'),
      },
      {
        id: 'action:theme-dark',
        group: 'actions',
        label: t('palette.themeDark'),
        icon: Moon,
        run: () => setPreference('dark'),
      },
      {
        id: 'action:theme-system',
        group: 'actions',
        label: t('palette.themeSystem'),
        icon: Monitor,
        run: () => setPreference('system'),
      },
      {
        id: 'action:lang-en',
        group: 'actions',
        label: 'Language: English',
        keywords: 'dil ingilizce',
        icon: Languages,
        run: () => setLocale('en'),
      },
      {
        id: 'action:lang-tr',
        group: 'actions',
        label: 'Dil: Türkçe',
        keywords: 'language turkish',
        icon: Languages,
        run: () => setLocale('tr'),
      },
      { id: 'action:help', group: 'actions', label: t('palette.shortcuts'), icon: Keyboard, run: onShowHelp },
      { id: 'action:signout', group: 'actions', label: t('shell.signOut'), icon: LogOut, run: onSignOut },
    ];
    const apiItems: Item[] = apis.map((a) => ({
      id: `api:${a.id}`,
      group: 'apis',
      label: a.name,
      keywords: [a.slug, a.ownerTeam, ...(a.tags ?? [])].join(' '),
      detail: a.ownerTeam,
      icon: Braces,
      href: `/apis/${encodeURIComponent(a.slug)}`,
    }));
    const q = query.trim();
    if (!q) {
      const byId = new Map([...navigateItems, ...actions, ...apiItems].map((i) => [i.id, i]));
      const recentItems = recent
        .map<Item | undefined>((r) =>
          byId.has(r.id)
            ? { ...byId.get(r.id)!, group: 'recent' }
            : r.href && r.id.startsWith('op:')
              ? { id: r.id, group: 'recent', label: r.label, href: r.href, method: r.method }
              : undefined,
        )
        .filter((i): i is Item => !!i);
      const used = new Set(recentItems.map((i) => i.id));
      return [
        ...recentItems,
        ...navigateItems.filter((i) => !used.has(i.id)),
        ...apiItems.filter((i) => !used.has(i.id)).slice(0, 5),
        ...actions.filter((i) => !used.has(i.id)),
      ];
    }
    const text = (i: Item) => `${i.label} ${i.keywords ?? ''}`;
    const operations: Item[] =
      q.length >= 2
        ? (search.data?.operations ?? []).slice(0, 8).map((op) => ({
            id: `op:${op.apiId}:${op.method} ${op.path}`,
            group: 'operations',
            label: `${op.method} ${op.path}`,
            method: op.method,
            detail: [op.summary, op.apiName].filter(Boolean).join(' · '),
            href: `/apis/${encodeURIComponent(op.apiSlug || String(op.apiId))}?${new URLSearchParams({ op: `${op.method} ${op.path}` })}`,
          }))
        : [];
    return [
      ...fuzzyFilter(q, apiItems, text, 6),
      ...operations,
      ...fuzzyFilter(q, navigateItems, text, 6),
      ...fuzzyFilter(q, actions, text, 6),
    ];
  }, [catalog.data, allowed, query, search.data, recent, t, setPreference, onShowHelp, onSignOut]);

  const index = Math.min(active, Math.max(0, items.length - 1));
  const optionId = (i: number) => `${listId}-opt-${i}`;

  function run(item: Item) {
    if (item.group !== 'actions' || item.href) {
      const entry: Recent = { id: item.id, label: item.label, href: item.href, method: item.method };
      writePref(
        RECENT_KEY,
        JSON.stringify([entry, ...readRecent().filter((r) => r.id !== item.id)].slice(0, RECENT_MAX)),
      );
    }
    onDone();
    if (item.href) navigate(item.href);
    item.run?.();
  }

  function move(next: number) {
    const target = (next + items.length) % Math.max(items.length, 1);
    setActive(target);
    document.getElementById(optionId(target))?.scrollIntoView?.({ block: 'nearest' });
  }

  const groups = (['recent', 'apis', 'operations', 'navigate', 'actions'] as const).filter((g) =>
    items.some((i) => i.group === g),
  );
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items.length ? optionId(index) : undefined}
          aria-label={t('palette.inputLabel')}
          placeholder={t('palette.placeholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') move(index + 1);
            else if (e.key === 'ArrowUp') move(index - 1);
            else if (e.key === 'Home' && e.ctrlKey) move(0);
            else if (e.key === 'End' && e.ctrlKey) move(items.length - 1);
            else if (e.key === 'Enter' && items[index]) run(items[index]);
            else return;
            e.preventDefault();
          }}
          className="h-12 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <Kbd>Esc</Kbd>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div ref={listRef} id={listId} role="listbox" aria-label={t('palette.results')}>
          {groups.map((group) => (
            <div key={group} role="group" aria-labelledby={`${listId}-${group}`}>
              <div
                id={`${listId}-${group}`}
                role="presentation"
                className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {t(`palette.groups.${group}`)}
              </div>
              {items.map((item, i) =>
                item.group !== group ? null : (
                  // The combobox owns the keyboard (aria-activedescendant); options are not focusable by design.
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
                  <div
                    key={item.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === index}
                    onMouseMove={() => i !== index && setActive(i)}
                    onClick={() => run(item)}
                    className={cn(
                      'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm',
                      i === index && 'bg-muted',
                    )}
                  >
                    {item.method ? (
                      <MethodBadge method={item.method} />
                    ) : item.icon ? (
                      <item.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">
                      <span className={cn(item.method && 'font-mono text-[13px]')}>
                        {item.method ? item.label.slice(item.method.length + 1) : item.label}
                      </span>
                      {item.detail && <span className="ml-2 text-xs text-muted-foreground">{item.detail}</span>}
                    </span>
                    {i === index && <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
        {items.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {search.isFetching ? t('common.loading') : t('palette.empty')}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> {t('palette.move')}
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> {t('palette.choose')}
        </span>
        <span className="flex items-center gap-1">
          <Kbd>?</Kbd> {t('palette.allShortcuts')}
        </span>
        <span className="sr-only" role="status" aria-live="polite">
          {t('palette.count', { count: items.length })}
        </span>
      </div>
    </>
  );
}
