import { useTranslation } from 'react-i18next';
import { ChevronDown, FolderInput, Plus, UserPlus } from 'lucide-react';
import { useAuthProviders } from '@/hooks/queries';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui';

export type NewUserKind = 'local' | 'ldap' | 'azure';

/**
 * "New user": a plain button when only local accounts can be made; with LDAP or
 * Microsoft sign-in enabled, a split button whose menu adds "From LDAP…" and
 * "Azure AD user…".
 */
export function NewUserMenu({ onChoose }: { onChoose: (kind: NewUserKind) => void }) {
  const { t } = useTranslation();
  const providers = useAuthProviders();
  const ldap = !!providers.data?.ldap;
  const azure = !!providers.data?.azureAd;
  const main = (
    <Button variant="accent" className={ldap || azure ? 'rounded-r-none' : undefined} onClick={() => onChoose('local')}>
      <Plus aria-hidden="true" />
      {t('admin.users.new')}
    </Button>
  );
  if (!ldap && !azure) return main;
  return (
    <div className="inline-flex">
      {main}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="accent"
            className="rounded-l-none border-l border-accent-foreground/25 px-2"
            aria-label={t('admin.users.newFrom')}
          >
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onChoose('local')}>
            <UserPlus aria-hidden="true" />
            {t('admin.users.newLocal')}
          </DropdownMenuItem>
          {ldap && (
            <DropdownMenuItem onSelect={() => onChoose('ldap')}>
              <FolderInput aria-hidden="true" />
              {t('admin.users.newLdap')}
            </DropdownMenuItem>
          )}
          {azure && (
            <DropdownMenuItem onSelect={() => onChoose('azure')}>
              <UserPlus aria-hidden="true" />
              {t('admin.users.newAzure')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
