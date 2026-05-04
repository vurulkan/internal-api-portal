import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ChipInput,
  FieldWrap,
  Input,
  MultiSelect,
  MultiSelectOption,
  NativeSelect,
  Spinner,
  Textarea,
  cn,
  fieldBase,
} from '../components/ui';
import {
  api,
  ApiDefinition,
  ApiDefinitionPayload,
  AuditLog,
  AzureADConfig,
  Group,
  GroupPayload,
  LdapConfig,
  LdapUser,
  Permission,
  Role,
  RolePayload,
  SessionSettings,
  SystemSettings,
  User,
  UserPayload,
} from '../services/api';

// ── Types ──────────────────────────────────────────────────────────────────────

const tabs = ['Users', 'Groups', 'Roles', 'API Definitions', 'LDAP Settings', 'Azure AD', 'Session Settings', 'Audit Logs', 'System Settings'] as const;
type Tab = (typeof tabs)[number];

const globalPermissionOptions = ['api.view', 'api.invoke'];

type UserForm = {
  id?: number;
  username: string;
  displayName: string;
  email: string;
  password: string;
  authSource: string;
  mustChangePassword: boolean;
  isActive: boolean;
  isAdmin: boolean;
  groupIds: number[];
};

type GroupForm = { id?: number; name: string; description: string; roleIds: number[] };
type RoleForm = { id?: number; name: string; description: string; scopes: string[] };
type ApiForm = {
  id?: number;
  name: string;
  slug: string;
  description: string;
  internalOpenapiUrl: string;
  internalBaseUrl: string;
  isActive: boolean;
  tryItEnabled: boolean;
  allowedMethods: string[];
  allowedPathPrefixes: string[];
  ownerTeam: string;
  tags: string[];
};

function emptyUserForm(): UserForm {
  return { username: '', displayName: '', email: '', password: '', authSource: 'local', mustChangePassword: true, isActive: true, isAdmin: false, groupIds: [] };
}
function emptyGroupForm(): GroupForm { return { name: '', description: '', roleIds: [] }; }
function emptyRoleForm(): RoleForm { return { name: '', description: '', scopes: [] }; }
function emptyApiForm(): ApiForm {
  return { name: '', slug: '', description: '', internalOpenapiUrl: '', internalBaseUrl: '', isActive: true, tryItEnabled: true, allowedMethods: [], allowedPathPrefixes: [], ownerTeam: '', tags: [] };
}

function splitList(value: string) {
  return value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

function buildAuditQuery(user: string, action: string, limit: number, offset: number) {
  const params = new URLSearchParams();
  if (user.trim()) params.set('user', user.trim());
  if (action.trim()) params.set('action', action.trim());
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const q = params.toString();
  return q ? `?${q}` : '';
}

// ── Sub-layouts ────────────────────────────────────────────────────────────────

function SplitLayout({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      {left}
      {right}
    </div>
  );
}

function EntityList({ title, subtitle, action, children }: { title: string; subtitle: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-800">{title}</p>
          <p className="text-xs text-gray-400">{subtitle}</p>
        </div>
        {action}
      </div>
      <hr className="mb-2 border-gray-100" />
      <div className="max-h-[640px] overflow-y-auto space-y-0.5">{children}</div>
    </div>
  );
}

function EntityItem({ label, sub, selected, onClick }: { label: string; sub?: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-lg px-3 py-2 text-left transition-colors',
        selected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
      )}
    >
      <p className="text-sm font-medium">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </button>
  );
}

function FormCard({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold text-gray-800">{title}</p>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <hr className="mb-4 border-gray-100" />
      {children}
    </div>
  );
}

// ── AdminPage ──────────────────────────────────────────────────────────────────

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Users');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [apis, setApis] = useState<ApiDefinition[]>([]);
  const [ldap, setLdap] = useState<LdapConfig | null>(null);
  const [azureAd, setAzureAd] = useState<AzureADConfig | null>(null);
  const [session, setSession] = useState<SessionSettings>({ sessionMinutes: 60 });
  const [system, setSystem] = useState<SystemSettings>({ brandTitle: '', logoDataUrl: '' });
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditUser, setAuditUser] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [auditPageSize, setAuditPageSize] = useState(25);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditTotal, setAuditTotal] = useState(0);
  const [ldapQuery, setLdapQuery] = useState('');
  const [ldapResults, setLdapResults] = useState<LdapUser[]>([]);
  const [selectedLdapUsers, setSelectedLdapUsers] = useState<string[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const [userGroupMap, setUserGroupMap] = useState<Record<number, number[]>>({});
  const [groupRoleMap, setGroupRoleMap] = useState<Record<number, number[]>>({});
  const [rolePermissionMap, setRolePermissionMap] = useState<Record<number, Permission[]>>({});

  const [userForm, setUserForm] = useState<UserForm>(emptyUserForm());
  const [groupForm, setGroupForm] = useState<GroupForm>(emptyGroupForm());
  const [roleForm, setRoleForm] = useState<RoleForm>(emptyRoleForm());
  const [apiForm, setApiForm] = useState<ApiForm>(emptyApiForm());

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [usersData, groupsData, rolesData, apisData, ldapData, azureAdData, sessionData, systemData, auditData] = await Promise.all([
        api.users(), api.groups(), api.roles(), api.adminApis(),
        api.ldap(), api.azureAd(), api.session(), api.system(),
        api.auditLogs(buildAuditQuery(auditUser, auditAction, auditPageSize, auditOffset)),
      ]);

      const nextUsers = usersData ?? [];
      const nextGroups = groupsData ?? [];
      const nextRoles = rolesData ?? [];
      const nextApis = apisData ?? [];

      setUsers(nextUsers);
      setGroups(nextGroups);
      setRoles(nextRoles);
      setApis(nextApis);
      setLdap(ldapData);
      setAzureAd(azureAdData);
      setSession(sessionData ?? { sessionMinutes: 60 });
      setSystem(systemData ?? { brandTitle: '', logoDataUrl: '' });
      setAuditLogs(auditData?.items ?? []);
      setAuditTotal(auditData?.total ?? 0);

      const nextUserGroups: Record<number, number[]> = {};
      const nextGroupRoles: Record<number, number[]> = {};
      const nextRolePermissions: Record<number, Permission[]> = {};

      await Promise.all(nextUsers.map(async (u) => { nextUserGroups[u.id] = (await api.userGroups(u.id)) ?? []; }));
      await Promise.all(nextGroups.map(async (g) => { nextGroupRoles[g.id] = (await api.groupRoles(g.id)) ?? []; }));
      await Promise.all(nextRoles.map(async (r) => { nextRolePermissions[r.id] = (await api.permissions(r.id)) ?? []; }));

      setUserGroupMap(nextUserGroups);
      setGroupRoleMap(nextGroupRoles);
      setRolePermissionMap(nextRolePermissions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Admin data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, [auditPageSize, auditOffset]);

  async function run(task: () => Promise<void>, successMessage: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
      setMessage(successMessage);
      await loadAll();
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : 'Operation failed.');
    } finally {
      setBusy(false);
    }
  }

  const groupOptions = useMemo(() => groups.map((g) => ({ label: g.name, value: g.id })), [groups]);
  const roleOptions = useMemo(() => roles.map((r) => ({ label: r.name, value: r.id })), [roles]);
  const currentRoleScopes = useMemo(() => new Set(roleForm.scopes), [roleForm.scopes]);
  const tagSuggestions = useMemo(() => Array.from(new Set(apis.flatMap((a) => a.tags ?? []))).sort(), [apis]);
  const pathPrefixSuggestions = useMemo(() => Array.from(new Set(apis.flatMap((a) => a.allowedPathPrefixes ?? []))).sort(), [apis]);

  function selectUser(user?: User) {
    if (!user) { setUserForm(emptyUserForm()); return; }
    setUserForm({ id: user.id, username: user.username, displayName: user.displayName ?? '', email: user.email ?? '', password: '', authSource: user.authSource, mustChangePassword: user.mustChangePassword, isActive: user.isActive, isAdmin: user.isAdmin, groupIds: userGroupMap[user.id] ?? [] });
  }
  function selectGroup(group?: Group) {
    if (!group) { setGroupForm(emptyGroupForm()); return; }
    setGroupForm({ id: group.id, name: group.name, description: group.description ?? '', roleIds: groupRoleMap[group.id] ?? [] });
  }
  function selectRole(role?: Role) {
    if (!role) { setRoleForm(emptyRoleForm()); return; }
    setRoleForm({ id: role.id, name: role.name, description: role.description ?? '', scopes: (rolePermissionMap[role.id] ?? []).map((p) => p.scope) });
  }
  function selectApi(apiItem?: ApiDefinition) {
    if (!apiItem) { setApiForm(emptyApiForm()); return; }
    setApiForm({ id: apiItem.id, name: apiItem.name, slug: apiItem.slug, description: apiItem.description ?? '', internalOpenapiUrl: apiItem.internalOpenapiUrl ?? '', internalBaseUrl: apiItem.internalBaseUrl ?? '', isActive: apiItem.isActive, tryItEnabled: apiItem.tryItEnabled, allowedMethods: apiItem.allowedMethods ?? [], allowedPathPrefixes: apiItem.allowedPathPrefixes ?? [], ownerTeam: apiItem.ownerTeam ?? '', tags: apiItem.tags ?? [] });
  }

  function toggleScope(scope: string, enabled: boolean) {
    setRoleForm((prev) => {
      const next = new Set(prev.scopes);
      enabled ? next.add(scope) : next.delete(scope);
      return { ...prev, scopes: Array.from(next).sort() };
    });
  }

  async function submitUser() {
    if (!userForm.username.trim()) { setError('Username is required.'); return; }
    if (!userForm.id && !userForm.password.trim()) { setError('Password is required for a new local user.'); return; }
    const payload: UserPayload = { username: userForm.username.trim(), displayName: userForm.displayName.trim(), email: userForm.email.trim(), password: userForm.password.trim() || undefined, authSource: userForm.authSource, mustChangePassword: userForm.mustChangePassword, isActive: userForm.isActive, isAdmin: userForm.isAdmin };
    await run(async () => {
      if (userForm.id) {
        await api.updateUser(userForm.id, payload);
        await api.setUserGroups(userForm.id, userForm.groupIds);
      } else {
        const created = (await api.createUser(payload)) as { id: number };
        await api.setUserGroups(created.id, userForm.groupIds);
      }
      setUserForm(emptyUserForm());
    }, userForm.id ? 'User updated.' : 'User created.');
  }

  async function submitGroup() {
    if (!groupForm.name.trim()) { setError('Group name is required.'); return; }
    const payload: GroupPayload = { name: groupForm.name.trim(), description: groupForm.description.trim() };
    await run(async () => {
      if (groupForm.id) {
        await api.updateGroup(groupForm.id, payload);
        await api.setGroupRoles(groupForm.id, groupForm.roleIds);
      } else {
        const created = (await api.createGroup(payload)) as { id: number };
        await api.setGroupRoles(created.id, groupForm.roleIds);
      }
      setGroupForm(emptyGroupForm());
    }, groupForm.id ? 'Group updated.' : 'Group created.');
  }

  async function submitRole() {
    if (!roleForm.name.trim()) { setError('Role name is required.'); return; }
    const payload: RolePayload = { name: roleForm.name.trim(), description: roleForm.description.trim() };
    await run(async () => {
      let roleId = roleForm.id;
      if (roleId) { await api.updateRole(roleId, payload); }
      else { const created = (await api.createRole(payload)) as { id: number }; roleId = created.id; }
      await api.replacePermissions(roleId!, roleForm.scopes);
      setRoleForm(emptyRoleForm());
    }, roleForm.id ? 'Role updated.' : 'Role created.');
  }

  async function submitApi() {
    if (!apiForm.name.trim() || !apiForm.slug.trim()) { setError('API name and slug are required.'); return; }
    if (!apiForm.internalOpenapiUrl.trim() || !apiForm.internalBaseUrl.trim()) { setError('Internal OpenAPI URL and Internal Base URL are required.'); return; }
    const payload: ApiDefinitionPayload = { name: apiForm.name.trim(), slug: apiForm.slug.trim(), description: apiForm.description.trim(), internalOpenapiUrl: apiForm.internalOpenapiUrl.trim(), internalBaseUrl: apiForm.internalBaseUrl.trim(), isActive: apiForm.isActive, tryItEnabled: apiForm.tryItEnabled, allowedMethods: apiForm.allowedMethods.map((m) => m.toUpperCase()), allowedPathPrefixes: apiForm.allowedPathPrefixes, ownerTeam: apiForm.ownerTeam.trim(), tags: apiForm.tags };
    await run(async () => {
      if (apiForm.id) await api.updateApi(apiForm.id, payload);
      else await api.createApi(payload);
      setApiForm(emptyApiForm());
    }, apiForm.id ? 'API updated.' : 'API created.');
  }

  async function saveLdap() {
    if (!ldap) return;
    await run(async () => { await api.updateLdap({ ...ldap, userBaseDns: ldap.userBaseDns ?? [] }); }, 'LDAP settings updated.');
  }

  async function searchLdap() {
    setBusy(true);
    setError('');
    try {
      const results = (await api.searchLdap(ldapQuery.trim())) ?? [];
      setLdapResults(results);
      setSelectedLdapUsers([]);
      if (results.length === 0) setMessage('LDAP search returned no users. userFilter and attributes may need adjustment.');
    } catch (ldapError) {
      setError(ldapError instanceof Error ? ldapError.message : 'LDAP search failed.');
      setLdapResults([]);
    } finally {
      setBusy(false);
    }
  }

  async function importSelectedLdapUsers() {
    const payload = ldapResults.filter((item) => selectedLdapUsers.includes(item.username));
    if (payload.length === 0) { setError('Select at least one LDAP user to import.'); return; }
    await run(async () => { await api.importLdap(payload); setSelectedLdapUsers([]); }, 'LDAP users imported.');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin Console</h1>
        <p className="mt-1 text-sm text-gray-500">
          User, group, role, LDAP and API registry management. Browser-visible state stays limited to portal metadata.
        </p>
      </div>

      {error && <div className="mb-4"><Alert variant="error">{error}</Alert></div>}
      {message && <div className="mb-4"><Alert variant="success">{message}</Alert></div>}

      {/* Tab bar */}
      <div className="mb-5 overflow-x-auto">
        <div className="flex min-w-max border-b border-gray-200">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => { setActiveTab(tab); setMessage(''); setError(''); }}
              className={cn(
                'px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
                activeTab === tab
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ── Users ── */}
      {activeTab === 'Users' && (
        <SplitLayout
          left={
            <EntityList
              title="Users"
              subtitle="Select a user to edit, or create a new local account."
              action={<Button size="sm" onClick={() => selectUser()}>New User</Button>}
            >
              {users.map((user) => (
                <EntityItem
                  key={user.id}
                  label={user.username}
                  sub={[user.authSource, user.isActive ? 'active' : 'disabled', user.isAdmin ? 'admin' : 'user'].join(' · ')}
                  selected={userForm.id === user.id}
                  onClick={() => selectUser(user)}
                />
              ))}
            </EntityList>
          }
          right={
            <FormCard
              title={userForm.id ? `Edit User #${userForm.id}` : 'Create User'}
              actions={
                <>
                  {userForm.id && (
                    <Button variant="danger" size="sm" onClick={() => run(async () => { await api.deleteUser(userForm.id!); setUserForm(emptyUserForm()); }, 'User deleted.')}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  )}
                  <Button variant="primary" size="sm" onClick={() => void submitUser()} disabled={busy}>
                    <Save className="h-3.5 w-3.5" /> Save
                  </Button>
                </>
              }
            >
              <div className="space-y-4">
                <Input label="Username" value={userForm.username} onChange={(v) => setUserForm({ ...userForm, username: v })} required />
                <Input label="Display Name" value={userForm.displayName} onChange={(v) => setUserForm({ ...userForm, displayName: v })} />
                <Input label="Email" value={userForm.email} onChange={(v) => setUserForm({ ...userForm, email: v })} />
                <Input label={userForm.id ? 'New Password (optional)' : 'Password'} type="password" value={userForm.password} onChange={(v) => setUserForm({ ...userForm, password: v })} required={!userForm.id} />
                <Input label="Auth Source" value={userForm.authSource} disabled />
                <MultiSelect
                  label="Groups"
                  options={groupOptions}
                  value={groupOptions.filter((o) => userForm.groupIds.includes(o.value))}
                  onChange={(v: MultiSelectOption[]) => setUserForm({ ...userForm, groupIds: v.map((i) => i.value) })}
                />
                <div className="flex flex-wrap gap-4">
                  <Checkbox label="Active" checked={userForm.isActive} onChange={(v) => setUserForm({ ...userForm, isActive: v })} />
                  <Checkbox label="Admin" checked={userForm.isAdmin} onChange={(v) => setUserForm({ ...userForm, isAdmin: v })} />
                  <Checkbox label="Force Password Change" checked={userForm.mustChangePassword} onChange={(v) => setUserForm({ ...userForm, mustChangePassword: v })} />
                </div>
              </div>
            </FormCard>
          }
        />
      )}

      {/* ── Groups ── */}
      {activeTab === 'Groups' && (
        <SplitLayout
          left={
            <EntityList title="Groups" subtitle="Groups aggregate users and receive roles.">
              {groups.map((group) => (
                <EntityItem key={group.id} label={group.name} sub={group.description || 'No description'} selected={groupForm.id === group.id} onClick={() => selectGroup(group)} />
              ))}
            </EntityList>
          }
          right={
            <FormCard
              title={groupForm.id ? `Edit Group #${groupForm.id}` : 'Create Group'}
              actions={
                <>
                  <Button size="sm" onClick={() => selectGroup()}>New Group</Button>
                  {groupForm.id && (
                    <Button variant="danger" size="sm" onClick={() => run(async () => { await api.deleteGroup(groupForm.id!); setGroupForm(emptyGroupForm()); }, 'Group deleted.')}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  )}
                  <Button variant="primary" size="sm" onClick={() => void submitGroup()} disabled={busy}>
                    <Save className="h-3.5 w-3.5" /> Save
                  </Button>
                </>
              }
            >
              <div className="space-y-4">
                <Input label="Group Name" value={groupForm.name} onChange={(v) => setGroupForm({ ...groupForm, name: v })} required />
                <Textarea label="Description" value={groupForm.description} onChange={(v) => setGroupForm({ ...groupForm, description: v })} rows={3} />
                <MultiSelect
                  label="Roles"
                  options={roleOptions}
                  value={roleOptions.filter((o) => groupForm.roleIds.includes(o.value))}
                  onChange={(v: MultiSelectOption[]) => setGroupForm({ ...groupForm, roleIds: v.map((i) => i.value) })}
                />
              </div>
            </FormCard>
          }
        />
      )}

      {/* ── Roles ── */}
      {activeTab === 'Roles' && (
        <SplitLayout
          left={
            <EntityList title="Roles" subtitle="Permissions are assigned to roles, then inherited through groups.">
              {roles.map((role) => (
                <EntityItem key={role.id} label={role.name} sub={role.description || 'No description'} selected={roleForm.id === role.id} onClick={() => selectRole(role)} />
              ))}
            </EntityList>
          }
          right={
            <FormCard
              title={roleForm.id ? `Edit Role #${roleForm.id}` : 'Create Role'}
              actions={
                <>
                  <Button size="sm" onClick={() => selectRole()}>New Role</Button>
                  {roleForm.id && (
                    <Button variant="danger" size="sm" onClick={() => run(async () => { await api.deleteRole(roleForm.id!); setRoleForm(emptyRoleForm()); }, 'Role deleted.')}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  )}
                  <Button variant="primary" size="sm" onClick={() => void submitRole()} disabled={busy}>
                    <Save className="h-3.5 w-3.5" /> Save
                  </Button>
                </>
              }
            >
              <div className="space-y-5">
                <Input label="Role Name" value={roleForm.name} onChange={(v) => setRoleForm({ ...roleForm, name: v })} required />
                <Textarea label="Description" value={roleForm.description} onChange={(v) => setRoleForm({ ...roleForm, description: v })} rows={2} />

                <div>
                  <p className="mb-2 text-sm font-semibold text-gray-700">Global Permissions</p>
                  <div className="flex flex-wrap gap-2">
                    {globalPermissionOptions.map((scope) => (
                      <button
                        key={scope}
                        type="button"
                        onClick={() => toggleScope(scope, !currentRoleScopes.has(scope))}
                        className={cn(
                          'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                          currentRoleScopes.has(scope)
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                        )}
                      >
                        {scope}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-sm font-semibold text-gray-700">Per-API Permissions</p>
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">API</th>
                          <th className="px-3 py-2 text-center text-xs font-medium uppercase text-gray-500">View</th>
                          <th className="px-3 py-2 text-center text-xs font-medium uppercase text-gray-500">Invoke</th>
                          <th className="px-3 py-2 text-center text-xs font-medium uppercase text-gray-500">Manage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {apis.map((apiItem) => (
                          <tr key={apiItem.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <p className="font-medium text-gray-800">{apiItem.name}</p>
                              <p className="text-xs text-gray-400">{apiItem.slug}</p>
                            </td>
                            {['view', 'invoke', 'manage'].map((action) => {
                              const scope = `api:${apiItem.id}:${action}`;
                              return (
                                <td key={scope} className="px-3 py-2 text-center">
                                  <input
                                    type="checkbox"
                                    checked={currentRoleScopes.has(scope)}
                                    onChange={(e) => toggleScope(scope, e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </FormCard>
          }
        />
      )}

      {/* ── API Definitions ── */}
      {activeTab === 'API Definitions' && (
        <SplitLayout
          left={
            <EntityList
              title="Registered APIs"
              subtitle="Internal URLs remain server-side. Select an API to edit or refresh its cached spec."
              action={<Button size="sm" onClick={() => selectApi()}>New API</Button>}
            >
              {apis.map((apiItem) => (
                <EntityItem
                  key={apiItem.id}
                  label={apiItem.name}
                  sub={[apiItem.slug, apiItem.isActive ? 'active' : 'inactive', apiItem.lastSpecStatus || 'never refreshed'].join(' · ')}
                  selected={apiForm.id === apiItem.id}
                  onClick={() => selectApi(apiItem)}
                />
              ))}
            </EntityList>
          }
          right={
            <FormCard
              title={apiForm.id ? `Edit API #${apiForm.id}` : 'Create API'}
              actions={
                <>
                  {apiForm.id && (
                    <>
                      <Button size="sm" onClick={() => run(async () => { await api.refreshApiSpec(apiForm.id!); }, 'API spec refreshed.')}>
                        <RefreshCw className="h-3.5 w-3.5" /> Refresh Spec
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => run(async () => { await api.deleteApi(apiForm.id!); setApiForm(emptyApiForm()); }, 'API deleted.')}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    </>
                  )}
                  <Button variant="primary" size="sm" onClick={() => void submitApi()} disabled={busy}>
                    <Save className="h-3.5 w-3.5" /> Save
                  </Button>
                </>
              }
            >
              <div className="space-y-4">
                <Input label="Name" value={apiForm.name} onChange={(v) => setApiForm({ ...apiForm, name: v })} required />
                <Input label="Slug" value={apiForm.slug} onChange={(v) => setApiForm({ ...apiForm, slug: v })} required />
                <Textarea label="Description" value={apiForm.description} onChange={(v) => setApiForm({ ...apiForm, description: v })} rows={3} />
                <Input label="Internal OpenAPI URL" value={apiForm.internalOpenapiUrl} onChange={(v) => setApiForm({ ...apiForm, internalOpenapiUrl: v })} required />
                <Input label="Internal Base URL" value={apiForm.internalBaseUrl} onChange={(v) => setApiForm({ ...apiForm, internalBaseUrl: v })} required />
                <Input label="Owner Team" value={apiForm.ownerTeam} onChange={(v) => setApiForm({ ...apiForm, ownerTeam: v })} />
                <ChipInput
                  label="Allowed Methods"
                  helperText="Optional allowlist. Type or choose a method, then press Enter."
                  options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE']}
                  value={apiForm.allowedMethods}
                  normalize={(v) => v.toUpperCase()}
                  onChange={(v) => setApiForm({ ...apiForm, allowedMethods: v })}
                />
                <ChipInput
                  label="Allowed Path Prefixes"
                  helperText="Optional allowlist. Type a path prefix like /v1/orders."
                  options={pathPrefixSuggestions}
                  value={apiForm.allowedPathPrefixes}
                  onChange={(v) => setApiForm({ ...apiForm, allowedPathPrefixes: v })}
                />
                <ChipInput
                  label="Tags"
                  helperText="Type a tag and press Enter, or reuse an existing tag."
                  options={tagSuggestions}
                  value={apiForm.tags}
                  onChange={(v) => setApiForm({ ...apiForm, tags: v })}
                />
                <div className="flex flex-wrap gap-4">
                  <Checkbox label="Active" checked={apiForm.isActive} onChange={(v) => setApiForm({ ...apiForm, isActive: v })} />
                  <Checkbox label="Try It Enabled" checked={apiForm.tryItEnabled} onChange={(v) => setApiForm({ ...apiForm, tryItEnabled: v })} />
                </div>
              </div>
            </FormCard>
          }
        />
      )}

      {/* ── LDAP Settings ── */}
      {activeTab === 'LDAP Settings' && (
        <div className="space-y-5">
          <FormCard
            title="LDAP Connection"
            actions={
              <>
                <Button onClick={() => run(async () => { if (!ldap) return; await api.testLdap(ldap); }, 'LDAP connection successful.')}>
                  Test Connection
                </Button>
                <Button variant="primary" onClick={() => void saveLdap()} disabled={busy || !ldap}>
                  <Save className="h-3.5 w-3.5" /> Save
                </Button>
              </>
            }
          >
            {ldap && (
              <div className="space-y-4">
                <Checkbox label="LDAP Enabled" checked={ldap.enabled} onChange={(v) => setLdap({ ...ldap, enabled: v })} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Host" value={ldap.host} onChange={(v) => setLdap({ ...ldap, host: v })} />
                  <FieldWrap label="Port">
                    <input type="number" value={ldap.port} onChange={(e) => setLdap({ ...ldap, port: Number(e.target.value) })} className={fieldBase} />
                  </FieldWrap>
                  <Input label="URL" value={ldap.url} onChange={(v) => setLdap({ ...ldap, url: v })} />
                  <FieldWrap label="Timeout Seconds">
                    <input type="number" value={ldap.timeoutSeconds} onChange={(e) => setLdap({ ...ldap, timeoutSeconds: Number(e.target.value) })} className={fieldBase} />
                  </FieldWrap>
                  <Input label="Bind DN" value={ldap.bindDn} onChange={(v) => setLdap({ ...ldap, bindDn: v })} />
                  <Input label={ldap.passwordConfigured ? 'Bind Password (leave blank to keep current)' : 'Bind Password'} type="password" value={ldap.bindPassword ?? ''} onChange={(v) => setLdap({ ...ldap, bindPassword: v })} />
                  <Input label="User Base DN" value={ldap.userBaseDn} onChange={(v) => setLdap({ ...ldap, userBaseDn: v })} />
                  <Input label="Username Attribute" value={ldap.usernameAttribute} onChange={(v) => setLdap({ ...ldap, usernameAttribute: v })} />
                  <Input label="Display Name Attribute" value={ldap.displayNameAttribute} onChange={(v) => setLdap({ ...ldap, displayNameAttribute: v })} />
                  <Input label="Email Attribute" value={ldap.emailAttribute} onChange={(v) => setLdap({ ...ldap, emailAttribute: v })} />
                </div>
                <Textarea label="User Base DNs" value={(ldap.userBaseDns ?? []).join('\n')} onChange={(v) => setLdap({ ...ldap, userBaseDns: splitList(v) })} helperText="Comma or newline separated values." rows={2} />
                <Input label="User Filter" value={ldap.userFilter} onChange={(v) => setLdap({ ...ldap, userFilter: v })} helperText="Examples: (objectClass=user) or (&(objectClass=user)(objectCategory=person))" />
                <div className="flex flex-wrap gap-4">
                  <Checkbox label="Use SSL" checked={ldap.useSsl} onChange={(v) => setLdap({ ...ldap, useSsl: v })} />
                  <Checkbox label="StartTLS" checked={ldap.startTls} onChange={(v) => setLdap({ ...ldap, startTls: v })} />
                  <Checkbox label="Skip TLS Verify" checked={ldap.sslSkipVerify} onChange={(v) => setLdap({ ...ldap, sslSkipVerify: v })} />
                </div>
              </div>
            )}
          </FormCard>

          <FormCard
            title="LDAP User Import"
            actions={
              <>
                <Button onClick={() => void searchLdap()} disabled={busy}>
                  <RefreshCw className="h-3.5 w-3.5" /> Search
                </Button>
                <Button variant="primary" onClick={() => void importSelectedLdapUsers()} disabled={busy || selectedLdapUsers.length === 0}>
                  Import Selected
                </Button>
              </>
            }
          >
            <div className="space-y-3">
              <Input label="Search Query" value={ldapQuery} onChange={setLdapQuery} />
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="w-10 px-3 py-2" />
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Username</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Display Name</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Email</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">DN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {ldapResults.map((item) => (
                      <tr key={item.username} className="hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedLdapUsers.includes(item.username)}
                            onChange={(e) =>
                              setSelectedLdapUsers((prev) =>
                                e.target.checked ? [...prev, item.username] : prev.filter((v) => v !== item.username)
                              )
                            }
                            className="h-4 w-4 rounded border-gray-300 text-blue-600"
                          />
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-800">{item.username}</td>
                        <td className="px-3 py-2 text-gray-600">{item.displayName || '-'}</td>
                        <td className="px-3 py-2 text-gray-600">{item.email || '-'}</td>
                        <td className="max-w-xs break-all px-3 py-2 text-xs text-gray-400">{item.dn}</td>
                      </tr>
                    ))}
                    {ldapResults.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">
                          No LDAP search results. Run a search above.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </FormCard>
        </div>
      )}

      {/* ── Azure AD ── */}
      {activeTab === 'Azure AD' && (
        <FormCard
          title="Azure AD / Microsoft Entra ID"
          actions={
            <>
              <Button onClick={() => run(async () => { if (!azureAd) return; await api.testAzureAd(azureAd); }, 'Azure AD connection successful.')} disabled={!azureAd}>
                Test
              </Button>
              <Button variant="primary" onClick={() => run(async () => { if (!azureAd) return; await api.updateAzureAd(azureAd); }, 'Azure AD settings updated.')} disabled={!azureAd || busy}>
                <Save className="h-3.5 w-3.5" /> Save
              </Button>
            </>
          }
        >
          {azureAd && (
            <div className="space-y-4">
              <Checkbox label="Azure AD Enabled" checked={azureAd.enabled} onChange={(v) => setAzureAd({ ...azureAd, enabled: v })} />
              <Input label="Tenant ID" value={azureAd.tenantId} onChange={(v) => setAzureAd({ ...azureAd, tenantId: v })} />
              <Input label="Client ID" value={azureAd.clientId} onChange={(v) => setAzureAd({ ...azureAd, clientId: v })} />
              <Input label={azureAd.passwordConfigured ? 'Client Secret (leave blank to keep current)' : 'Client Secret'} type="password" value={azureAd.clientSecret ?? ''} onChange={(v) => setAzureAd({ ...azureAd, clientSecret: v })} />
              <Input label="Redirect URL" value={azureAd.redirectUrl} onChange={(v) => setAzureAd({ ...azureAd, redirectUrl: v })} helperText="Example: https://portal.example.com/api/auth/azure/callback" />
              <Alert variant="info">
                Existing app groups and roles continue to work locally. Azure AD is used only as an additional login method.
              </Alert>
            </div>
          )}
        </FormCard>
      )}

      {/* ── Session Settings ── */}
      {activeTab === 'Session Settings' && (
        <FormCard
          title="Session Configuration"
          actions={
            <Button variant="primary" onClick={() => run(async () => { await api.updateSession(session); }, 'Session settings updated.')} disabled={busy}>
              <Save className="h-3.5 w-3.5" /> Save
            </Button>
          }
        >
          <div className="max-w-xs">
            <FieldWrap label="Session Minutes" helperText="Minimum 5 minutes.">
              <input
                type="number"
                value={session.sessionMinutes}
                onChange={(e) => setSession({ sessionMinutes: Number(e.target.value) })}
                className={fieldBase}
              />
            </FieldWrap>
          </div>
        </FormCard>
      )}

      {/* ── Audit Logs ── */}
      {activeTab === 'Audit Logs' && (
        <FormCard
          title="Audit Logs"
          actions={
            <>
              <Button onClick={() => void loadAll()}>
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
              <Button
                onClick={async () => {
                  const csv = await api.exportAuditLogs();
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = window.URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'audit-logs.csv';
                  link.click();
                  window.URL.revokeObjectURL(url);
                }}
              >
                Export CSV
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Filter by User" value={auditUser} onChange={setAuditUser} />
              <Input label="Filter by Action" value={auditAction} onChange={setAuditAction} />
              <NativeSelect
                label="Rows per page"
                value={String(auditPageSize)}
                onChange={(v) => { setAuditPageSize(Number(v)); setAuditOffset(0); }}
                options={[25, 50, 100].map((n) => ({ label: String(n), value: String(n) }))}
              />
            </div>
            <Button variant="secondary" onClick={() => { setAuditOffset(0); void loadAll(); }}>
              Apply Filters
            </Button>

            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Timestamp', 'User', 'Action', 'Resource', 'Status', 'Error'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditLogs.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">{new Date(entry.timestamp).toLocaleString()}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{entry.user}</td>
                      <td className="px-3 py-2 text-gray-700">{entry.action}</td>
                      <td className="px-3 py-2 text-gray-600">{[entry.resourceType, entry.resourceName || entry.resourceId].filter(Boolean).join(' / ')}</td>
                      <td className="px-3 py-2">
                        <Badge variant={entry.statusCode >= 200 && entry.statusCode < 300 ? 'green' : 'red'}>
                          {entry.statusCode}
                        </Badge>
                      </td>
                      <td className="max-w-xs break-all px-3 py-2 text-xs text-gray-400">{entry.errorMessage || '-'}</td>
                    </tr>
                  ))}
                  {auditLogs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-400">No audit records found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-gray-500">
                {auditTotal === 0 ? 'No audit records' : `${auditOffset + 1}–${Math.min(auditOffset + auditLogs.length, auditTotal)} of ${auditTotal}`}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={auditOffset === 0} onClick={() => setAuditOffset((prev) => Math.max(0, prev - auditPageSize))}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" disabled={auditOffset + auditPageSize >= auditTotal} onClick={() => setAuditOffset((prev) => prev + auditPageSize)}>
                  Next
                </Button>
              </div>
            </div>
          </div>
        </FormCard>
      )}

      {/* ── System Settings ── */}
      {activeTab === 'System Settings' && (
        <FormCard
          title="Portal Branding"
          actions={
            <Button variant="primary" onClick={() => run(async () => { await api.updateSystem(system); }, 'System settings updated.')} disabled={busy}>
              <Save className="h-3.5 w-3.5" /> Save
            </Button>
          }
        >
          <div className="space-y-4">
            <Input label="Brand Title" value={system.brandTitle} onChange={(v) => setSystem({ ...system, brandTitle: v })} />
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">Logo</p>
              {system.logoDataUrl ? (
                <img src={system.logoDataUrl} alt={system.brandTitle || 'Portal logo'} className="mb-2 max-h-20 max-w-[220px] rounded-lg border border-gray-200 object-contain p-2" />
              ) : (
                <p className="mb-2 text-sm text-gray-400">No custom logo uploaded.</p>
              )}
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors">
                Select Image
                <input hidden type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
              </label>
              {logoFile && <span className="ml-2 text-xs text-gray-500">{logoFile.name}</span>}
              <div className="mt-3 flex gap-2">
                <Button variant="primary" disabled={!logoFile || busy} onClick={() => run(async () => { if (!logoFile) return; const settings = await api.uploadSystemLogo(logoFile); setSystem(settings); setLogoFile(null); }, 'Logo uploaded.')}>
                  Upload Logo
                </Button>
                <Button variant="danger" disabled={!system.logoDataUrl || busy} onClick={() => run(async () => { const settings = await api.deleteSystemLogo(); setSystem(settings); setLogoFile(null); }, 'Logo removed.')}>
                  Remove Logo
                </Button>
              </div>
              <p className="mt-2 text-xs text-gray-400">PNG, JPEG, SVG or WEBP. Max 256 KB.</p>
            </div>
          </div>
        </FormCard>
      )}
    </div>
  );
}
