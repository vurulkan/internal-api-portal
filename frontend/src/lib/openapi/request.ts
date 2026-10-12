import { resolveRef } from './resolve';
import { exampleText } from './schema';
import type { Operation, Parameter, SpecObject } from './types';

export const paramId = (p: Pick<Parameter, 'in' | 'name'>) => `${p.in}:${p.name}`;

/** A parameter's starting value: only what the spec gives (example, default, enum), never a made-up one. */
export function parameterDefault(spec: SpecObject, p: Parameter): string {
  const schema = resolveRef(spec, p.schema) ?? {};
  const candidates = [
    p.example,
    schema.example,
    Array.isArray(schema.examples) ? schema.examples[0] : undefined,
    schema.default,
  ];
  const found = candidates.find((v) => v !== undefined && v !== null);
  return found !== undefined ? exampleText(found) : '';
}

/** Path parameters are encoded once, exactly as typed ("a b/c" → "a%20b%2Fc"). */
export function resolvePath(template: string, params: Parameter[], values: Record<string, string>) {
  return params
    .filter((p) => p.in === 'path')
    .reduce((path, p) => path.split(`{${p.name}}`).join(encodeURIComponent(values[paramId(p)] ?? '')), template);
}

export function queryString(params: Parameter[], values: Record<string, string>) {
  const query = new URLSearchParams();
  params
    .filter((p) => p.in === 'query')
    .forEach((p) => {
      const value = values[paramId(p)]?.trim();
      if (value) query.append(p.name, value);
    });
  return query.toString();
}

export type HeaderRow = { name: string; value: string };

/** The headers sent: Accept, Content-Type (with a body), header parameters, extra rows. */
export function requestHeaders(
  op: Operation,
  values: Record<string, string>,
  extra: HeaderRow[],
  accept: string,
  contentType: string,
  withBody: boolean,
) {
  const headers: Record<string, string> = {};
  if (accept) headers.Accept = accept;
  if (withBody && contentType) headers['Content-Type'] = contentType;
  op.parameters
    .filter((p) => p.in === 'header')
    .forEach((p) => {
      const value = values[paramId(p)]?.trim();
      if (value) headers[p.name] = value;
    });
  extra.forEach((h) => {
    if (h.name.trim() && h.value.trim()) headers[h.name.trim()] = h.value.trim();
  });
  return headers;
}

/** Which headers the portal forwards: the standard four, the API's allow-list, and X-* if allowed. */
export function headerAllowed(name: string, allowed: string[], forwardAllX: boolean) {
  const lower = name.toLowerCase();
  return (
    ['content-type', 'accept', 'accept-language', 'user-agent'].includes(lower) ||
    allowed.some((a) => a.toLowerCase() === lower) ||
    (forwardAllX && lower.startsWith('x-') && !lower.startsWith('x-forwarded') && lower !== 'x-http-method-override')
  );
}

/** Values that must not be copied around (snippets, history). */
export function isSensitiveHeader(name: string) {
  return /authorization|cookie|token|secret|password|api[-_]?key|session|signature/i.test(name);
}

export type ValidationError = {
  id: string;
  name: string;
  message: 'required' | 'integer' | 'number' | 'boolean' | 'enum' | 'json';
};

/** Checks values against the parameter schemas (types, enums, required). */
export function validateParameters(
  spec: SpecObject,
  params: Parameter[],
  values: Record<string, string>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const p of params) {
    const id = paramId(p);
    const value = (values[id] ?? '').trim();
    if (!value) {
      if (p.required) errors.push({ id, name: p.name, message: 'required' });
      continue;
    }
    const schema = resolveRef(spec, p.schema) ?? {};
    const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== 'null') : schema.type;
    if (Array.isArray(schema.enum) && schema.enum.length && !schema.enum.map(String).includes(value)) {
      errors.push({ id, name: p.name, message: 'enum' });
    } else if (type === 'integer' && !/^-?\d+$/.test(value)) {
      errors.push({ id, name: p.name, message: 'integer' });
    } else if (type === 'number' && !Number.isFinite(Number(value))) {
      errors.push({ id, name: p.name, message: 'number' });
    } else if (type === 'boolean' && !['true', 'false'].includes(value)) {
      errors.push({ id, name: p.name, message: 'boolean' });
    }
  }
  return errors;
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

export function isJsonContentType(contentType: string) {
  return /[/+]json\b/i.test(contentType);
}

export function prettyBody(body: string, contentType: string) {
  const trimmed = body.trim();
  if (!trimmed) return '';
  if (isJsonContentType(contentType) || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}
