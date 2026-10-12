/** Starting points for a new role; the scopes can be changed before saving. */
export const ROLE_TEMPLATES = [
  { id: 'viewer', scopes: ['api.view'] },
  { id: 'consumer', scopes: ['api.invoke'] },
  { id: 'apiOwner', scopes: ['api.view', 'api.create'] },
  { id: 'auditor', scopes: ['audit.view', 'audit.export'] },
  {
    id: 'admin',
    scopes: [
      'api.manage',
      'audit.export',
      'audit.view',
      'group.manage',
      'idp.manage',
      'role.manage',
      'session.manage',
      'settings.manage',
      'user.manage',
      'user.view',
    ],
  },
] as const;

export type RoleTemplateId = (typeof ROLE_TEMPLATES)[number]['id'];

export function scopeDiff(before: string[], after: string[]) {
  const was = new Set(before);
  const now = new Set(after);
  return { added: after.filter((s) => !was.has(s)), removed: before.filter((s) => !now.has(s)) };
}
