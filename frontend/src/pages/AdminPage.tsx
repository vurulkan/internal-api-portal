import { lazy, Suspense, useMemo, type ComponentType } from 'react';
import { Navigate, NavLink, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Fingerprint,
  KeyRound,
  Layers,
  LayoutList,
  MonitorSmartphone,
  Palette,
  ScrollText,
  ShieldCheck,
  Timer,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAdminSections } from '@/hooks/queries';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { SectionPanel } from '@/components/shell/shell-context';
import { ErrorState, LoadingRegion, PageHeader, Skeleton } from '@/components/ui';
import { ApiError } from '@/lib/api';

type Section = { id: string; path: string; icon: LucideIcon; Component: ComponentType };

const SECTIONS: Section[] = [
  { id: 'users', path: 'users', icon: Users, Component: lazy(() => import('./admin/UsersSection')) },
  { id: 'groups', path: 'groups', icon: Layers, Component: lazy(() => import('./admin/GroupsSection')) },
  { id: 'roles', path: 'roles', icon: ShieldCheck, Component: lazy(() => import('./admin/RolesSection')) },
  { id: 'apis', path: 'apis', icon: LayoutList, Component: lazy(() => import('./admin/ApisSection')) },
  { id: 'ldap', path: 'ldap', icon: KeyRound, Component: lazy(() => import('./admin/LdapSection')) },
  { id: 'azureAd', path: 'azure-ad', icon: Fingerprint, Component: lazy(() => import('./admin/AzureSection')) },
  {
    id: 'sessionSettings',
    path: 'session-settings',
    icon: Timer,
    Component: lazy(() => import('./admin/SessionSettingsSection')),
  },
  {
    id: 'sessions',
    path: 'sessions',
    icon: MonitorSmartphone,
    Component: lazy(() => import('./admin/SessionsSection')),
  },
  { id: 'audit', path: 'audit', icon: ScrollText, Component: lazy(() => import('./admin/AuditSection')) },
  { id: 'system', path: 'system', icon: Palette, Component: lazy(() => import('./admin/SystemSection')) },
];

export default function AdminPage() {
  const { t } = useTranslation();
  const { section: path } = useParams();
  const allowed = useAdminSections();
  const visible = useMemo(() => SECTIONS.filter((s) => allowed.includes(s.id)), [allowed]);
  const current = visible.find((s) => s.path === path);
  useDocumentTitle(current ? t(`admin.sections.${current.id}`) : t('nav.admin'));

  if (visible.length === 0) {
    return <ErrorState error={new ApiError(403, '')} />;
  }
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
        <nav aria-label={t('admin.sectionsLabel')}>
          <ul className="space-y-0.5">
            {visible.map((section) => (
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
