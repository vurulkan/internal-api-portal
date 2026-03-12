import type { Dispatch, SetStateAction } from 'react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import SwaggerUI from 'swagger-ui-react';
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
  const [result, setResult] = useState<InvokeResponse | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setError('');
    setResult(null);
    api.apiDetails(id).then(setDetails).catch((err) => setError(err.message));
    api.apiSpec(id).then(setSpec).catch((err) => setError(err.message));
  }, [id]);

  const operations = useMemo(() => parseOperations(spec), [spec]);

  const selectedOperation = useMemo(
    () => operations.find((operation) => operation.id === selectedOperationId) ?? operations[0] ?? null,
    [operations, selectedOperationId]
  );

  useEffect(() => {
    if (!selectedOperation) {
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
    if (!result) {
      return '';
    }
    try {
      return atob(result.bodyBase64);
    } catch {
      return result.bodyBase64;
    }
  }, [result]);

  const pathParams = selectedOperation?.parameters.filter((parameter) => parameter.in === 'path') ?? [];
  const queryParams = selectedOperation?.parameters.filter((parameter) => parameter.in === 'query') ?? [];
  const headerParams = selectedOperation?.parameters.filter((parameter) => parameter.in === 'header') ?? [];

  async function submitInvoke(event: FormEvent) {
    event.preventDefault();
    if (!selectedOperation) {
      setError('No documented operation available for this API.');
      return;
    }

    const missingRequired = selectedOperation.parameters.find(
      (parameter) => parameter.required && !paramValues[parameter.id]?.trim()
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
        bodyBase64: requestBody ? encodeBase64Utf8(requestBody) : ''
      });
      setResult(response);
    } catch (invokeError) {
      setError(invokeError instanceof Error ? invokeError.message : 'Invocation failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!details) {
    return <Typography>Loading API details...</Typography>;
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={3} gap={2} flexWrap="wrap">
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            {details.name}
          </Typography>
          <Typography color="text.secondary">{details.description}</Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Chip color={details.permissions?.invoke ? 'success' : 'warning'} label={details.permissions?.invoke ? 'Invoke allowed' : 'View only'} />
          <Chip variant="outlined" label={details.ownerTeam || 'No owner'} />
          <Chip variant="outlined" label={details.lastSpecStatus || 'Spec status unknown'} />
        </Stack>
      </Box>

      <Box display="grid" gridTemplateColumns={{ xs: '1fr', xl: '340px minmax(0, 1fr)' }} gap={2} mb={2}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              API Profile
            </Typography>
            <MetaRow label="Slug" value={details.slug} />
            <MetaRow label="Methods" value={details.allowedMethods?.length ? details.allowedMethods.join(', ') : 'All documented methods'} />
            <MetaRow label="Paths" value={details.allowedPathPrefixes?.length ? details.allowedPathPrefixes.join(', ') : 'All documented paths'} />
            <MetaRow label="Tags" value={details.tags?.length ? details.tags.join(', ') : 'No tags'} />
            <MetaRow label="Try It Out" value={details.tryItEnabled ? 'Enabled' : 'Disabled'} />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} mb={2}>
              <Box>
                <Typography variant="h6">Try It Out</Typography>
                <Typography variant="body2" color="text.secondary">
                  Choose a documented operation. Method and path are locked to the spec; you only fill the operation inputs.
                </Typography>
              </Box>
              {selectedOperation ? <Chip color="primary" label={`${selectedOperation.method} ${selectedOperation.path}`} /> : null}
            </Stack>

            {!details.permissions?.invoke || !details.tryItEnabled ? (
              <Typography color="text.secondary">Invocation is not enabled for your account or this API.</Typography>
            ) : operations.length === 0 ? (
              <Alert severity="warning">No operations were parsed from the OpenAPI document.</Alert>
            ) : (
              <Box component="form" display="flex" flexDirection="column" gap={3} onSubmit={submitInvoke}>
                <TextField
                  select
                  label="Operation"
                  value={selectedOperationId}
                  onChange={(event) => setSelectedOperationId(event.target.value)}
                  helperText="Select the path and method from the imported OpenAPI spec."
                >
                  {operations.map((operation) => (
                    <MenuItem key={operation.id} value={operation.id}>
                      {operation.method} {operation.path} {operation.summary ? `- ${operation.summary}` : ''}
                    </MenuItem>
                  ))}
                </TextField>

                {selectedOperation ? (
                  <>
                    <OperationSummary operation={selectedOperation} />

                    <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} gap={2}>
                      <TextField
                        select
                        label="Accept"
                        value={acceptType}
                        onChange={(event) => setAcceptType(event.target.value)}
                        helperText="Derived from documented responses."
                      >
                        {(selectedOperation.responseContentTypes.length ? selectedOperation.responseContentTypes : ['application/json']).map((value) => (
                          <MenuItem key={value} value={value}>
                            {value}
                          </MenuItem>
                        ))}
                      </TextField>

                      {selectedOperation.hasRequestBody ? (
                        <TextField
                          select
                          label="Content-Type"
                          value={contentType}
                          onChange={(event) => setContentType(event.target.value)}
                          helperText="Derived from documented request bodies."
                        >
                          {selectedOperation.requestContentTypes.map((value) => (
                            <MenuItem key={value} value={value}>
                              {value}
                            </MenuItem>
                          ))}
                        </TextField>
                      ) : (
                        <TextField label="Content-Type" value="No request body" disabled />
                      )}
                    </Box>

                    {pathParams.length > 0 ? <ParameterSection title="Path Parameters" parameters={pathParams} values={paramValues} onChange={setParamValues} /> : null}
                    {queryParams.length > 0 ? <ParameterSection title="Query Parameters" parameters={queryParams} values={paramValues} onChange={setParamValues} /> : null}
                    {headerParams.length > 0 ? <ParameterSection title="Header Parameters" parameters={headerParams} values={paramValues} onChange={setParamValues} /> : null}

                    {selectedOperation.hasRequestBody ? (
                      <TextField
                        label="Request Body"
                        multiline
                        minRows={10}
                        value={requestBody}
                        onChange={(event) => setRequestBody(event.target.value)}
                        helperText="Prefilled from the OpenAPI example when available."
                      />
                    ) : null}

                    <TextField
                      label="Additional Headers"
                      multiline
                      minRows={4}
                      value={additionalHeaders}
                      onChange={(event) => setAdditionalHeaders(event.target.value)}
                      helperText="Optional extra headers as `Header-Name: value`, one per line."
                    />

                    <Box>
                      <Button type="submit" variant="contained" disabled={submitting}>
                        {submitting ? 'Sending...' : 'Send Through Portal Proxy'}
                      </Button>
                    </Box>
                  </>
                ) : null}
              </Box>
            )}

            {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
            {result ? (
              <Box sx={{ mt: 2 }}>
                <Stack direction="row" spacing={1} mb={1} flexWrap="wrap">
                  <Chip color={result.statusCode >= 200 && result.statusCode < 300 ? 'success' : 'warning'} label={`HTTP ${result.statusCode}`} />
                  <Chip variant="outlined" label={result.contentType || 'unknown content type'} />
                  {result.truncated ? <Chip color="warning" label="Body truncated" /> : null}
                </Stack>
                <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Response Header</TableCell>
                        <TableCell>Value</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Object.entries(result.headers ?? {}).map(([name, value]) => (
                        <TableRow key={name}>
                          <TableCell>{name}</TableCell>
                          <TableCell sx={{ wordBreak: 'break-word' }}>{value}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Box sx={{ borderRadius: 2, background: '#0f1720', color: '#ebf2ff', p: 2 }}>
                  <Box component="pre" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', m: 0 }}>
                    {prettyBody}
                  </Box>
                </Box>
              </Box>
            ) : null}
          </CardContent>
        </Card>
      </Box>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Documentation
          </Typography>
          {spec ? <SwaggerUI spec={spec} supportedSubmitMethods={[]} /> : <Typography>Loading spec...</Typography>}
        </CardContent>
      </Card>
    </Box>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <Box mb={1.5}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography>{value}</Typography>
    </Box>
  );
}

function OperationSummary({ operation }: { operation: OperationOption }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Box display="flex" gap={1} flexWrap="wrap">
          <Chip color="primary" size="small" label={operation.method} />
          <Chip variant="outlined" size="small" label={operation.path} />
          {operation.tags.map((tag) => (
            <Chip key={tag} variant="outlined" size="small" label={tag} />
          ))}
        </Box>
        <Typography fontWeight={600}>{operation.summary || 'Untitled operation'}</Typography>
        {operation.description ? (
          <Typography variant="body2" color="text.secondary">
            {operation.description}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}

function ParameterSection({
  title,
  parameters,
  values,
  onChange
}: {
  title: string;
  parameters: OperationParameter[];
  values: Record<string, string>;
  onChange: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom>
        {title}
      </Typography>
      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} gap={2}>
        {parameters.map((parameter) => (
          <TextField
            key={parameter.id}
            label={parameter.name}
            value={values[parameter.id] ?? ''}
            required={parameter.required}
            onChange={(event) => onChange((current) => ({ ...current, [parameter.id]: event.target.value }))}
            helperText={parameter.description || `${parameter.in} parameter${parameter.required ? ' • required' : ''}`}
          />
        ))}
      </Box>
    </Box>
  );
}

function parseOperations(spec: SpecObject | null): OperationOption[] {
  if (!spec?.paths || typeof spec.paths !== 'object') {
    return [];
  }

  const isOpenAPI3 = typeof spec.openapi === 'string';
  const globalConsumes = listStrings(spec.consumes);
  const globalProduces = listStrings(spec.produces);
  const operations: OperationOption[] = [];

  Object.entries(spec.paths).forEach(([path, pathItem]) => {
    if (!pathItem || typeof pathItem !== 'object') {
      return;
    }

    const pathParameters = extractParameters((pathItem as SpecObject).parameters, spec);

    supportedMethods.forEach((methodKey) => {
      const operation = (pathItem as SpecObject)[methodKey];
      if (!operation || typeof operation !== 'object') {
        return;
      }

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
        hasRequestBody: isOpenAPI3 ? Boolean((operation as SpecObject).requestBody) : requestContentTypes.length > 0 || ['POST', 'PUT', 'PATCH'].includes(methodKey.toUpperCase())
      });
    });
  });

  return operations.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
}

function buildParamDefaults(operation: OperationOption) {
  return operation.parameters.reduce<Record<string, string>>((acc, parameter) => {
    acc[parameter.id] = parameter.defaultValue;
    return acc;
  }, {});
}

function buildResolvedPath(template: string, parameters: OperationParameter[], values: Record<string, string>) {
  return parameters.reduce(
    (path, parameter) => path.split(`{${parameter.name}}`).join(encodeURIComponent(values[parameter.id] ?? '')),
    template
  );
}

function buildQueryString(parameters: OperationParameter[], values: Record<string, string>) {
  const query = new URLSearchParams();
  parameters.forEach((parameter) => {
    const value = values[parameter.id]?.trim();
    if (!value) {
      return;
    }
    query.append(parameter.name, value);
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
  if (acceptType) {
    headers.Accept = acceptType;
  }
  if (hasRequestBody && contentType) {
    headers['Content-Type'] = contentType;
  }
  headerParams.forEach((parameter) => {
    const value = values[parameter.id]?.trim();
    if (value) {
      headers[parameter.name] = value;
    }
  });
  additionalHeaders
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [name, ...rest] = line.split(':');
      if (name && rest.length > 0) {
        headers[name.trim()] = rest.join(':').trim();
      }
    });
  return headers;
}

function extractParameters(raw: unknown, spec: SpecObject): OperationParameter[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item, index) => normalizeParameter(item as SpecObject, index, spec))
    .filter((item): item is OperationParameter => Boolean(item));
}

function mergeParameters(pathParameters: OperationParameter[], operationParameters: OperationParameter[]) {
  const merged = [...pathParameters];
  operationParameters.forEach((parameter) => {
    const index = merged.findIndex((item) => item.name === parameter.name && item.in === parameter.in);
    if (index >= 0) {
      merged[index] = parameter;
    } else {
      merged.push(parameter);
    }
  });
  return merged;
}

function normalizeParameter(rawParameter: SpecObject, index: number, spec: SpecObject): OperationParameter | null {
  const parameter = resolveRef(spec, rawParameter) as SpecObject;
  const location = parameter?.in;
  if (location !== 'path' && location !== 'query' && location !== 'header') {
    return null;
  }

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
    type: String(schema.type ?? parameter.type ?? 'string')
  };
}

function openAPI3BodyExample(requestBody: unknown, spec: SpecObject) {
  const body = resolveRef(spec, requestBody) as SpecObject | undefined;
  const content = (body?.content as SpecObject) ?? {};
  for (const entry of Object.values(content)) {
    const media = resolveRef(spec, entry) as SpecObject;
    const directExample = resolveExampleValue(spec, media.example);
    if (directExample !== undefined) {
      return stringifyExample(directExample);
    }
    if (media.examples && typeof media.examples === 'object') {
      const first = resolveRef(spec, Object.values(media.examples as SpecObject)[0]) as SpecObject | undefined;
      if (first?.value !== undefined) {
        return stringifyExample(resolveExampleValue(spec, first.value));
      }
    }
    const schema = resolveRef(spec, media.schema) as SpecObject | undefined;
    const schemaExample = resolveExampleValue(spec, schema?.example) ?? generateExampleFromSchema(schema, spec);
    if (schemaExample !== undefined) {
      return stringifyExample(schemaExample);
    }
  }
  return '';
}

function swagger2BodyExample(rawParameters: unknown, spec: SpecObject) {
  if (!Array.isArray(rawParameters)) {
    return '';
  }
  const parameter = rawParameters
    .map((item) => resolveRef(spec, item) as SpecObject)
    .find((item) => item?.in === 'body');
  if (!parameter) {
    return '';
  }
  const schema = resolveRef(spec, parameter.schema) as SpecObject | undefined;
  const example =
    resolveExampleValue(spec, parameter['x-example']) ??
    resolveExampleValue(spec, parameter.example) ??
    resolveExampleValue(spec, schema?.example) ??
    generateExampleFromSchema(schema, spec);
  if (example !== undefined) {
    return stringifyExample(example);
  }
  return '';
}

function extractResponseContentTypes(responses: unknown, spec: SpecObject) {
  const out: string[] = [];
  if (!responses || typeof responses !== 'object') {
    return out;
  }
  Object.entries(responses as SpecObject).forEach(([status, response]) => {
    if (!status.startsWith('2') && status !== 'default') {
      return;
    }
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
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function resolveRef(spec: SpecObject, value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const ref = (value as SpecObject).$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    return value;
  }
  const parts = ref
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = spec;
  for (const part of parts) {
    if (!current || typeof current !== 'object') {
      return value;
    }
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
  if (!schema) {
    return undefined;
  }
  const resolved = resolveRef(spec, schema) as SpecObject | undefined;
  if (!resolved) {
    return undefined;
  }
  if (resolved.example !== undefined) {
    return resolveExampleValue(spec, resolved.example);
  }
  if (resolved.default !== undefined) {
    return resolveExampleValue(spec, resolved.default);
  }
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return resolved.enum[0];
  }
  const schemaType = resolved.type;
  if (schemaType === 'object' || resolved.properties) {
    const out: Record<string, unknown> = {};
    Object.entries((resolved.properties as SpecObject) ?? {}).forEach(([key, value]) => {
      const example = generateExampleFromSchema(value as SpecObject, spec);
      if (example !== undefined) {
        out[key] = example;
      }
    });
    return out;
  }
  if (schemaType === 'array') {
    const itemExample = generateExampleFromSchema((resolved.items as SpecObject) ?? {}, spec);
    return itemExample === undefined ? [] : [itemExample];
  }
  if (schemaType === 'integer' || schemaType === 'number') {
    return 0;
  }
  if (schemaType === 'boolean') {
    return false;
  }
  if (schemaType === 'string' && resolved.format === 'date-time') {
    return new Date().toISOString();
  }
  if (schemaType === 'string' && resolved.format === 'date') {
    return new Date().toISOString().slice(0, 10);
  }
  if (schemaType === 'string') {
    return '';
  }
  if (Array.isArray(resolved.allOf) && resolved.allOf.length > 0) {
    return resolved.allOf.reduce<Record<string, unknown>>((acc, item) => {
      const value = generateExampleFromSchema(item as SpecObject, spec);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return { ...acc, ...(value as Record<string, unknown>) };
      }
      return acc;
    }, {});
  }
  return undefined;
}
