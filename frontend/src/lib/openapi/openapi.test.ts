import { describe, expect, it } from 'vitest';
import {
  decodeBase64Utf8,
  encodeBase64Utf8,
  exampleFromSchema,
  firstOperation,
  headerAllowed,
  normalizeSpec,
  operationsByTag,
  parameterDefault,
  prettyBody,
  queryString,
  requestHeaders,
  resolvePath,
  resolveRef,
  snippet,
  typeLabel,
  validateParameters,
  type SpecObject,
} from '.';

const oas3: SpecObject = {
  openapi: '3.0.3',
  info: { title: 'Payments', version: '2.3.1', description: 'Card payments.' },
  tags: [{ name: 'refunds' }, { name: 'charges', description: 'Charging cards' }],
  security: [{ apiKey: [] }],
  components: {
    securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } },
    parameters: { Limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, default: 20 } } },
    schemas: {
      Charge: {
        type: 'object',
        required: ['amount'],
        properties: {
          id: { type: 'string', readOnly: true },
          amount: { type: 'integer', minimum: 1 },
          currency: { type: 'string', enum: ['EUR', 'USD'] },
          secret: { type: 'string', writeOnly: true },
          parent: { $ref: '#/components/schemas/Charge' },
          created: { type: 'string', format: 'date-time' },
        },
      },
      // A → B → A: the F3 crash (infinite recursion) must not come back.
      A: { $ref: '#/components/schemas/B' },
      B: { $ref: '#/components/schemas/A' },
      Node: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          children: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
        },
      },
    },
  },
  paths: {
    '/v1/charges': {
      get: {
        operationId: 'listCharges',
        tags: ['charges'],
        parameters: [{ $ref: '#/components/parameters/Limit' }],
        responses: { 200: { description: 'ok' } },
      },
      post: {
        operationId: 'createCharge',
        tags: ['charges'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Charge' } } },
        },
        responses: {
          201: {
            description: 'Created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Charge' } } },
          },
          default: { description: 'Error' },
        },
      },
    },
    '/v1/charges/{id}': {
      parameters: [{ name: 'id', in: 'path', schema: { type: 'string' }, example: 'ch_1' }],
      get: {
        operationId: 'dup',
        parameters: [{ name: 'id', in: 'path', description: 'Overridden', schema: { type: 'string' } }],
        responses: {},
      },
      delete: { operationId: 'dup', deprecated: true, security: [], responses: {} },
    },
    '/v1/loops': {
      get: {
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/A' } } } },
        responses: {},
      },
    },
    '/v1/tree': {
      post: {
        tags: ['refunds'],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } },
        responses: {},
      },
    },
  },
};

describe('normalizeSpec (OpenAPI 3)', () => {
  const spec = normalizeSpec(oas3);
  const byKey = (k: string) => spec.operations.find((o) => o.key === k)!;

  it('reads info and every operation, with unique keys', () => {
    expect(spec).toMatchObject({ openapi: '3.0.3', title: 'Payments', version: '2.3.1' });
    expect(spec.operations.map((o) => o.key)).toEqual([
      'listCharges',
      'createCharge',
      'GET /v1/charges/{id}',
      'DELETE /v1/charges/{id}',
      'GET /v1/loops',
      'POST /v1/tree',
    ]);
  });

  it('merges path-level parameters, resolves $ref parameters, path params are required', () => {
    const get = byKey('GET /v1/charges/{id}');
    expect(get.parameters).toHaveLength(1);
    expect(get.parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true, description: 'Overridden' });
    expect(byKey('listCharges').parameters[0]).toMatchObject({ name: 'limit', in: 'query', required: false });
    expect(parameterDefault(oas3, byKey('listCharges').parameters[0])).toBe('20');
  });

  it('keeps security per operation (empty list = no auth) and responses sorted', () => {
    expect(byKey('createCharge').security[0][0]).toMatchObject({ type: 'apiKey', name: 'X-Api-Key', in: 'header' });
    expect(byKey('DELETE /v1/charges/{id}').security).toEqual([]);
    expect(byKey('createCharge').responses.map((r) => r.status)).toEqual(['201', 'default']);
  });

  it('opens on the first operation of the tree, not the first path', () => {
    expect(firstOperation(spec)?.key).toBe('POST /v1/tree');
  });

  it('groups by tag in the spec order, untagged last', () => {
    expect(operationsByTag(spec, 'Other').map(([tag, ops]) => `${tag}:${ops.length}`)).toEqual([
      'refunds:1',
      'charges:2',
      'Other:3',
    ]);
  });
});

describe('schemas', () => {
  it('build request and response examples (readOnly / writeOnly), stopping at cycles', () => {
    const charge = { $ref: '#/components/schemas/Charge' };
    expect(exampleFromSchema(oas3, charge, 'request')).toEqual({
      amount: 1,
      currency: 'EUR',
      secret: 'string',
      created: '2026-01-31T09:30:00Z',
    });
    expect(exampleFromSchema(oas3, charge, 'response')).toEqual({
      id: 'string',
      amount: 1,
      currency: 'EUR',
      created: '2026-01-31T09:30:00Z',
    });
    expect(exampleFromSchema(oas3, { $ref: '#/components/schemas/Node' })).toEqual({ name: 'string', children: [] });
  });

  it('a $ref loop resolves to something finite (F3)', () => {
    expect(() => resolveRef(oas3, { $ref: '#/components/schemas/A' })).not.toThrow();
    expect(exampleFromSchema(oas3, { $ref: '#/components/schemas/A' })).toBeUndefined();
    expect(normalizeSpec(oas3).operations.find((o) => o.path === '/v1/loops')).toBeDefined();
  });

  it('label types', () => {
    expect(typeLabel(oas3, { $ref: '#/components/schemas/Charge' })).toBe('Charge');
    expect(typeLabel(oas3, { type: 'array', items: { $ref: '#/components/schemas/Charge' } })).toBe('array<Charge>');
    expect(typeLabel(oas3, { type: ['string', 'null'], format: 'uuid' })).toBe('string<uuid> | null');
    expect(typeLabel(oas3, { oneOf: [{ type: 'integer' }, { type: 'string' }] })).toBe('integer | string');
  });
});

describe('normalizeSpec (Swagger 2.0)', () => {
  const swagger: SpecObject = {
    swagger: '2.0',
    info: { title: 'Pets', version: 1.5 },
    consumes: ['application/json'],
    produces: ['application/json', 'application/xml'],
    securityDefinitions: { basic: { type: 'basic' } },
    paths: {
      '/pets': {
        post: {
          parameters: [
            {
              in: 'body',
              name: 'pet',
              required: true,
              schema: { type: 'object', properties: { name: { type: 'string' } } },
            },
          ],
          responses: { 200: { description: 'ok', schema: { type: 'object' } } },
        },
        put: {
          consumes: ['multipart/form-data'],
          parameters: [{ in: 'formData', name: 'photo', type: 'file', required: true }],
          responses: {},
        },
        get: {
          parameters: [
            { in: 'query', name: 'status', type: 'string', enum: ['sold', 'available'], 'x-example': 'sold' },
          ],
          responses: {},
        },
      },
    },
  };
  const spec = normalizeSpec(swagger);
  it('turns body and formData parameters into a request body, produces into response content', () => {
    const post = spec.operations.find((o) => o.method === 'POST')!;
    expect(spec.version).toBe('1.5');
    expect(post.requestBody).toMatchObject({ required: true, content: [{ contentType: 'application/json' }] });
    expect(post.parameters).toEqual([]);
    expect(post.responses[0].content.map((c) => c.contentType)).toEqual(['application/json', 'application/xml']);
    const put = spec.operations.find((o) => o.method === 'PUT')!;
    expect(put.requestBody?.content[0]).toMatchObject({ contentType: 'multipart/form-data' });
    const get = spec.operations.find((o) => o.method === 'GET')!;
    expect(get.parameters[0].schema).toMatchObject({ type: 'string', enum: ['sold', 'available'] });
    expect(parameterDefault(swagger, get.parameters[0])).toBe('sold');
  });
  it('tolerates junk', () => {
    expect(normalizeSpec(null).operations).toEqual([]);
    expect(normalizeSpec({ paths: { '/x': 'nope', '/y': { get: 'nope' } } }).operations).toEqual([]);
  });
});

describe('requests', () => {
  const op = normalizeSpec(oas3).operations.find((o) => o.key === 'GET /v1/charges/{id}')!;
  it('encodes path parameters once and skips empty query values', () => {
    expect(resolvePath(op.path, op.parameters, { 'path:id': 'a b/c' })).toBe('/v1/charges/a%20b%2Fc');
    const list = normalizeSpec(oas3).operations[0];
    expect(queryString(list.parameters, { 'query:limit': ' ' })).toBe('');
    expect(queryString(list.parameters, { 'query:limit': '5' })).toBe('limit=5');
  });

  it('validates types, enums and required values', () => {
    const list = normalizeSpec(oas3).operations[0];
    expect(validateParameters(oas3, list.parameters, { 'query:limit': 'ten' })).toEqual([
      { id: 'query:limit', name: 'limit', message: 'integer' },
    ]);
    expect(validateParameters(oas3, op.parameters, {})).toEqual([{ id: 'path:id', name: 'id', message: 'required' }]);
    expect(validateParameters(oas3, list.parameters, { 'query:limit': '10' })).toEqual([]);
  });

  it('knows which headers the portal forwards', () => {
    expect(headerAllowed('content-type', [], false)).toBe(true);
    expect(headerAllowed('X-Tenant-Id', ['x-tenant-id'], false)).toBe(true);
    expect(headerAllowed('X-Other', [], false)).toBe(false);
    expect(headerAllowed('X-Other', [], true)).toBe(true);
    expect(headerAllowed('X-Forwarded-For', [], true)).toBe(false);
  });

  it('round-trips UTF-8 bodies and pretty-prints JSON', () => {
    expect(decodeBase64Utf8(encodeBase64Utf8('çğış — ✓'))).toBe('çğış — ✓');
    expect(prettyBody('{"a":1}', 'application/problem+json')).toBe('{\n  "a": 1\n}');
    expect(prettyBody('not json {', 'text/plain')).toBe('not json {');
  });
});

describe('snippets', () => {
  const headers = requestHeaders(
    normalizeSpec(oas3).operations[1],
    {},
    [
      { name: 'Authorization', value: 'Bearer real-token-123' },
      { name: 'X-Tenant-Id', value: "t'1" },
    ],
    'application/json',
    'application/json',
    true,
  );
  const input = {
    method: 'POST',
    url: '/v1/charges?limit=5',
    headers,
    injected: ['X-Service-Key'],
    body: '{"amount":10}',
  };

  it.each(['curl', 'fetch', 'httpie', 'go'] as const)('%s never contains secret values', (lang) => {
    const code = snippet(lang, input);
    expect(code).not.toContain('real-token-123');
    expect(code).toContain('<Authorization>');
    expect(code).toContain('<X-Service-Key>');
    expect(code).toContain('/v1/charges?limit=5');
    expect(code).toContain('BASE_URL');
  });

  it('quotes for the shell and uses the real base URL for managers', () => {
    const code = snippet('curl', { ...input, baseUrl: 'http://pay.internal:8080/' });
    expect(code).toContain(`curl -X POST 'http://pay.internal:8080/v1/charges?limit=5'`);
    expect(code).toContain(`-H 'X-Tenant-Id: t'\\''1'`);
    expect(code).toContain(`--data-raw '{"amount":10}'`);
  });
});
