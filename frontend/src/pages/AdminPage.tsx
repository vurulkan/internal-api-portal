import { lazy, Suspense, useMemo, type ComponentType } from 'react';
import { Navigate, NavLink, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Fingerprint,
  Gauge,
  Layers,
  LayoutList,
  MonitorSmartphone,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAdminSections } from '@/hooks/queries';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { SectionPanel } from '@/components/shell/shell-context';
import { ErrorState, LoadingRegion, PageHeader, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';

type Section = {
  id: string;
  path: string;
  icon: LucideIcon;
  group: 'start' | 'people' | 'apis' | 'platform';
  /** Open when the server lists any of these capability sections. */
  needs: string[] | 'any';
  Component: ComponentType;
};

const SECTIONS: Section[] = [
  {
    id: 'overview',
    path: 'overview',
    icon: Gauge,
    group: 'start',
    needs: 'any',
    Component: lazy(() => import('./admin/OverviewSection')),
  },
  {
    id: 'users',
    path: 'users',
    icon: Users,
    group: 'people',
    needs: ['users'],
    Component: lazy(() => import('./admin/UsersSection')),
  },
  {
    id: 'groups',
    path: 'groups',
    icon: Layers,
    group: 'people',
    needs: ['groups'],
    Component: lazy(() => import('./admin/GroupsSection')),
  },
  {
    id: 'roles',
    path: 'roles',
    icon: ShieldCheck,
    group: 'people',
    needs: ['roles'],
    Component: lazy(() => import('./admin/RolesSection')),
  },
  {
    id: 'sessions',
    path: 'sessions',
    icon: MonitorSmartphone,
    group: 'people',
    needs: ['sessions'],
    Component: lazy(() => import('./admin/SessionsSection')),
  },
  {
    id: 'apis',
    path: 'apis',
    icon: LayoutList,
    group: 'apis',
    needs: ['apis'],
    Component: lazy(() => import('./admin/ApisSection')),
  },
  {
    id: 'identity',
    path: 'identity',
    icon: Fingerprint,
    group: 'platform',
    needs: ['ldap', 'azureAd'],
    Component: lazy(() => import('./admin/IdentitySection')),
  },
  {
    id: 'audit',
    path: 'audit',
    icon: ScrollText,
    group: 'platform',
    needs: ['audit'],
    Component: lazy(() => import('./admin/AuditSection')),
  },
  {
    id: 'settings',
    path: 'settings',
    icon: Settings,
    group: 'platform',
    needs: ['sessionSettings', 'system'],
    Component: lazy(() => import('./admin/SettingsSection')),
  },
];

const GROUPS = ['start', 'people', 'apis', 'platform'] as const;

// Paths of 1.x sections that now live inside another one.
const MOVED: Record<string, string> = {
  ldap: '/admin/identity?tab=ldap',
  'azure-ad': '/admin/identity?tab=azure',
  'session-settings': '/admin/settings?tab=session',
  system: '/admin/settings?tab=branding',
};

export default function AdminPage() {
  const { t } = useTranslation();
  const { section: path } = useParams();
  const allowed = useAdminSections();
  const visible = useMemo(
    () =>
      allowed.length === 0
        ? []
        : SECTIONS.filter((s) => s.needs === 'any' || s.needs.some((need) => allowed.includes(need))),
    [allowed],
  );
  const current = visible.find((s) => s.path === path);
  useDocumentTitle(current ? t(`admin.sections.${current.id}`) : t('nav.admin'));

  if (visible.length === 0) {
    return <ErrorState error={new ApiError(403, '')} />;
  }
  if (path && MOVED[path]) return <Navigate to={MOVED[path]} replace />;
  if (!path) return <Navigate to={`/admin/${visible[0].path}`} replace />;
  if (!current) {
    // Unknown section, or one this user may not open.
    const known = SECTIONS.some((s) => s.path === path);
    return known ? <ErrorState error={new ApiError(403, '')} /> : <Navigate to={`/admin/${visible[0].path}`} replace />;
  }

  const Component = current.Component;
  return (
    <>
      <SectionPanel title={t('nav.admin')}>
        <nav aria-label={t('admin.sectionsLabel')} className="space-y-4">
          {GROUPS.map((group) => {
            const items = visible.filter((s) => s.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                {group !== 'start' && (
                  <p
                    id={`admin-nav-${group}`}
                    className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    {t(`admin.navGroups.${group}`)}
                  </p>
                )}
                <ul className="space-y-0.5" aria-labelledby={group !== 'start' ? `admin-nav-${group}` : undefined}>
                  {items.map((section) => (
                    <li key={section.id}>
                      <NavLink
                        to={`/admin/${section.path}`}
                        className={({ isActive }) =>
                          cn(
                            'flex h-9 items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                            isActive && 'bg-muted font-medium text-foreground',
                          )
                        }
                      >
                        <section.icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                        {t(`admin.sections.${section.id}`)}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </SectionPanel>
      <PageHeader
        breadcrumbs={[{ label: t('nav.admin'), to: '/admin' }, { label: t(`admin.sections.${current.id}`) }]}
        title={t(`admin.sections.${current.id}`)}
        description={t(`admin.descriptions.${current.id}`)}
      />
      <Suspense
        fallback={
          <LoadingRegion className="space-y-3">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-80" />
          </LoadingRegion>
        }
      >
        <Component />
      </Suspense>
    </>
  );
}
