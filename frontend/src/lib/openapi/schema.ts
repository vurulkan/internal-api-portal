import { refName, resolveRef } from './resolve';
import type { Schema, SpecObject } from './types';

const MAX_DEPTH = 8;

/** OAS 3.1 allows `type: ["string", "null"]`; 3.0 uses `nullable`. */
export function schemaTypes(schema: Schema | undefined): string[] {
  if (!schema) return [];
  const t = schema.type;
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  if (typeof t === 'string') return [t];
  if (schema.properties || schema.additionalProperties) return ['object'];
  if (schema.items) return ['array'];
  return [];
}

export function isNullable(schema: Schema | undefined) {
  return !!schema && (schema.nullable === true || schemaTypes(schema).includes('null'));
}

/** A short type label: "string<date-time>", "array<Charge>", "Charge", "integer | null". */
export function typeLabel(spec: SpecObject, raw: Schema | undefined): string {
  if (!raw) return '';
  const name = refName(raw);
  const schema = resolveRef(spec, raw);
  if (!schema || typeof schema !== 'object') return name ?? '';
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const variants = (schema.oneOf ?? schema.anyOf) as Schema[];
    return variants.map((v) => typeLabel(spec, v) || 'any').join(' | ');
  }
  const types = schemaTypes(schema).filter((t) => t !== 'null');
  let label: string;
  if (types[0] === 'array') {
    label = `array<${typeLabel(spec, schema.items) || 'any'}>`;
  } else if (name && (types[0] === 'object' || schema.allOf || !types.length)) {
    label = name;
  } else {
    label = types.join(' | ') || (schema.allOf ? 'object' : 'any');
    if (schema.format) label += `<${schema.format}>`;
  }
  return isNullable(schema) ? `${label} | null` : label;
}

/** allOf members merged into one object schema (properties and required lists). */
export function mergeAllOf(spec: SpecObject, raw: Schema): Schema {
  const schema = resolveRef(spec, raw);
  if (!Array.isArray(schema?.allOf)) return schema;
  const merged: Schema = {
    ...schema,
    properties: { ...(schema.properties ?? {}) },
    required: [...(schema.required ?? [])],
  };
  delete merged.allOf;
  for (const part of schema.allOf as Schema[]) {
    const p = mergeAllOf(spec, part);
    Object.assign(merged.properties, p.properties ?? {});
    merged.required.push(...(p.required ?? []));
    if (!merged.type && p.type) merged.type = p.type;
    if (!merged.description && p.description) merged.description = p.description;
  }
  return merged;
}

const FORMAT_EXAMPLES: Record<string, unknown> = {
  'date-time': '2026-01-31T09:30:00Z',
  date: '2026-01-31',
  time: '09:30:00',
  email: 'user@example.com',
  uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  uri: 'https://example.com',
  url: 'https://example.com',
  hostname: 'example.com',
  ipv4: '192.0.2.1',
  ipv6: '2001:db8::1',
  byte: 'ZXhhbXBsZQ==',
};

export type ExampleMode = 'request' | 'response';

function exampleValue(spec: SpecObject, value: unknown): unknown {
  const resolved = resolveRef(spec, value);
  if (resolved && typeof resolved === 'object' && !Array.isArray(resolved) && 'value' in (resolved as SpecObject)) {
    return (resolved as SpecObject).value;
  }
  return resolved;
}

/**
 * An example value for a schema: its example / default / first enum value, or one
 * built from its properties. Request examples leave readOnly properties out,
 * responses writeOnly ones. A schema that contains itself (Node.children: Node[])
 * stops at the first repeat on the current path, and nesting stops at MAX_DEPTH,
 * so recursive specs can't hang the page.
 */
export function exampleFromSchema(
  spec: SpecObject,
  raw: Schema | undefined,
  mode: ExampleMode = 'request',
  path: Set<object> = new Set(),
): unknown {
  if (!raw || path.size >= MAX_DEPTH) return undefined;
  const schema = resolveRef(spec, raw);
  if (!schema || typeof schema !== 'object' || path.has(schema)) return undefined;
  path.add(schema);
  try {
    if (schema.example !== undefined) return exampleValue(spec, schema.example);
    if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
    if (schema.default !== undefined) return schema.default;
    if (schema.const !== undefined) return schema.const;
    if (Array.isArray(schema.enum) && schema.enum.length)
      return schema.enum.find((v: unknown) => v !== null) ?? schema.enum[0];
    if (Array.isArray(schema.allOf)) return exampleFromSchema(spec, mergeAllOf(spec, schema), mode, path);
    const variants = schema.oneOf ?? schema.anyOf;
    if (Array.isArray(variants) && variants.length) return exampleFromSchema(spec, variants[0], mode, path);
    const types = schemaTypes(schema).filter((t) => t !== 'null');
    switch (types[0]) {
      case 'object': {
        const out: Record<string, unknown> = {};
        for (const [key, prop] of Object.entries((schema.properties ?? {}) as Record<string, Schema>)) {
          const p = resolveRef(spec, prop);
          if ((mode === 'request' && p?.readOnly) || (mode === 'response' && p?.writeOnly)) continue;
          const value = exampleFromSchema(spec, prop, mode, path);
          if (value !== undefined) out[key] = value;
        }
        return out;
      }
      case 'array': {
        const item = exampleFromSchema(spec, schema.items ?? {}, mode, path);
        return item === undefined ? [] : [item];
      }
      case 'integer':
        return typeof schema.minimum === 'number' ? Math.ceil(schema.minimum) : 0;
      case 'number':
        return typeof schema.minimum === 'number' ? schema.minimum : 0;
      case 'boolean':
        return false;
      case 'string':
        return FORMAT_EXAMPLES[schema.format as string] ?? 'string';
      default:
        return undefined;
    }
  } finally {
    path.delete(schema);
  }
}

export function stringifyExample(value: unknown) {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Parameters are sent as text: strings as they are, anything else as JSON. */
export function exampleText(value: unknown) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
