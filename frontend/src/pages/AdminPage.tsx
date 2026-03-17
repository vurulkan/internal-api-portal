import type { ReactNode, SyntheticEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import { createFilterOptions } from '@mui/material/Autocomplete';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
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
  UserPayload
} from '../services/api';

const tabs = ['Users', 'Groups', 'Roles', 'API Definitions', 'LDAP Settings', 'Azure AD', 'Session Settings', 'Audit Logs', 'System Settings'] as const;
type Tab = (typeof tabs)[number];

const globalPermissionOptions = [
  'api.view',
  'api.invoke'
];

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

type GroupForm = {
  id?: number;
  name: string;
  description: string;
  roleIds: number[];
};

type RoleForm = {
  id?: number;
  name: string;
  description: string;
  scopes: string[];
};

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

type CreatableOption = {
  label: string;
  value: string;
  isCreate?: boolean;
};

function emptyUserForm(): UserForm {
  return {
    username: '',
    displayName: '',
    email: '',
    password: '',
    authSource: 'local',
    mustChangePassword: true,
    isActive: true,
    isAdmin: false,
    groupIds: []
  };
}

function emptyGroupForm(): GroupForm {
  return { name: '', description: '', roleIds: [] };
}

function emptyRoleForm(): RoleForm {
  return { name: '', description: '', scopes: [] };
}

function emptyApiForm(): ApiForm {
  return {
    name: '',
    slug: '',
    description: '',
    internalOpenapiUrl: '',
    internalBaseUrl: '',
    isActive: true,
    tryItEnabled: true,
    allowedMethods: [],
    allowedPathPrefixes: [],
    ownerTeam: '',
    tags: []
  };
}

function splitList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function TabPanel({ active, name, children }: { active: Tab; name: Tab; children: ReactNode }) {
  if (active !== name) {
    return null;
  }
  return <Box sx={{ mt: 3 }}>{children}</Box>;
}

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
        api.users(),
        api.groups(),
        api.roles(),
        api.adminApis(),
        api.ldap(),
        api.azureAd(),
        api.session(),
        api.system(),
        api.auditLogs(buildAuditQuery(auditUser, auditAction, auditPageSize, auditOffset))
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

      await Promise.all(
        nextUsers.map(async (user) => {
          nextUserGroups[user.id] = (await api.userGroups(user.id)) ?? [];
        })
      );
      await Promise.all(
        nextGroups.map(async (group) => {
          nextGroupRoles[group.id] = (await api.groupRoles(group.id)) ?? [];
        })
      );
      await Promise.all(
        nextRoles.map(async (role) => {
          nextRolePermissions[role.id] = (await api.permissions(role.id)) ?? [];
        })
      );

      setUserGroupMap(nextUserGroups);
      setGroupRoleMap(nextGroupRoles);
      setRolePermissionMap(nextRolePermissions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Admin data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, [auditPageSize, auditOffset]);

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

  const groupOptions = useMemo(
    () => groups.map((group) => ({ label: group.name, value: group.id })),
    [groups]
  );
  const roleOptions = useMemo(
    () => roles.map((role) => ({ label: role.name, value: role.id })),
    [roles]
  );

  const currentRoleScopes = useMemo(() => new Set(roleForm.scopes), [roleForm.scopes]);
  const tagSuggestions = useMemo(() => Array.from(new Set(apis.flatMap((item) => item.tags ?? []))).sort((a, b) => a.localeCompare(b)), [apis]);
  const pathPrefixSuggestions = useMemo(
    () => Array.from(new Set(apis.flatMap((item) => item.allowedPathPrefixes ?? []))).sort((a, b) => a.localeCompare(b)),
    [apis]
  );

  function selectUser(user?: User) {
    if (!user) {
      setUserForm(emptyUserForm());
      return;
    }
    setUserForm({
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? '',
      email: user.email ?? '',
      password: '',
      authSource: user.authSource,
      mustChangePassword: user.mustChangePassword,
      isActive: user.isActive,
      isAdmin: user.isAdmin,
      groupIds: userGroupMap[user.id] ?? []
    });
  }

  function selectGroup(group?: Group) {
    if (!group) {
      setGroupForm(emptyGroupForm());
      return;
    }
    setGroupForm({
      id: group.id,
      name: group.name,
      description: group.description ?? '',
      roleIds: groupRoleMap[group.id] ?? []
    });
  }

  function selectRole(role?: Role) {
    if (!role) {
      setRoleForm(emptyRoleForm());
      return;
    }
    setRoleForm({
      id: role.id,
      name: role.name,
      description: role.description ?? '',
      scopes: (rolePermissionMap[role.id] ?? []).map((permission) => permission.scope)
    });
  }

  function selectApi(apiItem?: ApiDefinition) {
    if (!apiItem) {
      setApiForm(emptyApiForm());
      return;
    }
    setApiForm({
      id: apiItem.id,
      name: apiItem.name,
      slug: apiItem.slug,
      description: apiItem.description ?? '',
      internalOpenapiUrl: apiItem.internalOpenapiUrl ?? '',
      internalBaseUrl: apiItem.internalBaseUrl ?? '',
      isActive: apiItem.isActive,
      tryItEnabled: apiItem.tryItEnabled,
      allowedMethods: apiItem.allowedMethods ?? [],
      allowedPathPrefixes: apiItem.allowedPathPrefixes ?? [],
      ownerTeam: apiItem.ownerTeam ?? '',
      tags: apiItem.tags ?? []
    });
  }

  function toggleScope(scope: string, enabled: boolean) {
    setRoleForm((current) => {
      const next = new Set(current.scopes);
      if (enabled) {
        next.add(scope);
      } else {
        next.delete(scope);
      }
      return { ...current, scopes: Array.from(next).sort() };
    });
  }

  async function submitUser() {
    if (!userForm.username.trim()) {
      setError('Username zorunlu.');
      return;
    }
    if (!userForm.id && !userForm.password.trim()) {
      setError('Yeni local user için parola zorunlu.');
      return;
    }

    const payload: UserPayload = {
      username: userForm.username.trim(),
      displayName: userForm.displayName.trim(),
      email: userForm.email.trim(),
      password: userForm.password.trim() || undefined,
      authSource: userForm.authSource,
      mustChangePassword: userForm.mustChangePassword,
      isActive: userForm.isActive,
      isAdmin: userForm.isAdmin
    };

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
    if (!groupForm.name.trim()) {
      setError('Group name zorunlu.');
      return;
    }
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
    if (!roleForm.name.trim()) {
      setError('Role name zorunlu.');
      return;
    }
    const payload: RolePayload = { name: roleForm.name.trim(), description: roleForm.description.trim() };
    await run(async () => {
      let roleId = roleForm.id;
      if (roleId) {
        await api.updateRole(roleId, payload);
      } else {
        const created = (await api.createRole(payload)) as { id: number };
        roleId = created.id;
      }
      await api.replacePermissions(roleId!, roleForm.scopes);
      setRoleForm(emptyRoleForm());
    }, roleForm.id ? 'Role updated.' : 'Role created.');
  }

  async function submitApi() {
    if (!apiForm.name.trim() || !apiForm.slug.trim()) {
      setError('API name ve slug zorunlu.');
      return;
    }
    if (!apiForm.internalOpenapiUrl.trim() || !apiForm.internalBaseUrl.trim()) {
      setError('Internal OpenAPI URL ve Internal Base URL zorunlu.');
      return;
    }
    const payload: ApiDefinitionPayload = {
      name: apiForm.name.trim(),
      slug: apiForm.slug.trim(),
      description: apiForm.description.trim(),
      internalOpenapiUrl: apiForm.internalOpenapiUrl.trim(),
      internalBaseUrl: apiForm.internalBaseUrl.trim(),
      isActive: apiForm.isActive,
      tryItEnabled: apiForm.tryItEnabled,
      allowedMethods: apiForm.allowedMethods.map((item) => item.toUpperCase()),
      allowedPathPrefixes: apiForm.allowedPathPrefixes,
      ownerTeam: apiForm.ownerTeam.trim(),
      tags: apiForm.tags
    };

    await run(async () => {
      if (apiForm.id) {
        await api.updateApi(apiForm.id, payload);
      } else {
        await api.createApi(payload);
      }
      setApiForm(emptyApiForm());
    }, apiForm.id ? 'API updated.' : 'API created.');
  }

  async function saveLdap() {
    if (!ldap) {
      return;
    }
    await run(async () => {
      await api.updateLdap({ ...ldap, userBaseDns: ldap.userBaseDns ?? [] });
    }, 'LDAP settings updated.');
  }

  async function searchLdap() {
    setBusy(true);
    setError('');
    try {
      const results = (await api.searchLdap(ldapQuery.trim())) ?? [];
      setLdapResults(results);
      setSelectedLdapUsers([]);
      if (results.length === 0) {
        setMessage('LDAP search returned no users. userFilter and attributes may need adjustment.');
      }
    } catch (ldapError) {
      setError(ldapError instanceof Error ? ldapError.message : 'LDAP search failed.');
      setLdapResults([]);
    } finally {
      setBusy(false);
    }
  }

  async function importSelectedLdapUsers() {
    const payload = ldapResults.filter((item) => selectedLdapUsers.includes(item.username));
    if (payload.length === 0) {
      setError('Import için en az bir LDAP user seç.');
      return;
    }
    await run(async () => {
      await api.importLdap(payload);
      setSelectedLdapUsers([]);
    }, 'LDAP users imported.');
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" fontWeight={700}>
        Admin Console
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        User, group, role, LDAP and API registry management is handled here. Browser-visible state stays limited to portal metadata.
      </Typography>

      <Stack spacing={2} sx={{ mt: 3 }}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        {message ? <Alert severity="success">{message}</Alert> : null}
      </Stack>

      <Card sx={{ mt: 3 }}>
        <CardContent sx={{ p: 0 }}>
          <Tabs
            value={activeTab}
            onChange={(_: SyntheticEvent, value: Tab) => {
              setActiveTab(value);
              setMessage('');
              setError('');
            }}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ px: 2, pt: 2 }}
          >
            {tabs.map((tab) => (
              <Tab key={tab} label={tab} value={tab} />
            ))}
          </Tabs>
          <Divider />
          <Box sx={{ p: 3 }}>
            <TabPanel active={activeTab} name="Users">
              <SplitLayout
                left={
                  <EntityList
                    title="Users"
                    subtitle="Select a user to edit, or start a new local account."
                    action={<Button onClick={() => selectUser()} variant="outlined">New User</Button>}
                  >
                    {users.map((user) => (
                      <ListItemButton key={user.id} selected={userForm.id === user.id} onClick={() => selectUser(user)}>
                        <ListItemText
                          primary={user.username}
                          secondary={[user.authSource, user.isActive ? 'active' : 'disabled', user.isAdmin ? 'admin' : 'user'].join(' • ')}
                        />
                      </ListItemButton>
                    ))}
                  </EntityList>
                }
                right={
                  <FormCard
                    title={userForm.id ? `Edit User #${userForm.id}` : 'Create User'}
                    actions={
                      <Stack direction="row" spacing={1}>
                        {userForm.id ? (
                          <Button
                            color="error"
                            startIcon={<DeleteOutlineIcon />}
                            onClick={() =>
                              run(async () => {
                                await api.deleteUser(userForm.id!);
                                setUserForm(emptyUserForm());
                              }, 'User deleted.')
                            }
                          >
                            Delete
                          </Button>
                        ) : null}
                        <Button startIcon={<SaveOutlinedIcon />} variant="contained" onClick={() => void submitUser()} disabled={busy}>
                          Save
                        </Button>
                      </Stack>
                    }
                  >
                    <Stack spacing={2}>
                      <TextField label="Username" value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} required />
                      <TextField label="Display Name" value={userForm.displayName} onChange={(event) => setUserForm({ ...userForm, displayName: event.target.value })} />
                      <TextField label="Email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} />
                      <TextField
                        label={userForm.id ? 'New Password (optional)' : 'Password'}
                        type="password"
                        value={userForm.password}
                        onChange={(event) => setUserForm({ ...userForm, password: event.target.value })}
                        required={!userForm.id}
                      />
                      <TextField label="Auth Source" value={userForm.authSource} disabled />
                      <Autocomplete
                        multiple
                        options={groupOptions}
                        value={groupOptions.filter((option) => userForm.groupIds.includes(option.value))}
                        onChange={(_, value) => setUserForm({ ...userForm, groupIds: value.map((item) => item.value) })}
                        renderInput={(params) => <TextField {...params} label="Groups" />}
                      />
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        <FormControlLabel
                          control={<Checkbox checked={userForm.isActive} onChange={(event) => setUserForm({ ...userForm, isActive: event.target.checked })} />}
                          label="Active"
                        />
                        <FormControlLabel
                          control={<Checkbox checked={userForm.isAdmin} onChange={(event) => setUserForm({ ...userForm, isAdmin: event.target.checked })} />}
                          label="Admin"
                        />
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={userForm.mustChangePassword}
                              onChange={(event) => setUserForm({ ...userForm, mustChangePassword: event.target.checked })}
                            />
                          }
                          label="Force Password Change"
                        />
                      </Stack>
                    </Stack>
                  </FormCard>
                }
              />
            </TabPanel>

            <TabPanel active={activeTab} name="Groups">
              <SplitLayout
                left={
                  <EntityList title="Groups" subtitle="Groups aggregate users and receive roles.">
                    {groups.map((group) => (
                      <ListItemButton key={group.id} selected={groupForm.id === group.id} onClick={() => selectGroup(group)}>
                        <ListItemText primary={group.name} secondary={group.description || 'No description'} />
                      </ListItemButton>
                    ))}
                  </EntityList>
                }
                right={
                  <FormCard
                    title={groupForm.id ? `Edit Group #${groupForm.id}` : 'Create Group'}
                    actions={
                      <Stack direction="row" spacing={1}>
                        <Button onClick={() => selectGroup()} variant="outlined">New Group</Button>
                        {groupForm.id ? (
                          <Button
                            color="error"
                            startIcon={<DeleteOutlineIcon />}
                            onClick={() =>
                              run(async () => {
                                await api.deleteGroup(groupForm.id!);
                                setGroupForm(emptyGroupForm());
                              }, 'Group deleted.')
                            }
                          >
                            Delete
                          </Button>
                        ) : null}
                        <Button startIcon={<SaveOutlinedIcon />} variant="contained" onClick={() => void submitGroup()} disabled={busy}>
                          Save
                        </Button>
                      </Stack>
                    }
                  >
                    <Stack spacing={2}>
                      <TextField label="Group Name" value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} required />
                      <TextField
                        label="Description"
                        value={groupForm.description}
                        multiline
                        minRows={3}
                        onChange={(event) => setGroupForm({ ...groupForm, description: event.target.value })}
                      />
                      <Autocomplete
                        multiple
                        options={roleOptions}
                        value={roleOptions.filter((option) => groupForm.roleIds.includes(option.value))}
                        onChange={(_, value) => setGroupForm({ ...groupForm, roleIds: value.map((item) => item.value) })}
                        renderInput={(params) => <TextField {...params} label="Roles" />}
                      />
                    </Stack>
                  </FormCard>
                }
              />
            </TabPanel>

            <TabPanel active={activeTab} name="Roles">
              <SplitLayout
                left={
                  <EntityList title="Roles" subtitle="Permissions are assigned to roles, then inherited through groups.">
                    {roles.map((role) => (
                      <ListItemButton key={role.id} selected={roleForm.id === role.id} onClick={() => selectRole(role)}>
                        <ListItemText primary={role.name} secondary={role.description || 'No description'} />
                      </ListItemButton>
                    ))}
                  </EntityList>
                }
                right={
                  <FormCard
                    title={roleForm.id ? `Edit Role #${roleForm.id}` : 'Create Role'}
                    actions={
                      <Stack direction="row" spacing={1}>
                        <Button onClick={() => selectRole()} variant="outlined">New Role</Button>
                        {roleForm.id ? (
                          <Button
                            color="error"
                            startIcon={<DeleteOutlineIcon />}
                            onClick={() =>
                              run(async () => {
                                await api.deleteRole(roleForm.id!);
                                setRoleForm(emptyRoleForm());
                              }, 'Role deleted.')
                            }
                          >
                            Delete
                          </Button>
                        ) : null}
                        <Button startIcon={<SaveOutlinedIcon />} variant="contained" onClick={() => void submitRole()} disabled={busy}>
                          Save
                        </Button>
                      </Stack>
                    }
                  >
                    <Stack spacing={3}>
                      <TextField label="Role Name" value={roleForm.name} onChange={(event) => setRoleForm({ ...roleForm, name: event.target.value })} required />
                      <TextField
                        label="Description"
                        value={roleForm.description}
                        multiline
                        minRows={2}
                        onChange={(event) => setRoleForm({ ...roleForm, description: event.target.value })}
                      />

                      <Box>
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                          Global Permissions
                        </Typography>
                        <Stack direction="row" flexWrap="wrap" gap={1}>
                          {globalPermissionOptions.map((scope) => (
                            <Chip
                              key={scope}
                              label={scope}
                              color={currentRoleScopes.has(scope) ? 'primary' : 'default'}
                              variant={currentRoleScopes.has(scope) ? 'filled' : 'outlined'}
                              onClick={() => toggleScope(scope, !currentRoleScopes.has(scope))}
                            />
                          ))}
                        </Stack>
                      </Box>

                      <Box>
                        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                          Per-API Permissions
                        </Typography>
                        <TableContainer component={Paper} variant="outlined">
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>API</TableCell>
                                <TableCell>View</TableCell>
                                <TableCell>Invoke</TableCell>
                                <TableCell>Manage</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {apis.map((apiItem) => (
                                <TableRow key={apiItem.id}>
                                  <TableCell>
                                    <Typography fontWeight={600}>{apiItem.name}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {apiItem.slug}
                                    </Typography>
                                  </TableCell>
                                  {['view', 'invoke', 'manage'].map((action) => {
                                    const scope = `api:${apiItem.id}:${action}`;
                                    return (
                                      <TableCell key={scope}>
                                        <Checkbox checked={currentRoleScopes.has(scope)} onChange={(event) => toggleScope(scope, event.target.checked)} />
                                      </TableCell>
                                    );
                                  })}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Box>
                    </Stack>
                  </FormCard>
                }
              />
            </TabPanel>

            <TabPanel active={activeTab} name="API Definitions">
              <SplitLayout
                left={
                  <EntityList
                    title="Registered APIs"
                    subtitle="Internal URLs remain server-side. Select an API to edit or refresh its cached spec."
                    action={<Button onClick={() => selectApi()} variant="outlined">New API</Button>}
                  >
                    {apis.map((apiItem) => (
                      <ListItemButton key={apiItem.id} selected={apiForm.id === apiItem.id} onClick={() => selectApi(apiItem)}>
                        <ListItemText
                          primary={apiItem.name}
                          secondary={[apiItem.slug, apiItem.isActive ? 'active' : 'inactive', apiItem.lastSpecStatus || 'never refreshed'].join(' • ')}
                        />
                      </ListItemButton>
                    ))}
                  </EntityList>
                }
                right={
                  <FormCard
                    title={apiForm.id ? `Edit API #${apiForm.id}` : 'Create API'}
                    actions={
                      <Stack direction="row" spacing={1}>
                        {apiForm.id ? (
                          <>
                            <Button
                              startIcon={<RefreshIcon />}
                              onClick={() =>
                                run(async () => {
                                  await api.refreshApiSpec(apiForm.id!);
                                }, 'API spec refreshed.')
                              }
                            >
                              Refresh Spec
                            </Button>
                            <Button
                              color="error"
                              startIcon={<DeleteOutlineIcon />}
                              onClick={() =>
                                run(async () => {
                                  await api.deleteApi(apiForm.id!);
                                  setApiForm(emptyApiForm());
                                }, 'API deleted.')
                              }
                            >
                              Delete
                            </Button>
                          </>
                        ) : null}
                        <Button startIcon={<SaveOutlinedIcon />} variant="contained" onClick={() => void submitApi()} disabled={busy}>
                          Save
                        </Button>
                      </Stack>
                    }
                  >
                    <Stack spacing={2}>
                      <TextField label="Name" value={apiForm.name} onChange={(event) => setApiForm({ ...apiForm, name: event.target.value })} required />
                      <TextField label="Slug" value={apiForm.slug} onChange={(event) => setApiForm({ ...apiForm, slug: event.target.value })} required />
                      <TextField
                        label="Description"
                        value={apiForm.description}
                        multiline
                        minRows={3}
                        onChange={(event) => setApiForm({ ...apiForm, description: event.target.value })}
                      />
                      <TextField
                        label="Internal OpenAPI URL"
                        value={apiForm.internalOpenapiUrl}
                        onChange={(event) => setApiForm({ ...apiForm, internalOpenapiUrl: event.target.value })}
                        required
                      />
                      <TextField
                        label="Internal Base URL"
                        value={apiForm.internalBaseUrl}
                        onChange={(event) => setApiForm({ ...apiForm, internalBaseUrl: event.target.value })}
                        required
                      />
                      <TextField label="Owner Team" value={apiForm.ownerTeam} onChange={(event) => setApiForm({ ...apiForm, ownerTeam: event.target.value })} />
                      <CreatableChipSelect
                        label="Allowed Methods"
                        helperText="Optional allowlist. Type or choose a method, then click the add suggestion or press Enter."
                        options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE']}
                        value={apiForm.allowedMethods}
                        normalize={(value) => value.toUpperCase()}
                        onChange={(value) => setApiForm({ ...apiForm, allowedMethods: value })}
                      />
                      <CreatableChipSelect
                        label="Allowed Path Prefixes"
                        helperText="Optional allowlist. Type a documented path prefix like /v1/orders, then click the add suggestion."
                        options={pathPrefixSuggestions}
                        value={apiForm.allowedPathPrefixes}
                        onChange={(value) => setApiForm({ ...apiForm, allowedPathPrefixes: value })}
                      />
                      <CreatableChipSelect
                        label="Tags"
                        helperText="Type a tag name and pick the add suggestion, or reuse an existing tag."
                        options={tagSuggestions}
                        value={apiForm.tags}
                        onChange={(value) => setApiForm({ ...apiForm, tags: value })}
                      />
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        <FormControlLabel
                          control={<Checkbox checked={apiForm.isActive} onChange={(event) => setApiForm({ ...apiForm, isActive: event.target.checked })} />}
                          label="Active"
                        />
                        <FormControlLabel
                          control={<Checkbox checked={apiForm.tryItEnabled} onChange={(event) => setApiForm({ ...apiForm, tryItEnabled: event.target.checked })} />}
                          label="Try It Enabled"
                        />
                      </Stack>
                    </Stack>
                  </FormCard>
                }
              />
            </TabPanel>

            <TabPanel active={activeTab} name="LDAP Settings">
              <Stack spacing={3}>
                <FormCard
                  title="LDAP Connection"
                  actions={
                    <Stack direction="row" spacing={1}>
                      <Button
                        onClick={() =>
                          run(async () => {
                            if (!ldap) {
                              return;
                            }
                            await api.testLdap(ldap);
                          }, 'LDAP connection successful.')
                        }
                      >
                        Test Connection
                      </Button>
                      <Button variant="contained" startIcon={<SaveOutlinedIcon />} onClick={() => void saveLdap()} disabled={busy || !ldap}>
                        Save
                      </Button>
                    </Stack>
                  }
                >
                  {ldap ? (
                    <Stack spacing={2}>
                      <FormControlLabel
                        control={<Checkbox checked={ldap.enabled} onChange={(event) => setLdap({ ...ldap, enabled: event.target.checked })} />}
                        label="LDAP Enabled"
                      />
                      <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }} gap={2}>
                        <TextField label="Host" value={ldap.host} onChange={(event) => setLdap({ ...ldap, host: event.target.value })} />
                        <TextField label="Port" type="number" value={ldap.port} onChange={(event) => setLdap({ ...ldap, port: Number(event.target.value) })} />
                        <TextField label="URL" value={ldap.url} onChange={(event) => setLdap({ ...ldap, url: event.target.value })} />
                        <TextField label="Timeout Seconds" type="number" value={ldap.timeoutSeconds} onChange={(event) => setLdap({ ...ldap, timeoutSeconds: Number(event.target.value) })} />
                        <TextField label="Bind DN" value={ldap.bindDn} onChange={(event) => setLdap({ ...ldap, bindDn: event.target.value })} />
                        <TextField
                          label={ldap.passwordConfigured ? 'Bind Password (leave blank to keep current)' : 'Bind Password'}
                          type="password"
                          value={ldap.bindPassword ?? ''}
                          onChange={(event) => setLdap({ ...ldap, bindPassword: event.target.value })}
                        />
                        <TextField label="User Base DN" value={ldap.userBaseDn} onChange={(event) => setLdap({ ...ldap, userBaseDn: event.target.value })} />
                        <TextField label="Username Attribute" value={ldap.usernameAttribute} onChange={(event) => setLdap({ ...ldap, usernameAttribute: event.target.value })} />
                        <TextField label="Display Name Attribute" value={ldap.displayNameAttribute} onChange={(event) => setLdap({ ...ldap, displayNameAttribute: event.target.value })} />
                        <TextField label="Email Attribute" value={ldap.emailAttribute} onChange={(event) => setLdap({ ...ldap, emailAttribute: event.target.value })} />
                      </Box>
                      <TextField
                        label="User Base DNs"
                        multiline
                        minRows={2}
                        helperText="Comma or newline separated values."
                        value={(ldap.userBaseDns ?? []).join('\n')}
                        onChange={(event) => setLdap({ ...ldap, userBaseDns: splitList(event.target.value) })}
                      />
                      <TextField
                        label="User Filter"
                        value={ldap.userFilter}
                        onChange={(event) => setLdap({ ...ldap, userFilter: event.target.value })}
                        helperText="Examples: (objectClass=user) or (&(objectClass=user)(objectCategory=person))"
                      />
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        <FormControlLabel
                          control={<Checkbox checked={ldap.useSsl} onChange={(event) => setLdap({ ...ldap, useSsl: event.target.checked })} />}
                          label="Use SSL"
                        />
                        <FormControlLabel
                          control={<Checkbox checked={ldap.startTls} onChange={(event) => setLdap({ ...ldap, startTls: event.target.checked })} />}
                          label="StartTLS"
                        />
                        <FormControlLabel
                          control={<Checkbox checked={ldap.sslSkipVerify} onChange={(event) => setLdap({ ...ldap, sslSkipVerify: event.target.checked })} />}
                          label="Skip TLS Verify"
                        />
                      </Stack>
                    </Stack>
                  ) : null}
                </FormCard>

                <FormCard
                  title="LDAP User Import"
                  actions={
                    <Stack direction="row" spacing={1}>
                      <Button onClick={() => void searchLdap()} startIcon={<RefreshIcon />} disabled={busy}>
                        Search
                      </Button>
                      <Button variant="contained" onClick={() => void importSelectedLdapUsers()} disabled={busy || selectedLdapUsers.length === 0}>
                        Import Selected
                      </Button>
                    </Stack>
                  }
                >
                  <Stack spacing={2}>
                    <TextField label="Search Query" value={ldapQuery} onChange={(event) => setLdapQuery(event.target.value)} />
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell />
                            <TableCell>Username</TableCell>
                            <TableCell>Display Name</TableCell>
                            <TableCell>Email</TableCell>
                            <TableCell>DN</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {ldapResults.map((item) => (
                            <TableRow key={item.username}>
                              <TableCell padding="checkbox">
                                <Checkbox
                                  checked={selectedLdapUsers.includes(item.username)}
                                  onChange={(event) =>
                                    setSelectedLdapUsers((current) =>
                                      event.target.checked ? [...current, item.username] : current.filter((value) => value !== item.username)
                                    )
                                  }
                                />
                              </TableCell>
                              <TableCell>{item.username}</TableCell>
                              <TableCell>{item.displayName || '-'}</TableCell>
                              <TableCell>{item.email || '-'}</TableCell>
                              <TableCell sx={{ maxWidth: 320, wordBreak: 'break-word' }}>{item.dn}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Stack>
                </FormCard>
              </Stack>
            </TabPanel>

            <TabPanel active={activeTab} name="Azure AD">
              <FormCard
                title="Azure AD / Microsoft Entra ID"
                actions={
                  <Stack direction="row" spacing={1}>
                    <Button
                      onClick={() =>
                        run(async () => {
                          if (!azureAd) {
                            return;
                          }
                          await api.testAzureAd(azureAd);
                        }, 'Azure AD connection successful.')
                      }
                      disabled={!azureAd}
                    >
                      Test
                    </Button>
                    <Button
                      variant="contained"
                      startIcon={<SaveOutlinedIcon />}
                      onClick={() =>
                        run(async () => {
                          if (!azureAd) {
                            return;
                          }
                          await api.updateAzureAd(azureAd);
                        }, 'Azure AD settings updated.')
                      }
                      disabled={!azureAd || busy}
                    >
                      Save
                    </Button>
                  </Stack>
                }
              >
                {azureAd ? (
                  <Stack spacing={2}>
                    <FormControlLabel
                      control={<Checkbox checked={azureAd.enabled} onChange={(event) => setAzureAd({ ...azureAd, enabled: event.target.checked })} />}
                      label="Azure AD Enabled"
                    />
                    <TextField label="Tenant ID" value={azureAd.tenantId} onChange={(event) => setAzureAd({ ...azureAd, tenantId: event.target.value })} />
                    <TextField label="Client ID" value={azureAd.clientId} onChange={(event) => setAzureAd({ ...azureAd, clientId: event.target.value })} />
                    <TextField
                      label={azureAd.passwordConfigured ? 'Client Secret (leave blank to keep current)' : 'Client Secret'}
                      type="password"
                      value={azureAd.clientSecret ?? ''}
                      onChange={(event) => setAzureAd({ ...azureAd, clientSecret: event.target.value })}
                    />
                    <TextField
                      label="Redirect URL"
                      value={azureAd.redirectUrl}
                      onChange={(event) => setAzureAd({ ...azureAd, redirectUrl: event.target.value })}
                      helperText="Example: https://portal.example.com/api/auth/azure/callback"
                    />
                    <Alert severity="info">
                      Existing app groups and roles continue to work locally. Azure AD is used only as an additional login method.
                    </Alert>
                  </Stack>
                ) : null}
              </FormCard>
            </TabPanel>

            <TabPanel active={activeTab} name="Session Settings">
              <FormCard
                title="Session Configuration"
                actions={
                  <Button
                    variant="contained"
                    startIcon={<SaveOutlinedIcon />}
                    onClick={() =>
                      run(async () => {
                        await api.updateSession(session);
                      }, 'Session settings updated.')
                    }
                    disabled={busy}
                  >
                    Save
                  </Button>
                }
              >
                <TextField
                  label="Session Minutes"
                  type="number"
                  value={session.sessionMinutes}
                  onChange={(event) => setSession({ sessionMinutes: Number(event.target.value) })}
                  helperText="Minimum 5 minutes."
                />
              </FormCard>
            </TabPanel>

            <TabPanel active={activeTab} name="Audit Logs">
              <FormCard
                title="Audit Logs"
                actions={
                  <Stack direction="row" spacing={1}>
                    <Button onClick={() => void loadAll()} startIcon={<RefreshIcon />}>Refresh</Button>
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
                  </Stack>
                }
              >
                <Stack spacing={2}>
                  <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }} gap={2}>
                    <TextField label="Filter by User" value={auditUser} onChange={(event) => setAuditUser(event.target.value)} />
                    <TextField label="Filter by Action" value={auditAction} onChange={(event) => setAuditAction(event.target.value)} />
                    <TextField
                      select
                      label="Rows per page"
                      value={String(auditPageSize)}
                      onChange={(event) => {
                        setAuditPageSize(Number(event.target.value));
                        setAuditOffset(0);
                      }}
                    >
                      {[25, 50, 100].map((value) => (
                        <MenuItem key={value} value={String(value)}>
                          {value}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setAuditOffset(0);
                      void loadAll();
                    }}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    Apply Filters
                  </Button>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Timestamp</TableCell>
                          <TableCell>User</TableCell>
                          <TableCell>Action</TableCell>
                          <TableCell>Resource</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Error</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {auditLogs.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell>{new Date(entry.timestamp).toLocaleString()}</TableCell>
                            <TableCell>{entry.user}</TableCell>
                            <TableCell>{entry.action}</TableCell>
                            <TableCell>{[entry.resourceType, entry.resourceName || entry.resourceId].filter(Boolean).join(' / ')}</TableCell>
                            <TableCell>{entry.statusCode}</TableCell>
                            <TableCell>{entry.errorMessage || '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
                    <Typography variant="body2" color="text.secondary">
                      {auditTotal === 0 ? 'No audit records' : `${auditOffset + 1}-${Math.min(auditOffset + auditLogs.length, auditTotal)} of ${auditTotal}`}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button variant="outlined" disabled={auditOffset === 0} onClick={() => setAuditOffset((current) => Math.max(0, current - auditPageSize))}>
                        Previous
                      </Button>
                      <Button
                        variant="outlined"
                        disabled={auditOffset + auditPageSize >= auditTotal}
                        onClick={() => setAuditOffset((current) => current + auditPageSize)}
                      >
                        Next
                      </Button>
                    </Stack>
                  </Stack>
                </Stack>
              </FormCard>
            </TabPanel>

            <TabPanel active={activeTab} name="System Settings">
              <FormCard
                title="Portal Branding"
                actions={
                  <Button
                    variant="contained"
                    startIcon={<SaveOutlinedIcon />}
                    onClick={() =>
                      run(async () => {
                        await api.updateSystem(system);
                      }, 'System settings updated.')
                    }
                    disabled={busy}
                  >
                    Save
                  </Button>
                }
              >
                <Stack spacing={2}>
                  <TextField label="Brand Title" value={system.brandTitle} onChange={(event) => setSystem({ ...system, brandTitle: event.target.value })} />
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">Logo</Typography>
                    {system.logoDataUrl ? (
                      <Box
                        component="img"
                        src={system.logoDataUrl}
                        alt={system.brandTitle || 'Portal logo'}
                        sx={{ maxWidth: 220, maxHeight: 80, objectFit: 'contain', border: '1px solid #d7dce5', borderRadius: 1, p: 1 }}
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No custom logo uploaded.
                      </Typography>
                    )}
                    <Button component="label" variant="outlined">
                      Select Image
                      <input
                        hidden
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml,image/webp"
                        onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)}
                      />
                    </Button>
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="contained"
                        disabled={!logoFile || busy}
                        onClick={() =>
                          run(async () => {
                            if (!logoFile) {
                              return;
                            }
                            const settings = await api.uploadSystemLogo(logoFile);
                            setSystem(settings);
                            setLogoFile(null);
                          }, 'Logo uploaded.')
                        }
                      >
                        Upload Logo
                      </Button>
                      <Button
                        color="error"
                        disabled={!system.logoDataUrl || busy}
                        onClick={() =>
                          run(async () => {
                            const settings = await api.deleteSystemLogo();
                            setSystem(settings);
                            setLogoFile(null);
                          }, 'Logo removed.')
                        }
                      >
                        Remove Logo
                      </Button>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      PNG, JPEG, SVG or WEBP. Max 256 KB.
                    </Typography>
                  </Stack>
                </Stack>
              </FormCard>
            </TabPanel>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

function buildAuditQuery(user: string, action: string, limit: number, offset: number) {
  const params = new URLSearchParams();
  if (user.trim()) {
    params.set('user', user.trim());
  }
  if (action.trim()) {
    params.set('action', action.trim());
  }
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const query = params.toString();
  return query ? `?${query}` : '';
}

function SplitLayout({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <Box display="grid" gridTemplateColumns={{ xs: '1fr', lg: '320px minmax(0, 1fr)' }} gap={3}>
      {left}
      {right}
    </Box>
  );
}

function EntityList({
  title,
  subtitle,
  action,
  children
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          </Box>
          {action}
        </Stack>
        <Divider sx={{ my: 2 }} />
        <List dense sx={{ maxHeight: 640, overflow: 'auto' }}>
          {children}
        </List>
      </CardContent>
    </Card>
  );
}

function FormCard({
  title,
  actions,
  children
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={2}>
          <Typography variant="h6" fontWeight={700}>
            {title}
          </Typography>
          {actions}
        </Stack>
        <Divider sx={{ my: 2 }} />
        {children}
      </CardContent>
    </Card>
  );
}

const creatableFilter = createFilterOptions<CreatableOption>();

function CreatableChipSelect({
  label,
  helperText,
  options,
  value,
  onChange,
  normalize
}: {
  label: string;
  helperText: string;
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  normalize?: (value: string) => string;
}) {
  const optionObjects = options.map((option) => ({ label: option, value: option }));
  const selectedObjects = value.map((item) => ({ label: item, value: item }));

  return (
    <Autocomplete<CreatableOption, true, false, true>
      multiple
      freeSolo
      selectOnFocus
      clearOnBlur
      handleHomeEndKeys
      options={optionObjects}
      value={selectedObjects}
      filterOptions={(inputOptions, params) => {
        const filtered = creatableFilter(inputOptions, params);
        const inputValue = params.inputValue.trim();
        if (!inputValue) {
          return filtered;
        }
        const normalizedInput = normalize ? normalize(inputValue) : inputValue;
        const exists = inputOptions.some((option) => (normalize ? normalize(option.value) : option.value) === normalizedInput);
        if (!exists) {
          filtered.push({
            label: `Add "${normalizedInput}"`,
            value: normalizedInput,
            isCreate: true
          });
        }
        return filtered;
      }}
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.label)}
      onChange={(_, newValue) => {
        const next = Array.from(
          new Set(
            newValue
              .map((item) => {
                if (typeof item === 'string') {
                  return normalize ? normalize(item.trim()) : item.trim();
                }
                return normalize ? normalize(item.value.trim()) : item.value.trim();
              })
              .filter(Boolean)
          )
        );
        onChange(next);
      }}
      renderInput={(params) => <TextField {...params} label={label} helperText={helperText} />}
    />
  );
}
