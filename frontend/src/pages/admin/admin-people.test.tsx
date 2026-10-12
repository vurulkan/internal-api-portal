import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { meResponse, publicRoutes } from '@/test/fixtures';
import { apiError, json, mockFetch } from '@/test/fetchMock';
import { renderApp } from '@/test/render';
import { expectNoA11yViolations } from '@/test/a11y';
import { csvCell } from './common';

const me = meResponse();
const users = [
  { ...me.user, groupIds: [], lastLoginAt: '2026-01-02T00:00:00Z' },
  { ...me.user, id: 2, username: 'bob', displayName: 'Bob', isAdmin: false, groupIds: [7], authSource: 'ldap' },
  { ...me.user, id: 3, username: 'carol', displayName: 'Carol', isAdmin: false, groupIds: [], isActive: false },
];
const groups = [
  { id: 7, name: 'payments-team', description: '', createdAt: '', memberIds: [2], roleIds: [5] },
  { id: 8, name: 'auditors', description: '', createdAt: '', memberIds: [], roleIds: [] },
];
const roles = [{ id: 5, name: 'consumer', description: '', createdAt: '', permissionCount: 1, groupIds: [7] }];
const base = {
  ...publicRoutes,
  'GET /api/auth/me': me,
  'GET /api/admin/users': users,
  'GET /api/admin/groups': groups,
  'GET /api/admin/roles': roles,
  'GET /api/catalog': [],
};

describe('users', () => {
  it('filters through the URL and explains why the last admin stays active', async () => {
    mockFetch(base);
    const { router } = renderApp('/admin/users?source=ldap');
    await screen.findByRole('button', { name: /bob/ });
    expect(screen.queryByRole('button', { name: /carol/ })).not.toBeInTheDocument();
    await router.navigate('/admin/users');
    await screen.findByRole('button', { name: /carol/ });
    // Olivia is the only active admin and the signed-in user: her switch is locked, with the reason.
    const own = screen.getByRole('switch', { name: 'olivia is active' });
    expect(own).toBeDisabled();
    expect(own).toHaveAccessibleDescription(/your own account/);
    expect(screen.getByRole('switch', { name: 'bob is active' })).toBeEnabled();
    await expectNoA11yViolations();
  });

  it('flips the active switch at once and back when the server refuses', async () => {
    mockFetch({ ...base, 'POST /api/admin/users/bulk-status': () => apiError(409, 'nope') });
    const user = userEvent.setup();
    renderApp('/admin/users');
    const bob = await screen.findByRole('switch', { name: 'bob is active' });
    await user.click(bob);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'bob is active' })).toBeChecked());
    expect(await screen.findByText('nope')).toBeInTheDocument();
    // The row did not open the editor.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('deactivates the selection, leaving yourself out', async () => {
    const calls = mockFetch({ ...base, 'POST /api/admin/users/bulk-status': { changed: [2], sessionsRevoked: 1 } });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await screen.findByRole('button', { name: /bob/ });
    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Deactivate 1 user?' });
    expect(dialog).toHaveTextContent('2 selected users are left out');
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('1 user deactivated.')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/admin/users/bulk-status')?.body).toEqual({ userIds: [2], active: false });
  });

  it('asks before discarding unsaved changes, and previews what new groups grant', async () => {
    mockFetch({
      ...base,
      'GET /api/admin/users/2/groups': [7],
      'GET /api/admin/users/2/permissions': (url: string) =>
        url.includes('groupIds=7,8')
          ? {
              userId: 2,
              isAdmin: false,
              groupIds: [7, 8],
              scopes: ['api.invoke', 'audit.view'],
              sources: [
                { scope: 'api.invoke', via: 'role', groupId: 7, groupName: 'payments-team', roleName: 'consumer' },
                { scope: 'audit.view', via: 'role', groupId: 8, groupName: 'auditors', roleName: 'auditor' },
              ],
            }
          : {
              userId: 2,
              isAdmin: false,
              groupIds: [7],
              scopes: ['api.invoke'],
              sources: [
                { scope: 'api.invoke', via: 'role', groupId: 7, groupName: 'payments-team', roleName: 'consumer' },
              ],
            },
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await user.click(await screen.findByRole('button', { name: /bob/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Edit bob' });
    await user.click(within(drawer).getByRole('tab', { name: 'Groups & permissions' }));
    expect(await within(drawer).findByText('payments-team → consumer')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'auditors' }));
    expect(await within(drawer).findByText('Permissions after saving')).toBeInTheDocument();
    expect(await within(drawer).findByText('auditors → auditor')).toBeInTheDocument();
    expect(within(drawer).getByText('Added')).toBeInTheDocument();
    await expectNoA11yViolations();

    await user.keyboard('{Escape}{Escape}');
    const confirm = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Edit bob' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog', { name: 'Edit bob' })).getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit bob' })).not.toBeInTheDocument());
  });

  it('CSV cells cannot run as spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('groups', () => {
  it('shows counts and changes members at once', async () => {
    const calls = mockFetch({
      ...base,
      'GET /api/admin/groups/7/roles': [5],
      'POST /api/admin/groups/7/members': { added: [3] },
      'DELETE /api/admin/groups/7/members/2': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    renderApp('/admin/groups');
    const row = (await screen.findByRole('button', { name: 'payments-team' })).closest('tr')!;
    expect(within(row).getByText('consumer')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'payments-team' }));
    const drawer = await screen.findByRole('dialog', { name: 'Edit payments-team' });
    await user.click(within(drawer).getByRole('tab', { name: /Members/ }));
    await user.click(await within(drawer).findByRole('button', { name: 'Remove bob from the group' }));
    expect(await screen.findByText('bob removed from the group.')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: /carol/ }));
    await user.click(within(drawer).getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('1 member added.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/admin/groups/7/members')?.body).toEqual({
      userIds: [3],
    });
    await expectNoA11yViolations();
  });
});

describe('roles', () => {
  it('starts from a template and confirms a change with its diff', async () => {
    const calls = mockFetch({
      ...base,
      'GET /api/permissions/catalog': {
        items: [
          { scope: 'api.view', group: 'APIs', family: 'read', description: 'See APIs' },
          { scope: 'api.invoke', group: 'APIs', family: 'write', description: 'Call APIs' },
          { scope: 'audit.view', group: 'Audit', family: 'read', description: 'Read the audit log' },
          { scope: 'audit.export', group: 'Audit', family: 'read', description: 'Export it' },
        ],
      },
      'GET /api/admin/apis': [],
      'GET /api/admin/roles/5/permissions': [{ id: 1, roleId: 5, scope: 'api.invoke', description: '' }],
      'PUT /api/admin/roles/5': () => json({ ok: true }),
      'PUT /api/admin/roles/5/permissions': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    renderApp('/admin/roles');
    await user.click(await screen.findByRole('button', { name: 'consumer' }));
    const drawer = await screen.findByRole('dialog', { name: 'Edit consumer' });
    expect(await within(drawer).findByText('payments-team')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('checkbox', { name: /audit\.view/ }));
    await user.click(within(drawer).getByRole('checkbox', { name: /api\.invoke/ }));
    await user.click(within(drawer).getByRole('button', { name: 'Save' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Change the permissions of consumer?' });
    expect(confirm).toHaveTextContent('every member of the 1 group');
    expect(within(confirm).getByText('audit.view')).toBeInTheDocument();
    expect(within(confirm).getByText('api.invoke')).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Role updated.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/admin/roles/5/permissions')?.body).toEqual({
      scopes: ['audit.view'],
    });
  });
});

describe('admin navigation', () => {
  it.each([
    ['/admin/ldap', '/admin/identity', '?tab=ldap'],
    ['/admin/azure-ad', '/admin/identity', '?tab=azure'],
    ['/admin/session-settings', '/admin/settings', '?tab=session'],
    ['/admin/system', '/admin/settings', '?tab=branding'],
  ])('%s moved into %s', async (from, path, search) => {
    mockFetch({ ...base, 'GET /api/admin/*': {} });
    const { router } = renderApp(from);
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
    expect(router.state.location.search).toBe(search);
  });

  it('shows system information without secrets', async () => {
    mockFetch({
      ...base,
      'GET /api/admin/system/info': {
        version: '2.0.0',
        goVersion: 'go1.27',
        startedAt: '2026-01-01T00:00:00Z',
        databaseBytes: 3 * 1024 * 1024,
        schemaVersion: 11,
        encryptionKeySource: 'database',
        encryptionKeyId: 'ab12cd34',
        specRefreshMinutes: 360,
        auditRetentionDays: 30,
        backupsEnabled: false,
        metricsEnabled: true,
        timeZone: 'UTC',
      },
    });
    renderApp('/admin/settings?tab=system');
    expect(await screen.findByText('2.0.0')).toBeInTheDocument();
    expect(screen.getByText('In the database')).toBeInTheDocument();
    expect(screen.getByText('Every 360 minutes')).toBeInTheDocument();
    expect(screen.getByText(/DATA_ENCRYPTION_KEY \(or/)).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});
