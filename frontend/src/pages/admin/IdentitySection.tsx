import { lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminSections } from '@/hooks/queries';
import { TabbedSection, type SectionTab } from './TabbedSection';

const Ldap = lazy(() => import('./LdapSection'));
const Azure = lazy(() => import('./AzureSection'));

/** Sign-in sources: LDAP and Microsoft Entra ID (Azure AD), one tab each. */
export default function IdentitySection() {
  const { t } = useTranslation();
  const sections = useAdminSections();
  const tabs: SectionTab[] = [
    ...(sections.includes('ldap') ? [{ id: 'ldap', label: t('admin.sections.ldap'), Component: Ldap }] : []),
    ...(sections.includes('azureAd') ? [{ id: 'azure', label: t('admin.sections.azureAd'), Component: Azure }] : []),
  ];
  return <TabbedSection tabs={tabs} label={t('admin.sections.identity')} />;
}
