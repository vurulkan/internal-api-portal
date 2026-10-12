// A small upstream API for the browser tests: an OpenAPI document and the
// operations it documents (try-it calls are echoed back).
import { createServer } from 'node:http';

const spec = {
  openapi: '3.0.3',
  info: { title: 'Payments', version: '2.3.1', description: 'Card **payments** and refunds.' },
  tags: [{ name: 'charges', description: 'Charging cards' }, { name: 'refunds' }],
  components: {
    securitySchemes: { serviceKey: { type: 'apiKey', in: 'header', name: 'X-Service-Key' } },
    schemas: {
      Charge: {
        type: 'object',
        required: ['amount', 'currency'],
        properties: {
          id: { type: 'string', readOnly: true, example: 'ch_1' },
          amount: { type: 'integer', minimum: 1, example: 1250 },
          currency: { type: 'string', enum: ['EUR', 'USD', 'TRY'] },
          description: { type: 'string', nullable: true },
        },
      },
    },
  },
  security: [{ serviceKey: [] }],
  paths: {
    '/v1/charges': {
      get: {
        operationId: 'listCharges',
        summary: 'List charges',
        tags: ['charges'],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, default: 20 } },
          { name: 'X-Tenant-Id', in: 'header', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'A page',
            content: {
              'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Charge' } } },
            },
          },
        },
      },
      post: {
        operationId: 'createCharge',
        summary: 'Create a charge',
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
          400: { description: 'Invalid request' },
        },
      },
    },
    '/v1/charges/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, example: 'ch_1' }],
      get: {
        operationId: 'getCharge',
        summary: 'Get a charge',
        tags: ['charges'],
        responses: { 200: { description: 'The charge' } },
      },
      delete: {
        operationId: 'cancelCharge',
        summary: 'Cancel a charge',
        deprecated: true,
        tags: ['charges'],
        responses: { 204: { description: 'Cancelled' } },
      },
    },
    '/v1/refunds': {
      post: {
        operationId: 'createRefund',
        summary: 'Refund a charge',
        tags: ['refunds'],
        responses: { 201: { description: 'Refunded' } },
      },
    },
  },
};

// A large spec (1500 operations over 50 tags) for the performance budgets.
const large = {
  openapi: '3.0.3',
  info: { title: 'Warehouse', version: '9.0.0' },
  paths: Object.fromEntries(
    Array.from({ length: 750 }, (_, i) => [
      `/v1/area${i % 50}/items${i}`,
      {
        get: {
          operationId: `listItems${i}`,
          summary: `List items of shelf ${i}`,
          tags: [`area${i % 50}`],
          responses: { 200: { description: 'ok' } },
        },
        post: {
          operationId: `createItem${i}`,
          summary: `Store an item on shelf ${i}`,
          tags: [`area${i % 50}`],
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Charge' } } } },
          responses: { 201: { description: 'stored' } },
        },
      },
    ]),
  ),
  components: spec.components,
};

const port = Number(process.env.UPSTREAM_PORT ?? 18096);
createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://upstream');
  if (url.pathname === '/openapi.json' || url.pathname === '/large.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(url.pathname === '/large.json' ? large : spec));
    return;
  }
  if (url.pathname === '/healthz') {
    res.end('ok');
    return;
  }
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const status = req.method === 'POST' ? 201 : 200;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        method: req.method,
        path: url.pathname,
        query: url.search,
        received: body ? JSON.parse(body) : null,
      }),
    );
  });
}).listen(port, '127.0.0.1');
