import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { catalog, meResponse, publicRoutes } from '@/test/fixtures';
import { apiError, json, mockFetch } from '@/test/fetchMock';
import { renderApp } from '@/test/render';
import { expectNoA11yViolations } from '@/test/a11y';

const base = {
  ...publicRoutes,
  'GET /api/auth/me': meResponse(),
  'GET /api/admin/groups': [{ id: 7, name: 'payments-team', description: '', createdAt: '' }],
  'GET /api/catalog': catalog,
};
const existing = {
  ...catalog[0],
  internalOpenapiUrl: 'http://pay.internal/openapi.json',
  internalBaseUrl: 'http://pay.internal',
  allowedMethods: [],
  allowedPathPrefixes: [],
  injectHeaderNames: ['X-Service-Key'],
  lastSpecRefreshAt: '2026-01-01T00:00:00Z',
  lastSpecStatus: 'error: dial tcp 10.0.0.9:80: refused',
};

describe('API wizard', () => {
  it('validates each step, previews the spec and creates the API', async () => {
    const calls = mockFetch({
      ...base,
      'GET /api/admin/apis': [],
      'POST /api/admin/apis/spec-preview': {
        format: 'yaml',
        bytes: 4096,
        openapi: '3.0.3',
        title: 'Ledger',
        version: '1.4.0',
        operationCount: 12,
        tagCount: 3,
        sample: [{ method: 'GET', path: '/v1/entries', summary: 'List entries' }],
      },
      'POST /api/admin/apis': () => json({ id: 9 }, 201),
      'PUT /api/admin/apis/9/access': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    renderApp('/admin/apis?new=1');
    const drawer = await screen.findByRole('dialog', { name: 'New API' });
    expect(within(drawer).getByRole('listitem', { current: 'step' })).toHaveTextContent('Source');
    await user.click(within(drawer).getByRole('button', { name: /Next/ }));
    expect(within(drawer).getByLabelText(/^Name/)).toHaveFocus();
    expect(within(drawer).getByLabelText(/Internal OpenAPI URL/)).toHaveAccessibleDescription(/Required/);

    await user.type(within(drawer).getByLabelText(/Internal OpenAPI URL/), 'http://ledger.internal/openapi.yaml');
    await user.click(within(drawer).getByRole('button', { name: 'Preview spec' }));
    expect(await within(drawer).findByText('12')).toBeInTheDocument();
    expect(within(drawer).getByText('/v1/entries')).toBeInTheDocument();
    // The empty name took the spec's title, and the slug followed.
    expect(within(drawer).getByLabelText(/^Name/)).toHaveValue('Ledger');
    expect(within(drawer).getByLabelText(/^Slug/)).toHaveValue('ledger');
    await user.type(within(drawer).getByLabelText(/Internal base URL/), 'not a url');
    await user.click(within(drawer).getByRole('button', { name: /Next/ }));
    expect(within(drawer).getByLabelText(/Internal base URL/)).toHaveAccessibleDescription(/absolute http/);
    await user.clear(within(drawer).getByLabelText(/Internal base URL/));
    await user.type(within(drawer).getByLabelText(/Internal base URL/), 'http://ledger.internal');
    await user.click(within(drawer).getByRole('button', { name: /Next/ }));

    expect(within(drawer).getByRole('listitem', { current: 'step' })).toHaveTextContent('Access & try-it');
    await user.click(within(drawer).getByRole('button', { name: 'Add header' }));
    await user.type(within(drawer).getByLabelText('Header 1 name'), 'X-Service-Key');
    await user.type(within(drawer).getByLabelText('Header 1 value'), 'secret-value-123');
    await expectNoA11yViolations();
    await user.click(within(drawer).getByRole('button', { name: /Next/ }));

    expect(within(drawer).getByText('12 operations, version 1.4.0')).toBeInTheDocument();
    expect(within(drawer).getByText(/only API managers will see this API/)).toBeInTheDocument();
    // The header's name is reviewed, never its value.
    expect(within(drawer).getByText('X-Service-Key')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('secret-value-123');
    await user.click(within(drawer).getByRole('button', { name: 'Create API' }));
    expect(await screen.findByText('API created.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/admin/apis')?.body).toMatchObject({
      name: 'Ledger',
      slug: 'ledger',
      internalOpenapiUrl: 'http://ledger.internal/openapi.yaml',
      injectHeaders: [{ name: 'X-Service-Key', value: 'secret-value-123' }],
    });
    expect(calls.some((c) => c.url === '/api/admin/apis/9/access')).toBe(false);
  });

  it('shows why a preview failed', async () => {
    mockFetch({
      ...base,
      'GET /api/admin/apis': [],
      'POST /api/admin/apis/spec-preview': () => apiError(502, 'spec fetch failed: status 404'),
    });
    const user = userEvent.setup();
    renderApp('/admin/apis?new=1');
    const drawer = await screen.findByRole('dialog', { name: 'New API' });
    await user.type(within(drawer).getByLabelText(/Internal OpenAPI URL/), 'http://x.internal/spec');
    await user.click(within(drawer).getByRole('button', { name: 'Preview spec' }));
    expect(await within(drawer).findByText('spec fetch failed: status 404')).toBeInTheDocument();
  });
});

describe('API list and editor', () => {
  it('refreshes a row in place and lists what a delete takes with it', async () => {
    const calls = mockFetch({
      ...base,
      'GET /api/admin/apis': [existing],
      'GET /api/admin/apis/1/access': { items: [] },
      'POST /api/admin/apis/1/refresh': { ok: true },
      'GET /api/admin/apis/1/impact': {
        accessGrants: 2,
        roleScopes: 1,
        favorites: 4,
        operations: 30,
        historyEntries: 3,
        hasOwnerGroup: false,
      },
    });
    const user = userEvent.setup();
    renderApp('/admin/apis');
    const row = (await screen.findByRole('button', { name: /^Payments API/ })).closest('tr')!;
    expect(within(row).getByText('Fetch failed')).toHaveAttribute('title', existing.lastSpecStatus);
    await user.click(within(row).getByRole('button', { name: 'Refresh the spec of Payments API' }));
    expect(await screen.findByText('Spec of Payments API refreshed.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/apis/1/refresh')).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: /^Payments API/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Edit Payments API' });
    await user.click(within(drawer).getByRole('tab', { name: 'Headers' }));
    // Stored header values are write-only.
    expect(within(drawer).getByLabelText('Header 1 name')).toHaveValue('X-Service-Key');
    expect(within(drawer).getByLabelText('Header 1 value')).toHaveValue('');
    await user.click(within(drawer).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Payments API?' });
    expect(await within(confirm).findByText('2 group access grants')).toBeInTheDocument();
    expect(within(confirm).getByText('4 favorites')).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});

describe('overview', () => {
  it('links each problem to where it is fixed', async () => {
    mockFetch({
      ...base,
      'GET /api/admin/overview': {
        generatedAt: '2026-01-01T00:00:00Z',
        apis: { total: 3, active: 2, specErrors: 1, specMissing: 0, stale: 0 },
        users: { total: 10, active: 8, admins: 1, signedIn24h: 4 },
        activeSessions: 5,
        activity: { invokes: { success: 40, denied: 2 }, denied: 6, failed: 1, logins: { denied: 3 } },
        attention: [
          { kind: 'spec_error', severity: 'danger', apiId: 1, apiName: 'Payments API', detail: 'dial tcp: refused' },
          { kind: 'ldap_skip_verify', severity: 'warning' },
        ],
      },
    });
    const user = userEvent.setup();
    const { router } = renderApp('/admin');
    expect(await screen.findByText('Payments API: the spec could not be fetched')).toBeInTheDocument();
    expect(screen.getByText('4 signed in during the last 24 h · 10 accounts')).toBeInTheDocument();
    expect(screen.getByText('40 succeeded · 2 denied · 0 failed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Denied requests/ })).toHaveAttribute(
      'href',
      '/admin/audit?range=24h&outcome=denied',
    );
    await expectNoA11yViolations();
    const items = screen.getAllByRole('link', { name: 'Open' });
    await user.click(items[1]);
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/identity'));
    expect(router.state.location.search).toBe('?tab=ldap');
  });
});

describe('audit', () => {
  it('keeps filters in the URL and turns a preset into a from time', async () => {
    const calls = mockFetch({ ...base, 'GET /api/admin/audit-logs': { items: [], total: 0, limit: 25, offset: 0 } });
    const user = userEvent.setup();
    const { router } = renderApp('/admin/audit?action=user.&outcome=denied');
    await screen.findByRole('heading', { level: 1, name: 'Audit log' });
    expect(await screen.findByLabelText(/Action starts with/)).toHaveValue('user.');
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('action=user.') && c.url.includes('outcome=denied'))).toBe(true),
    );
    await user.click(screen.getByRole('combobox', { name: 'Period' }));
    await user.click(await screen.findByRole('option', { name: 'Last 24 hours' }));
    await waitFor(() => expect(router.state.location.search).toContain('range=24h'));
    const last = calls.filter((c) => c.url.startsWith('/api/admin/audit-logs')).at(-1)!;
    const from = new URL(last.url, 'http://x').searchParams.get('from')!;
    expect(Date.now() - Date.parse(from)).toBeGreaterThan(23.9 * 3600_000);
    expect(Date.now() - Date.parse(from)).toBeLessThan(24.1 * 3600_000);
    // The date fields stay (disabled) so the form doesn't jump.
    expect(screen.getByLabelText(/^From/)).toBeDisabled();
  });
});
