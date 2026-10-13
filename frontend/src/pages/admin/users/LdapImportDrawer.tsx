import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import { api, type LdapUser } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Drawer,
  DrawerBody,
  DrawerFooter,
  EmptyState,
  Field,
  Input,
  MultiSelect,
  notifyError,
  type Column,
} from '@/components/ui';
import { useAdminMutation } from '../common';

/**
 * Users → New user → From LDAP: find directory users, pick them, optionally put
 * them in groups, import. The server looks every name up in the directory again,
 * so the accounts get the directory's name and e-mail.
 */
export function LdapImportDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LdapUser[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [outcome, setOutcome] = useState<{ skipped: string[]; missing: string[] } | null>(null);
  const users = useQuery({ queryKey: queryKeys.admin.users, queryFn: async () => (await api.users()) ?? [] });
  const groups = useQuery({ queryKey: queryKeys.admin.groups, queryFn: async () => (await api.groups()) ?? [] });
  // Directory names compare case-insensitively ("Bob" in the directory is "bob" typed).
  const existing = useMemo(
    () => new Map((users.data ?? []).map((u) => [u.username.toLowerCase(), u.authSource])),
    [users.data],
  );

  const search = useMutation({
    mutationFn: () => api.searchLdap(query.trim()),
    onSuccess: (found) => {
      setResults(found ?? []);
      setSelected([]);
    },
    onError: (error) => notifyError(error, t('admin.ldap.searchFailed')),
  });
  const importUsers = useAdminMutation({
    mutationFn: (names: string[]) => api.importLdap(names, groupIds),
    success: (r) =>
      groupIds.length
        ? t('admin.ldapImport.importedToGroups', { count: r.imported, added: r.addedToGroups })
        : t('admin.ldap.imported', { count: r.imported }),
    invalidate: [queryKeys.admin.users, queryKeys.admin.groups],
    onSuccess: (r) => {
      setSelected([]);
      setOutcome(r.skipped.length || r.missing.length ? { skipped: r.skipped, missing: r.missing } : null);
    },
  });

  const columns: Column<LdapUser>[] = [
    {
      id: 'username',
      header: t('admin.users.username'),
      sortValue: (u) => u.username,
      cell: (u) => {
        const source = existing.get(u.username.toLowerCase());
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{u.username}</span>
            {source && (
              <Badge variant={source === 'ldap' ? 'outline' : 'warning'}>
                {source === 'ldap'
                  ? t('admin.ldap.alreadyImported')
                  : t('admin.ldap.otherAccount', { source: t(`authSource.${source}`, { defaultValue: source }) })}
              </Badge>
            )}
          </span>
        );
      },
    },
    {
      id: 'name',
      header: t('admin.users.displayName'),
      sortValue: (u) => u.displayName,
      cell: (u) => u.displayName || '–',
    },
    { id: 'email', header: t('admin.users.email'), cell: (u) => u.email || '–', className: 'text-muted-foreground' },
  ];

  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('admin.ldapImport.title')}
      className="w-[min(100vw,44rem)]"
    >
      <DrawerBody className="space-y-4 p-4">
        <p className="text-[13px] text-muted-foreground">{t('admin.ldapImport.body')}</p>
        <form
          role="search"
          aria-label={t('admin.ldapImport.title')}
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            search.mutate();
          }}
        >
          <Field label={t('admin.ldap.searchQuery')} id="ldap-query" className="min-w-56 flex-1">
            <Input type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
          </Field>
          <Button type="submit" loading={search.isPending}>
            <Search aria-hidden="true" />
            {t('admin.ldap.search')}
          </Button>
        </form>
        {outcome && (
          <Alert variant="warning" title={t('admin.ldapImport.notImported')}>
            {outcome.skipped.length > 0 && (
              <p>{t('admin.ldapImport.skipped', { names: outcome.skipped.join(', ') })}</p>
            )}
            {outcome.missing.length > 0 && (
              <p>{t('admin.ldapImport.missing', { names: outcome.missing.join(', ') })}</p>
            )}
          </Alert>
        )}
        {results !== null && (
          <DataTable
            caption={t('admin.ldap.results')}
            rows={results}
            columns={columns}
            rowKey={(u) => u.username}
            rowLabel={(u) => u.username}
            selectable
            selected={selected}
            onSelectedChange={setSelected}
            empty={<EmptyState title={t('admin.ldap.noResults')} description={t('admin.ldap.noResultsBody')} />}
          />
        )}
        {results !== null && results.length > 0 && (
          <Field
            label={t('admin.ldapImport.groups')}
            id="ldap-import-groups"
            helper={t('admin.ldapImport.groupsHelper')}
          >
            <MultiSelect
              options={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
              value={groupIds}
              onChange={setGroupIds}
            />
          </Field>
        )}
      </DrawerBody>
      <DrawerFooter>
        <Button onClick={onClose}>{t('common.close')}</Button>
        <Button
          variant="primary"
          disabled={selected.length === 0}
          loading={importUsers.isPending}
          onClick={() => importUsers.mutate(selected)}
        >
          <UserPlus aria-hidden="true" />
          {t('admin.ldap.importSelected', { count: selected.length })}
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}
