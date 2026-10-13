import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { meResponse, publicRoutes } from '@/test/fixtures';
import { json, mockFetch } from '@/test/fetchMock';
import { renderApp } from '@/test/render';
import { expectNoA11yViolations } from '@/test/a11y';

const me = meResponse();
const base = {
  ...publicRoutes,
  'GET /api/auth/me': me,
  'GET /api/catalog': [],
  'GET /api/admin/users': [
    { ...me.user, groupIds: [] },
    { ...me.user, id: 5, username: 'carol', isAdmin: false, authSource: 'ldap', groupIds: [] },
  ],
  'GET /api/admin/groups': [{ id: 7, name: 'readers', description: '', createdAt: '', memberIds: [], roleIds: [] }],
};

describe('New user', () => {
  it('is a plain button when only local accounts can be made', async () => {
    mockFetch({ ...base, 'GET /api/auth/providers': { local: true, ldap: false, azureAd: false } });
    renderApp('/admin/users');
    expect(await screen.findByRole('button', { name: 'New user' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More ways to add users' })).not.toBeInTheDocument();
  });

  it('imports LDAP users into groups, and reports who was left out', async () => {
    const calls = mockFetch({
      ...base,
      'GET /api/auth/providers': { local: true, ldap: true, azureAd: false },
      'POST /api/admin/ldap/search': [
        { username: 'Bob', displayName: 'Bob Builder', email: 'bob@corp.example', dn: 'uid=Bob,dc=corp' },
        { username: 'Carol', displayName: 'Carol', email: 'carol@corp.example', dn: 'uid=carol,dc=corp' },
      ],
      'POST /api/admin/ldap/import': { ok: true, imported: 1, skipped: [], missing: ['Carol'], addedToGroups: 1 },
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await user.click(await screen.findByRole('button', { name: 'More ways to add users' }));
    expect(screen.queryByRole('menuitem', { name: 'Azure AD user…' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('menuitem', { name: 'From LDAP…' }));
    const drawer = await screen.findByRole('dialog', { name: 'Import from LDAP' });
    await user.type(within(drawer).getByLabelText(/Name, username or email/), 'o');
    await user.click(within(drawer).getByRole('button', { name: 'Search' }));
    // "carol" is already an LDAP account here (case-insensitive).
    expect(await within(drawer).findByText('Already imported')).toBeInTheDocument();
    await user.click(within(drawer).getByRole('checkbox', { name: 'Select all rows on this page' }));
    await user.click(within(drawer).getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'readers' }));
    await expectNoA11yViolations();
    await user.click(within(drawer).getByRole('button', { name: 'Import 2 users' }));
    expect(await screen.findByText('1 user imported; 1 group memberships added.')).toBeInTheDocument();
    expect(within(drawer).getByText('Not found in the directory: Carol.')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/admin/ldap/import')?.body).toEqual({
      usernames: ['Bob', 'Carol'],
      groupIds: [7],
    });
  });

  it('pre-registers an Azure AD user with a sign-in name and groups', async () => {
    const calls = mockFetch({
      ...base,
      'GET /api/auth/providers': { local: true, ldap: false, azureAd: true },
      'POST /api/admin/users/azure': () => json({ id: 9, username: 'jdoe' }, 201),
    });
    const user = userEvent.setup();
    renderApp('/admin/users');
    await user.click(await screen.findByRole('button', { name: 'More ways to add users' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Azure AD user…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an Azure AD user' });
    await user.click(within(dialog).getByRole('button', { name: 'Add user' }));
    expect(within(dialog).getByLabelText(/^Email/)).toHaveAccessibleDescription(/e-mail address/);
    await user.type(within(dialog).getByLabelText(/^Email/), 'jane.doe@corp.com');
    await user.type(within(dialog).getByLabelText(/Sign-in name/), 'jdoe@corp.onmicrosoft.com');
    await user.click(within(dialog).getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'readers' }));
    await expectNoA11yViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Add user' }));
    expect(
      await screen.findByText('jdoe added; the account is bound at the first Microsoft sign-in.'),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/admin/users/azure')?.body).toEqual({
      email: 'jane.doe@corp.com',
      upn: 'jdoe@corp.onmicrosoft.com',
      displayName: '',
      groupIds: [7],
    });
  });

  it('?import=ldap (the link on Identity providers) opens the import', async () => {
    mockFetch({ ...base, 'GET /api/auth/providers': { local: true, ldap: true, azureAd: false } });
    renderApp('/admin/users?import=ldap');
    expect(await screen.findByRole('dialog', { name: 'Import from LDAP' })).toBeInTheDocument();
  });
});

describe('LDAP settings', () => {
  it('auto-create warns while no group limits it, and is saved', async () => {
    const ldap = {
      enabled: true,
      url: '',
      host: 'dc1',
      port: 389,
      useSsl: false,
      startTls: false,
      sslSkipVerify: false,
      timeoutSeconds: 5,
      bindDn: 'cn=svc',
      userBaseDn: 'dc=corp',
      userBaseDns: [],
      userFilter: '(objectClass=person)',
      usernameAttribute: 'uid',
      displayNameAttribute: 'displayName',
      emailAttribute: 'mail',
      passwordConfigured: true,
      autoCreate: false,
      autoCreateGroups: [],
    };
    const calls = mockFetch({
      ...base,
      'GET /api/auth/providers': { local: true, ldap: true, azureAd: false },
      'GET /api/admin/ldap': ldap,
      'PUT /api/admin/ldap': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    renderApp('/admin/identity?tab=ldap');
    await user.click(await screen.findByRole('switch', { name: 'Create an account at the first sign-in' }));
    expect(screen.getByText(/can get an account \(without permissions\)/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Only members of these directory groups/), 'CN=API Users,DC=corp');
    expect(screen.queryByText(/can get an account \(without permissions\)/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Import users' })).toHaveAttribute('href', '/admin/users?import=ldap');
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/admin/ldap')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      autoCreate: true,
      autoCreateGroups: ['CN=API Users,DC=corp'],
    });
  });
});
