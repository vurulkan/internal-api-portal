export type User = {
  id: number;
  username: string;
  displayName: string;
  email: string;
  authSource: string;
  mustChangePassword: boolean;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Role = { id: number; name: string; description: string; createdAt: string };
export type Group = { id: number; name: string; description: string; createdAt: string };
export type Permission = { id: number; roleId: number; scope: string; description: string };
export type LdapUser = { username: string; displayName: string; email: string; dn: string };
export type AuditLog = {
  id: number;
  timestamp: string;
  user: string;
  action: string;
  resourceType: string;
  resourceId: string;
  resourceName: string;
  sourceIp: string;
  statusCode: number;
  durationMs: number;
  blocked: boolean;
  errorMessage: string;
  detailsJson: string;
};
export type ApiSummary = {
  id: number;
  name: string;
  slug: string;
  description: string;
  isActive: boolean;
  tryItEnabled: boolean;
  ownerTeam: string;
  tags: string[];
  lastSpecRefreshAt?: string;
  lastSpecStatus?: string;
  canView: boolean;
  canInvoke: boolean;
  canManage: boolean;
};
export type ApiDefinition = {
  id: number;
  name: string;
  slug: string;
  description: string;
  internalOpenapiUrl?: string;
  internalBaseUrl?: string;
  isActive: boolean;
  tryItEnabled: boolean;
  allowedMethods: string[];
  allowedPathPrefixes: string[];
  ownerTeam: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastSpecRefreshAt?: string;
  lastSpecStatus?: string;
  permissions?: { view: boolean; invoke: boolean; manage: boolean };
};
export type LdapConfig = {
  enabled: boolean;
  url: string;
  host: string;
  port: number;
  useSsl: boolean;
  startTls: boolean;
  sslSkipVerify: boolean;
  timeoutSeconds: number;
  bindDn: string;
  bindPassword?: string;
  userBaseDn: string;
  userBaseDns: string[];
  userFilter: string;
  usernameAttribute: string;
  displayNameAttribute: string;
  emailAttribute: string;
  passwordConfigured: boolean;
};
export type SessionSettings = { sessionMinutes: number };
export type SystemSettings = { brandTitle: string; logoDataUrl: string };
export type AzureADConfig = {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  clientSecret?: string;
  redirectUrl: string;
  passwordConfigured: boolean;
};
export type AuthProviders = {
  local: boolean;
  ldap: boolean;
  azureAd: boolean;
};
export type MeResponse = {
  user: User;
  permissions: string[];
  groupIds: number[];
  branding: SystemSettings;
};
export type InvokeResponse = {
  statusCode: number;
  headers: Record<string, string>;
  bodyBase64: string;
  contentType: string;
  truncated: boolean;
  requestBytes: number;
  responseBytes: number;
};

export type PaginatedAuditLogs = {
  items: AuditLog[];
  total: number;
  limit: number;
  offset: number;
};

export type UserPayload = {
  username: string;
  displayName?: string;
  email?: string;
  password?: string;
  authSource?: string;
  mustChangePassword?: boolean;
  isActive?: boolean;
  isAdmin?: boolean;
};

export type GroupPayload = {
  name: string;
  description?: string;
};

export type RolePayload = {
  name: string;
  description?: string;
};

export type ApiDefinitionPayload = {
  name: string;
  slug: string;
  description?: string;
  internalOpenapiUrl?: string;
  internalBaseUrl?: string;
  isActive: boolean;
  tryItEnabled: boolean;
  allowedMethods: string[];
  allowedPathPrefixes: string[];
  ownerTeam?: string;
  tags: string[];
};

const TOKEN_KEY = 'api_portal_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  if (response.headers.get('Content-Type')?.includes('text/csv')) {
    return (await response.text()) as T;
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

async function uploadRequest<T>(path: string, formData: FormData): Promise<T> {
  const headers = new Headers();
  const token = getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(path, { method: 'POST', body: formData, headers });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request<MeResponse>('/api/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  publicSettings: () => request<SystemSettings>('/api/system/public'),
  authProviders: () => request<AuthProviders>('/api/auth/providers'),
  startAzureLogin: () => {
    window.location.assign('/api/auth/azure/start');
  },
  catalog: () => request<ApiSummary[]>('/api/catalog'),
  apiDetails: (id: string) => request<ApiDefinition>(`/api/apis/${id}`),
  apiSpec: (id: string) => request<Record<string, unknown>>(`/api/apis/${id}/spec`),
  invoke: (id: string, payload: Record<string, unknown>) =>
    request<InvokeResponse>(`/api/apis/${id}/invoke`, { method: 'POST', body: JSON.stringify(payload) }),
  users: () => request<User[]>('/api/admin/users'),
  createUser: (payload: UserPayload) => request('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (id: number, payload: UserPayload) => request(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteUser: (id: number) => request(`/api/admin/users/${id}`, { method: 'DELETE' }),
  userGroups: (id: number) => request<number[]>(`/api/admin/users/${id}/groups`),
  setUserGroups: (id: number, groupIds: number[]) => request(`/api/admin/users/${id}/groups`, { method: 'PUT', body: JSON.stringify(groupIds) }),
  groups: () => request<Group[]>('/api/admin/groups'),
  createGroup: (payload: GroupPayload) => request('/api/admin/groups', { method: 'POST', body: JSON.stringify(payload) }),
  updateGroup: (id: number, payload: GroupPayload) => request(`/api/admin/groups/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteGroup: (id: number) => request(`/api/admin/groups/${id}`, { method: 'DELETE' }),
  groupRoles: (id: number) => request<number[]>(`/api/admin/groups/${id}/roles`),
  setGroupRoles: (id: number, roleIds: number[]) => request(`/api/admin/groups/${id}/roles`, { method: 'PUT', body: JSON.stringify(roleIds) }),
  roles: () => request<Role[]>('/api/admin/roles'),
  createRole: (payload: RolePayload) => request('/api/admin/roles', { method: 'POST', body: JSON.stringify(payload) }),
  updateRole: (id: number, payload: RolePayload) => request(`/api/admin/roles/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteRole: (id: number) => request(`/api/admin/roles/${id}`, { method: 'DELETE' }),
  permissions: (roleId: number) => request<Permission[]>(`/api/admin/roles/${roleId}/permissions`),
  addPermission: (roleId: number, payload: { scope: string; description: string }) => request(`/api/admin/roles/${roleId}/permissions`, { method: 'POST', body: JSON.stringify(payload) }),
  replacePermissions: (roleId: number, scopes: string[]) => request(`/api/admin/roles/${roleId}/permissions`, { method: 'PUT', body: JSON.stringify({ scopes }) }),
  deletePermission: (id: number) => request(`/api/admin/permissions/${id}`, { method: 'DELETE' }),
  ldap: () => request<LdapConfig>('/api/admin/ldap'),
  updateLdap: (payload: LdapConfig) => request('/api/admin/ldap', { method: 'PUT', body: JSON.stringify(payload) }),
  testLdap: (payload: LdapConfig) => request('/api/admin/ldap/test', { method: 'POST', body: JSON.stringify(payload) }),
  searchLdap: (query: string) => request<LdapUser[]>('/api/admin/ldap/search', { method: 'POST', body: JSON.stringify({ query }) }),
  importLdap: (payload: LdapUser[]) => request('/api/admin/ldap/import', { method: 'POST', body: JSON.stringify(payload) }),
  azureAd: () => request<AzureADConfig>('/api/admin/azure-ad'),
  updateAzureAd: (payload: AzureADConfig) => request('/api/admin/azure-ad', { method: 'PUT', body: JSON.stringify(payload) }),
  testAzureAd: (payload: AzureADConfig) => request('/api/admin/azure-ad/test', { method: 'POST', body: JSON.stringify(payload) }),
  adminApis: () => request<ApiDefinition[]>('/api/admin/apis'),
  createApi: (payload: ApiDefinitionPayload) => request('/api/admin/apis', { method: 'POST', body: JSON.stringify(payload) }),
  updateApi: (id: number, payload: ApiDefinitionPayload) => request(`/api/admin/apis/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteApi: (id: number) => request(`/api/admin/apis/${id}`, { method: 'DELETE' }),
  refreshApiSpec: (id: number) => request(`/api/admin/apis/${id}/refresh`, { method: 'POST' }),
  auditLogs: (query = '') => request<PaginatedAuditLogs>(`/api/admin/audit-logs${query}`),
  exportAuditLogs: async () => {
    const token = getToken();
    const response = await fetch('/api/admin/audit-logs/export', {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return response.text();
  },
  session: () => request<SessionSettings>('/api/admin/session'),
  updateSession: (payload: SessionSettings) => request('/api/admin/session', { method: 'PUT', body: JSON.stringify(payload) }),
  system: () => request<SystemSettings>('/api/admin/system'),
  updateSystem: (payload: SystemSettings) => request('/api/admin/system', { method: 'PUT', body: JSON.stringify(payload) }),
  uploadSystemLogo: (file: File) => {
    const formData = new FormData();
    formData.append('logo', file);
    return uploadRequest<SystemSettings>('/api/admin/system/logo', formData);
  },
  deleteSystemLogo: () => request<SystemSettings>('/api/admin/system/logo', { method: 'DELETE' })
};
