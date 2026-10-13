import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ProjectLink } from '@/components/shell/ProjectLink';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Languages } from 'lucide-react';
import { api, isApiError } from '@/lib/api';
import { formatCountdown, safeNextPath } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { setLocale, type Locale } from '@/i18n';
import { useAuthProviders, useBranding, useMe } from '@/hooks/queries';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Alert, Button, Field, Input, PasswordInput } from '@/components/ui';

// Codes the Azure AD callback appends as ?auth_error=… when sign-in fails.
const AUTH_ERRORS = [
  'azure_not_configured',
  'azure_state',
  'azure_denied',
  'azure_failed',
  'azure_groups',
  'account_disabled',
];

/** When a lockout of `seconds` (Retry-After) ends. */
function lockoutEnd(seconds: number) {
  return Date.now() + seconds * 1000;
}

function useCountdown(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, (until - now) / 1000) : 0;
}

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  useDocumentTitle(t('login.title'));
  const me = useMe();
  const providers = useAuthProviders();
  const { brandTitle, logoDataUrl } = useBranding();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  // An Azure AD failure comes back as ?auth_error=…: shown once, then dropped from the URL.
  const [formError, setFormError] = useState(() => {
    const code = params.get('auth_error');
    return code ? t(`login.authErrors.${AUTH_ERRORS.includes(code) ? code : 'azure_failed'}`) : '';
  });
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const remaining = useCountdown(lockedUntil);
  const locked = remaining > 0;

  const schema = z.object({
    username: z.string().trim().min(1, t('login.usernameRequired')),
    password: z.string().min(1, t('login.passwordRequired')),
  });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { username: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (!params.has('auth_error')) return;
    const rest = new URLSearchParams(params);
    rest.delete('auth_error');
    setParams(rest, { replace: true });
  }, [params, setParams]);

  async function onSubmit(values: Values) {
    setFormError('');
    try {
      await api.login(values.username.trim(), values.password);
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      navigate(next, { replace: true });
    } catch (error) {
      form.setValue('password', '');
      if (isApiError(error, 429)) {
        setLockedUntil(lockoutEnd(error.retryAfter || 300));
        setFormError('');
      } else if (isApiError(error, 401)) {
        form.setError('password', { message: t('login.invalidCredentials') });
        form.setFocus('password');
      } else {
        setFormError(isApiError(error, 0) ? t('errors.networkBody') : t('login.failed'));
      }
    }
  }

  const otherLocale: Locale = i18n.language === 'tr' ? 'en' : 'tr';
  if (me.isSuccess) return <Navigate to={next} replace />;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="flex justify-end p-3">
        <Button variant="ghost" size="sm" onClick={() => setLocale(otherLocale)}>
          <Languages aria-hidden="true" />
          {otherLocale === 'tr' ? 'Türkçe' : 'English'}
        </Button>
      </div>
      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            {logoDataUrl ? (
              <img src={logoDataUrl} alt="" className="mb-4 h-12 max-w-[200px] object-contain" />
            ) : (
              <span
                aria-hidden="true"
                className="mb-4 flex size-11 items-center justify-center rounded-lg bg-primary text-lg font-semibold text-primary-foreground"
              >
                {brandTitle.charAt(0).toUpperCase()}
              </span>
            )}
            <h1 className="text-xl font-semibold tracking-tight">{brandTitle}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('login.subtitle')}</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            {formError && (
              <Alert variant="destructive" role="alert" className="mb-4">
                {formError}
              </Alert>
            )}
            {locked && (
              <Alert variant="warning" role="status" className="mb-4" title={t('login.lockedTitle')}>
                {t('login.lockedBody', { time: formatCountdown(remaining) })}
              </Alert>
            )}

            {providers.data?.azureAd && (
              <>
                <Button size="lg" className="w-full" onClick={() => api.startAzureLogin()}>
                  <MicrosoftLogo />
                  {t('login.microsoft')}
                </Button>
                <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  {t('login.or')}
                  <span className="h-px flex-1 bg-border" />
                </div>
              </>
            )}

            <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
              <Field
                label={t('login.username')}
                error={errors.username?.message}
                helper={providers.data?.ldap ? t('login.usernameLdapHelper') : undefined}
                id="username"
              >
                <Input
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  {...form.register('username')}
                />
              </Field>
              <Field label={t('login.password')} error={errors.password?.message} id="password">
                <PasswordInput autoComplete="current-password" {...form.register('password')} />
              </Field>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                loading={isSubmitting}
                disabled={locked}
              >
                {t('login.signIn')}
              </Button>
            </form>
          </div>
        </div>
      </main>
      <ProjectLink />
    </div>
  );
}

function MicrosoftLogo() {
  // Microsoft's four squares (brand colors are part of the logo, not UI colors).
  return (
    <svg viewBox="0 0 21 21" aria-hidden="true" className="size-4">
      <rect x="1" y="1" width="9" height="9" fill="var(--ms-red, rgb(242 80 34))" />
      <rect x="11" y="1" width="9" height="9" fill="var(--ms-green, rgb(127 186 0))" />
      <rect x="1" y="11" width="9" height="9" fill="var(--ms-blue, rgb(0 164 239))" />
      <rect x="11" y="11" width="9" height="9" fill="var(--ms-yellow, rgb(255 185 0))" />
    </svg>
  );
}
