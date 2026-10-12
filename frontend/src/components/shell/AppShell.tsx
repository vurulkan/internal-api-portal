import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigation, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  CircleHelp,
  Languages,
  LayoutGrid,
  LogOut,
  Menu,
  MonitorSmartphone,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
  Sun,
  UserRound,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { markSessionEstablished } from '@/lib/query';
import { readPref, writePref } from '@/lib/storage';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { setLocale, type Locale } from '@/i18n';
import { useAdminSections, useBranding, useMe } from '@/hooks/queries';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import {
  Alert,
  Button,
  Dialog,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Kbd,
  Tooltip,
} from '@/components/ui';
import { ShellContext } from './shell-context';

const PANEL_KEY = 'portal.panelCollapsed';

type NavItem = { to: string; label: string; icon: typeof LayoutGrid; end?: boolean };

/** Top bar + nav rail + section panel + content. `restricted`: forced password change. */
export function AppShell({ restricted = false }: { restricted?: boolean }) {
  const { t } = useTranslation();
  const me = useMe();
  const sections = useAdminSections();
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readPref(PANEL_KEY) === '1');
  const [panels, setPanels] = useState<{ id: string; title: string }[]>([]);
  const [panelTarget, setPanelTarget] = useState<HTMLElement | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  const registerPanel = useCallback((id: string, title: string) => {
    setPanels((prev) => [...prev.filter((p) => p.id !== id), { id, title }]);
  }, []);
  const unregisterPanel = useCallback((id: string) => {
    setPanels((prev) => prev.filter((p) => p.id !== id));
  }, []);
  const panel = panels[panels.length - 1];
  const shellValue = useMemo(
    () => ({ panelTarget, registerPanel, unregisterPanel }),
    [panelTarget, registerPanel, unregisterPanel],
  );

  // A route change closes the drawer (state adjusted during render, not in an effect).
  const [drawerPath, setDrawerPath] = useState(location.pathname);
  if (drawerPath !== location.pathname) {
    setDrawerPath(location.pathname);
    setMobileOpen(false);
  }

  const nav: NavItem[] = restricted
    ? []
    : [
        { to: '/', label: t('nav.catalog'), icon: LayoutGrid, end: true },
        ...(sections.length > 0 ? [{ to: '/admin', label: t('nav.admin'), icon: ShieldCheck }] : []),
      ];

  function toggleCollapsed() {
    setCollapsed((prev) => {
      writePref(PANEL_KEY, prev ? '0' : '1');
      return !prev;
    });
  }

  const showDesktopPanel = isDesktop && !!panel && !collapsed;
  const warnings = me.data?.user.isAdmin ? (me.data.warnings ?? []) : [];

  return (
    <ShellContext.Provider value={shellValue}>
      <a
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-70 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {t('shell.skipToContent')}
      </a>
      <NavigationProgress />
      <TopBar
        restricted={restricted}
        onOpenMenu={() => setMobileOpen(true)}
        panelToggle={
          isDesktop && panel ? (
            <IconButton
              label={
                collapsed ? t('shell.showPanel', { panel: panel.title }) : t('shell.hidePanel', { panel: panel.title })
              }
              icon={collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              tooltipSide="bottom"
            />
          ) : null
        }
      />
      <div className="flex min-h-[calc(100dvh-3.5rem)]">
        {isDesktop && !restricted && (
          <nav
            aria-label={t('shell.mainNavigation')}
            className="sticky top-14 flex h-[calc(100dvh-3.5rem)] w-16 shrink-0 flex-col items-center gap-1 border-r border-border bg-card py-3"
          >
            {nav.map((item) => (
              <RailLink key={item.to} item={item} />
            ))}
            <div className="mt-auto">
              <IconButton
                label={t('shell.help')}
                icon={<CircleHelp aria-hidden="true" />}
                tooltipSide="right"
                onClick={() => setHelpOpen(true)}
              />
            </div>
          </nav>
        )}
        {showDesktopPanel && (
          <aside
            aria-label={panel.title}
            className="sticky top-14 h-[calc(100dvh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-border bg-card"
          >
            <p className="px-4 pt-4 pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {panel.title}
            </p>
            <div ref={setPanelTarget} className="px-2 pb-4" />
          </aside>
        )}
        <main ref={mainRef} id="main" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6">
            {warnings.map((code) => (
              <Alert key={code} variant="warning" role="status" className="mb-4">
                {t(`warnings.${code}`, { defaultValue: code })}
              </Alert>
            ))}
            <Outlet />
          </div>
        </main>
      </div>
      {!isDesktop && (
        <Drawer open={mobileOpen} onOpenChange={setMobileOpen} side="left" title={t('shell.menu')}>
          {!restricted && (
            <nav aria-label={t('shell.mainNavigation')} className="space-y-0.5 border-b border-border p-2">
              {nav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium hover:bg-muted',
                      isActive && 'bg-muted text-foreground',
                    )
                  }
                >
                  <item.icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
                  {item.label}
                </NavLink>
              ))}
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  setHelpOpen(true);
                }}
                className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-sm font-medium hover:bg-muted"
              >
                <CircleHelp className="size-5" strokeWidth={1.75} aria-hidden="true" />
                {t('shell.help')}
              </button>
            </nav>
          )}
          {panel && (
            <section aria-label={panel.title}>
              <p className="px-4 pt-4 pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {panel.title}
              </p>
              <div ref={setPanelTarget} className="px-2 pb-4" />
            </section>
          )}
        </Drawer>
      )}
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </ShellContext.Provider>
  );
}

function RailLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Tooltip content={item.label} side="right">
      <NavLink
        to={item.to}
        end={item.end}
        aria-label={item.label}
        className={({ isActive }) =>
          cn(
            'relative flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground',
            isActive &&
              'bg-muted text-foreground before:absolute before:top-2 before:bottom-2 before:-left-3 before:w-0.5 before:rounded-full before:bg-foreground',
          )
        }
      >
        <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
      </NavLink>
    </Tooltip>
  );
}

/** Slim bar while a lazy route loads. */
function NavigationProgress() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  if (navigation.state === 'idle') return null;
  return (
    <div
      role="progressbar"
      aria-label={t('common.loading')}
      className="fixed inset-x-0 top-0 z-60 h-0.5 overflow-hidden"
    >
      <div className="h-full w-1/3 animate-[nav-progress_1.2s_ease-in-out_infinite] bg-link motion-reduce:animate-none" />
    </div>
  );
}

function TopBar({
  restricted,
  onOpenMenu,
  panelToggle,
}: {
  restricted: boolean;
  onOpenMenu: () => void;
  panelToggle: ReactNode;
}) {
  const { t } = useTranslation();
  const { brandTitle, logoDataUrl } = useBranding();
  const isDesktop = useIsDesktop();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card px-3 sm:px-4">
      {!isDesktop && (
        <IconButton
          label={t('shell.openMenu')}
          icon={<Menu aria-hidden="true" />}
          onClick={onOpenMenu}
          tooltipSide="bottom"
        />
      )}
      {panelToggle}
      <Link to="/" className="flex min-w-0 shrink-0 items-center gap-2 rounded-md pr-2">
        {logoDataUrl ? (
          <img src={logoDataUrl} alt="" className="size-7 shrink-0 rounded object-contain" />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
          >
            {brandTitle.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="hidden max-w-56 truncate text-sm font-semibold sm:inline">{brandTitle}</span>
        <span className="sr-only sm:hidden">{brandTitle}</span>
      </Link>
      <div className="flex min-w-0 flex-1 justify-center">{!restricted && <GlobalSearch />}</div>
      <div className="flex shrink-0 items-center gap-0.5">
        <ThemeMenu />
        <LanguageMenu />
        <UserMenu restricted={restricted} />
      </div>
    </header>
  );
}

/** Filters the catalog (M10 turns it into the command palette). "/" or ⌘K focuses it. */
function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const onCatalog = location.pathname === '/';
  // On the catalog the URL (?q=) is the value; elsewhere it's local until Enter.
  const [draft, setDraft] = useState('');
  const value = onCatalog ? (params.get('q') ?? '') : draft;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function update(next: string) {
    setDraft(next);
    if (onCatalog) {
      const nextParams = new URLSearchParams(params);
      if (next) nextParams.set('q', next);
      else nextParams.delete('q');
      setParams(nextParams, { replace: true });
    }
  }

  return (
    <form
      role="search"
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

function ThemeMenu() {
  const { t } = useTranslation();
  const { preference, resolved, setPreference } = useTheme();
  const Icon = preference === 'system' ? MonitorSmartphone : resolved === 'dark' ? Moon : Sun;
  return (
    <DropdownMenu>
      <Tooltip content={t('shell.theme')} side="bottom">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('shell.themeCurrent', { theme: t(`theme.${preference}`) })}>
            <Icon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent>
        <DropdownMenuLabel>{t('shell.theme')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={preference} onValueChange={(v) => setPreference(v as ThemePreference)}>
          <DropdownMenuRadioItem value="light">{t('theme.light')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t('theme.dark')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">{t('theme.system')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LanguageMenu() {
  const { t, i18n } = useTranslation();
  return (
    <DropdownMenu>
      <Tooltip content={t('shell.language')} side="bottom">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('shell.languageCurrent', { language: t(`language.${i18n.language}`) })}
          >
            <Languages aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent>
        <DropdownMenuLabel>{t('shell.language')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={i18n.language} onValueChange={(v) => setLocale(v as Locale)}>
          <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="tr">Türkçe</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ restricted }: { restricted: boolean }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = me.data?.user;
  if (!user) return null;
  const isLocal = user.authSource === 'local';

  async function signOut() {
    try {
      await api.logout();
    } catch {
      // The session may already be gone; the local state is cleared either way.
    }
    markSessionEstablished(false);
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('shell.userMenu', { user: user.username })} className="ml-1">
          <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
            {(user.displayName || user.username).charAt(0).toUpperCase()}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{user.displayName || user.username}</p>
          <p className="truncate text-xs text-muted-foreground">
            {user.username} · {t(`authSource.${user.authSource}`, { defaultValue: user.authSource })}
          </p>
        </div>
        <DropdownMenuSeparator />
        {!restricted && (
          <>
            <DropdownMenuItem asChild>
              <Link to="/account">
                <UserRound aria-hidden="true" />
                {t('shell.account')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account#sessions">
                <MonitorSmartphone aria-hidden="true" />
                {t('shell.mySessions')}
              </Link>
            </DropdownMenuItem>
            {isLocal && (
              <DropdownMenuItem asChild>
                <Link to="/account#password">
                  <ShieldCheck aria-hidden="true" />
                  {t('shell.changePassword')}
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" />
          {t('shell.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const rows: [string, ReactNode][] = [
    [
      t('help.focusSearch'),
      <>
        <Kbd>/</Kbd> {t('help.or')} <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </>,
    ],
    [
      t('help.skipToContent'),
      <>
        <Kbd>Tab</Kbd> {t('help.onPageLoad')}
      </>,
    ],
    [t('help.closeOverlay'), <Kbd>Esc</Kbd>],
    [
      t('help.moveInLists'),
      <>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> <Kbd>Enter</Kbd>
      </>,
    ],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('help.title')} description={t('help.description')}>
      <dl className="divide-y divide-border text-sm">
        {rows.map(([label, keys]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2">
            <dt>{label}</dt>
            <dd className="flex shrink-0 items-center gap-1 text-muted-foreground">{keys}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
