// OpenAPI 2 / 3 parsing for the try-it form: operations, parameters with example
// values, content types and request body examples. Pure functions (unit-tested).

/* eslint-disable @typescript-eslint/no-explicit-any */
export type SpecObject = Record<string, any>;

export type OperationParameter = {
  id: string;
  name: string;
  in: 'path' | 'query' | 'header';
  description: string;
  required: boolean;
  defaultValue: string;
  type: string;
};

export type OperationOption = {
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

export function parseOperations(spec: SpecObject | null): OperationOption[] {
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

      const operationParameters = mergeParameters(
        pathParameters,
        extractParameters((operation as SpecObject).parameters, spec),
      );
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
        hasRequestBody: isOpenAPI3
          ? Boolean((operation as SpecObject).requestBody)
          : requestContentTypes.length > 0 || ['POST', 'PUT', 'PATCH'].includes(methodKey.toUpperCase()),
      });
    });
  });

  return operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

export function buildParamDefaults(operation: OperationOption) {
  return operation.parameters.reduce<Record<string, string>>((acc, p) => {
    acc[p.id] = p.defaultValue;
    return acc;
  }, {});
}

export function buildResolvedPath(template: string, parameters: OperationParameter[], values: Record<string, string>) {
  return parameters.reduce(
    (path, p) => path.split(`{${p.name}}`).join(encodeURIComponent(values[p.id] ?? '')),
    template,
  );
}

export function buildQueryString(parameters: OperationParameter[], values: Record<string, string>) {
  const query = new URLSearchParams();
  parameters.forEach((p) => {
    const value = values[p.id]?.trim();
    if (value) query.append(p.name, value);
  });
  return query.toString();
}

export function buildHeaders(
  headerParams: OperationParameter[],
  values: Record<string, string>,
  additionalHeaders: string,
  acceptType: string,
  contentType: string,
  hasRequestBody: boolean,
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
  return raw
    .map((item, i) => normalizeParameter(item as SpecObject, i, spec))
    .filter((p): p is OperationParameter => Boolean(p));
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
  const parameter = rawParameters
    .map((item) => resolveRef(spec, item) as SpecObject)
    .find((item) => item?.in === 'body');
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

export function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function decodeBase64Utf8(value: string) {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return value;
  }
}

export function beautifyBody(body: string, contentType: string) {
  const trimmed = body.trim();
  if (!trimmed) return '';
  if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

// Follows local $ref chains. A ref seen twice (A -> B -> A) stops the walk instead of
// recursing forever.
function resolveRef(spec: SpecObject, value: unknown): unknown {
  let current: unknown = value;
  const seen = new Set<string>();
  while (current && typeof current === 'object') {
    const ref = (current as SpecObject).$ref;
    if (typeof ref !== 'string' || !ref.startsWith('#/') || seen.has(ref)) break;
    seen.add(ref);
    const target = lookupPointer(spec, ref);
    if (target === undefined) break;
    current = target;
  }
  return current ?? value;
}

function lookupPointer(spec: SpecObject, ref: string): unknown {
  const parts = ref
    .slice(2)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = spec;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as SpecObject)[part];
  }
  return current;
}

const MAX_EXAMPLE_DEPTH = 8;

function resolveExampleValue(spec: SpecObject, value: unknown): unknown {
  const resolved = resolveRef(spec, value);
  if (resolved && typeof resolved === 'object' && 'value' in (resolved as SpecObject)) {
    return (resolved as SpecObject).value;
  }
  return resolved;
}

// Builds an example value from a schema. Self-referencing schemas (a Node with
// children: Node[]) stop at the first repeat on the current path, and nesting is
// capped at MAX_EXAMPLE_DEPTH, so recursive specs can't hang the page.
function generateExampleFromSchema(
  schema: SpecObject | undefined,
  spec: SpecObject,
  path: Set<object> = new Set(),
): unknown {
  if (!schema || path.size >= MAX_EXAMPLE_DEPTH) return undefined;
  const resolved = resolveRef(spec, schema) as SpecObject | undefined;
  if (!resolved || typeof resolved !== 'object' || path.has(resolved)) return undefined;
  path.add(resolved);
  try {
    return exampleForResolvedSchema(resolved, spec, path);
  } finally {
    path.delete(resolved);
  }
}

function exampleForResolvedSchema(resolved: SpecObject, spec: SpecObject, path: Set<object>): unknown {
  if (resolved.example !== undefined) return resolveExampleValue(spec, resolved.example);
  if (resolved.default !== undefined) return resolveExampleValue(spec, resolved.default);
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) return resolved.enum[0];
  const schemaType = resolved.type;
  if (schemaType === 'object' || resolved.properties) {
    const out: Record<string, unknown> = {};
    Object.entries((resolved.properties as SpecObject) ?? {}).forEach(([key, value]) => {
      const example = generateExampleFromSchema(value as SpecObject, spec, path);
      if (example !== undefined) out[key] = example;
    });
    return out;
  }
  if (schemaType === 'array') {
    const itemExample = generateExampleFromSchema((resolved.items as SpecObject) ?? {}, spec, path);
    return itemExample === undefined ? [] : [itemExample];
  }
  if (schemaType === 'integer' || schemaType === 'number') return 0;
  if (schemaType === 'boolean') return false;
  if (schemaType === 'string' && resolved.format === 'date-time') return new Date().toISOString();
  if (schemaType === 'string' && resolved.format === 'date') return new Date().toISOString().slice(0, 10);
  if (schemaType === 'string') return '';
  if (Array.isArray(resolved.allOf) && resolved.allOf.length > 0) {
    return resolved.allOf.reduce<Record<string, unknown>>((acc, item) => {
      const value = generateExampleFromSchema(item as SpecObject, spec, path);
      if (value && typeof value === 'object' && !Array.isArray(value))
        return { ...acc, ...(value as Record<string, unknown>) };
      return acc;
    }, {});
  }
  return undefined;
}
