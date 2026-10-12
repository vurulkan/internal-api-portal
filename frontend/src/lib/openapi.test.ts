import { describe, expect, it } from 'vitest';
import {
  beautifyBody,
  buildHeaders,
  buildQueryString,
  buildResolvedPath,
  decodeBase64Utf8,
  encodeBase64Utf8,
  parseOperations,
} from './openapi';

const spec = {
  openapi: '3.0.0',
  paths: {
    '/v1/charges/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'ch 1' } }],
      get: {
        summary: 'Get a charge',
        tags: ['charges'],
        parameters: [{ name: 'expand', in: 'query', schema: { type: 'boolean' } }],
      },
    },
    '/v1/charges': {
      post: {
        tags: ['charges'],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Charge' } } } },
        responses: { '201': { content: { 'application/json': {} } } },
      },
    },
  },
  components: {
    schemas: {
      // Self-reference must not hang the example generator.
      Charge: {
        type: 'object',
        properties: { amount: { type: 'integer' }, parent: { $ref: '#/components/schemas/Charge' } },
      },
    },
  },
};

describe('parseOperations', () => {
  const ops = parseOperations(spec);
  it('lists operations sorted by path, with merged parameters and examples', () => {
    expect(ops.map((o) => o.id)).toEqual(['POST /v1/charges', 'GET /v1/charges/{id}']);
    const get = ops[1];
    expect(get.parameters.map((p) => `${p.in}:${p.name}=${p.defaultValue}`)).toEqual([
      'path:id=ch 1',
      'query:expand=false',
    ]);
    expect(get.hasRequestBody).toBe(false);
  });
  it('builds a request body example from a recursive schema', () => {
    const post = ops[0];
    expect(post.hasRequestBody).toBe(true);
    expect(JSON.parse(post.requestBodyExample)).toEqual({ amount: 0 });
    expect(post.responseContentTypes).toEqual(['application/json']);
  });
  it('returns nothing for a spec without paths', () => {
    expect(parseOperations(null)).toEqual([]);
    expect(parseOperations({ openapi: '3.0.0' })).toEqual([]);
  });
});

describe('request building', () => {
  const [, get] = parseOperations(spec);
  const values = { 'path:id': 'a b/c', 'query:expand': 'true' };
  it('encodes path parameters once', () => {
    expect(
      buildResolvedPath(
        get.path,
        get.parameters.filter((p) => p.in === 'path'),
        values,
      ),
    ).toBe('/v1/charges/a%20b%2Fc');
  });
  it('skips empty query parameters', () => {
    expect(
      buildQueryString(
        get.parameters.filter((p) => p.in === 'query'),
        { 'query:expand': ' ' },
      ),
    ).toBe('');
    expect(
      buildQueryString(
        get.parameters.filter((p) => p.in === 'query'),
        values,
      ),
    ).toBe('expand=true');
  });
  it('parses additional headers and keeps colons in values', () => {
    expect(buildHeaders([], {}, 'X-Tenant-Id: t1\nbroken\nX-Time: 10:30', 'application/json', '', false)).toEqual({
      Accept: 'application/json',
      'X-Tenant-Id': 't1',
      'X-Time': '10:30',
    });
  });
  it('round-trips UTF-8 through base64 and pretty-prints JSON', () => {
    expect(decodeBase64Utf8(encodeBase64Utf8('çğış — ✓'))).toBe('çğış — ✓');
    expect(beautifyBody('{"a":1}', 'application/json')).toBe('{\n  "a": 1\n}');
    expect(beautifyBody('not json {', 'text/plain')).toBe('not json {');
  });
});
