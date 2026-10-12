import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { catalog, meResponse, publicRoutes } from '@/test/fixtures';
import { apiError, json, mockFetch } from '@/test/fetchMock';
import { renderApp } from '@/test/render';
import { expectNoA11yViolations } from '@/test/a11y';

const unauthorized = () => apiError(401, 'authentication required', 'unauthorized');

describe('sign-in', () => {
  it('sends a signed-out user to /login with the page to return to, and back after signing in', async () => {
    let signedIn = false;
    const calls = mockFetch({
      ...publicRoutes,
      'GET /api/auth/me': () => (signedIn ? meResponse() : unauthorized()),
      'POST /api/auth/login': () => {
        signedIn = true;
        return { ok: true };
      },
      'GET /api/catalog': catalog,
      'GET /api/apis/1': {
        ...catalog[0],
        allowedMethods: [],
        allowedPathPrefixes: [],
        permissions: { view: true, invoke: true, manage: true },
      },
      'GET /api/apis/1/spec': { openapi: '3.0.0', paths: {} },
    });
    const user = userEvent.setup();
    const { router } = renderApp('/apis/1?tab=details');
    await screen.findByRole('heading', { name: 'Acme API Portal' });
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/apis/1?tab=details')}`);
    await expectNoA11yViolations();

    await user.type(screen.getByLabelText('Username'), 'olivia');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { level: 1, name: 'Payments API' });
    expect(router.state.location.pathname).toBe('/apis/1');
    expect(calls.find((c) => c.url === '/api/auth/login')?.body).toEqual({
      username: 'olivia',
      password: 'correct-horse-battery',
    });
  });

  it('shows wrong credentials under the password field and validates empty fields', async () => {
    mockFetch({
      ...publicRoutes,
      'GET /api/auth/me': unauthorized,
      'POST /api/auth/login': () => apiError(401, 'invalid credentials'),
    });
    const user = userEvent.setup();
    renderApp('/login');
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByLabelText('Username')).toHaveAccessibleDescription(/Enter your username/);
    await user.type(screen.getByLabelText('Username'), 'olivia');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const password = screen.getByLabelText('Password');
    await waitFor(() => expect(password).toHaveAccessibleDescription(/not correct/));
    expect(password).toHaveValue('');
    expect(password).toHaveFocus();
  });

  it('counts down a lockout from Retry-After and blocks submitting', async () => {
    mockFetch({
      ...publicRoutes,
      'GET /api/auth/me': unauthorized,
      'POST /api/auth/login': () =>
        apiError(429, 'too many failed sign-in attempts', 'rate_limited', { 'Retry-After': '125' }),
    });
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(await screen.findByLabelText('Username'), 'olivia');
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Try again in 2:0[45]/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('warns about Caps Lock in the password field', async () => {
    mockFetch({ ...publicRoutes, 'GET /api/auth/me': unauthorized });
    const user = userEvent.setup();
    renderApp('/login');
    await user.click(await screen.findByLabelText('Password'));
    await user.keyboard('{CapsLock}A');
    expect(await screen.findByText('Caps Lock is on')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(/Caps Lock is on/);
  });
});

describe('session end', () => {
  it('a 401 after sign-in shows one toast and returns to the same page after signing in again', async () => {
    let expired = false;
    mockFetch({
      ...publicRoutes,
      'GET /api/auth/me': () => (expired ? unauthorized() : meResponse()),
      'GET /api/catalog': () => (expired ? unauthorized() : catalog),
      'GET /api/admin/users': () => unauthorized(),
    });
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'API Catalog' });
    expired = true;
    await user.click(screen.getByRole('link', { name: 'Admin' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/admin/users')}`);
    expect(await screen.findAllByText('Your session has ended. Sign in again to continue.')).toHaveLength(1);
  });
});

describe('forced password change', () => {
  it('only the change-password page is reachable, with the rules shown live', async () => {
    mockFetch({ ...publicRoutes, 'GET /api/auth/me': meResponse({ mustChangePassword: true }) });
    const user = userEvent.setup();
    const { router } = renderApp('/admin/users');
    await screen.findByRole('heading', { level: 1, name: 'Set a new password' });
    expect(router.state.location.pathname).toBe('/change-password');
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^New password/), 'olivia-is-long-enough');
    expect(screen.getByText('At least 12 characters').closest('li')).toHaveTextContent('(met)');
    expect(screen.getByText('Does not contain your username').closest('li')).toHaveTextContent('(not met yet)');
    await expectNoA11yViolations();
  });

  it('puts the server reason under the field it belongs to', async () => {
    mockFetch({
      ...publicRoutes,
      'GET /api/auth/me': meResponse({ mustChangePassword: true }),
      'POST /api/auth/change-password': () =>
        apiError(400, 'current password is incorrect', 'invalid_current_password'),
    });
    const user = userEvent.setup();
    renderApp('/change-password');
    await user.type(await screen.findByLabelText(/^Current password/), 'nope');
    await user.type(screen.getByLabelText(/^New password/), 'correct-horse-battery');
    await user.type(screen.getByLabelText(/^Confirm new password/), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    await waitFor(() => expect(screen.getByLabelText(/^Current password/)).toHaveAccessibleDescription(/not correct/));
  });
});

describe('catalog', () => {
  it('filters by search and tag, explains an empty result and clears it', async () => {
    mockFetch({ ...publicRoutes, 'GET /api/auth/me': meResponse(), 'GET /api/catalog': catalog });
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await screen.findByRole('link', { name: 'Payments API' });
    expect(screen.getByText('2 APIs')).toBeInTheDocument();
    await expectNoA11yViolations();

    await user.click(screen.getByRole('checkbox', { name: 'payments' }));
    expect(router.state.location.search).toBe('?tag=payments');
    expect(screen.queryByRole('link', { name: 'Identity API' })).not.toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search APIs' }), 'zzz');
    expect(await screen.findByText('No APIs match')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    expect(await screen.findByText('2 APIs')).toBeInTheDocument();
  });

  it('says why it is empty when the user has no APIs', async () => {
    mockFetch({ ...publicRoutes, 'GET /api/auth/me': meResponse(), 'GET /api/catalog': [] });
    renderApp('/');
    expect(await screen.findByText('No APIs available to you yet')).toBeInTheDocument();
  });

  it('shows a retryable error with the request id', async () => {
    let fail = true;
    mockFetch({
      ...publicRoutes,
      'GET /api/auth/me': meResponse(),
      'GET /api/catalog': () => (fail ? apiError(500, 'database is locked', 'internal_error') : catalog),
    });
    const user = userEvent.setup();
    renderApp('/');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('database is locked');
    expect(alert).toHaveTextContent('req-test');
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Payments API' })).toBeInTheDocument();
  });
});

describe('shell', () => {
  it('has a skip link, labelled navigation and a 404 page', async () => {
    mockFetch({ ...publicRoutes, 'GET /api/auth/me': meResponse(), 'GET /api/catalog': catalog });
    renderApp('/does-not-exist');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
    expect(document.title).toBe('Page not found · Acme API Portal');
    await expectNoA11yViolations();
  });

  it('switches language and theme from the top bar, and remembers them', async () => {
    mockFetch({ ...publicRoutes, 'GET /api/auth/me': meResponse(), 'GET /api/catalog': catalog });
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'API Catalog' });
    await user.click(screen.getByRole('button', { name: /^Theme:/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('portal.theme')).toBe('dark');
    await user.click(screen.getByRole('button', { name: /^Language:/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Türkçe' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'API Kataloğu' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('tr');
    expect(localStorage.getItem('portal.locale')).toBe('tr');
    await i18n.changeLanguage('en');
  });

  it('shows the encryption warning to administrators', async () => {
    mockFetch({
      ...publicRoutes,
      'GET /api/auth/me': meResponse({}, { warnings: ['encryption_key_in_database'] }),
      'GET /api/catalog': catalog,
    });
    renderApp('/');
    expect(await screen.findByText(/DATA_ENCRYPTION_KEY/)).toBeInTheDocument();
  });
});

describe('admin', () => {
  it('lists only the sections the user may open; others are forbidden', async () => {
    mockFetch({
      ...publicRoutes,
      'GET /api/auth/me': meResponse(
        { isAdmin: false },
        {
          capabilities: {
            adminSections: ['apis'],
            managesAllApis: false,
            managedApis: [1],
            canCreateApi: false,
            canExportAudit: false,
          },
        },
      ),
      'GET /api/admin/apis': [{ ...catalog[0], allowedMethods: [], allowedPathPrefixes: [] }],
    });
    const { router } = renderApp('/admin');
    await screen.findByRole('heading', { level: 1, name: 'API definitions' });
    expect(router.state.location.pathname).toBe('/admin/apis');
    // The rail marks where you are (regression: the tooltip used to break NavLink's className).
    const rail = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(rail).getByRole('link', { name: 'Admin' })).toHaveAttribute('aria-current', 'page');
    const adminLink = within(rail).getByRole('link', { name: 'Admin' });
    expect(adminLink.className).not.toContain('=>');
    expect(adminLink.classList.contains('bg-muted')).toBe(true);
    expect(within(rail).getByRole('link', { name: 'API Catalog' })).not.toHaveAttribute('aria-current');
    const sections = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(within(sections).getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'New API' })).not.toBeInTheDocument();
    await router.navigate('/admin/users');
    expect(await screen.findByText('You don’t have access to this')).toBeInTheDocument();
  });

  it('edits a user in a drawer and refetches only what changed', async () => {
    const users = [
      { ...meResponse().user },
      { ...meResponse().user, id: 2, username: 'bob', displayName: 'Bob', isAdmin: false },
    ];
    const calls = mockFetch({
      ...publicRoutes,
      'GET /api/auth/me': meResponse(),
      'GET /api/admin/users': users,
      'GET /api/admin/groups': [{ id: 7, name: 'payments-team', description: '', createdAt: '' }],
      'GET /api/admin/users/2/groups': [7],
      'PUT /api/admin/users/2': () => json({ ok: true }),
      'PUT /api/admin/users/2/groups': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    // Rows open from the keyboard: the first cell is a button.
    const bobRow = await screen.findByRole('button', { name: /bob/ });
    bobRow.focus();
    await user.keyboard('{Enter}');
    const drawer = await screen.findByRole('dialog', { name: 'Edit bob' });
    await waitFor(() => expect(within(drawer).getByText('payments-team')).toBeInTheDocument());
    await expectNoA11yViolations();
    const name = within(drawer).getByLabelText(/Display name/);
    await user.clear(name);
    await user.type(name, 'Robert');
    const before = calls.length;
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('User updated.')).toBeInTheDocument();
    const after = calls.slice(before).map((c) => `${c.method} ${c.url}`);
    expect(after).toContain('PUT /api/admin/users/2');
    expect(after).toContain('PUT /api/admin/users/2/groups');
    // Targeted refetch: no other admin section is reloaded.
    expect(after.filter((c) => c.startsWith('GET /api/admin/') && !c.includes('/users'))).toEqual([]);
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/admin/users/2')?.body).toMatchObject({
      displayName: 'Robert',
    });
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/admin/users/2/groups')?.body).toEqual([7]);
  });
});

describe('kitchen sink', () => {
  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    localStorage.setItem('portal.theme', theme);
    mockFetch({ ...publicRoutes, 'GET /api/auth/me': meResponse() });
    renderApp('/__ui');
    await screen.findByRole('heading', { level: 1, name: 'Kitchen sink' });
    expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark');
    await expectNoA11yViolations();
  });
});
