import { lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminSections } from '@/hooks/queries';
import { TabbedSection, type SectionTab } from './TabbedSection';

const Session = lazy(() => import('./SessionSettingsSection'));
const Branding = lazy(() => import('./SystemSection'));
const SystemInfo = lazy(() => import('./SystemInfoPanel'));

/** Portal settings: session lifetime, branding, and what is running. */
export default function SettingsSection() {
  const { t } = useTranslation();
  const sections = useAdminSections();
  const tabs: SectionTab[] = [
    ...(sections.includes('sessionSettings')
      ? [{ id: 'session', label: t('admin.settings.tabs.session'), Component: Session }]
      : []),
    ...(sections.includes('system')
      ? [
          { id: 'branding', label: t('admin.settings.tabs.branding'), Component: Branding },
          { id: 'system', label: t('admin.settings.tabs.system'), Component: SystemInfo },
        ]
      : []),
  ];
  return <TabbedSection tabs={tabs} label={t('admin.sections.settings')} />;
}
