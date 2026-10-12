// The admin console's sections, without their components: the admin page renders
// them, the command palette and "g a" navigate to them.

export type AdminSectionDef = {
  id: string;
  path: string;
  group: 'start' | 'people' | 'apis' | 'platform';
  /** Open when the server lists any of these capability sections. */
  needs: string[] | 'any';
};

export const ADMIN_SECTIONS: AdminSectionDef[] = [
  { id: 'overview', path: 'overview', group: 'start', needs: 'any' },
  { id: 'users', path: 'users', group: 'people', needs: ['users'] },
  { id: 'groups', path: 'groups', group: 'people', needs: ['groups'] },
  { id: 'roles', path: 'roles', group: 'people', needs: ['roles'] },
  { id: 'sessions', path: 'sessions', group: 'people', needs: ['sessions'] },
  { id: 'apis', path: 'apis', group: 'apis', needs: ['apis'] },
  { id: 'identity', path: 'identity', group: 'platform', needs: ['ldap', 'azureAd'] },
  { id: 'audit', path: 'audit', group: 'platform', needs: ['audit'] },
  { id: 'settings', path: 'settings', group: 'platform', needs: ['sessionSettings', 'system'] },
];

/** The sections a user with these capability sections may open. */
export function visibleAdminSections(allowed: string[]) {
  if (allowed.length === 0) return [];
  return ADMIN_SECTIONS.filter((s) => s.needs === 'any' || s.needs.some((need) => allowed.includes(need)));
}
