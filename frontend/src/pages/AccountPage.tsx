import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Check, Circle, LogOut, MonitorSmartphone } from 'lucide-react';
import { api, isApiError, type MeResponse, type Session } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { useMe, useMySessions } from '@/hooks/queries';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  ErrorState,
  Field,
  KeyValueList,
  LoadingRegion,
  notifyError,
  notifySuccess,
  PageHeader,
  PasswordInput,
  Skeleton,
} from '@/components/ui';

/** A short device label from the user agent; the full string is in the title. */
export function deviceLabel(userAgent: string, t: (key: string, options?: Record<string, string>) => string) {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : t('account.browser');
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Mac OS X/.test(userAgent)
      ? 'macOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : '';
  return os ? t('account.deviceOn', { browser, os }) : browser;
}

export default function AccountPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('account.title'));
  const me = useMe();
  const location = useLocation();
  const user = me.data!.user;
  const isLocal = user.authSource === 'local';

  // /account#password, #sessions (user menu) scroll to the section.
  useEffect(() => {
    if (!location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [location.hash]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('account.title')} description={t('account.description')} />
      <div className="space-y-5">
        <Card>
          <CardHeader title={t('account.profile')} />
          <CardContent className="py-1">
            <KeyValueList
              items={[
                { label: t('account.username'), value: user.username, mono: true },
                { label: t('account.displayName'), value: user.displayName || '–' },
                { label: t('account.email'), value: user.email || '–' },
                {
                  label: t('account.authSource'),
                  value: t(`authSource.${user.authSource}`, { defaultValue: user.authSource }),
                },
                { label: t('account.role'), value: user.isAdmin ? t('account.administrator') : t('account.member') },
              ]}
            />
          </CardContent>
        </Card>

        <section id="password" aria-labelledby="password-heading" className="scroll-mt-20">
          <Card>
            <CardHeader id="password-heading" title={t('account.changePassword')} />
            <CardContent>
              {isLocal ? (
                <PasswordChangeForm me={me.data!} />
              ) : (
                <Alert variant="info">
                  {t('account.passwordManagedBy', {
                    source: t(`authSource.${user.authSource}`, { defaultValue: user.authSource }),
                  })}
                </Alert>
              )}
            </CardContent>
          </Card>
        </section>

        <section id="sessions" aria-labelledby="sessions-heading" className="scroll-mt-20">
          <SessionsCard />
        </section>
      </div>
    </div>
  );
}

/** Forced change after an administrator set the password or at the first sign-in. */
export function ChangePasswordPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('account.forcedTitle'));
  const me = useMe();
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title={t('account.forcedTitle')} description={t('account.forcedDescription')} />
      <Card>
        <CardContent>
          <PasswordChangeForm me={me.data!} forced />
        </CardContent>
      </Card>
    </div>
  );
}

function PasswordChangeForm({ me, forced = false }: { me: MeResponse; forced?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const minLength = me.passwordPolicy?.minLength ?? 12;
  const username = me.user.username.toLowerCase();

  const schema = z
    .object({
      currentPassword: z.string().min(1, t('account.currentRequired')),
      newPassword: z
        .string()
        .refine((v) => [...v].length >= minLength, t('account.ruleLength', { count: minLength }))
        .refine((v) => !v.toLowerCase().includes(username), t('account.ruleUsername')),
      confirmPassword: z.string(),
    })
    .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: t('account.ruleMatch') });
  type Values = z.infer<typeof schema>;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const [newPassword, confirmPassword] = useWatch({ control: form.control, name: ['newPassword', 'confirmPassword'] });
  const [serverError, setServerError] = useState('');

  const rules = useMemo(
    () => [
      { label: t('account.ruleLength', { count: minLength }), ok: [...(newPassword ?? '')].length >= minLength },
      { label: t('account.ruleUsername'), ok: !!newPassword && !newPassword.toLowerCase().includes(username) },
      { label: t('account.ruleMatch'), ok: !!newPassword && newPassword === confirmPassword },
    ],
    [newPassword, confirmPassword, minLength, username, t],
  );

  async function onSubmit(values: Values) {
    setServerError('');
    try {
      const result = await api.changePassword(values.currentPassword, values.newPassword);
      form.reset();
      const revoked = result?.sessionsRevoked ?? 0;
      notifySuccess(
        revoked > 0 ? t('account.passwordChangedRevoked', { count: revoked }) : t('account.passwordChanged'),
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      await queryClient.invalidateQueries({ queryKey: queryKeys.mySessions });
      if (forced) navigate('/', { replace: true });
    } catch (error) {
      if (isApiError(error) && error.code === 'invalid_current_password') {
        form.setError('currentPassword', { message: t('account.currentWrong') });
        form.setFocus('currentPassword');
      } else if (isApiError(error) && error.code === 'password_policy') {
        // The policy check (common passwords, reuse, …) answers with a readable reason.
        form.setError('newPassword', { message: error.message });
        form.setFocus('newPassword');
      } else {
        setServerError(error instanceof Error ? error.message : t('account.passwordFailed'));
      }
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-md space-y-4">
      {serverError && (
        <Alert variant="destructive" role="alert">
          {serverError}
        </Alert>
      )}
      <Field label={t('account.currentPassword')} error={errors.currentPassword?.message} id="currentPassword" required>
        <PasswordInput autoComplete="current-password" {...form.register('currentPassword')} />
      </Field>
      <Field label={t('account.newPassword')} error={errors.newPassword?.message} id="newPassword" required>
        <PasswordInput
          autoComplete="new-password"
          aria-describedby="password-rules"
          {...form.register('newPassword')}
        />
      </Field>
      <Field label={t('account.confirmPassword')} error={errors.confirmPassword?.message} id="confirmPassword" required>
        <PasswordInput autoComplete="new-password" {...form.register('confirmPassword')} />
      </Field>
      <div id="password-rules">
        <p className="sr-only">{t('account.rulesTitle')}</p>
        <ul className="space-y-1 text-[13px]">
          {rules.map((rule) => (
            <li
              key={rule.label}
              className={
                rule.ok ? 'flex items-center gap-2 text-success' : 'flex items-center gap-2 text-muted-foreground'
              }
            >
              {rule.ok ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Circle className="size-4" aria-hidden="true" />
              )}
              <span>
                {rule.label}
                <span className="sr-only"> ({rule.ok ? t('account.ruleMet') : t('account.ruleNotMet')})</span>
              </span>
            </li>
          ))}
          <li className="pl-6 text-xs text-muted-foreground">{t('account.ruleCommon')}</li>
        </ul>
      </div>
      <Button type="submit" variant="primary" loading={isSubmitting}>
        {t('account.updatePassword')}
      </Button>
    </form>
  );
}

function SessionsCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sessions = useMySessions();
  const [confirmOthers, setConfirmOthers] = useState(false);
  const others = (sessions.data ?? []).filter((s) => !s.current).length;

  const revoke = useMutation({
    mutationFn: (session: Session) => api.revokeMySession(session.id),
    onSuccess: () => {
      notifySuccess(t('account.sessionEnded'));
      void queryClient.invalidateQueries({ queryKey: queryKeys.mySessions });
    },
    onError: (error) => notifyError(error, t('account.sessionEndFailed')),
  });

  async function revokeOthers() {
    try {
      const result = await api.revokeMyOtherSessions();
      notifySuccess(t('account.otherSessionsEnded', { count: result.sessionsRevoked }));
      await queryClient.invalidateQueries({ queryKey: queryKeys.mySessions });
    } catch (error) {
      notifyError(error, t('account.sessionEndFailed'));
    }
  }

  return (
    <Card>
      <CardHeader
        id="sessions-heading"
        title={t('account.sessions')}
        description={t('account.sessionsDescription')}
        actions={
          <Button size="sm" disabled={others === 0} onClick={() => setConfirmOthers(true)}>
            <LogOut aria-hidden="true" />
            {t('account.signOutOthers')}
          </Button>
        }
      />
      <CardContent className="py-1">
        {sessions.isPending ? (
          <LoadingRegion className="space-y-3 py-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </LoadingRegion>
        ) : sessions.isError ? (
          <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : (
          <ul className="divide-y divide-border">
            {sessions.data.map((session) => (
              <li key={session.id} className="flex items-center gap-3 py-3">
                <MonitorSmartphone
                  className="size-5 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium" title={session.userAgent}>
                    {deviceLabel(session.userAgent, t)}
                    {session.current && <Badge variant="success">{t('account.thisBrowser')}</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('account.sessionMeta', {
                      ip: session.ip || t('account.unknownAddress'),
                      active: formatRelative(session.lastUsedAt),
                      signedIn: formatDateTime(session.createdAt),
                    })}
                  </p>
                </div>
                {!session.current && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={revoke.isPending && revoke.variables?.id === session.id}
                    onClick={() => revoke.mutate(session)}
                  >
                    {t('account.signOut')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <AlertDialog
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title={t('account.signOutOthersTitle')}
        description={t('account.signOutOthersBody', { count: others })}
        confirmLabel={t('account.signOutOthers')}
        onConfirm={revokeOthers}
      />
    </Card>
  );
}
