import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { History, Lock, Plus, RotateCcw, Send, Trash2, Wand2, X } from 'lucide-react';
import { api, isApiError, type ApiDefinition, type InvokeResponse } from '@/lib/api';
import { formatCountdown, formatDateTime, formatRelative } from '@/lib/format';
import {
  addHistory,
  clearHistory,
  readHistory,
  saveDetailsEnabled,
  setSaveDetails,
  type HistoryEntry,
} from '@/lib/history';
import {
  encodeBase64Utf8,
  exampleFromSchema,
  headerAllowed,
  isJsonContentType,
  isSensitiveHeader,
  parameterDefault,
  paramId,
  queryString,
  requestHeaders,
  resolvePath,
  resolveRef,
  stringifyExample,
  typeLabel,
  validateParameters,
  type HeaderRow,
  type NormalizedSpec,
  type Operation,
  type Parameter,
  type ValidationError,
} from '@/lib/openapi';
import { useFeatures } from '@/hooks/queries';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  FormErrorSummary,
  IconButton,
  Input,
  Kbd,
  PasswordInput,
  Select,
  Skeleton,
  StatusBadge,
  Switch,
} from '@/components/ui';
import { ResponseViewer } from './ResponseViewer';
import { Snippets } from './Snippets';

const CodeEditor = lazy(() => import('@/components/api/CodeEditor'));

/** The try-it console: who may use it is decided here, the form is per operation. */
export function TryItConsole({ spec, op, apiDef }: { spec: NormalizedSpec; op: Operation; apiDef: ApiDefinition }) {
  const { t } = useTranslation();
  const features = useFeatures();
  if (features.data && !features.data.tryIt)
    return <EmptyState icon={Send} title={t('api.tryItOffTitle')} description={t('api.tryItOff')} />;
  if (!apiDef.permissions?.invoke)
    return <EmptyState icon={Lock} title={t('api.noInvokeTitle')} description={t('api.noInvoke')} />;
  if (!apiDef.tryItEnabled || !apiDef.isActive)
    return <EmptyState icon={Send} title={t('api.tryItDisabledTitle')} description={t('api.tryItDisabled')} />;
  return <TryItForm key={op.key} spec={spec} op={op} apiDef={apiDef} />;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function initialBody(spec: NormalizedSpec, op: Operation, contentType: string) {
  const media = op.requestBody?.content.find((m) => m.contentType === contentType) ?? op.requestBody?.content[0];
  if (!media) return '';
  return stringifyExample(
    media.example ?? media.examples[0]?.value ?? exampleFromSchema(spec.raw, media.schema, 'request'),
  );
}

function TryItForm({ spec, op, apiDef }: { spec: NormalizedSpec; op: Operation; apiDef: ApiDefinition }) {
  const { t } = useTranslation();
  const raw = spec.raw;
  const allowed = useMemo(() => apiDef.allowedRequestHeaders ?? [], [apiDef.allowedRequestHeaders]);
  const injected = useMemo(() => apiDef.injectHeaderNames ?? [], [apiDef.injectHeaderNames]);
  const forwardAllX = !!apiDef.forwardAllXHeaders;
  const params = op.parameters.filter((p) => p.in !== 'cookie');
  const bodyTypes = op.requestBody?.content.map((m) => m.contentType) ?? [];
  const responseTypes = Array.from(new Set(op.responses.flatMap((r) => r.content.map((m) => m.contentType))));

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map((p) => [paramId(p), parameterDefault(raw, p)])),
  );
  const [extra, setExtra] = useState<HeaderRow[]>([]);
  const [accept, setAccept] = useState(responseTypes[0] ?? 'application/json');
  const [contentType, setContentType] = useState(bodyTypes[0] ?? '');
  const [body, setBody] = useState(() => initialBody(spec, op, bodyTypes[0] ?? ''));
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  // After a send attempt every error shows (with the summary); before, only touched fields.
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<{ response: InvokeResponse; durationMs: number } | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [history, setHistory] = useState<HistoryEntry[]>(() => readHistory(apiDef.id, op.key));
  const [saveDetails, setSaveDetailsState] = useState(saveDetailsEnabled);
  const abort = useRef<AbortController | null>(null);
  const responseHeading = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!retryUntil) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryUntil]);
  useEffect(() => () => abort.current?.abort(), []);
  const waitSeconds = retryUntil ? Math.max(0, (retryUntil - now) / 1000) : 0;

  const withBody = !!op.requestBody && bodyTypes.length > 0;
  const path = resolvePath(op.path, params, values);
  const query = queryString(params, values);
  const headers = requestHeaders(op, values, extra, accept, contentType, withBody);
  const visibleErrors = submitted ? errors : errors.filter((e) => touched.has(e.id));

  function errorText(e: ValidationError) {
    return t(`api.validation.${e.message}`, { name: e.name });
  }

  function validate(): ValidationError[] {
    const found = validateParameters(raw, params, values);
    if (withBody && isJsonContentType(contentType) && body.trim()) {
      try {
        JSON.parse(body);
      } catch {
        found.push({ id: 'body', name: t('api.requestBody'), message: 'json' });
      }
    }
    return found;
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (sending || waitSeconds > 0) return;
    const found = validate();
    setSubmitted(true);
    setErrors(found);
    if (found.length) return;
    const controller = new AbortController();
    abort.current = controller;
    setSending(true);
    setFailure(null);
    setResult(null);
    setAnnouncement(t('api.sending'));
    const started = performance.now();
    try {
      const response = await api.invoke(
        String(apiDef.id),
        { method: op.method, path, query, headers, bodyBase64: withBody && body ? encodeBase64Utf8(body) : '' },
        controller.signal,
      );
      const durationMs = response.durationMs ?? performance.now() - started;
      setResult({ response, durationMs });
      setAnnouncement(t('api.responseReceived', { status: response.statusCode, ms: Math.round(durationMs) }));
      setHistory(
        addHistory(
          apiDef.id,
          op.key,
          { at: new Date().toISOString(), method: op.method, path: op.path, status: response.statusCode, durationMs },
          { values, body },
        ),
      );
      window.requestAnimationFrame(() => responseHeading.current?.focus());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setAnnouncement(t('api.cancelled'));
        return;
      }
      setFailure(error);
      setAnnouncement(t('api.sendFailed'));
      if (isApiError(error, 429) && error.retryAfter) {
        setRetryUntil(Date.now() + error.retryAfter * 1000);
        setNow(Date.now());
      }
    } finally {
      setSending(false);
      abort.current = null;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  }

  function restore(entry: HistoryEntry) {
    if (entry.values) setValues(entry.values);
    if (entry.body !== undefined) setBody(entry.body);
    formRef.current?.querySelector<HTMLElement>('input, select, button')?.focus();
  }

  const groups = (['path', 'query', 'header'] as const)
    .map((loc) => [loc, params.filter((p) => p.in === loc)] as const)
    .filter(([, list]) => list.length);
  const headerSuggestions = allowed.filter(
    (name) => !params.some((p) => p.in === 'header' && p.name.toLowerCase() === name.toLowerCase()),
  );

  return (
    <div className="min-w-0 space-y-6">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {/* ⌘↵ / Ctrl↵ from any control in the form sends it (the keys reach the form by bubbling). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <form
        ref={formRef}
        onSubmit={send}
        onKeyDown={onKeyDown}
        noValidate
        className="space-y-5"
        aria-labelledby="tryit-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="tryit-heading" className="text-sm font-semibold">
            {t('api.tryIt')}
          </h3>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
            <Kbd>↵</Kbd> {t('api.toSend')}
          </span>
        </div>

        {submitted && errors.length > 0 && (
          <FormErrorSummary
            errors={errors.map((e) => ({
              field: e.id === 'body' ? 'tryit-body' : `param-${e.id}`,
              message: errorText(e),
            }))}
          />
        )}

        {groups.map(([loc, list]) => (
          <fieldset key={loc} className="min-w-0 space-y-3">
            <legend className="mb-2 text-[13px] font-semibold">{t(`api.groups.${loc}`)}</legend>
            {list.map((p) => (
              <ParamField
                key={paramId(p)}
                spec={spec}
                p={p}
                value={values[paramId(p)] ?? ''}
                onChange={(v) => setValues((prev) => ({ ...prev, [paramId(p)]: v }))}
                onBlur={() => {
                  setTouched((prev) => new Set(prev).add(paramId(p)));
                  setErrors(validate());
                }}
                error={visibleErrors.find((e) => e.id === paramId(p))}
                errorText={errorText}
                warn={
                  loc === 'header' &&
                  !headerAllowed(p.name, allowed, forwardAllX) &&
                  !injected.some((n) => n.toLowerCase() === p.name.toLowerCase())
                    ? t('api.headerNotForwarded')
                    : undefined
                }
                locked={loc === 'header' && injected.some((n) => n.toLowerCase() === p.name.toLowerCase())}
              />
            ))}
          </fieldset>
        ))}

        <fieldset className="min-w-0 space-y-3">
          <legend className="mb-2 text-[13px] font-semibold">{t('api.headers')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Accept" id="tryit-accept">
              <Select
                value={accept}
                onValueChange={setAccept}
                options={(responseTypes.length ? responseTypes : ['application/json']).map((v) => ({
                  value: v,
                  label: v,
                }))}
              />
            </Field>
            {withBody && (
              <Field label="Content-Type" id="tryit-content-type">
                <Select
                  value={contentType}
                  onValueChange={(v) => {
                    setContentType(v);
                    setBody(initialBody(spec, op, v));
                  }}
                  options={bodyTypes.map((v) => ({ value: v, label: v }))}
                />
              </Field>
            )}
          </div>
          {injected.length > 0 && (
            <ul className="space-y-1" aria-label={t('api.injectedHeaders')}>
              {injected.map((name) => (
                <li
                  key={name}
                  className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[13px]"
                >
                  <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  <code className="font-mono">{name}</code>
                  <span className="text-muted-foreground">{t('api.headerInjected')}</span>
                </li>
              ))}
            </ul>
          )}
          {extra.map((row, index) => {
            const blocked = row.name.trim() !== '' && !headerAllowed(row.name.trim(), allowed, forwardAllX);
            const update = (patch: Partial<HeaderRow>) =>
              setExtra((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
            return (
              <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2">
                <div>
                  <Input
                    aria-label={t('api.headerName', { index: index + 1 })}
                    list="tryit-header-names"
                    className="font-mono text-[13px]"
                    value={row.name}
                    placeholder={headerSuggestions[0] ?? 'X-Header'}
                    onChange={(e) => update({ name: e.target.value })}
                    aria-invalid={blocked || undefined}
                    aria-describedby={blocked ? `tryit-header-${index}-warn` : undefined}
                  />
                  {blocked && (
                    <p id={`tryit-header-${index}-warn`} className="mt-1 text-xs text-warning">
                      {t('api.headerNotForwarded')}
                    </p>
                  )}
                </div>
                {isSensitiveHeader(row.name) ? (
                  <PasswordInput
                    aria-label={t('api.headerValue', { index: index + 1 })}
                    autoComplete="off"
                    value={row.value}
                    onChange={(e) => update({ value: e.target.value })}
                  />
                ) : (
                  <Input
                    aria-label={t('api.headerValue', { index: index + 1 })}
                    value={row.value}
                    onChange={(e) => update({ value: e.target.value })}
                  />
                )}
                <IconButton
                  label={t('api.removeHeader', { index: index + 1 })}
                  icon={<X aria-hidden="true" />}
                  onClick={() => setExtra((prev) => prev.filter((_, i) => i !== index))}
                />
              </div>
            );
          })}
          <datalist id="tryit-header-names">
            {headerSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => setExtra((prev) => [...prev, { name: headerSuggestions[prev.length] ?? '', value: '' }])}
            >
              <Plus aria-hidden="true" />
              {t('api.addHeader')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {allowed.length || forwardAllX
                ? t('api.allowedHeadersList', { list: [...allowed, ...(forwardAllX ? ['X-*'] : [])].join(', ') })
                : t('api.noExtraHeaders')}
            </span>
          </div>
        </fieldset>

        {withBody && (
          <fieldset className="min-w-0 space-y-2">
            <legend className="mb-2 text-[13px] font-semibold">
              {t('api.requestBody')}
              {op.requestBody?.required && <span className="ml-1 text-destructive">*</span>}
            </legend>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => setBody(initialBody(spec, op, contentType))}>
                <RotateCcw aria-hidden="true" />
                {t('api.resetExample')}
              </Button>
              {isJsonContentType(contentType) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    try {
                      setBody(JSON.stringify(JSON.parse(body), null, 2));
                    } catch {
                      setErrors(validate());
                    }
                  }}
                >
                  <Wand2 aria-hidden="true" />
                  {t('api.format')}
                </Button>
              )}
            </div>
            <div id="tryit-body">
              <Suspense fallback={<Skeleton className="h-40" />}>
                <CodeEditor
                  value={body}
                  onChange={setBody}
                  language={isJsonContentType(contentType) ? 'json' : 'text'}
                  label={t('api.requestBody')}
                  onSubmit={() => void send()}
                />
              </Suspense>
            </div>
            {errors.some((e) => e.id === 'body') && (
              <p className="text-xs font-medium text-destructive">{t('api.validation.json')}</p>
            )}
          </fieldset>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="accent" loading={sending} disabled={waitSeconds > 0}>
            <Send aria-hidden="true" />
            {t('api.send')}
          </Button>
          {sending && (
            <Button onClick={() => abort.current?.abort()}>
              <X aria-hidden="true" />
              {t('common.cancel')}
            </Button>
          )}
          <code className="min-w-0 font-mono text-xs text-muted-foreground break-token">
            {op.method} {path}
            {query ? `?${query}` : ''}
          </code>
        </div>
      </form>

      {waitSeconds > 0 && (
        <Alert variant="warning" role="status" title={t('api.errors.rateLimitedTitle')}>
          {t('api.errors.rateLimited', { time: formatCountdown(waitSeconds) })}
        </Alert>
      )}
      {failure !== null && !(isApiError(failure, 429) && waitSeconds > 0) && (
        <ProxyFailure error={failure} apiDef={apiDef} />
      )}
      {result && (
        <ResponseViewer
          ref={responseHeading}
          result={result.response}
          durationMs={result.durationMs}
          fileName={`${apiDef.slug}-${op.operationId ?? op.method.toLowerCase()}`}
        />
      )}

      <Snippets
        input={{
          method: op.method,
          url: path + (query ? `?${query}` : ''),
          headers,
          injected,
          body: withBody ? body : '',
          baseUrl: apiDef.internalBaseUrl,
        }}
      />

      <section aria-labelledby="history-heading" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="history-heading" className="flex items-center gap-1.5 text-sm font-semibold">
            <History className="size-4" aria-hidden="true" />
            {t('api.history')}
          </h3>
          {history.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearHistory(apiDef.id, op.key);
                setHistory([]);
              }}
            >
              <Trash2 aria-hidden="true" />
              {t('api.clearHistory')}
            </Button>
          )}
        </div>
        <Switch
          label={t('api.saveDetails')}
          description={t('api.saveDetailsHelper')}
          checked={saveDetails}
          onCheckedChange={(on) => {
            setSaveDetails(on);
            setSaveDetailsState(on);
          }}
        />
        {history.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t('api.noHistory')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {history.map((entry, i) => (
              <li key={`${entry.at}-${i}`} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-[13px]">
                <StatusBadge status={entry.status} />
                <span className="tabular-nums text-muted-foreground" title={formatDateTime(entry.at)}>
                  {formatRelative(entry.at)}
                </span>
                {entry.durationMs !== undefined && (
                  <span className="tabular-nums text-muted-foreground">{Math.round(entry.durationMs)} ms</span>
                )}
                {entry.values || entry.body !== undefined ? (
                  <Button size="sm" variant="link" className="ml-auto" onClick={() => restore(entry)}>
                    {t('api.restore')}
                  </Button>
                ) : (
                  <Badge variant="outline" className="ml-auto">
                    {t('api.noDetailsSaved')}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ParamField({
  spec,
  p,
  value,
  onChange,
  onBlur,
  error,
  errorText,
  warn,
  locked,
}: {
  spec: NormalizedSpec;
  p: Parameter;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: ValidationError;
  errorText: (e: ValidationError) => string;
  warn?: string;
  locked: boolean;
}) {
  const { t } = useTranslation();
  const schema = resolveRef(spec.raw, p.schema) ?? {};
  const type = Array.isArray(schema.type) ? schema.type.find((x: string) => x !== 'null') : schema.type;
  const id = `param-${paramId(p)}`;
  const helper = [typeLabel(spec.raw, p.schema), schema.format === 'date-time' && t('api.dateTimeHint'), warn]
    .filter(Boolean)
    .join(' · ');
  const label = <span className="font-mono text-[13px]">{p.name}</span>;
  if (locked) {
    return (
      <p className="flex items-center gap-2 text-[13px]">
        <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
        {label}
        <span className="text-muted-foreground">{t('api.headerInjected')}</span>
      </p>
    );
  }
  const control =
    Array.isArray(schema.enum) && schema.enum.length ? (
      <Select
        value={value}
        onValueChange={(v) => {
          onChange(v);
          onBlur();
        }}
        options={[
          ...(p.required ? [] : [{ value: '', label: t('api.notSet') }]),
          ...schema.enum.map((v: unknown) => ({ value: String(v), label: String(v) })),
        ]}
      />
    ) : type === 'boolean' ? (
      <Select
        value={value}
        onValueChange={(v) => {
          onChange(v);
          onBlur();
        }}
        options={[
          ...(p.required ? [] : [{ value: '', label: t('api.notSet') }]),
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' },
        ]}
      />
    ) : isSensitiveHeader(p.name) && p.in === 'header' ? (
      <PasswordInput autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    ) : (
      <Input
        value={value}
        inputMode={type === 'integer' || type === 'number' ? 'decimal' : undefined}
        className="font-mono text-[13px]"
        spellCheck={false}
        placeholder={schema.format === 'date-time' ? '2026-01-31T09:30:00Z' : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    );
  return (
    <Field
      id={id}
      label={label}
      required={p.required}
      helper={[helper, p.description].filter(Boolean).join(' — ') || undefined}
      error={error ? errorText(error) : undefined}
    >
      {control}
    </Field>
  );
}

/** Portal-side refusals, in words: allow-lists, rate limits, timeouts, reachability. */
function ProxyFailure({ error, apiDef }: { error: unknown; apiDef: ApiDefinition }) {
  const { t } = useTranslation();
  const message = error instanceof Error ? error.message : String(error);
  let title = t('api.sendFailed');
  let body: React.ReactNode = message;
  if (isApiError(error)) {
    if (error.status === 0) {
      title = t('errors.networkTitle');
      body = t('errors.networkBody');
    } else if (error.status === 403) {
      title = t('api.errors.forbiddenTitle');
    } else if (error.code === 'upstream_timeout' || error.status === 504) {
      title = t('api.errors.timeoutTitle');
      body = t('api.errors.timeout', { seconds: apiDef.timeoutSeconds || 30 });
    } else if (error.code === 'upstream_error' || error.status === 502) {
      title = t('api.errors.unreachableTitle');
      body = t('api.errors.unreachable');
    } else if (/allowlist|not allowed/i.test(message)) {
      title = t('api.errors.policyTitle');
      body = (
        <>
          {message}
          {(apiDef.allowedPathPrefixes ?? []).length > 0 && (
            <span className="mt-1 block">
              {t('api.errors.allowedPaths', { list: apiDef.allowedPathPrefixes!.join(', ') })}
            </span>
          )}
          {(apiDef.allowedMethods ?? []).length > 0 && (
            <span className="mt-1 block">
              {t('api.errors.allowedMethods', { list: apiDef.allowedMethods.join(', ') })}
            </span>
          )}
        </>
      );
    }
  }
  return (
    <Alert variant="destructive" role="alert" title={title}>
      {body}
      {isApiError(error) && error.requestId && (
        <span className="mt-1 block text-xs">
          {t('errors.requestId')}: <code className="font-mono select-all">{error.requestId}</code>
        </span>
      )}
    </Alert>
  );
}
