import { request, type Session } from './api';

// Admin console endpoints added in 2.0.0 (overview, previews, bulk changes).

export type AttentionItem = {
  kind: 'spec_error' | 'spec_missing' | 'spec_stale' | 'encryption_key_in_database' | 'ldap_skip_verify';
  severity: 'warning' | 'danger';
  apiId?: number;
  apiName?: string;
  /** The spec error text: only the API's managers get it. */
  detail?: string;
  since?: string;
};

export type AdminOverview = {
  generatedAt: string;
  apis?: { total: number; active: number; specErrors: number; specMissing: number; stale: number };
  users?: { total: number; active: number; admins: number; signedIn24h: number };
  activeSessions?: number;
  activity?: {
    invokes: Partial<Record<'success' | 'denied' | 'failed', number>>;
    denied: number;
    failed: number;
    logins: Partial<Record<'success' | 'denied' | 'failed', number>>;
  };
  attention: AttentionItem[];
};

export type PermissionSource = {
  scope: string;
  via: 'role' | 'owner' | 'access';
  groupId: number;
  groupName: string;
  roleId?: number;
  roleName?: string;
};

export type EffectivePermissions = {
  userId: number;
  isAdmin: boolean;
  groupIds: number[];
  scopes: string[];
  sources: PermissionSource[];
};

export type SpecPreview = {
  format: 'json' | 'yaml';
  bytes: number;
  openapi: string;
  title: string;
  version: string;
  operationCount: number;
  tagCount: number;
  sample: { method: string; path: string; summary: string }[];
};

export type ApiImpact = {
  accessGrants: number;
  roleScopes: number;
  favorites: number;
  operations: number;
  historyEntries: number;
  hasOwnerGroup: boolean;
};

export type SystemInfo = {
  version: string;
  goVersion: string;
  startedAt: string;
  databaseBytes: number;
  schemaVersion: number;
  encryptionKeySource: 'environment' | 'database';
  encryptionKeyId: string;
  specRefreshMinutes: number;
  auditRetentionDays: number;
  backupsEnabled: boolean;
  metricsEnabled: boolean;
  timeZone: string;
};

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const adminApi = {
  overview: () => request<AdminOverview>('/api/admin/overview'),
  systemInfo: () => request<SystemInfo>('/api/admin/system/info'),
  specPreview: (url: string, signal?: AbortSignal) =>
    request<SpecPreview>('/api/admin/apis/spec-preview', { ...json('POST', { url }), signal }),
  apiImpact: (id: number) => request<ApiImpact>(`/api/admin/apis/${id}/impact`),
  /** groupIds previews another group set; omitted, the user's current groups. */
  userPermissions: (id: number, groupIds?: number[]) =>
    request<EffectivePermissions>(
      `/api/admin/users/${id}/permissions${groupIds ? `?groupIds=${groupIds.join(',')}` : ''}`,
    ),
  groupPermissions: (id: number) =>
    request<{ groupId: number; sources: PermissionSource[] }>(`/api/admin/groups/${id}/permissions`),
  userSessions: (id: number) => request<{ items: Session[] }>(`/api/admin/sessions?userId=${id}`),
  /** An Azure AD account waiting for its first Microsoft sign-in. */
  preregisterAzure: (payload: { email: string; upn?: string; displayName?: string; groupIds: number[] }) =>
    request<{ id: number; username: string; sharesEmailWith?: string }>(
      '/api/admin/users/azure',
      json('POST', payload),
    ),
  bulkUserStatus: (userIds: number[], active: boolean) =>
    request<{ changed: number[]; sessionsRevoked: number }>(
      '/api/admin/users/bulk-status',
      json('POST', { userIds, active }),
    ),
  addGroupMembers: (groupId: number, userIds: number[]) =>
    request<{ added: number[] }>(`/api/admin/groups/${groupId}/members`, json('POST', { userIds })),
  removeGroupMember: (groupId: number, userId: number) =>
    request(`/api/admin/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
};
