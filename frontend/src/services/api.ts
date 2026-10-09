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
export type SessionSettings = { sessionMinutes: number; maxHours: number };
export type Session = {
  id: number;
  userId: number;
  username?: string;
  authSource: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  ip: string;
  userAgent: string;
  current?: boolean;
};
export type LdapLoginStep = { name: string; ok: boolean; detail: string };
export type SystemSettings = { brandTitle: string; logoDataUrl: string };
export type AzureADConfig = {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  clientSecret?: string;
  redirectUrl: string;
  passwordConfigured: boolean;
  allowedGroups: string[];
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
  passwordPolicy?: { minLength: number };
  session?: { expiresAt: string; idleMinutes: number };
  // e.g. "encryption_key_in_database" (administrators only)
  warnings?: string[];
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

// Sessions live in an HttpOnly cookie the page can't read. Tokens kept in
// localStorage by 1.3.0 and older are removed.
try {
  localStorage.removeItem('api_portal_token');
} catch {
  // storage unavailable (private mode): nothing to clean up
}

// Every request carries this header; the backend refuses state-changing API
// requests without it (CSRF protection, see backend/internal/api/session.go).
const CSRF_HEADER = 'X-CSRF-Protection';

// ApiError carries the backend's error body: {"error", "code", "requestId"}.
// message is the human-readable text; requestId lets support find the log lines.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;

  constructor(status: number, message: string, code = '', requestId = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const text = await response.text();
  const requestId = response.headers.get('X-Request-Id') ?? '';
  try {
    const body = JSON.parse(text) as { error?: string; code?: string; requestId?: string };
    if (body && typeof body.error === 'string') {
      return new ApiError(response.status, body.error, body.code ?? '', body.requestId || requestId);
    }
  } catch {
    // Not JSON (e.g. a proxy's HTML error page): fall back to the raw text.
  }
  return new ApiError(response.status, text.trim() || `Request failed (${response.status})`, '', requestId);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  headers.set('Content-Type', 'application/json');
  headers.set(CSRF_HEADER, '1');
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  if (!response.ok) {
    throw await toApiError(response);
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
  headers.set(CSRF_HEADER, '1');
  const response = await fetch(path, { method: 'POST', body: formData, headers, credentials: 'same-origin' });
  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ ok: boolean }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  mySessions: () => request<{ items: Session[] }>('/api/auth/sessions'),
  revokeMySession: (id: number) => request(`/api/auth/sessions/${id}`, { method: 'DELETE' }),
  revokeMyOtherSessions: () => request<{ sessionsRevoked: number }>('/api/auth/sessions/revoke-others', { method: 'POST' }),
  sessions: () => request<{ items: Session[] }>('/api/admin/sessions'),
  revokeSession: (id: number) => request(`/api/admin/sessions/${id}`, { method: 'DELETE' }),
  revokeUserSessions: (id: number) => request<{ sessionsRevoked: number }>(`/api/admin/users/${id}/revoke-sessions`, { method: 'POST' }),
  resetPassword: (id: number) =>
    request<{ temporaryPassword: string; sessionsRevoked: number }>(`/api/admin/users/${id}/reset-password`, { method: 'POST' }),
  testLdapLogin: (username: string, password: string) =>
    request<{ ok: boolean; steps: LdapLoginStep[] }>('/api/admin/ldap/test-login', { method: 'POST', body: JSON.stringify({ username, password }) }),
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
  // skipped: usernames that already belong to a local or Azure AD account (left unchanged).
  importLdap: (payload: LdapUser[]) =>
    request<{ imported: number; skipped: string[] }>('/api/admin/ldap/import', { method: 'POST', body: JSON.stringify(payload) }),
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
    const response = await fetch('/api/admin/audit-logs/export', { credentials: 'same-origin' });
    if (!response.ok) {
      throw await toApiError(response);
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
