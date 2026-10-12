import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Languages, LogOut, MonitorSmartphone, Moon, ShieldCheck, Sun, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { markSessionEstablished } from '@/lib/query';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { setLocale, type Locale } from '@/i18n';
import { useMe } from '@/hooks/queries';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@/components/ui';

/** Signs out (the server session may already be gone) and returns to the sign-in page. */
export function useSignOut() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async () => {
    try {
      await api.logout();
    } catch {
      // The session may already be gone; the local state is cleared either way.
    }
    markSessionEstablished(false);
    queryClient.clear();
    navigate('/login', { replace: true });
  };
}

export function ThemeMenu() {
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

export function LanguageMenu() {
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

export function UserMenu({ restricted }: { restricted: boolean }) {
  const { t } = useTranslation();
  const me = useMe();
  const signOut = useSignOut();
  const user = me.data?.user;
  if (!user) return null;
  const isLocal = user.authSource === 'local';

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
