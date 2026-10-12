import { lazy, Suspense, useMemo, useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FileWarning, Send } from 'lucide-react';
import { api, isApiError, type ApiDefinition, type InvokeResponse } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import {
  beautifyBody,
  buildHeaders,
  buildParamDefaults,
  buildQueryString,
  buildResolvedPath,
  decodeBase64Utf8,
  encodeBase64Utf8,
  parseOperations,
  type OperationOption,
  type OperationParameter,
  type SpecObject,
} from '@/lib/openapi';
import { useApiDetails, useApiSpec, useFeatures } from '@/hooks/queries';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { SectionPanel } from '@/components/shell/shell-context';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CodeBlock,
  EmptyState,
  ErrorState,
  Field,
  Input,
  KeyValueList,
  LoadingRegion,
  MethodBadge,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TableContainer,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
} from '@/components/ui';

const SwaggerDocs = lazy(() => import('@/components/SwaggerDocs'));

export default function ApiDetailsPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const details = useApiDetails(id);
  const spec = useApiSpec(id);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'try';
  useDocumentTitle(details.data?.name ?? t('api.title'));

  const operations = useMemo(() => parseOperations((spec.data as SpecObject) ?? null), [spec.data]);
  const operationId = params.get('op') ?? operations[0]?.id ?? '';
  const selected = operations.find((op) => op.id === operationId) ?? operations[0] ?? null;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  }

  if (details.isPending) {
    return (
      <LoadingRegion className="space-y-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-96" />
      </LoadingRegion>
    );
  }
  if (details.isError) {
    return (
      <Card>
        <ErrorState error={details.error} onRetry={() => void details.refetch()} />
      </Card>
    );
  }

  const apiDef = details.data;
  const canInvoke = !!apiDef.permissions?.invoke;

  return (
    <>
      <SectionPanel title={t('api.operations')}>
        <OperationList
          operations={operations}
          loading={spec.isPending}
          selectedId={selected?.id ?? ''}
          onSelect={(op) => {
            const next = new URLSearchParams(params);
            next.set('op', op.id);
            next.set('tab', 'try');
            setParams(next, { replace: true });
          }}
        />
      </SectionPanel>

      <PageHeader
        breadcrumbs={[{ label: t('catalog.title'), to: '/' }, { label: apiDef.name }]}
        title={apiDef.name}
        description={apiDef.description}
        meta={
          <>
            <Badge variant={canInvoke ? 'success' : 'info'}>
              {canInvoke ? t('catalog.accessLevel.invoke') : t('catalog.accessLevel.view')}
            </Badge>
            {apiDef.ownerTeam && <Badge variant="outline">{apiDef.ownerTeam}</Badge>}
            <SpecFreshness api={apiDef} />
          </>
        }
      />

      <Tabs value={tab} onValueChange={(value) => setParam('tab', value)}>
        <TabsList label={t('api.sections')}>
          <TabsTrigger value="try">{t('api.tryIt')}</TabsTrigger>
          <TabsTrigger value="docs">{t('api.documentation')}</TabsTrigger>
          <TabsTrigger value="details">{t('api.details')}</TabsTrigger>
        </TabsList>
        <TabsContent value="try">
          <TryIt api={apiDef} operation={selected} specState={spec} operationsCount={operations.length} />
        </TabsContent>
        <TabsContent value="docs">
          <Card>
            <CardContent>
              {spec.isPending ? (
                <LoadingRegion>
                  <Skeleton className="h-96" />
                </LoadingRegion>
              ) : spec.isError ? (
                <ErrorState error={spec.error} onRetry={() => void spec.refetch()} />
              ) : (
                <Suspense
                  fallback={
                    <LoadingRegion>
                      <Skeleton className="h-96" />
                    </LoadingRegion>
                  }
                >
                  <SwaggerDocs spec={spec.data as SpecObject} />
                </Suspense>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="details">
          <Card>
            <CardContent className="py-1">
              <KeyValueList
                items={[
                  { label: t('catalog.slug'), value: apiDef.slug, mono: true },
                  {
                    label: t('api.allowedMethods'),
                    value: apiDef.allowedMethods?.length
                      ? apiDef.allowedMethods.join(', ')
                      : t('api.allDocumentedMethods'),
                  },
                  {
                    label: t('api.allowedPaths'),
                    value: apiDef.allowedPathPrefixes?.length
                      ? apiDef.allowedPathPrefixes.join(', ')
                      : t('api.allDocumentedPaths'),
                    mono: !!apiDef.allowedPathPrefixes?.length,
                  },
                  { label: t('catalog.tags'), value: apiDef.tags?.length ? apiDef.tags.join(', ') : '–' },
                  { label: t('api.tryIt'), value: apiDef.tryItEnabled ? t('common.enabled') : t('common.disabled') },
                  {
                    label: t('api.rateLimit'),
                    value: apiDef.rateLimitPerMinute
                      ? t('api.perMinute', { count: apiDef.rateLimitPerMinute })
                      : t('api.defaultLimit'),
                  },
                  {
                    label: t('api.lastRefresh'),
                    value: apiDef.lastSpecRefreshAt
                      ? formatDateTime(apiDef.lastSpecRefreshAt)
                      : t('api.neverRefreshed'),
                  },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function SpecFreshness({ api: apiDef }: { api: ApiDefinition }) {
  const { t } = useTranslation();
  if (!apiDef.lastSpecRefreshAt) return <Badge variant="warning">{t('api.neverRefreshed')}</Badge>;
  const ok = !apiDef.lastSpecStatus || /^(ok|success|200)/i.test(apiDef.lastSpecStatus);
  return (
    <Badge variant={ok ? 'neutral' : 'warning'} title={formatDateTime(apiDef.lastSpecRefreshAt)}>
      {t('api.specRefreshed', { when: formatRelative(apiDef.lastSpecRefreshAt) })}
      {!ok && ` · ${apiDef.lastSpecStatus}`}
    </Badge>
  );
}

function OperationList({
  operations,
  loading,
  selectedId,
  onSelect,
}: {
  operations: OperationOption[];
  loading: boolean;
  selectedId: string;
  onSelect: (op: OperationOption) => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const visible = operations.filter((op) => !q || `${op.method} ${op.path} ${op.summary}`.toLowerCase().includes(q));
    const byTag = new Map<string, OperationOption[]>();
    visible.forEach((op) => {
      const tag = op.tags[0] ?? t('api.untagged');
      byTag.set(tag, [...(byTag.get(tag) ?? []), op]);
    });
    return Array.from(byTag.entries());
  }, [operations, filter, t]);

  if (loading) {
    return (
      <LoadingRegion className="space-y-2 px-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-7" />
        ))}
      </LoadingRegion>
    );
  }
  if (operations.length === 0) {
    return <p className="px-2 text-[13px] text-muted-foreground">{t('api.noOperations')}</p>;
  }
  return (
    <div className="space-y-3">
      <div className="px-1">
        <label htmlFor="operation-filter" className="sr-only">
          {t('api.filterOperations')}
        </label>
        <Input
          id="operation-filter"
          type="search"
          className="h-8"
          placeholder={t('api.filterOperations')}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      {groups.length === 0 && <p className="px-2 text-[13px] text-muted-foreground">{t('api.noOperationMatch')}</p>}
      {groups.map(([tag, ops]) => (
        <section key={tag} aria-label={tag}>
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{tag}</p>
          <ul className="space-y-0.5">
            {ops.map((op) => (
              <li key={op.id}>
                <button
                  type="button"
                  onClick={() => onSelect(op)}
                  aria-current={op.id === selectedId ? 'true' : undefined}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted',
                    op.id === selectedId && 'bg-muted',
                  )}
                  title={op.summary || undefined}
                >
                  <MethodBadge method={op.method} className="min-w-[3rem]" />
                  <span className="min-w-0 font-mono text-xs break-token">{op.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TryIt({
  api: apiDef,
  operation,
  specState,
  operationsCount,
}: {
  api: ApiDefinition;
  operation: OperationOption | null;
  specState: ReturnType<typeof useApiSpec>;
  operationsCount: number;
}) {
  const { t } = useTranslation();
  const features = useFeatures();

  if (features.data && !features.data.tryIt) {
    return <Alert variant="info">{t('api.tryItOff')}</Alert>;
  }
  if (!apiDef.permissions?.invoke || !apiDef.tryItEnabled) {
    return <Alert variant="info">{t('api.tryItNotAllowed')}</Alert>;
  }
  if (specState.isPending) {
    return (
      <LoadingRegion>
        <Skeleton className="h-80" />
      </LoadingRegion>
    );
  }
  if (specState.isError) {
    return (
      <Card>
        <ErrorState error={specState.error} onRetry={() => void specState.refetch()} />
      </Card>
    );
  }
  if (!operation || operationsCount === 0) {
    return (
      <Card>
        <EmptyState icon={FileWarning} title={t('api.noOperations')} description={t('api.noOperationsBody')} />
      </Card>
    );
  }

  return <TryItForm key={operation.id} apiDef={apiDef} operation={operation} />;
}

/** Remounted per operation, so parameters and body start from that operation's examples. */
function TryItForm({ apiDef, operation }: { apiDef: ApiDefinition; operation: OperationOption }) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>(() => buildParamDefaults(operation));
  const [contentType, setContentType] = useState(operation.requestContentTypes[0] ?? '');
  const [accept, setAccept] = useState(operation.responseContentTypes[0] ?? 'application/json');
  const [extraHeaders, setExtraHeaders] = useState('');
  const [body, setBody] = useState(operation.requestBodyExample);
  const [missing, setMissing] = useState<string[]>([]);
  const [result, setResult] = useState<InvokeResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);

  const prettyBody = useMemo(
    () => (result ? beautifyBody(decodeBase64Utf8(result.bodyBase64), result.contentType) : ''),
    [result],
  );

  const pathParams = operation.parameters.filter((p) => p.in === 'path');
  const queryParams = operation.parameters.filter((p) => p.in === 'query');
  const headerParams = operation.parameters.filter((p) => p.in === 'header');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const required = operation.parameters.filter((p) => p.required && !values[p.id]?.trim()).map((p) => p.id);
    setMissing(required);
    if (required.length) {
      document.getElementById(`param-${required[0]}`)?.focus();
      return;
    }
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const response = await api.invoke(String(apiDef.id), {
        method: operation.method,
        path: buildResolvedPath(operation.path, pathParams, values),
        query: buildQueryString(queryParams, values),
        headers: buildHeaders(headerParams, values, extraHeaders, accept, contentType, operation.hasRequestBody),
        bodyBase64: body ? encodeBase64Utf8(body) : '',
      });
      setResult(response);
    } catch (invokeError) {
      setError(invokeError);
    } finally {
      setSending(false);
    }
  }

  const acceptOptions = (
    operation.responseContentTypes.length ? operation.responseContentTypes : ['application/json']
  ).map((v) => ({ value: v, label: v }));

  return (
    <div className="grid min-w-0 gap-5 2xl:grid-cols-2">
      <Card>
        <CardHeader
          title={
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <MethodBadge method={operation.method} />
              <span className="font-mono text-sm break-token">{operation.path}</span>
            </span>
          }
          description={operation.summary || operation.description || undefined}
        />
        <CardContent>
          <form onSubmit={submit} noValidate className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('api.accept')} helper={t('api.acceptHelper')}>
                <Select value={accept} onValueChange={setAccept} options={acceptOptions} />
              </Field>
              {operation.hasRequestBody && operation.requestContentTypes.length > 0 ? (
                <Field label={t('api.contentType')} helper={t('api.contentTypeHelper')}>
                  <Select
                    value={contentType}
                    onValueChange={setContentType}
                    options={operation.requestContentTypes.map((v) => ({ value: v, label: v }))}
                  />
                </Field>
              ) : null}
            </div>
            <ParameterGroup
              title={t('api.pathParameters')}
              params={pathParams}
              values={values}
              onChange={setValues}
              missing={missing}
            />
            <ParameterGroup
              title={t('api.queryParameters')}
              params={queryParams}
              values={values}
              onChange={setValues}
              missing={missing}
            />
            <ParameterGroup
              title={t('api.headerParameters')}
              params={headerParams}
              values={values}
              onChange={setValues}
              missing={missing}
            />
            {operation.hasRequestBody && (
              <Field label={t('api.requestBody')} helper={t('api.requestBodyHelper')}>
                <Textarea
                  rows={10}
                  className="font-mono text-xs"
                  spellCheck={false}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </Field>
            )}
            <Field label={t('api.extraHeaders')} helper={t('api.extraHeadersHelper')} optional>
              <Textarea
                rows={3}
                className="font-mono text-xs"
                spellCheck={false}
                value={extraHeaders}
                onChange={(e) => setExtraHeaders(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="accent" loading={sending}>
              <Send aria-hidden="true" />
              {t('api.send')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="min-w-0" aria-live="polite">
        {error !== null && (
          <Alert variant="destructive" role="alert" title={t('api.sendFailed')}>
            {error instanceof Error ? error.message : String(error)}
            {isApiError(error) && error.requestId && (
              <span className="mt-1 block text-xs">
                {t('errors.requestId')}: <code className="font-mono select-all">{error.requestId}</code>
              </span>
            )}
          </Alert>
        )}
        {result ? (
          <Card>
            <CardHeader
              title={t('api.response')}
              actions={
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={result.statusCode} />
                  {result.durationMs !== undefined && (
                    <Badge variant="outline">{formatNumber(result.durationMs)} ms</Badge>
                  )}
                  <Badge variant="outline">{t('api.bytes', { count: result.responseBytes })}</Badge>
                  {result.truncated && <Badge variant="warning">{t('api.truncated')}</Badge>}
                  {result.rateLimit && (
                    <Badge variant={result.rateLimit.remaining <= 1 ? 'warning' : 'outline'}>
                      {t('api.rateLeft', {
                        remaining: result.rateLimit.remaining,
                        limit: result.rateLimit.limitPerMinute,
                      })}
                    </Badge>
                  )}
                </div>
              }
            />
            <CardContent className="space-y-4">
              <CodeBlock code={prettyBody || t('api.emptyBody')} label={result.contentType || t('api.body')} />
              <TableContainer>
                <Table>
                  <caption className="sr-only">{t('api.responseHeaders')}</caption>
                  <THead>
                    <tr>
                      <TH>{t('api.header')}</TH>
                      <TH>{t('api.value')}</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {Object.entries(result.headers ?? {}).map(([name, value]) => (
                      <TR key={name}>
                        <TD className="font-mono text-xs whitespace-nowrap">{name}</TD>
                        <TD className="text-xs break-token">{value}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        ) : (
          !error && (
            <div className="rounded-lg border border-dashed border-border">
              <EmptyState icon={Send} title={t('api.noResponseYet')} description={t('api.noResponseYetBody')} />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function ParameterGroup({
  title,
  params,
  values,
  onChange,
  missing,
}: {
  title: string;
  params: OperationParameter[];
  values: Record<string, string>;
  onChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  missing: string[];
}) {
  const { t } = useTranslation();
  if (params.length === 0) return null;
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="mb-2 text-sm font-semibold">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {params.map((param) => (
          <Field
            key={param.id}
            id={`param-${param.id}`}
            label={<span className="font-mono text-[13px]">{param.name}</span>}
            helper={param.description || param.type}
            required={param.required}
            error={missing.includes(param.id) ? t('api.paramRequired', { name: param.name }) : undefined}
          >
            <Input
              value={values[param.id] ?? ''}
              onChange={(event) => onChange((prev) => ({ ...prev, [param.id]: event.target.value }))}
              className="font-mono text-[13px]"
              spellCheck={false}
            />
          </Field>
        ))}
      </div>
    </fieldset>
  );
}
