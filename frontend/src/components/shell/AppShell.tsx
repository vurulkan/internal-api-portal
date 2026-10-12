import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate, useNavigation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CircleHelp, Command, LayoutGrid, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { clickShortcutTarget, modKey, moveInList, moveTab, useShortcuts } from '@/lib/shortcuts';
import { readPref, writePref } from '@/lib/storage';
import { useAdminSections, useBranding, useMe } from '@/hooks/queries';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { Alert, Drawer, DrawerBody, IconButton, Tooltip } from '@/components/ui';
import { CommandPalette } from './CommandPalette';
import { ShortcutHelp } from './ShortcutHelp';
import { GlobalSearch } from './GlobalSearch';
import { ShellContext } from './shell-context';
import { LanguageMenu, ThemeMenu, UserMenu, useSignOut } from './TopBarMenus';

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const signOut = useSignOut();

  useShortcuts(
    [
      { keys: 'k', mod: true, inDialog: true, run: () => setPaletteOpen((open) => !open) },
      { keys: '?', run: () => setHelpOpen(true) },
      { keys: '/', run: focusPageSearch },
      { keys: 'g c', run: () => navigate('/') },
      { keys: 'g a', run: () => sections.length > 0 && navigate('/admin') },
      { keys: '[', inDialog: true, run: () => moveTab(-1) },
      { keys: ']', inDialog: true, run: () => moveTab(1) },
      { keys: 'j', run: () => moveInList(1) },
      { keys: 'k', run: () => moveInList(-1) },
      { keys: 'n', run: () => clickShortcutTarget('next-page') },
      { keys: 'p', run: () => clickShortcutTarget('prev-page') },
      { keys: 'f', run: () => clickShortcutTarget('favorite') },
    ],
    !restricted,
  );

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
        onOpenPalette={() => setPaletteOpen(true)}
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
                shortcut="?"
                aria-keyshortcuts="?"
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
            data-panel-scroll
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
          {/* The drawer's content scrolls (long filter lists, operation trees). */}
          <DrawerBody data-panel-scroll>
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
          </DrawerBody>
        </Drawer>
      )}
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
      {!restricted && (
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onShowHelp={() => setHelpOpen(true)}
          onSignOut={() => void signOut()}
        />
      )}
    </ShellContext.Provider>
  );
}

function RailLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  // A plain Link: the tooltip's Slot can't merge NavLink's function className.
  const active = !!useMatch({ path: item.to, end: !!item.end });
  return (
    <Tooltip content={item.label} side="right">
      <Link
        to={item.to}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground',
          active &&
            'bg-muted text-foreground before:absolute before:top-2 before:bottom-2 before:-left-3 before:w-0.5 before:rounded-full before:bg-foreground',
        )}
      >
        <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
      </Link>
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

/** "/": the page's own search or filter box (marked data-page-search), else the top bar's. */
function focusPageSearch() {
  const target =
    document.querySelector<HTMLInputElement>('#main [data-page-search]') ??
    document.querySelector<HTMLInputElement>('aside [data-page-search]') ??
    document.getElementById('global-search');
  target?.focus();
  (target as HTMLInputElement | null)?.select?.();
}

function TopBar({
  restricted,
  onOpenMenu,
  onOpenPalette,
  panelToggle,
}: {
  restricted: boolean;
  onOpenMenu: () => void;
  onOpenPalette: () => void;
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
        {!restricted && (
          <IconButton
            label={t('palette.open')}
            // A keyboard tool: on phones the search box has the room.
            className="hidden sm:inline-flex"
            shortcut={`${modKey} K`}
            icon={<Command aria-hidden="true" />}
            onClick={onOpenPalette}
            aria-keyshortcuts="Meta+K Control+K"
            tooltipSide="bottom"
          />
        )}
        <ThemeMenu />
        <LanguageMenu />
        <UserMenu restricted={restricted} />
      </div>
    </header>
  );
}
