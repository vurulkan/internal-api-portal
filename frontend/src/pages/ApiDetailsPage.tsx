import type { Dispatch, SetStateAction } from 'react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Copy, Check } from 'lucide-react';
import SwaggerUI from 'swagger-ui-react';
import { Alert, Badge, Button, FieldWrap, NativeSelect, Textarea, cn, fieldBase } from '../components/ui';
import { api, ApiDefinition, InvokeResponse } from '../services/api';

type SpecObject = Record<string, any>;

type OperationParameter = {
  id: string;
  name: string;
  in: 'path' | 'query' | 'header';
  description: string;
  required: boolean;
  defaultValue: string;
  type: string;
};

type OperationOption = {
  id: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  tags: string[];
  parameters: OperationParameter[];
  requestContentTypes: string[];
  responseContentTypes: string[];
  requestBodyExample: string;
  hasRequestBody: boolean;
};

const supportedMethods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

const methodColors: Record<string, string> = {
  GET:     'bg-green-50 text-green-700 border-green-200',
  POST:    'bg-blue-50 text-blue-700 border-blue-200',
  PUT:     'bg-amber-50 text-amber-700 border-amber-200',
  PATCH:   'bg-amber-50 text-amber-700 border-amber-200',
  DELETE:  'bg-red-50 text-red-700 border-red-200',
  OPTIONS: 'bg-gray-50 text-gray-600 border-gray-200',
  HEAD:    'bg-gray-50 text-gray-600 border-gray-200',
};

function MethodBadge({ method }: { method: string }) {
  const cls = methodColors[method] ?? 'bg-gray-50 text-gray-600 border-gray-200';
  return (
    <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-mono font-bold', cls)}>
      {method}
    </span>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-800">{value}</span>
    </div>
  );
}

function OperationSummary({ operation }: { operation: OperationOption }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <MethodBadge method={operation.method} />
        <span className="font-mono text-xs text-gray-600">{operation.path}</span>
        {operation.tags.map((tag) => (
          <span key={tag} className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">{tag}</span>
        ))}
      </div>
      {operation.summary && <p className="text-sm font-medium text-gray-800">{operation.summary}</p>}
      {operation.description && <p className="mt-0.5 text-xs text-gray-500">{operation.description}</p>}
    </div>
  );
}

function ParameterSection({
  title,
  parameters,
  values,
  onChange,
}: {
  title: string;
  parameters: OperationParameter[];
  values: Record<string, string>;
  onChange: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-gray-700">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {parameters.map((param) => (
          <FieldWrap
            key={param.id}
            label={param.name}
            helperText={param.description || `${param.in} parameter${param.required ? ' • required' : ''}`}
            required={param.required}
          >
            <input
              type="text"
              required={param.required}
              value={values[param.id] ?? ''}
              onChange={(e) => onChange((prev) => ({ ...prev, [param.id]: e.target.value }))}
              className={fieldBase}
            />
          </FieldWrap>
        ))}
      </div>
    </div>
  );
}

export function ApiDetailsPage() {
  const { id = '' } = useParams();
  const [details, setDetails] = useState<ApiDefinition | null>(null);
  const [spec, setSpec] = useState<SpecObject | null>(null);
  const [selectedOperationId, setSelectedOperationId] = useState('');
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [contentType, setContentType] = useState('');
  const [acceptType, setAcceptType] = useState('application/json');
  const [additionalHeaders, setAdditionalHeaders] = useState('');
  const [requestBody, setRequestBody] = useState('');
  const [selectedOperationTag, setSelectedOperationTag] = useState('__all__');
  const [result, setResult] = useState<InvokeResponse | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setError('');
    setResult(null);
    api.apiDetails(id).then(setDetails).catch((err) => setError(err.message));
    api.apiSpec(id).then(setSpec).catch((err) => setError(err.message));
  }, [id]);

  const operations = useMemo(() => parseOperations(spec), [spec]);

  const operationTags = useMemo(() => {
    const tags = new Set<string>();
    operations.forEach((op) => op.tags.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [operations]);

  const visibleOperations = useMemo(() => {
    if (selectedOperationTag === '__all__') return operations;
    return operations.filter((op) => op.tags.includes(selectedOperationTag));
  }, [operations, selectedOperationTag]);

  const selectedOperation = useMemo(
    () => visibleOperations.find((op) => op.id === selectedOperationId) ?? visibleOperations[0] ?? null,
    [visibleOperations, selectedOperationId]
  );

  useEffect(() => {
    if (selectedOperationTag !== '__all__' && !operationTags.includes(selectedOperationTag)) {
      setSelectedOperationTag('__all__');
    }
  }, [operationTags, selectedOperationTag]);

  useEffect(() => {
    if (!selectedOperation) {
      setSelectedOperationId('');
      return;
    }
    setSelectedOperationId(selectedOperation.id);
    setParamValues(buildParamDefaults(selectedOperation));
    setContentType(selectedOperation.requestContentTypes[0] ?? '');
    setAcceptType(selectedOperation.responseContentTypes[0] ?? 'application/json');
    setRequestBody(selectedOperation.requestBodyExample);
    setAdditionalHeaders('');
  }, [selectedOperation?.id]);

  const prettyBody = useMemo(() => {
    if (!result) return '';
    return beautifyBody(decodeBase64Utf8(result.bodyBase64), result.contentType);
  }, [result]);

  const pathParams = selectedOperation?.parameters.filter((p) => p.in === 'path') ?? [];
  const queryParams = selectedOperation?.parameters.filter((p) => p.in === 'query') ?? [];
  const headerParams = selectedOperation?.parameters.filter((p) => p.in === 'header') ?? [];

  async function submitInvoke(event: FormEvent) {
    event.preventDefault();
    if (!selectedOperation) {
      setError('No documented operation available for this API.');
      return;
    }
    const missingRequired = selectedOperation.parameters.find(
      (p) => p.required && !paramValues[p.id]?.trim()
    );
    if (missingRequired) {
      setError(`${missingRequired.name} is required.`);
      return;
    }
    setSubmitting(true);
    setError('');
    setResult(null);
    try {
      const headers = buildHeaders(headerParams, paramValues, additionalHeaders, acceptType, contentType, selectedOperation.hasRequestBody);
      const path = buildResolvedPath(selectedOperation.path, pathParams, paramValues);
      const query = buildQueryString(queryParams, paramValues);
      const response = await api.invoke(id, {
        method: selectedOperation.method,
        path,
        query,
        headers,
        bodyBase64: requestBody ? encodeBase64Utf8(requestBody) : '',
      });
      setResult(response);
    } catch (invokeError) {
      setError(invokeError instanceof Error ? invokeError.message : 'Invocation failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!details) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-400">Loading API details…</div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{details.name}</h1>
          {details.description && <p className="mt-1 text-sm text-gray-500">{details.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={details.permissions?.invoke ? 'green' : 'amber'}>
            {details.permissions?.invoke ? 'Invoke allowed' : 'View only'}
          </Badge>
          {details.ownerTeam && <Badge variant="gray">{details.ownerTeam}</Badge>}
          {details.lastSpecStatus && <Badge variant="blue">{details.lastSpecStatus}</Badge>}
        </div>
      </div>

      {/* 2-col layout */}
      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* API Profile */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">API Profile</h2>
          <MetaRow label="Slug" value={details.slug} />
          <MetaRow label="Methods" value={details.allowedMethods?.length ? details.allowedMethods.join(', ') : 'All documented methods'} />
          <MetaRow label="Paths" value={details.allowedPathPrefixes?.length ? details.allowedPathPrefixes.join(', ') : 'All documented paths'} />
          <MetaRow label="Tags" value={details.tags?.length ? details.tags.join(', ') : 'No tags'} />
          <MetaRow label="Try It Out" value={details.tryItEnabled ? 'Enabled' : 'Disabled'} />
        </div>

        {/* Try It Out */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Try It Out</h2>
              <p className="mt-0.5 text-xs text-gray-500">Choose a documented operation. Method and path are locked to the spec.</p>
            </div>
            {selectedOperation && (
              <div className="flex items-center gap-1.5">
                <MethodBadge method={selectedOperation.method} />
                <span className="font-mono text-xs text-gray-500">{selectedOperation.path}</span>
              </div>
            )}
          </div>

          {!details.permissions?.invoke || !details.tryItEnabled ? (
            <p className="text-sm text-gray-500">Invocation is not enabled for your account or this API.</p>
          ) : operations.length === 0 ? (
            <Alert variant="warning">No operations were parsed from the OpenAPI document.</Alert>
          ) : (
            <form onSubmit={submitInvoke} className="space-y-4">
              {/* Tag filter */}
              <NativeSelect
                label="Operation Tag"
                value={selectedOperationTag}
                onChange={setSelectedOperationTag}
                helperText="Filter operations by OpenAPI tag."
                options={[
                  { label: 'All tags', value: '__all__' },
                  ...operationTags.map((t) => ({ label: t, value: t })),
                ]}
              />

              {/* Operation selector */}
              <FieldWrap label="Operation" helperText="Select the path and method from the imported OpenAPI spec.">
                <select
                  value={selectedOperationId}
                  onChange={(e) => setSelectedOperationId(e.target.value)}
                  disabled={visibleOperations.length === 0}
                  className={cn(fieldBase, 'cursor-pointer')}
                >
                  {visibleOperations.length === 0 ? (
                    <option value="" disabled>No operations found for this tag</option>
                  ) : null}
                  {visibleOperations.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.method} {op.path}{op.summary ? ` – ${op.summary}` : ''}
                    </option>
                  ))}
                </select>
              </FieldWrap>

              {selectedOperation && (
                <>
                  <OperationSummary operation={selectedOperation} />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <NativeSelect
                      label="Accept"
                      value={acceptType}
                      onChange={setAcceptType}
                      helperText="Derived from documented responses."
                      options={(selectedOperation.responseContentTypes.length ? selectedOperation.responseContentTypes : ['application/json']).map((v) => ({ label: v, value: v }))}
                    />
                    {selectedOperation.hasRequestBody ? (
                      <NativeSelect
                        label="Content-Type"
                        value={contentType}
                        onChange={setContentType}
                        helperText="Derived from documented request bodies."
                        options={selectedOperation.requestContentTypes.map((v) => ({ label: v, value: v }))}
                      />
                    ) : (
                      <FieldWrap label="Content-Type">
                        <input disabled value="No request body" className={fieldBase} />
                      </FieldWrap>
                    )}
                  </div>

                  {pathParams.length > 0 && (
                    <ParameterSection title="Path Parameters" parameters={pathParams} values={paramValues} onChange={setParamValues} />
                  )}
                  {queryParams.length > 0 && (
                    <ParameterSection title="Query Parameters" parameters={queryParams} values={paramValues} onChange={setParamValues} />
                  )}
                  {headerParams.length > 0 && (
                    <ParameterSection title="Header Parameters" parameters={headerParams} values={paramValues} onChange={setParamValues} />
                  )}

                  {selectedOperation.hasRequestBody && (
                    <Textarea
                      label="Request Body"
                      value={requestBody}
                      onChange={setRequestBody}
                      rows={10}
                      helperText="Prefilled from the OpenAPI example when available."
                    />
                  )}

                  <Textarea
                    label="Additional Headers"
                    value={additionalHeaders}
                    onChange={setAdditionalHeaders}
                    rows={4}
                    helperText="Optional extra headers as Header-Name: value, one per line."
                  />

                  <Button type="submit" variant="primary" disabled={submitting}>
                    {submitting ? 'Sending…' : 'Send Through Portal Proxy'}
                  </Button>
                </>
              )}
            </form>
          )}

          {error && (
            <div className="mt-4">
              <Alert variant="error">{error}</Alert>
            </div>
          )}

          {result && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant={result.statusCode >= 200 && result.statusCode < 300 ? 'green' : 'amber'}>
                  HTTP {result.statusCode}
                </Badge>
                {result.contentType && <Badge variant="blue">{result.contentType}</Badge>}
                {result.truncated && <Badge variant="amber">Body truncated</Badge>}
              </div>

              {/* Response headers */}
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Response Header</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {Object.entries(result.headers ?? {}).map(([name, value]) => (
                      <tr key={name}>
                        <td className="px-3 py-2 font-mono text-gray-700">{name}</td>
                        <td className="px-3 py-2 break-all text-gray-600">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Response body */}
              <div className="rounded-lg bg-slate-900 p-4">
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(prettyBody);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1500);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-400 hover:text-slate-100 transition-colors"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-200">
                  {prettyBody}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Documentation */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">Documentation</h2>
        {spec ? (
          <SwaggerUI spec={spec} supportedSubmitMethods={[]} />
        ) : (
          <p className="text-sm text-gray-400">Loading spec…</p>
        )}
      </div>
    </div>
  );
}

// ── Utility functions (unchanged) ─────────────────────────────────────────────

function parseOperations(spec: SpecObject | null): OperationOption[] {
  if (!spec?.paths || typeof spec.paths !== 'object') return [];

  const isOpenAPI3 = typeof spec.openapi === 'string';
  const globalConsumes = listStrings(spec.consumes);
  const globalProduces = listStrings(spec.produces);
  const operations: OperationOption[] = [];

  Object.entries(spec.paths).forEach(([path, pathItem]) => {
    if (!pathItem || typeof pathItem !== 'object') return;
    const pathParameters = extractParameters((pathItem as SpecObject).parameters, spec);

    supportedMethods.forEach((methodKey) => {
      const operation = (pathItem as SpecObject)[methodKey];
      if (!operation || typeof operation !== 'object') return;

      const operationParameters = mergeParameters(pathParameters, extractParameters((operation as SpecObject).parameters, spec));
      const requestContentTypes = isOpenAPI3
        ? objectKeys((resolveRef(spec, (operation as SpecObject).requestBody) as SpecObject | undefined)?.content)
        : listStrings((operation as SpecObject).consumes).concat(globalConsumes);
      const responseContentTypes = isOpenAPI3
        ? extractResponseContentTypes((operation as SpecObject).responses, spec)
        : listStrings((operation as SpecObject).produces).concat(globalProduces);
      const bodyExample = isOpenAPI3
        ? openAPI3BodyExample((operation as SpecObject).requestBody, spec)
        : swagger2BodyExample((operation as SpecObject).parameters, spec);

      operations.push({
        id: `${methodKey.toUpperCase()} ${path}`,
        method: methodKey.toUpperCase(),
        path,
        summary: String((operation as SpecObject).summary ?? ''),
        description: String((operation as SpecObject).description ?? ''),
        tags: listStrings((operation as SpecObject).tags),
        parameters: operationParameters,
        requestContentTypes: uniq(requestContentTypes).filter(Boolean),
        responseContentTypes: uniq(responseContentTypes).filter(Boolean),
        requestBodyExample: bodyExample,
        hasRequestBody:
          isOpenAPI3
            ? Boolean((operation as SpecObject).requestBody)
            : requestContentTypes.length > 0 || ['POST', 'PUT', 'PATCH'].includes(methodKey.toUpperCase()),
      });
    });
  });

  return operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function buildParamDefaults(operation: OperationOption) {
  return operation.parameters.reduce<Record<string, string>>((acc, p) => {
    acc[p.id] = p.defaultValue;
    return acc;
  }, {});
}

function buildResolvedPath(template: string, parameters: OperationParameter[], values: Record<string, string>) {
  return parameters.reduce(
    (path, p) => path.split(`{${p.name}}`).join(encodeURIComponent(values[p.id] ?? '')),
    template
  );
}

function buildQueryString(parameters: OperationParameter[], values: Record<string, string>) {
  const query = new URLSearchParams();
  parameters.forEach((p) => {
    const value = values[p.id]?.trim();
    if (value) query.append(p.name, value);
  });
  return query.toString();
}

function buildHeaders(
  headerParams: OperationParameter[],
  values: Record<string, string>,
  additionalHeaders: string,
  acceptType: string,
  contentType: string,
  hasRequestBody: boolean
) {
  const headers: Record<string, string> = {};
  if (acceptType) headers.Accept = acceptType;
  if (hasRequestBody && contentType) headers['Content-Type'] = contentType;
  headerParams.forEach((p) => {
    const value = values[p.id]?.trim();
    if (value) headers[p.name] = value;
  });
  additionalHeaders
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [name, ...rest] = line.split(':');
      if (name && rest.length > 0) headers[name.trim()] = rest.join(':').trim();
    });
  return headers;
}

function extractParameters(raw: unknown, spec: SpecObject): OperationParameter[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => normalizeParameter(item as SpecObject, i, spec)).filter((p): p is OperationParameter => Boolean(p));
}

function mergeParameters(pathParameters: OperationParameter[], operationParameters: OperationParameter[]) {
  const merged = [...pathParameters];
  operationParameters.forEach((p) => {
    const idx = merged.findIndex((m) => m.name === p.name && m.in === p.in);
    if (idx >= 0) merged[idx] = p;
    else merged.push(p);
  });
  return merged;
}

function normalizeParameter(rawParameter: SpecObject, index: number, spec: SpecObject): OperationParameter | null {
  const parameter = resolveRef(spec, rawParameter) as SpecObject;
  const location = parameter?.in;
  if (location !== 'path' && location !== 'query' && location !== 'header') return null;

  const schema = (resolveRef(spec, parameter.schema) as SpecObject) ?? {};
  const defaultValue =
    resolveExampleValue(spec, parameter.example) ??
    resolveExampleValue(spec, parameter.default) ??
    resolveExampleValue(spec, schema.example) ??
    resolveExampleValue(spec, schema.default) ??
    generateExampleFromSchema(schema, spec) ??
    '';

  return {
    id: `${location}:${String(parameter.name ?? index)}`,
    name: String(parameter.name ?? `param_${index}`),
    in: location,
    description: String(parameter.description ?? ''),
    required: Boolean(parameter.required),
    defaultValue: defaultValue == null ? '' : stringifyExample(defaultValue),
    type: String(schema.type ?? parameter.type ?? 'string'),
  };
}

function openAPI3BodyExample(requestBody: unknown, spec: SpecObject) {
  const body = resolveRef(spec, requestBody) as SpecObject | undefined;
  const content = (body?.content as SpecObject) ?? {};
  for (const entry of Object.values(content)) {
    const media = resolveRef(spec, entry) as SpecObject;
    const directExample = resolveExampleValue(spec, media.example);
    if (directExample !== undefined) return stringifyExample(directExample);
    if (media.examples && typeof media.examples === 'object') {
      const first = resolveRef(spec, Object.values(media.examples as SpecObject)[0]) as SpecObject | undefined;
      if (first?.value !== undefined) return stringifyExample(resolveExampleValue(spec, first.value));
    }
    const schema = resolveRef(spec, media.schema) as SpecObject | undefined;
    const schemaExample = resolveExampleValue(spec, schema?.example) ?? generateExampleFromSchema(schema, spec);
    if (schemaExample !== undefined) return stringifyExample(schemaExample);
  }
  return '';
}

function swagger2BodyExample(rawParameters: unknown, spec: SpecObject) {
  if (!Array.isArray(rawParameters)) return '';
  const parameter = rawParameters.map((item) => resolveRef(spec, item) as SpecObject).find((item) => item?.in === 'body');
  if (!parameter) return '';
  const schema = resolveRef(spec, parameter.schema) as SpecObject | undefined;
  const example =
    resolveExampleValue(spec, parameter['x-example']) ??
    resolveExampleValue(spec, parameter.example) ??
    resolveExampleValue(spec, schema?.example) ??
    generateExampleFromSchema(schema, spec);
  return example !== undefined ? stringifyExample(example) : '';
}

function extractResponseContentTypes(responses: unknown, spec: SpecObject) {
  const out: string[] = [];
  if (!responses || typeof responses !== 'object') return out;
  Object.entries(responses as SpecObject).forEach(([status, response]) => {
    if (!status.startsWith('2') && status !== 'default') return;
    const content = ((resolveRef(spec, response) as SpecObject | undefined)?.content as SpecObject) ?? {};
    out.push(...Object.keys(content));
  });
  return out;
}

function listStrings(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function objectKeys(value: unknown) {
  return value && typeof value === 'object' ? Object.keys(value as Record<string, unknown>) : [];
}

function uniq(values: string[]) {
  return Array.from(new Set(values));
}

function stringifyExample(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeBase64Utf8(value: string) {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return value;
  }
}

function beautifyBody(body: string, contentType: string) {
  const trimmed = body.trim();
  if (!trimmed) return '';
  if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.stringify(JSON.parse(trimmed), null, 2); } catch { return body; }
  }
  return body;
}

function resolveRef(spec: SpecObject, value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const ref = (value as SpecObject).$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return value;
  const parts = ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = spec;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return value;
    current = (current as SpecObject)[part];
  }
  if (current && typeof current === 'object' && (current as SpecObject).$ref && current !== value) {
    return resolveRef(spec, current);
  }
  return current ?? value;
}

function resolveExampleValue(spec: SpecObject, value: unknown): unknown {
  const resolved = resolveRef(spec, value);
  if (resolved && typeof resolved === 'object' && 'value' in (resolved as SpecObject)) {
    return (resolved as SpecObject).value;
  }
  return resolved;
}

function generateExampleFromSchema(schema: SpecObject | undefined, spec: SpecObject): unknown {
  if (!schema) return undefined;
  const resolved = resolveRef(spec, schema) as SpecObject | undefined;
  if (!resolved) return undefined;
  if (resolved.example !== undefined) return resolveExampleValue(spec, resolved.example);
  if (resolved.default !== undefined) return resolveExampleValue(spec, resolved.default);
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) return resolved.enum[0];
  const schemaType = resolved.type;
  if (schemaType === 'object' || resolved.properties) {
    const out: Record<string, unknown> = {};
    Object.entries((resolved.properties as SpecObject) ?? {}).forEach(([key, value]) => {
      const example = generateExampleFromSchema(value as SpecObject, spec);
      if (example !== undefined) out[key] = example;
    });
    return out;
  }
  if (schemaType === 'array') {
    const itemExample = generateExampleFromSchema((resolved.items as SpecObject) ?? {}, spec);
    return itemExample === undefined ? [] : [itemExample];
  }
  if (schemaType === 'integer' || schemaType === 'number') return 0;
  if (schemaType === 'boolean') return false;
  if (schemaType === 'string' && resolved.format === 'date-time') return new Date().toISOString();
  if (schemaType === 'string' && resolved.format === 'date') return new Date().toISOString().slice(0, 10);
  if (schemaType === 'string') return '';
  if (Array.isArray(resolved.allOf) && resolved.allOf.length > 0) {
    return resolved.allOf.reduce<Record<string, unknown>>((acc, item) => {
      const value = generateExampleFromSchema(item as SpecObject, spec);
      if (value && typeof value === 'object' && !Array.isArray(value)) return { ...acc, ...(value as Record<string, unknown>) };
      return acc;
    }, {});
  }
  return undefined;
}
