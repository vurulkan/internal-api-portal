import { mkdirSync } from 'node:fs';
import { request } from '@playwright/test';
import { ADMIN, BASE, BOOTSTRAP_PASSWORD, UPSTREAM, USER_PASSWORD } from './portal';

/** Seeds a fresh portal (APIs, groups, roles, users) and saves the admin's session. */
export default async function globalSetup() {
  const api = await request.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { 'X-CSRF-Protection': '1', Origin: BASE },
  });
  const call = async (method: string, path: string, data?: unknown) => {
    const res = await api.fetch(path, { method, data });
    if (!res.ok() && !(path.endsWith('/refresh') && res.status() === 502)) {
      throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
  await call('POST', '/api/auth/login', { username: ADMIN.username, password: BOOTSTRAP_PASSWORD });
  await call('POST', '/api/auth/change-password', { currentPassword: BOOTSTRAP_PASSWORD, newPassword: ADMIN.password });

  const payments = await call('POST', '/api/admin/apis', {
    name: 'Payments API',
    slug: 'payments',
    description: 'Charges and refunds for card payments.',
    internalOpenapiUrl: `${UPSTREAM}/openapi.json`,
    internalBaseUrl: UPSTREAM,
    isActive: true,
    tryItEnabled: true,
    allowedMethods: [],
    allowedPathPrefixes: ['/v1'],
    ownerTeam: 'payments-team',
    tags: ['payments', 'core'],
    allowedRequestHeaders: ['X-Tenant-Id'],
    injectHeaders: [{ name: 'X-Service-Key', value: 'e2e-inject-secret-5150' }],
  });
  const ledger = await call('POST', '/api/admin/apis', {
    name: 'Ledger API',
    slug: 'ledger',
    description: 'Unreachable on purpose.',
    internalOpenapiUrl: 'http://127.0.0.1:1/openapi.json',
    internalBaseUrl: 'http://127.0.0.1:1',
    isActive: true,
    tryItEnabled: true,
    allowedMethods: [],
    allowedPathPrefixes: [],
    ownerTeam: 'finance',
    tags: ['finance'],
  });
  const warehouse = await call('POST', '/api/admin/apis', {
    name: 'Warehouse API',
    slug: 'warehouse',
    description: 'A large spec: 1500 operations.',
    internalOpenapiUrl: `${UPSTREAM}/large.json`,
    internalBaseUrl: UPSTREAM,
    isActive: true,
    tryItEnabled: true,
    allowedMethods: [],
    allowedPathPrefixes: [],
    ownerTeam: 'logistics',
    tags: ['logistics'],
  });
  await call('POST', `/api/admin/apis/${warehouse.id}/refresh`);
  await call('POST', `/api/admin/apis/${payments.id}/refresh`);
  await call('POST', `/api/admin/apis/${ledger.id}/refresh`);

  const team = await call('POST', '/api/admin/groups', {
    name: 'payments-team',
    description: 'Owns the payments APIs',
  });
  const auditors = await call('POST', '/api/admin/groups', { name: 'auditors', description: 'Read the audit log' });
  const consumer = await call('POST', '/api/admin/roles', { name: 'api-consumer', description: 'Call every API' });
  await call('PUT', `/api/admin/roles/${consumer.id}/permissions`, { scopes: ['api.invoke'] });
  const auditor = await call('POST', '/api/admin/roles', { name: 'auditor', description: 'Read the audit log' });
  await call('PUT', `/api/admin/roles/${auditor.id}/permissions`, { scopes: ['audit.view'] });
  await call('PUT', `/api/admin/groups/${team.id}/roles`, [consumer.id]);
  // Direct API access (no role): auditors may view the Payments API.
  await call('PUT', `/api/admin/apis/${payments.id}/access`, [{ groupId: auditors.id, level: 'view' }]);
  await call('PUT', `/api/admin/groups/${auditors.id}/roles`, [auditor.id]);
  for (const name of ['bob', 'carol', 'dave']) {
    const user = await call('POST', '/api/admin/users', {
      username: name,
      displayName: `${name[0].toUpperCase()}${name.slice(1)} Example`,
      email: `${name}@example.com`,
      password: USER_PASSWORD,
      mustChangePassword: false,
      isActive: true,
      isAdmin: false,
    });
    if (name === 'bob') await call('PUT', `/api/admin/users/${user.id}/groups`, [team.id]);
  }
  await call('POST', `/api/apis/${payments.id}/invoke`, {
    method: 'GET',
    path: '/v1/charges',
    query: '',
    headers: {},
    bodyBase64: '',
  });

  mkdirSync('e2e/.auth', { recursive: true });
  await api.storageState({ path: 'e2e/.auth/admin.json' });
  await api.dispose();
}
