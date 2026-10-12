import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { meResponse, publicRoutes } from '@/test/fixtures';
import { apiError, json, mockFetch } from '@/test/fetchMock';
import { renderApp } from '@/test/render';
import { expectNoA11yViolations } from '@/test/a11y';

// Swagger UI: counts how often the (lazy) module is loaded.
const swaggerLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/components/SwaggerDocs', () => {
  swaggerLoads.count++;
  return { default: () => <div>Swagger UI here</div> };
});

// CodeMirror needs layout APIs jsdom lacks; a textarea stands in for it.
vi.mock('@/components/api/CodeEditor', () => ({
  default: ({
    value,
    onChange,
    label,
    readOnly,
  }: {
    value: string;
    onChange?: (v: string) => void;
    label: string;
    readOnly?: boolean;
  }) => <textarea aria-label={label} value={value} readOnly={readOnly} onChange={(e) => onChange?.(e.target.value)} />,
}));

const spec = {
  openapi: '3.0.3',
  info: { title: 'Payments', version: '2.3.1', description: 'Card **payments**. <script>alert(1)</script>' },
  components: {
    securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-Service-Key' } },
    schemas: {
      Charge: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'integer', minimum: 1 },
          currency: { type: 'string', enum: ['EUR', 'USD'] },
          parent: { $ref: '#/components/schemas/Charge' },
        },
      },
    },
  },
  security: [{ key: [] }],
  paths: {
    '/v1/charges': {
      post: {
        operationId: 'createCharge',
        summary: 'Create a charge',
        tags: ['charges'],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'mode', in: 'query', schema: { type: 'string', enum: ['test', 'live'] } },
          { name: 'X-Tenant-Id', in: 'header', schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Charge' } } },
        },
        responses: {
          201: {
            description: 'Created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Charge' } } },
          },
          400: { description: 'Bad request' },
        },
      },
    },
    '/v1/charges/{id}': {
      get: {
        operationId: 'getCharge',
        summary: 'Get a charge',
        tags: ['charges'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'ok' } },
      },
    },
    '/v1/old': { get: { operationId: 'legacy', deprecated: true, responses: { 200: { description: 'ok' } } } },
  },
};

function details(extra: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Payments API',
    slug: 'payments',
    description: 'Charges.',
    isActive: true,
    tryItEnabled: true,
    allowedMethods: [],
    allowedPathPrefixes: ['/v1'],
    ownerTeam: 'payments-team',
    tags: ['payments'],
    specState: 'ok',
    specVersion: '2.3.1',
    operationCount: 3,
    lastSpecRefreshAt: new Date().toISOString(),
    allowedRequestHeaders: ['X-Tenant-Id', 'Authorization'],
    forwardAllXHeaders: false,
    injectHeaderNames: ['X-Service-Key'],
    favorite: false,
    permissions: { view: true, invoke: true, manage: false },
    ...extra,
  };
}

function routes(extra: Record<string, unknown> = {}, det = details()) {
  return {
    ...publicRoutes,
    'GET /api/auth/me': meResponse(
      { isAdmin: false },
      {
        capabilities: {
          adminSections: [],
          managesAllApis: false,
          managedApis: [],
          canCreateApi: false,
          canExportAudit: false,
        },
      },
    ),
    'GET /api/apis/payments': det,
    'GET /api/apis/payments/spec': spec,
    'GET /api/apis/1': det,
    'GET /api/apis/1/spec': spec,
    ...extra,
  };
}

const okResponse = {
  statusCode: 201,
  headers: { 'Content-Type': 'application/json' },
  bodyBase64: btoa('{"id":"ch_1","amount":10}'),
  contentType: 'application/json',
  truncated: false,
  requestBytes: 12,
  responseBytes: 26,
  durationMs: 42,
  rateLimit: { limitPerMinute: 120, remaining: 119 },
};

describe('API workspace', () => {
  it('opens the first operation, with a deep link per operation and Back / Forward', async () => {
    mockFetch(routes());
    const user = userEvent.setup();
    const { router } = renderApp('/apis/payments');
    expect(await screen.findByRole('heading', { level: 2, name: 'Create a charge' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/apis/payments/operations/createCharge');
    const tree = await screen.findByRole('list', { name: 'Operations' });
    await user.click(within(tree).getByRole('link', { name: /\/v1\/charges\/\{id\}/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Get a charge' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/apis/payments/operations/getCharge');
    expect(within(tree).getByRole('link', { name: /\/v1\/charges\/\{id\}/ })).toHaveAttribute('aria-current', 'page');
    await router.navigate(-1);
    expect(await screen.findByRole('heading', { level: 2, name: 'Create a charge' })).toBeInTheDocument();
    // Deprecated operations sit in their own group.
    expect(within(tree).getByText('Deprecated')).toBeInTheDocument();
  });

  it('documents parameters, body schema (circular refs) and responses; markdown without HTML', async () => {
    mockFetch(routes());
    const user = userEvent.setup();
    renderApp('/apis/payments/operations/createCharge');
    const doc = await screen.findByRole('article', { name: 'Create a charge' });
    const params = within(doc).getByRole('table', { name: 'Parameters' });
    expect(within(params).getByText('limit')).toBeInTheDocument();
    expect(within(params).getByText('integer')).toBeInTheDocument();
    expect(within(doc).getAllByText('circular').length).toBeGreaterThan(0);
    expect(within(doc).getByText(/the portal adds it for you/)).toBeInTheDocument();
    await user.click(within(doc).getByRole('tab', { name: '400' }));
    expect(within(doc).getByText('Bad request')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Overview' }));
    expect(await screen.findByText('payments', { selector: 'strong' })).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });

  it('try it: validates, sends with ⌘↵, announces the response and keeps no secrets', async () => {
    const calls = mockFetch(routes({ 'POST /api/apis/1/invoke': okResponse }));
    const user = userEvent.setup();
    renderApp('/apis/payments/operations/createCharge');
    const limit = await screen.findByLabelText(/^limit/);
    await user.type(limit, 'ten');
    await user.tab();
    expect(limit).toHaveAccessibleDescription(/must be a whole number/);
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Fix 1 problem');
    expect(calls.some((c) => c.url.includes('/invoke'))).toBe(false);

    await user.clear(limit);
    await user.type(limit, '5');
    await user.click(screen.getByRole('button', { name: 'Add header' }));
    await user.clear(screen.getByLabelText('Header 1 name'));
    await user.type(screen.getByLabelText('Header 1 name'), 'Authorization');
    await user.type(screen.getByLabelText('Header 1 value'), 'Bearer top-secret-77');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    const heading = await screen.findByRole('heading', { name: 'Response' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Response received: 201, 42 ms');
    const sent = calls.find((c) => c.url === '/api/apis/1/invoke')!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ method: 'POST', path: '/v1/charges', query: 'limit=5' });
    expect(sent.headers).toMatchObject({ Authorization: 'Bearer top-secret-77', 'Content-Type': 'application/json' });
    expect(JSON.parse(atob(String(sent.bodyBase64)))).toEqual({ amount: 1, currency: 'EUR' });

    // The secret is in no snippet and not in storage.
    const code = screen.getByRole('region', { name: 'Code' });
    expect(code).not.toHaveTextContent('top-secret-77');
    expect(code).toHaveTextContent('<Authorization>');
    expect(code).toHaveTextContent('<X-Service-Key>');
    expect(JSON.stringify({ ...localStorage })).not.toContain('top-secret-77');
    expect(screen.getByRole('region', { name: 'History' })).toHaveTextContent('201');
  });

  it('explains portal refusals and counts down a rate limit', async () => {
    // What the portal really answers (403 + code forbidden).
    let reply: Response = apiError(403, "path /admin is not in this API's allowlist", 'forbidden');
    mockFetch(routes({ 'POST /api/apis/1/invoke': () => reply }));
    const user = userEvent.setup();
    renderApp('/apis/payments/operations/getCharge');
    await user.type(await screen.findByLabelText(/^id/), 'ch_1');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Not allowed through the portal')).toBeInTheDocument();
    expect(screen.getByText('Allowed paths: /v1')).toBeInTheDocument();
    reply = apiError(429, 'rate limit', 'rate_limited', { 'Retry-After': '32' });
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(/You can send again in 0:3[12]/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
  });

  it('can be cancelled while sending', async () => {
    mockFetch(
      routes({
        'POST /api/apis/1/invoke': (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
          ),
      }),
    );
    const user = userEvent.setup();
    renderApp('/apis/payments/operations/getCharge');
    await user.type(await screen.findByLabelText(/^id/), 'ch_1');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send request' })).not.toHaveAttribute('aria-busy'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says why try it is unavailable, and hides manager tabs from viewers', async () => {
    mockFetch(routes({}, details({ permissions: { view: true, invoke: false, manage: false } })));
    renderApp('/apis/payments/operations/createCharge');
    expect(await screen.findByText('You may read, not call this API')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Access' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Activity' })).not.toBeInTheDocument();
  });

  it('managers see the spec history and the internal address in snippets', async () => {
    mockFetch(
      routes(
        {
          'GET /api/apis/payments/activity': {
            items: [
              {
                at: new Date().toISOString(),
                kind: 'changed',
                version: '2.4.0',
                operationCount: 3,
                addedCount: 1,
                removedCount: 0,
                changedCount: 1,
                added: ['POST /v1/refunds'],
                removed: [],
                changed: ['GET /v1/charges/{id}'],
              },
              {
                at: new Date().toISOString(),
                kind: 'failed',
                operationCount: 0,
                addedCount: 0,
                removedCount: 0,
                changedCount: 0,
                added: [],
                removed: [],
                changed: [],
                error: 'spec fetch failed with status 502',
              },
            ],
          },
          'POST /api/apis/1/invoke': json(okResponse),
        },
        details({
          permissions: { view: true, invoke: true, manage: true },
          internalBaseUrl: 'http://pay.internal:8080',
        }),
      ),
    );
    const user = userEvent.setup();
    renderApp('/apis/payments/operations/getCharge');
    expect(await screen.findByRole('region', { name: 'Code' })).toHaveTextContent(
      'http://pay.internal:8080/v1/charges/',
    );
    await user.click(screen.getByRole('link', { name: 'Activity' }));
    expect(await screen.findByText('Spec changed')).toBeInTheDocument();
    expect(screen.getByText('1 added')).toBeInTheDocument();
    expect(screen.getByText('spec fetch failed with status 502')).toBeInTheDocument();
  });

  it('old links (?op=…&tab=try) land on the operation', async () => {
    mockFetch(routes());
    const { router } = renderApp(`/apis/1?${new URLSearchParams({ op: 'GET /v1/charges/{id}', tab: 'try' })}`);
    await waitFor(() => expect(router.state.location.pathname).toBe('/apis/payments/operations/getCharge'));
  });

  it('loads Swagger UI only when the Classic tab opens', async () => {
    mockFetch(routes());
    const user = userEvent.setup();
    renderApp('/apis/payments/operations/createCharge');
    await screen.findByRole('article', { name: 'Create a charge' });
    expect(swaggerLoads.count).toBe(0);
    await user.click(screen.getByRole('link', { name: 'Classic' }));
    expect(await screen.findByText('Swagger UI here')).toBeInTheDocument();
    expect(swaggerLoads.count).toBe(1);
  });

  it('renders a 1000-operation tree without 1000 rows', async () => {
    // jsdom has no layout: give the side panel a real size.
    // (TanStack Virtual measures offsetWidth / offsetHeight.)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240);
    const paths = Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [
        `/v1/items/${i}`,
        { get: { operationId: `item${i}`, tags: [`group${i % 10}`], responses: {} } },
      ]),
    );
    mockFetch(routes({ 'GET /api/apis/payments/spec': { openapi: '3.0.0', info: { version: '1' }, paths } }));
    renderApp('/apis/payments/operations/item0');
    await screen.findByRole('heading', { level: 2, name: 'GET /v1/items/0' });
    const tree = await screen.findByRole('list', { name: 'Operations' });
    expect(screen.getByText('1000 operations')).toBeInTheDocument();
    await waitFor(() => expect(within(tree).queryAllByRole('link').length).toBeGreaterThan(5));
    const rendered = within(tree).getAllByRole('link').length;
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(100);
    vi.restoreAllMocks();
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    localStorage.setItem('portal.theme', theme);
    mockFetch(routes({ 'POST /api/apis/1/invoke': okResponse }));
    const user = userEvent.setup();
    renderApp('/apis/payments/operations/createCharge');
    await screen.findByRole('article', { name: 'Create a charge' });
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('heading', { name: 'Response' });
    await expectNoA11yViolations();
  });
});
