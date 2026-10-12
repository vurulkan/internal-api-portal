import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX, PlugZap, Search, UserPlus } from 'lucide-react';
import { api, type LdapConfig, type LdapLoginStep, type LdapUser } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  Checkbox,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingRegion,
  notifyError,
  notifySuccess,
  PasswordInput,
  Skeleton,
  Switch,
  Textarea,
  type Column,
} from '@/components/ui';
import { splitList, useAdminMutation } from './common';

export default function LdapSection() {
  const config = useQuery({ queryKey: queryKeys.admin.ldap, queryFn: api.ldap });
  if (config.isError)
    return (
      <Card>
        <ErrorState error={config.error} onRetry={() => void config.refetch()} />
      </Card>
    );
  if (!config.data) {
    return (
      <LoadingRegion className="space-y-3">
        <Skeleton className="h-96" />
      </LoadingRegion>
    );
  }
  return (
    <div className="space-y-5">
      <ConnectionCard
        key={config.dataUpdatedAt}
        initial={{ ...config.data, bindPassword: '', userBaseDns: config.data.userBaseDns ?? [] }}
      />
      <LoginTest />
      <UserImport />
    </div>
  );
}

function ConnectionCard({ initial }: { initial: LdapConfig }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<LdapConfig>(initial);

  const save = useAdminMutation({
    mutationFn: (value: LdapConfig) => api.updateLdap(value),
    success: t('admin.ldap.saved'),
    invalidate: [queryKeys.admin.ldap, queryKeys.authProviders],
  });
  const test = useMutation({
    mutationFn: (value: LdapConfig) => api.testLdap(value),
    onSuccess: () => notifySuccess(t('admin.ldap.testOk')),
    onError: (error) => notifyError(error, t('admin.ldap.testFailed')),
  });

  const set = <K extends keyof LdapConfig>(key: K, value: LdapConfig[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const insecure = form.sslSkipVerify && (form.useSsl || form.startTls);

  return (
    <Card>
      <CardHeader title={t('admin.ldap.connection')} description={t('admin.ldap.connectionBody')} />
      <form
        id="ldap-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(form);
        }}
      >
        <CardContent className="space-y-4">
          <Switch
            label={t('admin.ldap.enabled')}
            description={t('admin.ldap.enabledHelper')}
            checked={form.enabled}
            onCheckedChange={(v) => set('enabled', v)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.ldap.host')} id="ldap-host">
              <Input
                className="font-mono text-[13px]"
                value={form.host}
                onChange={(e) => set('host', e.target.value)}
              />
            </Field>
            <Field label={t('admin.ldap.port')} id="ldap-port">
              <Input
                type="number"
                inputMode="numeric"
                value={String(form.port)}
                onChange={(e) => set('port', Number(e.target.value))}
              />
            </Field>
            <Field label={t('admin.ldap.url')} id="ldap-url" optional helper={t('admin.ldap.urlHelper')}>
              <Input
                className="font-mono text-[13px]"
                placeholder="ldaps://dc1.corp.example:636"
                value={form.url}
                onChange={(e) => set('url', e.target.value)}
              />
            </Field>
            <Field label={t('admin.ldap.timeout')} id="ldap-timeout">
              <Input
                type="number"
                inputMode="numeric"
                value={String(form.timeoutSeconds)}
                onChange={(e) => set('timeoutSeconds', Number(e.target.value))}
              />
            </Field>
            <Field label={t('admin.ldap.bindDn')} id="ldap-bind">
              <Input
                className="font-mono text-[13px]"
                value={form.bindDn}
                onChange={(e) => set('bindDn', e.target.value)}
              />
            </Field>
            <Field
              label={t('admin.ldap.bindPassword')}
              id="ldap-bind-password"
              helper={form.passwordConfigured ? t('admin.keepSecret') : undefined}
            >
              <PasswordInput
                autoComplete="off"
                value={form.bindPassword ?? ''}
                onChange={(e) => set('bindPassword', e.target.value)}
              />
            </Field>
            <Field label={t('admin.ldap.userBaseDn')} id="ldap-base">
              <Input
                className="font-mono text-[13px]"
                value={form.userBaseDn}
                onChange={(e) => set('userBaseDn', e.target.value)}
              />
            </Field>
            <Field label={t('admin.ldap.usernameAttribute')} id="ldap-uattr">
              <Input
                className="font-mono text-[13px]"
                value={form.usernameAttribute}
                onChange={(e) => set('usernameAttribute', e.target.value)}
              />
            </Field>
            <Field label={t('admin.ldap.displayNameAttribute')} id="ldap-dattr">
              <Input
                className="font-mono text-[13px]"
                value={form.displayNameAttribute}
                onChange={(e) => set('displayNameAttribute', e.target.value)}
              />
            </Field>
            <Field label={t('admin.ldap.emailAttribute')} id="ldap-eattr">
              <Input
                className="font-mono text-[13px]"
                value={form.emailAttribute}
                onChange={(e) => set('emailAttribute', e.target.value)}
              />
            </Field>
          </div>
          <Field
            label={t('admin.ldap.userBaseDns')}
            id="ldap-bases"
            optional
            helper={t('admin.ldap.userBaseDnsHelper')}
          >
            <Textarea
              rows={2}
              className="font-mono text-[13px]"
              value={(form.userBaseDns ?? []).join('\n')}
              onChange={(e) => set('userBaseDns', splitList(e.target.value))}
            />
          </Field>
          <Field label={t('admin.ldap.userFilter')} id="ldap-filter" helper={t('admin.ldap.userFilterHelper')}>
            <Input
              className="font-mono text-[13px]"
              value={form.userFilter}
              onChange={(e) => set('userFilter', e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Checkbox label={t('admin.ldap.useSsl')} checked={form.useSsl} onCheckedChange={(v) => set('useSsl', v)} />
            <Checkbox
              label={t('admin.ldap.startTls')}
              checked={form.startTls}
              onCheckedChange={(v) => set('startTls', v)}
            />
            <Checkbox
              label={t('admin.ldap.skipVerify')}
              checked={form.sslSkipVerify}
              onCheckedChange={(v) => set('sslSkipVerify', v)}
            />
          </div>
          {insecure && <Alert variant="warning">{t('admin.ldap.skipVerifyWarning')}</Alert>}
        </CardContent>
        <CardFooter>
          <Button onClick={() => test.mutate(form)} loading={test.isPending}>
            <PlugZap aria-hidden="true" />
            {t('admin.ldap.test')}
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function LoginTest() {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [steps, setSteps] = useState<LdapLoginStep[] | null>(null);
  const run = useMutation({
    mutationFn: () => api.testLdapLogin(username, password),
    onSuccess: (result) => {
      setSteps(result.steps);
      setPassword('');
    },
    onError: (error) => notifyError(error, t('admin.ldap.testFailed')),
  });
  return (
    <Card>
      <CardHeader title={t('admin.ldap.loginTest')} description={t('admin.ldap.loginTestBody')} />
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (username) run.mutate();
        }}
      >
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.users.username')} id="ldap-test-user">
              <Input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field
              label={t('login.password')}
              id="ldap-test-password"
              optional
              helper={t('admin.ldap.loginTestPasswordHelper')}
            >
              <PasswordInput autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </div>
          {steps && (
            <ol className="space-y-2 text-sm" aria-label={t('admin.ldap.steps')}>
              {steps.map((step) => (
                <li key={step.name} className="flex items-start gap-2">
                  {step.ok ? (
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-label={t('admin.ldap.stepOk')} />
                  ) : (
                    <CircleX
                      className="mt-0.5 size-4 shrink-0 text-destructive"
                      aria-label={t('admin.ldap.stepFailed')}
                    />
                  )}
                  <span className="min-w-0">
                    <strong>{step.name}</strong>: <span className="font-mono text-xs break-token">{step.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={!username} loading={run.isPending}>
            {t('admin.ldap.runTest')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function UserImport() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LdapUser[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const search = useMutation({
    mutationFn: () => api.searchLdap(query.trim()),
    onSuccess: (users) => {
      setResults(users ?? []);
      setSelected([]);
    },
    onError: (error) => notifyError(error, t('admin.ldap.searchFailed')),
  });
  const importUsers = useAdminMutation({
    mutationFn: (users: LdapUser[]) => api.importLdap(users),
    success: (r) =>
      r.skipped?.length
        ? t('admin.ldap.importedSkipped', { count: r.imported, skipped: r.skipped.join(', ') })
        : t('admin.ldap.imported', { count: r.imported }),
    invalidate: [queryKeys.admin.users],
    onSuccess: () => setSelected([]),
  });

  const columns: Column<LdapUser>[] = [
    {
      id: 'username',
      header: t('admin.users.username'),
      sortValue: (u) => u.username,
      cell: (u) => <span className="font-medium">{u.username}</span>,
    },
    {
      id: 'name',
      header: t('admin.users.displayName'),
      sortValue: (u) => u.displayName,
      cell: (u) => u.displayName || '–',
    },
    { id: 'email', header: t('admin.users.email'), cell: (u) => u.email || '–', className: 'text-muted-foreground' },
    {
      id: 'dn',
      header: 'DN',
      cell: (u) => <span className="font-mono text-xs break-token">{u.dn}</span>,
      className: 'max-w-sm text-muted-foreground',
    },
  ];

  return (
    <Card>
      <CardHeader title={t('admin.ldap.import')} description={t('admin.ldap.importBody')} />
      <CardContent className="space-y-3">
        <form
          role="search"
          aria-label={t('admin.ldap.import')}
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            search.mutate();
          }}
        >
          <Field label={t('admin.ldap.searchQuery')} id="ldap-query" className="min-w-56 flex-1">
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          </Field>
          <Button type="submit" loading={search.isPending}>
            <Search aria-hidden="true" />
            {t('admin.ldap.search')}
          </Button>
        </form>
        {results !== null && (
          <DataTable
            caption={t('admin.ldap.results')}
            rows={results}
            columns={columns}
            rowKey={(u) => u.username}
            rowLabel={(u) => u.username}
            selectable
            selected={selected}
            onSelectedChange={setSelected}
            toolbar={
              <Button
                variant="primary"
                size="sm"
                disabled={selected.length === 0}
                loading={importUsers.isPending}
                onClick={() => importUsers.mutate(results.filter((u) => selected.includes(u.username)))}
              >
                <UserPlus aria-hidden="true" />
                {t('admin.ldap.importSelected', { count: selected.length })}
              </Button>
            }
            empty={<EmptyState title={t('admin.ldap.noResults')} description={t('admin.ldap.noResultsBody')} />}
          />
        )}
      </CardContent>
    </Card>
  );
}
