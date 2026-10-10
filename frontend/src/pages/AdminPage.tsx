import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, LogOut, RefreshCw, Save, Trash2, XCircle } from 'lucide-react';
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
  ApiAccess,
  ApiDefinition,
  auditQuery,
  AuditFilter,
  ApiDefinitionPayload,
  AuditLog,
  AzureADConfig,
  Group,
  GroupPayload,
  LdapConfig,
  LdapLoginStep,
  LdapUser,
  MeResponse,
  Permission,
  ScopeDef,
  Session,
  Role,
  RolePayload,
  SessionSettings,
  SystemSettings,
  User,
  UserPayload,
} from '../services/api';

// ── Types ──────────────────────────────────────────────────────────────────────

const tabs = ['Users', 'Groups', 'Roles', 'API Definitions', 'LDAP Settings', 'Azure AD', 'Session Settings', 'Sessions', 'Audit Logs', 'System Settings'] as const;
type Tab = (typeof tabs)[number];

// Which capability (GET /api/auth/me → capabilities.adminSections) opens each tab.
const TAB_SECTION: Record<Tab, string> = {
  Users: 'users',
  Groups: 'groups',
  Roles: 'roles',
  'API Definitions': 'apis',
  'LDAP Settings': 'ldap',
  'Azure AD': 'azureAd',
  'Session Settings': 'sessionSettings',
  Sessions: 'sessions',
  'Audit Logs': 'audit',
  'System Settings': 'system',
};

const FAMILY_STYLE: Record<ScopeDef['family'], string> = {
  read: 'border-gray-300 text-gray-700',
  write: 'border-amber-300 text-amber-900',
  destructive: 'border-red-300 text-red-800',
};
const PER_API_ACTIONS = ['view', 'invoke', 'manage', 'delete'] as const;

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

type GroupForm = { id?: number; name: string; description: string; roleIds: number[]; azureGroupId: string; ldapGroupDn: string };
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
  ownerGroupId: number | null;
  allowedRequestHeaders: string[];
  forwardAllXHeaders: boolean;
  // value '' keeps the stored value of an existing header
  injectHeaders: { name: string; value: string }[];
  rateLimitPerMinute: number;
  timeoutSeconds: number;
  access: ApiAccess[];
};

function emptyUserForm(): UserForm {
  return { username: '', displayName: '', email: '', password: '', authSource: 'local', mustChangePassword: true, isActive: true, isAdmin: false, groupIds: [] };
}
function emptyGroupForm(): GroupForm { return { name: '', description: '', roleIds: [], azureGroupId: '', ldapGroupDn: '' }; }
function emptyRoleForm(): RoleForm { return { name: '', description: '', scopes: [] }; }
function emptyApiForm(): ApiForm {
  return { name: '', slug: '', description: '', internalOpenapiUrl: '', internalBaseUrl: '', isActive: true, tryItEnabled: true, allowedMethods: [], allowedPathPrefixes: [], ownerTeam: '', tags: [], ownerGroupId: null, allowedRequestHeaders: [], forwardAllXHeaders: false, injectHeaders: [], rateLimitPerMinute: 0, timeoutSeconds: 0, access: [] };
}

function splitList(value: string) {
  return value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
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

export function AdminPage({ me }: { me: MeResponse }) {
  const caps = me.capabilities;
  const sections = useMemo(() => new Set(caps?.adminSections ?? (me.user.isAdmin ? Object.values(TAB_SECTION) : [])), [caps, me.user.isAdmin]);
  const visibleTabs = useMemo(() => tabs.filter((t) => sections.has(TAB_SECTION[t])), [sections]);
  const [activeTab, setActiveTab] = useState<Tab>(visibleTabs[0] ?? 'Users');
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
  const [session, setSession] = useState<SessionSettings>({ sessionMinutes: 60, maxHours: 12 });
  const [activeSessions, setActiveSessions] = useState<Session[]>([]);
  // A temporary password from "Reset password", shown once until another user is selected.
  const [issuedPassword, setIssuedPassword] = useState<{ username: string; password: string } | null>(null);
  const [ldapTestUser, setLdapTestUser] = useState('');
  const [ldapTestPassword, setLdapTestPassword] = useState('');
  const [ldapTestSteps, setLdapTestSteps] = useState<LdapLoginStep[] | null>(null);
  const [system, setSystem] = useState<SystemSettings>({ brandTitle: '', logoDataUrl: '' });
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditFilter, setAuditFilter] = useState<AuditFilter>({});
  const [scopeCatalog, setScopeCatalog] = useState<ScopeDef[]>([]);
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
      // Only fetch what this user may see: a delegated administrator gets 403 for the rest.
      const when = <T,>(section: string, load: () => Promise<T>, fallback: T) => (sections.has(section) ? load() : Promise.resolve(fallback));
      const [usersData, groupsData, rolesData, apisData, ldapData, azureAdData, sessionData, systemData, auditData, sessionsData, catalogData] = await Promise.all([
        when('users', api.users, [] as User[]),
        sections.size > 0 ? api.groups() : Promise.resolve([] as Group[]),
        sections.size > 0 ? api.roles() : Promise.resolve([] as Role[]),
        when('apis', api.adminApis, [] as ApiDefinition[]),
        when('ldap', api.ldap, null as LdapConfig | null),
        when('azureAd', api.azureAd, null as AzureADConfig | null),
        when('sessionSettings', api.session, null as SessionSettings | null),
        when('system', api.system, null as SystemSettings | null),
        when('audit', () => api.auditLogs(auditQuery(auditFilter, { limit: auditPageSize, offset: auditOffset })), null),
        when('sessions', api.sessions, { items: [] as Session[] }),
        when('roles', api.permissionCatalog, { items: [] as ScopeDef[] }),
      ]);
      setScopeCatalog(catalogData?.items ?? []);

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
      setSession(sessionData ?? { sessionMinutes: 60, maxHours: 12 });
      setActiveSessions(sessionsData?.items ?? []);
      setSystem(systemData ?? { brandTitle: '', logoDataUrl: '' });
      setAuditLogs(auditData?.items ?? []);
      setAuditTotal(auditData?.total ?? 0);

      const nextUserGroups: Record<number, number[]> = {};
      const nextGroupRoles: Record<number, number[]> = {};
      const nextRolePermissions: Record<number, Permission[]> = {};

      await Promise.all(nextUsers.map(async (u) => { nextUserGroups[u.id] = (await api.userGroups(u.id)) ?? []; }));
      if (sections.has('groups')) await Promise.all(nextGroups.map(async (g) => { nextGroupRoles[g.id] = (await api.groupRoles(g.id)) ?? []; }));
      if (sections.has('roles')) await Promise.all(nextRoles.map(async (r) => { nextRolePermissions[r.id] = (await api.permissions(r.id)) ?? []; }));

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

  async function run(task: () => Promise<void>, successMessage: string | (() => string)) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await task();
      setMessage(typeof successMessage === 'function' ? successMessage() : successMessage);
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
    setIssuedPassword(null);
    if (!user) { setUserForm(emptyUserForm()); return; }
    setUserForm({ id: user.id, username: user.username, displayName: user.displayName ?? '', email: user.email ?? '', password: '', authSource: user.authSource, mustChangePassword: user.mustChangePassword, isActive: user.isActive, isAdmin: user.isAdmin, groupIds: userGroupMap[user.id] ?? [] });
  }
  function selectGroup(group?: Group) {
    if (!group) { setGroupForm(emptyGroupForm()); return; }
    setGroupForm({ id: group.id, name: group.name, description: group.description ?? '', roleIds: groupRoleMap[group.id] ?? [], azureGroupId: group.azureGroupId ?? '', ldapGroupDn: group.ldapGroupDn ?? '' });
  }
  function selectRole(role?: Role) {
    if (!role) { setRoleForm(emptyRoleForm()); return; }
    setRoleForm({ id: role.id, name: role.name, description: role.description ?? '', scopes: (rolePermissionMap[role.id] ?? []).map((p) => p.scope) });
  }
  function selectApi(apiItem?: ApiDefinition) {
    if (!apiItem) { setApiForm(emptyApiForm()); return; }
    const form: ApiForm = {
      id: apiItem.id, name: apiItem.name, slug: apiItem.slug, description: apiItem.description ?? '', internalOpenapiUrl: apiItem.internalOpenapiUrl ?? '', internalBaseUrl: apiItem.internalBaseUrl ?? '',
      isActive: apiItem.isActive, tryItEnabled: apiItem.tryItEnabled, allowedMethods: apiItem.allowedMethods ?? [], allowedPathPrefixes: apiItem.allowedPathPrefixes ?? [], ownerTeam: apiItem.ownerTeam ?? '', tags: apiItem.tags ?? [],
      ownerGroupId: apiItem.ownerGroupId ?? null, allowedRequestHeaders: apiItem.allowedRequestHeaders ?? [], forwardAllXHeaders: apiItem.forwardAllXHeaders ?? false,
      injectHeaders: (apiItem.injectHeaderNames ?? []).map((name) => ({ name, value: '' })), rateLimitPerMinute: apiItem.rateLimitPerMinute ?? 0, timeoutSeconds: apiItem.timeoutSeconds ?? 0, access: [],
    };
    setApiForm(form);
    api.apiAccess(apiItem.id).then((r) => setApiForm((prev) => (prev.id === apiItem.id ? { ...prev, access: r.items ?? [] } : prev))).catch(() => undefined);
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
    const payload: UserPayload = { username: userForm.username.trim(), displayName: userForm.displayName.trim(), email: userForm.email.trim(), password: userForm.password || undefined, authSource: userForm.authSource, mustChangePassword: userForm.mustChangePassword, isActive: userForm.isActive, isAdmin: userForm.isAdmin };
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
    const payload: GroupPayload = { name: groupForm.name.trim(), description: groupForm.description.trim(), azureGroupId: groupForm.azureGroupId.trim(), ldapGroupDn: groupForm.ldapGroupDn.trim() };
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
    const payload: ApiDefinitionPayload = {
      name: apiForm.name.trim(), slug: apiForm.slug.trim(), description: apiForm.description.trim(), internalOpenapiUrl: apiForm.internalOpenapiUrl.trim(), internalBaseUrl: apiForm.internalBaseUrl.trim(),
      isActive: apiForm.isActive, tryItEnabled: apiForm.tryItEnabled, allowedMethods: apiForm.allowedMethods.map((m) => m.toUpperCase()), allowedPathPrefixes: apiForm.allowedPathPrefixes, ownerTeam: apiForm.ownerTeam.trim(), tags: apiForm.tags,
      ownerGroupId: apiForm.ownerGroupId, allowedRequestHeaders: apiForm.allowedRequestHeaders, forwardAllXHeaders: apiForm.forwardAllXHeaders,
      injectHeaders: apiForm.injectHeaders.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), value: h.value })),
      rateLimitPerMinute: Number.isFinite(apiForm.rateLimitPerMinute) ? apiForm.rateLimitPerMinute : 0, timeoutSeconds: Number.isFinite(apiForm.timeoutSeconds) ? apiForm.timeoutSeconds : 0,
    };
    await run(async () => {
      if (apiForm.id) {
        await api.updateApi(apiForm.id, payload);
        await api.setApiAccess(apiForm.id, apiForm.access);
        // Stay on the API; drop typed header values so they don't linger on screen.
        setApiForm((prev) => ({ ...prev, injectHeaders: prev.injectHeaders.filter((h) => h.name.trim()).map((h) => ({ name: h.name.trim(), value: '' })) }));
      } else {
        const created = (await api.createApi(payload)) as { id: number };
        if (apiForm.access.length) await api.setApiAccess(created.id, apiForm.access);
        setApiForm(emptyApiForm());
      }
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
    let summary = 'LDAP users imported.';
    await run(async () => {
      const result = await api.importLdap(payload);
      setSelectedLdapUsers([]);
      summary = `Imported ${result.imported} LDAP user${result.imported === 1 ? '' : 's'}.` +
        (result.skipped?.length ? ` Skipped (already a local or Azure AD account): ${result.skipped.join(', ')}.` : '');
    }, () => summary);
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
          {visibleTabs.map((tab) => (
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
                  {userForm.id && userForm.authSource === 'local' && (
                    <Button size="sm" disabled={busy} onClick={() => {
                      const target = userForm.username;
                      if (!window.confirm(`Reset the password of ${target}? They will be signed out and must set a new password.`)) return;
                      void run(async () => {
                        const result = await api.resetPassword(userForm.id!);
                        setIssuedPassword({ username: target, password: result.temporaryPassword });
                      }, `Password of ${target} reset.`);
                    }}>
                      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Reset password
                    </Button>
                  )}
                  {userForm.id && (
                    <Button size="sm" disabled={busy} onClick={() => run(async () => { await api.revokeUserSessions(userForm.id!); }, `Sessions of ${userForm.username} ended.`)}>
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out sessions
                    </Button>
                  )}
                  {userForm.id && (
                    <Button variant="danger" size="sm" onClick={() => {
                      if (!window.confirm(`Delete user ${userForm.username}? This can't be undone.`)) return;
                      void run(async () => { await api.deleteUser(userForm.id!); setUserForm(emptyUserForm()); }, 'User deleted.');
                    }}>
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
                {issuedPassword && (
                  <Alert variant="warning">
                    <div>
                      Temporary password for <strong>{issuedPassword.username}</strong>:{' '}
                      <code className="select-all rounded bg-white px-1.5 py-0.5 font-mono">{issuedPassword.password}</code>
                      <p className="mt-1 text-xs">Shown only now. Hand it over securely; it must be changed at the next sign-in.</p>
                    </div>
                  </Alert>
                )}
                {userForm.id && userForm.authSource !== 'local' && (
                  <Alert variant="info">Username, display name and e-mail come from {userForm.authSource === 'ldap' ? 'LDAP' : 'Azure AD'} and can't be edited here.</Alert>
                )}
                <Input label="Username" value={userForm.username} onChange={(v) => setUserForm({ ...userForm, username: v })} required disabled={!!userForm.id && userForm.authSource !== 'local'} />
                <Input label="Display Name" value={userForm.displayName} onChange={(v) => setUserForm({ ...userForm, displayName: v })} disabled={!!userForm.id && userForm.authSource !== 'local'} />
                <Input label="Email" value={userForm.email} onChange={(v) => setUserForm({ ...userForm, email: v })} disabled={!!userForm.id && userForm.authSource !== 'local'} />
                {userForm.authSource === 'local' && (
                  <Input label={userForm.id ? 'New Password (optional)' : 'Password'} type="password" autoComplete="new-password" value={userForm.password} onChange={(v) => setUserForm({ ...userForm, password: v })} required={!userForm.id} />
                )}
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
                <div className="space-y-3 rounded-lg border border-gray-200 p-3">
                  <p className="text-sm font-semibold text-gray-700">Directory mapping (optional)</p>
                  <p className="text-xs text-gray-500">Members of the mapped directory group join this group at sign-in, and leave it when they're no longer members. Mapping a group whose roles you don't hold yourself is refused.</p>
                  <Input label="Azure AD group object ID" value={groupForm.azureGroupId} onChange={(v) => setGroupForm({ ...groupForm, azureGroupId: v })} placeholder="00000000-0000-0000-0000-000000000000" />
                  <Input label="LDAP group DN" value={groupForm.ldapGroupDn} onChange={(v) => setGroupForm({ ...groupForm, ldapGroupDn: v })} placeholder="CN=API Owners,OU=Groups,DC=corp,DC=example" helperText="Matched against the user's memberOf." />
                </div>
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

                {Array.from(new Set(scopeCatalog.filter((d) => !d.perApi).map((d) => d.group))).map((group) => (
                  <fieldset key={group}>
                    <legend className="mb-2 text-sm font-semibold text-gray-700">{group}</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {scopeCatalog.filter((d) => !d.perApi && d.group === group).map((def) => (
                        <label key={def.scope} className={cn('flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm', FAMILY_STYLE[def.family], currentRoleScopes.has(def.scope) && 'bg-blue-50')}>
                          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={currentRoleScopes.has(def.scope)} onChange={(e) => toggleScope(def.scope, e.target.checked)} />
                          <span>
                            <span className="font-mono text-xs font-semibold">{def.scope}</span>
                            <span className="ml-1.5 text-[11px] uppercase tracking-wide opacity-80">{def.family}</span>
                            <span className="block text-xs text-gray-600">{def.description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
                {currentRoleScopes.has('ldap.manage') && (
                  <Alert variant="info">This role has <code>ldap.manage</code>, the old name of <code>idp.manage</code>; saving converts it.</Alert>
                )}

                <div>
                  <p className="mb-2 text-sm font-semibold text-gray-700">Per-API permissions</p>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">API</th>
                          {PER_API_ACTIONS.map((action) => {
                            const def = scopeCatalog.find((d) => d.perApi && d.action === action);
                            return (
                              <th key={action} scope="col" className="px-3 py-2 text-center text-xs font-medium uppercase text-gray-500" title={def?.description}>
                                {action}{def?.family === 'destructive' ? ' ⚠' : ''}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {apis.map((apiItem) => (
                          <tr key={apiItem.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <p className="font-medium text-gray-800">{apiItem.name}</p>
                              <p className="text-xs text-gray-400">{apiItem.slug}</p>
                            </td>
                            {PER_API_ACTIONS.map((action) => {
                              const scope = `api:${apiItem.id}:${action}`;
                              return (
                                <td key={scope} className="px-3 py-2 text-center">
                                  <input
                                    type="checkbox"
                                    aria-label={`${apiItem.name}: ${action}`}
                                    checked={currentRoleScopes.has(scope)}
                                    onChange={(e) => toggleScope(scope, e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        {apis.length === 0 && (
                          <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-gray-500">No APIs you can see. API owners can also grant access per API from API Definitions → Access.</td></tr>
                        )}
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
              action={caps?.canCreateApi || me.user.isAdmin ? <Button size="sm" onClick={() => selectApi()}>New API</Button> : undefined}
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
          right={!apiForm.id && !(caps?.canCreateApi || me.user.isAdmin) ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              Select one of your APIs on the left to edit it, refresh its spec or manage who may use it.
            </div>
          ) : (
            <FormCard
              title={apiForm.id ? `Edit API #${apiForm.id}` : 'Create API'}
              actions={
                <>
                  {apiForm.id && (
                    <>
                      <Button size="sm" onClick={() => run(async () => { await api.refreshApiSpec(apiForm.id!); }, 'API spec refreshed.')}>
                        <RefreshCw className="h-3.5 w-3.5" /> Refresh Spec
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => {
                        if (!window.confirm(`Delete ${apiForm.name}? Its permissions and access grants are removed too.`)) return;
                        void run(async () => { await api.deleteApi(apiForm.id!); setApiForm(emptyApiForm()); }, 'API deleted.');
                      }}>
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

                <NativeSelect
                  label="Owner group"
                  value={apiForm.ownerGroupId ? String(apiForm.ownerGroupId) : ''}
                  onChange={(v) => setApiForm({ ...apiForm, ownerGroupId: v ? Number(v) : null })}
                  options={[{ label: 'No owner group', value: '' }, ...groups.map((g) => ({ label: g.name, value: String(g.id) }))]}
                  disabled={!caps?.managesAllApis && !me.user.isAdmin}
                  helperText="Members of the owner group manage this API (edit, refresh, access). Set by API administrators."
                />

                <fieldset className="space-y-3 rounded-lg border border-gray-200 p-3">
                  <legend className="px-1 text-sm font-semibold text-gray-700">Try-it requests</legend>
                  <ChipInput
                    label="Headers users may send"
                    helperText="Besides Content-Type, Accept, Accept-Language and User-Agent. Routing headers (X-Forwarded-*, X-HTTP-Method-Override, …) are never forwarded."
                    options={['Authorization', 'X-Api-Key', 'X-Tenant-Id', 'X-Correlation-Id']}
                    value={apiForm.allowedRequestHeaders}
                    onChange={(v) => setApiForm({ ...apiForm, allowedRequestHeaders: v })}
                  />
                  <Checkbox label="Also forward any other X-* header (behaviour before 1.5.0)" checked={apiForm.forwardAllXHeaders} onChange={(v) => setApiForm({ ...apiForm, forwardAllXHeaders: v })} />
                  <div>
                    <p className="mb-1 text-sm font-medium text-gray-700">Headers the portal adds</p>
                    <p className="mb-2 text-xs text-gray-500">E.g. a service API key. Values are stored encrypted, never shown again, and override what users send. Leave a value empty to keep the stored one.</p>
                    {apiForm.injectHeaders.map((header, index) => (
                      <div key={index} className="mb-2 flex gap-2">
                        <input aria-label="Header name" className={cn(fieldBase, 'font-mono')} value={header.name} placeholder="X-Api-Key"
                          onChange={(e) => setApiForm({ ...apiForm, injectHeaders: apiForm.injectHeaders.map((h, i) => (i === index ? { ...h, name: e.target.value } : h)) })} />
                        <input aria-label="Header value" type="password" autoComplete="off" className={fieldBase} value={header.value} placeholder={apiForm.id ? '(unchanged)' : 'value'}
                          onChange={(e) => setApiForm({ ...apiForm, injectHeaders: apiForm.injectHeaders.map((h, i) => (i === index ? { ...h, value: e.target.value } : h)) })} />
                        <Button size="sm" variant="ghost" onClick={() => setApiForm({ ...apiForm, injectHeaders: apiForm.injectHeaders.filter((_, i) => i !== index) })}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Remove header</span>
                        </Button>
                      </div>
                    ))}
                    <Button size="sm" onClick={() => setApiForm({ ...apiForm, injectHeaders: [...apiForm.injectHeaders, { name: '', value: '' }] })}>Add header</Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FieldWrap label="Rate limit (calls per minute per user)" helperText="0 = default (120).">
                      <input type="number" min={0} max={10000} className={fieldBase} value={Number.isFinite(apiForm.rateLimitPerMinute) ? apiForm.rateLimitPerMinute : ''}
                        onChange={(e) => setApiForm({ ...apiForm, rateLimitPerMinute: e.target.valueAsNumber })} />
                    </FieldWrap>
                    <FieldWrap label="Timeout (seconds)" helperText="0 = portal default.">
                      <input type="number" min={0} max={300} className={fieldBase} value={Number.isFinite(apiForm.timeoutSeconds) ? apiForm.timeoutSeconds : ''}
                        onChange={(e) => setApiForm({ ...apiForm, timeoutSeconds: e.target.valueAsNumber })} />
                    </FieldWrap>
                  </div>
                </fieldset>

                <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3">
                  <legend className="px-1 text-sm font-semibold text-gray-700">Access</legend>
                  <p className="text-xs text-gray-500">Groups that may see (view) or call (invoke) this API, in addition to roles.</p>
                  {apiForm.access.map((entry, index) => (
                    <div key={entry.groupId} className="flex items-center gap-2">
                      <span className="flex-1 text-sm">{groups.find((g) => g.id === entry.groupId)?.name ?? entry.groupName ?? `group ${entry.groupId}`}</span>
                      <select aria-label="Access level" className={cn(fieldBase, 'w-32')} value={entry.level}
                        onChange={(e) => setApiForm({ ...apiForm, access: apiForm.access.map((a, i) => (i === index ? { ...a, level: e.target.value as ApiAccess['level'] } : a)) })}>
                        <option value="view">view</option>
                        <option value="invoke">invoke</option>
                      </select>
                      <Button size="sm" variant="ghost" onClick={() => setApiForm({ ...apiForm, access: apiForm.access.filter((_, i) => i !== index) })}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Remove access</span>
                      </Button>
                    </div>
                  ))}
                  <select aria-label="Grant access to a group" className={fieldBase} value=""
                    onChange={(e) => { const id = Number(e.target.value); if (id) setApiForm({ ...apiForm, access: [...apiForm.access, { groupId: id, level: 'view' }] }); }}>
                    <option value="">Add a group…</option>
                    {groups.filter((g) => !apiForm.access.some((a) => a.groupId === g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </fieldset>
              </div>
            </FormCard>
          )}
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
                <Input label="User Filter" value={ldap.userFilter} onChange={(v) => setLdap({ ...ldap, userFilter: v })} helperText="The username is always part of the login search: a filter with %s gets it substituted, any other filter is combined with (usernameAttribute=username). Examples: (objectClass=user) or (&(objectClass=user)(mail=%s))" />
                <div className="flex flex-wrap gap-4">
                  <Checkbox label="Use SSL" checked={ldap.useSsl} onChange={(v) => setLdap({ ...ldap, useSsl: v })} />
                  <Checkbox label="StartTLS" checked={ldap.startTls} onChange={(v) => setLdap({ ...ldap, startTls: v })} />
                  <Checkbox label="Skip TLS Verify" checked={ldap.sslSkipVerify} onChange={(v) => setLdap({ ...ldap, sslSkipVerify: v })} />
                </div>
                {ldap.sslSkipVerify && (ldap.useSsl || ldap.startTls) && (
                  <Alert variant="warning">
                    TLS certificate verification is off: anyone on the network path can impersonate the directory and read bind and user passwords. Use only for testing.
                  </Alert>
                )}
              </div>
            )}
          </FormCard>

          <FormCard
            title="Test a sign-in"
            actions={
              <Button disabled={busy || !ldapTestUser} onClick={() => run(async () => {
                const result = await api.testLdapLogin(ldapTestUser, ldapTestPassword);
                setLdapTestSteps(result.steps);
                setLdapTestPassword('');
              }, 'LDAP test sign-in finished.')}>
                Test sign-in
              </Button>
            }
          >
            <p className="mb-3 text-sm text-gray-500">Runs the LDAP login steps with the saved settings and shows where a sign-in fails. Nothing is changed.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Username" autoComplete="off" value={ldapTestUser} onChange={setLdapTestUser} />
              <Input label="Password" type="password" autoComplete="off" value={ldapTestPassword} onChange={setLdapTestPassword} helperText="Leave empty to test only the search." />
            </div>
            {ldapTestSteps && (
              <ol className="mt-4 space-y-2 text-sm">
                {ldapTestSteps.map((step) => (
                  <li key={step.name} className="flex items-start gap-2">
                    {step.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />}
                    <span><strong>{step.name}</strong>{step.ok ? '' : ' (failed)'}: <span className="break-words font-mono text-xs">{step.detail}</span></span>
                  </li>
                ))}
              </ol>
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
              <Textarea
                label="Allowed groups (optional)"
                value={(azureAd.allowedGroups ?? []).join('\n')}
                onChange={(v) => setAzureAd({ ...azureAd, allowedGroups: v.split(/[\n,]/).map((g) => g.trim()).filter(Boolean) })}
                helperText="Azure AD group object IDs, one per line. When set, only members may sign in. Requires the groups claim in the app registration's token configuration."
                rows={3}
              />
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
          <div className="grid max-w-xl gap-4 sm:grid-cols-2">
            <FieldWrap label="Idle timeout (minutes)" helperText="A session ends after this long without activity. 5 minutes to 24 hours.">
              <input
                type="number"
                min={5}
                max={1440}
                value={Number.isFinite(session.sessionMinutes) ? session.sessionMinutes : ''}
                onChange={(e) => setSession({ ...session, sessionMinutes: e.target.valueAsNumber })}
                className={fieldBase}
              />
            </FieldWrap>
            <FieldWrap label="Maximum session age (hours)" helperText="A session ends this long after sign-in, even when active. 1 hour to 30 days.">
              <input
                type="number"
                min={1}
                max={720}
                value={Number.isFinite(session.maxHours) ? session.maxHours : ''}
                onChange={(e) => setSession({ ...session, maxHours: e.target.valueAsNumber })}
                className={fieldBase}
              />
            </FieldWrap>
          </div>
        </FormCard>
      )}

      {/* ── Sessions ── */}
      {activeTab === 'Sessions' && (
        <FormCard
          title="Active sessions"
          actions={<Button size="sm" onClick={() => void loadAll()} disabled={loading}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh</Button>}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-xs uppercase text-gray-500">
                <tr>
                  <th scope="col" className="py-2 pr-4">User</th>
                  <th scope="col" className="py-2 pr-4">Source</th>
                  <th scope="col" className="py-2 pr-4">Address</th>
                  <th scope="col" className="py-2 pr-4">Last active</th>
                  <th scope="col" className="py-2 pr-4">Signed in</th>
                  <th scope="col" className="py-2 pr-4">Expires</th>
                  <th scope="col" className="py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeSessions.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 pr-4 font-mono" title={s.userAgent}>{s.username}{s.current && <Badge variant="green" className="ml-2">you</Badge>}</td>
                    <td className="py-2 pr-4">{s.authSource}</td>
                    <td className="py-2 pr-4 font-mono">{s.ip}</td>
                    <td className="py-2 pr-4">{new Date(s.lastUsedAt).toLocaleString()}</td>
                    <td className="py-2 pr-4">{new Date(s.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-4">{new Date(s.expiresAt).toLocaleString()}</td>
                    <td className="py-2 text-right">
                      {!s.current && (
                        <Button size="sm" variant="ghost" onClick={() => run(async () => { await api.revokeSession(s.id); }, `Session of ${s.username} ended.`)}>
                          End session
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {activeSessions.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-gray-500">No active sessions.</td></tr>
                )}
              </tbody>
            </table>
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
                disabled={!caps?.canExportAudit && !me.user.isAdmin}
                onClick={async () => {
                  const { csv, truncated, rows } = await api.exportAuditLogs(auditFilter);
                  if (truncated) setMessage(`Export contains the newest ${rows} matching entries only (AUDIT_EXPORT_MAX_ROWS). Narrow the filters for the rest.`);
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
              <Input label="User" value={auditFilter.user ?? ''} onChange={(v) => setAuditFilter({ ...auditFilter, user: v })} />
              <Input label="Action starts with" value={auditFilter.action ?? ''} onChange={(v) => setAuditFilter({ ...auditFilter, action: v })} placeholder="user. · api.invoke · auth.login" />
              <NativeSelect
                label="Outcome"
                value={auditFilter.outcome ?? ''}
                onChange={(v) => setAuditFilter({ ...auditFilter, outcome: v })}
                options={[{ label: 'Any', value: '' }, { label: 'Success', value: 'success' }, { label: 'Denied', value: 'denied' }, { label: 'Failed', value: 'failed' }]}
              />
              <FieldWrap label="From">
                <input type="date" className={fieldBase} value={auditFilter.from ?? ''} onChange={(e) => setAuditFilter({ ...auditFilter, from: e.target.value })} />
              </FieldWrap>
              <FieldWrap label="To (exclusive)">
                <input type="date" className={fieldBase} value={auditFilter.to ?? ''} onChange={(e) => setAuditFilter({ ...auditFilter, to: e.target.value })} />
              </FieldWrap>
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
                    {['Timestamp', 'User', 'Action', 'Outcome', 'Target', 'Changed', 'Status', 'Reason'].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditLogs.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">{new Date(entry.timestamp).toLocaleString()}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{entry.user}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-700">{entry.action}</td>
                      <td className="px-3 py-2">
                        {entry.outcome ? <Badge variant={entry.outcome === 'success' ? 'green' : entry.outcome === 'denied' ? 'amber' : 'red'}>{entry.outcome}</Badge> : <span className="text-xs text-gray-400">–</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{[entry.resourceType, entry.resourceName || entry.resourceId].filter(Boolean).join(' / ')}</td>
                      <td className="max-w-[12rem] px-3 py-2 text-xs text-gray-500 [overflow-wrap:anywhere]">{entry.changes || '–'}</td>
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
                      <td colSpan={8} className="px-3 py-8 text-center text-sm text-gray-400">No audit records found.</td>
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
                <input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
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
