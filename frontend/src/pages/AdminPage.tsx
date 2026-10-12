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
import { ADMIN_SECTIONS, visibleAdminSections, type AdminSectionDef } from '@/lib/admin-sections';
import { cn } from '@/lib/cn';
import { useAdminSections } from '@/hooks/queries';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { SectionPanel } from '@/components/shell/shell-context';
import { ErrorState, LoadingRegion, PageHeader, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';

type Section = AdminSectionDef & { icon: LucideIcon; Component: ComponentType };

const COMPONENTS: Record<string, { icon: LucideIcon; Component: ComponentType }> = {
  overview: { icon: Gauge, Component: lazy(() => import('./admin/OverviewSection')) },
  users: { icon: Users, Component: lazy(() => import('./admin/UsersSection')) },
  groups: { icon: Layers, Component: lazy(() => import('./admin/GroupsSection')) },
  roles: { icon: ShieldCheck, Component: lazy(() => import('./admin/RolesSection')) },
  sessions: { icon: MonitorSmartphone, Component: lazy(() => import('./admin/SessionsSection')) },
  apis: { icon: LayoutList, Component: lazy(() => import('./admin/ApisSection')) },
  identity: { icon: Fingerprint, Component: lazy(() => import('./admin/IdentitySection')) },
  audit: { icon: ScrollText, Component: lazy(() => import('./admin/AuditSection')) },
  settings: { icon: Settings, Component: lazy(() => import('./admin/SettingsSection')) },
};

const SECTIONS: Section[] = ADMIN_SECTIONS.map((s) => ({ ...s, ...COMPONENTS[s.id] }));

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
  const visible = useMemo(() => {
    const ids = visibleAdminSections(allowed).map((s) => s.id);
    return SECTIONS.filter((s) => ids.includes(s.id));
  }, [allowed]);
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
