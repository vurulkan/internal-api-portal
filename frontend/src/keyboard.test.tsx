import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { catalog, meResponse, publicRoutes } from '@/test/fixtures';
import { json, mockFetch } from '@/test/fetchMock';
import { renderApp } from '@/test/render';
import { expectNoA11yViolations } from '@/test/a11y';

const me = meResponse();
const base = {
  ...publicRoutes,
  'GET /api/auth/me': me,
  'GET /api/catalog': catalog,
  'GET /api/search': {
    query: 'charge',
    apis: [],
    operations: [
      {
        apiId: 1,
        apiName: 'Payments API',
        apiSlug: 'payments',
        method: 'POST',
        path: '/v1/charges',
        summary: 'Create a charge',
      },
    ],
  },
};

describe('command palette', () => {
  it('opens with ⌘K, finds operations, navigates with the arrows and remembers the choice', async () => {
    mockFetch(base);
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'API Catalog' });
    const before = document.activeElement;
    await user.keyboard('{Meta>}k{/Meta}');
    const input = await screen.findByRole('combobox', { name: 'Search commands, APIs and operations' });
    expect(input).toHaveFocus();
    const listbox = screen.getByRole('listbox', { name: 'Results' });
    expect(within(listbox).getByRole('group', { name: 'Go to' })).toBeInTheDocument();
    await expectNoA11yViolations();

    await user.type(input, 'charge');
    const op = await within(listbox).findByRole('option', { name: /\/v1\/charges/ });
    expect(within(listbox).getByRole('group', { name: 'Operations' })).toContainElement(op);
    // The first option is active; ↓ / ↑ move the active descendant.
    const options = within(listbox).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[1]?.id ?? options[0].id);
    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', options[0].id));
    const target = options.findIndex((o) => o === op);
    for (let i = 0; i < target; i++) await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/apis\/payments/));
    expect(screen.queryByRole('combobox', { name: /Search commands/ })).not.toBeInTheDocument();

    await user.keyboard('{Control>}k{/Control}');
    const recent = await screen.findByRole('group', { name: 'Recent' });
    expect(within(recent).getByRole('option', { name: /\/v1\/charges/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(before).toBeTruthy();
  });

  it('runs actions: theme and admin sections the user may open', async () => {
    mockFetch({ ...base, 'GET /api/admin/overview': { generatedAt: '2026-01-01T00:00:00Z', attention: [] } });
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'API Catalog' });
    await user.keyboard('{Meta>}k{/Meta}');
    await user.type(await screen.findByRole('combobox', { name: /Search commands/ }), 'dark');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
    await user.keyboard('{Meta>}k{/Meta}');
    await user.type(await screen.findByRole('combobox', { name: /Search commands/ }), 'admin overview');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/overview'));
  });
});

describe('shortcuts', () => {
  it('? lists every shortcut; g a / g c navigate; / focuses the page search', async () => {
    mockFetch({
      ...base,
      'GET /api/admin/overview': { generatedAt: '2026-01-01T00:00:00Z', attention: [] },
      'GET /api/admin/users': [me.user],
      'GET /api/admin/groups': [],
    });
    const user = userEvent.setup();
    const { router } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'API Catalog' });
    await user.keyboard('?');
    const help = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const text of [
      'Command palette',
      'Previous / next tab',
      'Delete the focused row',
      'Copy the request as cURL',
    ]) {
      expect(within(help).getByText(new RegExp(text))).toBeInTheDocument();
    }
    await expectNoA11yViolations();
    await user.keyboard('{Escape}');
    await user.keyboard('ga');
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/overview'));
    await router.navigate('/admin/users');
    const usersSearch = await screen.findByRole('searchbox', { name: 'Search users' });
    await user.keyboard('/');
    expect(usersSearch).toHaveFocus();
    await user.keyboard('{Escape}');
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('gc');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('j / k move through table rows, d asks to delete the focused row', async () => {
    const users = [
      { ...me.user, groupIds: [] },
      { ...me.user, id: 2, username: 'bob', isAdmin: false, groupIds: [] },
      { ...me.user, id: 3, username: 'carol', isAdmin: false, groupIds: [] },
    ];
    const calls = mockFetch({
      ...base,
      'GET /api/admin/users': users,
      'GET /api/admin/groups': [],
      'DELETE /api/admin/users/3': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findByRole('button', { name: /carol/ });
    await user.keyboard('j');
    expect(screen.getByRole('button', { name: /^olivia/ })).toHaveFocus();
    await user.keyboard('jj');
    expect(screen.getByRole('button', { name: /^carol/ })).toHaveFocus();
    await user.keyboard('k');
    expect(screen.getByRole('button', { name: /^bob/ })).toHaveFocus();
    await user.keyboard('j');
    await user.keyboard('d');
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete carol?' });
    await user.type(within(confirm).getByRole('textbox'), 'carol');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('User deleted.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/admin/users/3')).toBe(true);
    // Yourself (the last admin): d does nothing.
    screen.getByRole('button', { name: /^olivia/ }).focus();
    await user.keyboard('d');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('[ and ] switch tabs inside a drawer', async () => {
    mockFetch({
      ...base,
      'GET /api/admin/users': [me.user, { ...me.user, id: 2, username: 'bob', isAdmin: false }],
      'GET /api/admin/groups': [],
      'GET /api/admin/users/2/groups': [],
      'GET /api/admin/users/2/permissions': { userId: 2, isAdmin: false, groupIds: [], scopes: [], sources: [] },
      'GET /api/admin/sessions': { items: [] },
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await user.click(await screen.findByRole('button', { name: /^bob/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Edit bob' });
    expect(within(drawer).getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
    (document.activeElement as HTMLElement)?.blur?.();
    within(drawer).getByRole('tab', { name: 'Profile' }).focus();
    await user.keyboard(']');
    await waitFor(() =>
      expect(within(drawer).getByRole('tab', { name: 'Groups & permissions' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    await user.keyboard('[[');
    await waitFor(() =>
      expect(within(drawer).getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true'),
    );
  });
});
