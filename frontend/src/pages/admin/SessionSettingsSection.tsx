import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { api, type SessionSettings } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  ErrorState,
  Field,
  Input,
  LoadingRegion,
  Skeleton,
} from '@/components/ui';
import { useAdminMutation } from './common';

export default function SessionSettingsSection() {
  const settings = useQuery({ queryKey: queryKeys.admin.sessionSettings, queryFn: api.session });
  if (settings.isError)
    return (
      <Card>
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      </Card>
    );
  if (!settings.data)
    return (
      <LoadingRegion>
        <Skeleton className="h-56" />
      </LoadingRegion>
    );
  return <SettingsForm key={settings.dataUpdatedAt} initial={settings.data} />;
}

function SettingsForm({ initial }: { initial: SessionSettings }) {
  const { t } = useTranslation();
  const [idle, setIdle] = useState(String(initial.sessionMinutes));
  const [max, setMax] = useState(String(initial.maxHours));
  const [errors, setErrors] = useState<{ idle?: string; max?: string }>({});
  const save = useAdminMutation({
    mutationFn: (value: { sessionMinutes: number; maxHours: number }) => api.updateSession(value),
    success: t('admin.sessionSettings.saved'),
    invalidate: [queryKeys.admin.sessionSettings],
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const sessionMinutes = Number(idle);
    const maxHours = Number(max);
    const next: typeof errors = {};
    if (!Number.isInteger(sessionMinutes) || sessionMinutes < 5 || sessionMinutes > 1440)
      next.idle = t('admin.sessionSettings.idleRange');
    if (!Number.isInteger(maxHours) || maxHours < 1 || maxHours > 720) next.max = t('admin.sessionSettings.maxRange');
    setErrors(next);
    if (next.idle || next.max) {
      document.getElementById(next.idle ? 'session-idle' : 'session-max')?.focus();
      return;
    }
    save.mutate({ sessionMinutes, maxHours });
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader title={t('admin.sessionSettings.title')} description={t('admin.sessionSettings.body')} />
      <form noValidate onSubmit={submit}>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('admin.sessionSettings.idle')}
            id="session-idle"
            helper={t('admin.sessionSettings.idleHelper')}
            error={errors.idle}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={5}
              max={1440}
              value={idle}
              onChange={(e) => setIdle(e.target.value)}
            />
          </Field>
          <Field
            label={t('admin.sessionSettings.max')}
            id="session-max"
            helper={t('admin.sessionSettings.maxHelper')}
            error={errors.max}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={720}
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </Field>
        </CardContent>
        <CardFooter>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
