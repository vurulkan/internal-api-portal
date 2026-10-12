import type { ApiSummary, MeResponse } from '@/lib/api';

export function meResponse(overrides: Partial<MeResponse['user']> = {}, extra: Partial<MeResponse> = {}): MeResponse {
  return {
    user: {
      id: 1,
      username: 'olivia',
      displayName: 'Olivia Admin',
      email: 'olivia@example.com',
      authSource: 'local',
      mustChangePassword: false,
      isActive: true,
      isAdmin: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...overrides,
    },
    permissions: [],
    groupIds: [],
    branding: { brandTitle: 'Acme API Portal', logoDataUrl: '' },
    passwordPolicy: { minLength: 12 },
    warnings: [],
    capabilities: {
      adminSections: [
        'users',
        'groups',
        'roles',
        'apis',
        'ldap',
        'azureAd',
        'sessionSettings',
        'sessions',
        'audit',
        'system',
      ],
      managesAllApis: true,
      managedApis: [],
      canCreateApi: true,
      canExportAudit: true,
    },
    features: { tryIt: true, ldap: true, azureAd: true, auditExport: true },
    ...extra,
  };
}

export const catalog: ApiSummary[] = [
  {
    id: 1,
    name: 'Payments API',
    slug: 'payments',
    description: 'Charges and refunds.',
    isActive: true,
    tryItEnabled: true,
    ownerTeam: 'payments-team',
    tags: ['payments', 'core'],
    canView: true,
    canInvoke: true,
    canManage: true,
  },
  {
    id: 2,
    name: 'Identity API',
    slug: 'identity',
    description: 'Users and tokens.',
    isActive: true,
    tryItEnabled: false,
    ownerTeam: 'identity',
    tags: ['core'],
    canView: true,
    canInvoke: false,
    canManage: false,
  },
];

export const publicRoutes = {
  'GET /api/system/public': { brandTitle: 'Acme API Portal', logoDataUrl: '' },
  'GET /api/auth/providers': { local: true, ldap: true, azureAd: false },
  'GET /api/features': { tryIt: true, ldap: true, azureAd: true, auditExport: true },
};
