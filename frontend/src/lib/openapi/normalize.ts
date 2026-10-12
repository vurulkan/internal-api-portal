import { resolveRef } from './resolve';
import type {
  MediaType,
  NormalizedSpec,
  Operation,
  Parameter,
  ParameterLocation,
  RequestBody,
  Response,
  Schema,
  SecurityScheme,
  SpecObject,
} from './types';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const LOCATIONS: ParameterLocation[] = ['path', 'query', 'header', 'cookie'];

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const asObject = (v: unknown): SpecObject => (v && typeof v === 'object' && !Array.isArray(v) ? (v as SpecObject) : {});
const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** Turns an OpenAPI 2.0 / 3.0 / 3.1 document into one operation model. */
export function normalizeSpec(raw: SpecObject | null | undefined): NormalizedSpec {
  const spec = asObject(raw);
  const swagger2 = typeof spec.swagger === 'string';
  const info = asObject(spec.info);
  const schemes = securitySchemes(spec, swagger2);
  const operations: Operation[] = [];

  for (const [path, rawItem] of Object.entries(asObject(spec.paths))) {
    const item = asObject(resolveRef(spec, rawItem));
    const shared = asArray<SpecObject>(item.parameters);
    for (const method of METHODS) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;
      const allParams = mergeParameters(spec, shared, asArray<SpecObject>(op.parameters));
      const consumes = swagger2 ? [...asArray<string>(op.consumes), ...asArray<string>(spec.consumes)] : [];
      const produces = swagger2 ? [...asArray<string>(op.produces), ...asArray<string>(spec.produces)] : [];
      const security = (op.security ?? spec.security) as unknown;
      operations.push({
        key: '',
        method: method.toUpperCase(),
        path,
        operationId: text(op.operationId) || undefined,
        summary: text(op.summary),
        description: text(op.description),
        tags: asArray<string>(op.tags).filter((t) => typeof t === 'string'),
        deprecated: op.deprecated === true,
        parameters: allParams
          .filter((p): p is SpecObject => LOCATIONS.includes(p.in))
          .map((p) => toParameter(spec, p, swagger2)),
        requestBody: swagger2 ? swagger2Body(allParams, consumes) : openapi3Body(spec, op.requestBody),
        responses: responses(spec, op.responses, swagger2, produces),
        security: asArray<SpecObject>(security).map((req) =>
          Object.keys(asObject(req))
            .map((k) => schemes.get(k))
            .filter((s): s is SecurityScheme => !!s),
        ),
      });
    }
  }
  operations.sort(
    (a, b) =>
      a.path.localeCompare(b.path) || METHODS.indexOf(a.method.toLowerCase()) - METHODS.indexOf(b.method.toLowerCase()),
  );
  assignKeys(operations);
  return {
    openapi: text(spec.openapi) || text(spec.swagger),
    title: text(info.title),
    version: typeof info.version === 'number' ? String(info.version) : text(info.version),
    description: text(info.description),
    tags: asArray<SpecObject>(spec.tags)
      .map((t) => ({ name: text(t.name), description: text(t.description) }))
      .filter((t) => t.name),
    operations,
    raw: spec,
  };
}

/** operationId when unique; otherwise "METHOD /path" (always unique). */
function assignKeys(ops: Operation[]) {
  const counts = new Map<string, number>();
  ops.forEach((op) => op.operationId && counts.set(op.operationId, (counts.get(op.operationId) ?? 0) + 1));
  ops.forEach((op) => {
    op.key = op.operationId && counts.get(op.operationId) === 1 ? op.operationId : `${op.method} ${op.path}`;
  });
}

/** Operation parameters override path-level ones with the same name and location. */
function mergeParameters(spec: SpecObject, shared: SpecObject[], own: SpecObject[]) {
  const out = new Map<string, SpecObject>();
  for (const raw of [...shared, ...own]) {
    const p = asObject(resolveRef(spec, raw));
    if (!p.name || !p.in) continue;
    out.set(`${p.in}:${p.name}`, p);
  }
  return Array.from(out.values());
}

function toParameter(spec: SpecObject, p: SpecObject, swagger2: boolean): Parameter {
  // 2.0 puts type / format / enum on the parameter itself.
  const schema: Schema | undefined = swagger2
    ? {
        type: p.type,
        format: p.format,
        enum: p.enum,
        items: p.items,
        default: p.default,
        minimum: p.minimum,
        maximum: p.maximum,
      }
    : (p.schema as Schema | undefined);
  let example: unknown = p.example ?? p['x-example'];
  if (example === undefined && p.examples && typeof p.examples === 'object') {
    const first = Object.values(p.examples as SpecObject)[0];
    example = asObject(resolveRef(spec, first)).value;
  }
  return {
    name: String(p.name),
    in: p.in,
    required: p.in === 'path' || p.required === true,
    deprecated: p.deprecated === true,
    description: text(p.description),
    schema,
    example,
  };
}

function mediaTypes(spec: SpecObject, content: unknown): MediaType[] {
  return Object.entries(asObject(content)).map(([contentType, raw]) => {
    const media = asObject(resolveRef(spec, raw));
    return {
      contentType,
      schema: media.schema as Schema | undefined,
      example: media.example,
      examples: Object.entries(asObject(media.examples)).map(([name, ex]) => {
        const e = asObject(resolveRef(spec, ex));
        return { name, summary: text(e.summary) || undefined, value: e.value };
      }),
    };
  });
}

function openapi3Body(spec: SpecObject, raw: unknown): RequestBody | undefined {
  if (!raw) return undefined;
  const body = asObject(resolveRef(spec, raw));
  return {
    required: body.required === true,
    description: text(body.description),
    content: mediaTypes(spec, body.content),
  };
}

function swagger2Body(params: SpecObject[], consumes: string[]): RequestBody | undefined {
  const body = params.find((p) => p.in === 'body');
  const form = params.filter((p) => p.in === 'formData');
  if (body) {
    const types = consumes.length ? Array.from(new Set(consumes)) : ['application/json'];
    return {
      required: body.required === true,
      description: text(body.description),
      content: types.map((contentType) => ({
        contentType,
        schema: body.schema as Schema,
        example: body['x-example'],
        examples: [],
      })),
    };
  }
  if (form.length) {
    const schema: Schema = {
      type: 'object',
      properties: Object.fromEntries(
        form.map((p) => [
          p.name,
          {
            type: p.type === 'file' ? 'string' : p.type,
            format: p.type === 'file' ? 'binary' : p.format,
            description: p.description,
          },
        ]),
      ),
      required: form.filter((p) => p.required).map((p) => p.name),
    };
    const contentType = form.some((p) => p.type === 'file')
      ? 'multipart/form-data'
      : 'application/x-www-form-urlencoded';
    return {
      required: form.some((p) => p.required),
      description: '',
      content: [{ contentType, schema, examples: [] }],
    };
  }
  return undefined;
}

function responses(spec: SpecObject, raw: unknown, swagger2: boolean, produces: string[]): Response[] {
  return Object.entries(asObject(raw))
    .filter(([status]) => /^([1-5](\d\d|XX)|default)$/i.test(status))
    .map(([status, value]) => {
      const r = asObject(resolveRef(spec, value));
      const content = swagger2
        ? r.schema
          ? (produces.length ? Array.from(new Set(produces)) : ['application/json']).map((contentType) => ({
              contentType,
              schema: r.schema as Schema,
              example: asObject(r.examples)[contentType],
              examples: [],
            }))
          : []
        : mediaTypes(spec, r.content);
      return {
        status,
        description: text(r.description),
        content,
        headers: Object.entries(asObject(r.headers)).map(([name, h]) => {
          const header = asObject(resolveRef(spec, h));
          return { name, description: text(header.description), schema: (header.schema ?? header) as Schema };
        }),
      };
    })
    .sort((a, b) => (a.status === 'default' ? 1 : b.status === 'default' ? -1 : a.status.localeCompare(b.status)));
}

function securitySchemes(spec: SpecObject, swagger2: boolean) {
  const defs = swagger2 ? asObject(spec.securityDefinitions) : asObject(asObject(spec.components).securitySchemes);
  const out = new Map<string, SecurityScheme>();
  for (const [key, raw] of Object.entries(defs)) {
    const s = asObject(resolveRef(spec, raw));
    out.set(key, {
      key,
      type: text(s.type),
      name: text(s.name) || undefined,
      in: text(s.in) || undefined,
      scheme: text(s.scheme) || undefined,
      description: text(s.description) || undefined,
    });
  }
  return out;
}

/** Operations grouped by their first tag (untagged last), in spec order. */
export function operationsByTag(spec: NormalizedSpec, untagged: string) {
  const order = spec.tags.map((t) => t.name);
  const groups = new Map<string, Operation[]>();
  for (const op of spec.operations) {
    const tag = op.tags[0] ?? untagged;
    groups.set(tag, [...(groups.get(tag) ?? []), op]);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === untagged) return 1;
    if (b === untagged) return -1;
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib) || a.localeCompare(b);
  });
}
