import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { LayoutList, Plus, RotateCw } from 'lucide-react';
import { api, type ApiDefinition } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { useAdminSections, useMe } from '@/hooks/queries';
import { Badge, Button, Card, DataTable, EmptyState, ErrorState, IconButton, type Column } from '@/components/ui';
import { matches, SearchInput, SectionToolbar, TableSkeleton, useAdminMutation } from './common';
import { ApiDrawer } from './apis/ApiDrawer';
import { ApiWizard } from './apis/ApiWizard';

export default function ApisSection() {
  const { t } = useTranslation();
  const me = useMe();
  const caps = me.data?.capabilities;
  const canCreate = !!caps?.canCreateApi || !!me.data?.user.isAdmin;
  const managesAll = !!caps?.managesAllApis || !!me.data?.user.isAdmin;
  const sections = useAdminSections();
  const apis = useQuery({ queryKey: queryKeys.admin.apis, queryFn: async () => (await api.adminApis()) ?? [] });
  // Groups feed the owner group and the access list (every API manager can list them).
  const groups = useQuery({
    queryKey: queryKeys.admin.groups,
    queryFn: async () => (await api.groups()) ?? [],
    enabled: sections.length > 0,
  });
  const [search, setSearch] = useState('');
  // /admin/apis?new=1 (the catalog's "New API") opens the wizard; ?edit=<id> (the API
  // page's "Edit definition") opens that API once the list is in.
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(() => !!params.get('new') && canCreate);
  const [editing, setEditing] = useState<ApiDefinition | null>(null);
  const editId = Number(params.get('edit'));
  const [openedEdit, setOpenedEdit] = useState(0);
  if (editId && editId !== openedEdit && apis.data) {
    setOpenedEdit(editId);
    const target = apis.data.find((a) => a.id === editId);
    if (target) setEditing(target);
  }
  useEffect(() => {
    if (!params.has('new') && !params.has('edit')) return;
    const rest = new URLSearchParams(params);
    rest.delete('new');
    if (apis.data) rest.delete('edit');
    setParams(rest, { replace: true });
  }, [params, setParams, apis.data]);
  const rows = useMemo(
    () => (apis.data ?? []).filter((a) => matches(search, a.name, a.slug, a.ownerTeam, ...(a.tags ?? []))),
    [apis.data, search],
  );
  const refresh = useAdminMutation({
    mutationFn: (a: ApiDefinition) => api.refreshApiSpec(a.id),
    success: (_r, a) => t('admin.apis.refreshedNamed', { name: a.name }),
    invalidate: (a) => [
      queryKeys.admin.apis,
      queryKeys.admin.overview,
      queryKeys.spec(String(a.id)),
      queryKeys.catalog,
    ],
    errorFallback: t('admin.apis.refreshFailed'),
  });

  const columns: Column<ApiDefinition>[] = [
    {
      id: 'name',
      header: t('admin.apis.name'),
      sortValue: (a) => a.name,
      cell: (a) => (
        <span className="block min-w-0">
          <span className="font-medium">{a.name}</span>
          <span className="block font-mono text-xs text-muted-foreground">{a.slug}</span>
        </span>
      ),
    },
    {
      id: 'owner',
      header: t('catalog.owner'),
      sortValue: (a) => a.ownerTeam ?? '',
      cell: (a) => a.ownerTeam || '–',
      className: 'text-muted-foreground',
    },
    {
      id: 'status',
      header: t('admin.users.status'),
      sortValue: (a) => (a.isActive ? 1 : 0),
      cell: (a) => (
        <span className="flex flex-wrap gap-1">
          <Badge variant={a.isActive ? 'success' : 'destructive'}>
            {a.isActive ? t('common.active') : t('common.inactive')}
          </Badge>
          {!a.tryItEnabled && <Badge variant="outline">{t('admin.apis.tryItOff')}</Badge>}
        </span>
      ),
    },
    {
      id: 'spec',
      header: t('admin.apis.spec'),
      sortValue: (a) => a.lastSpecRefreshAt ?? '',
      cell: (a) => <SpecCell apiDef={a} />,
    },
    {
      id: 'actions',
      header: <span className="sr-only">{t('admin.apis.actions')}</span>,
      cell: (a) => (
        // stopPropagation: the row click opens the editor.
        <IconButton
          label={t('admin.apis.refreshNamed', { name: a.name })}
          icon={<RotateCw aria-hidden="true" />}
          disabled={refresh.isPending && refresh.variables?.id === a.id}
          onClick={(e) => {
            e.stopPropagation();
            refresh.mutate(a);
          }}
        />
      ),
      className: 'w-12 text-right',
    },
  ];

  if (apis.isPending) return <TableSkeleton />;
  if (apis.isError)
    return (
      <Card>
        <ErrorState error={apis.error} onRetry={() => void apis.refetch()} />
      </Card>
    );

  const newButton = canCreate && (
    <Button variant="accent" onClick={() => setCreating(true)}>
      <Plus aria-hidden="true" />
      {t('admin.apis.new')}
    </Button>
  );
  return (
    <>
      <DataTable
        caption={t('admin.sections.apis')}
        rows={rows}
        columns={columns}
        rowKey={(a) => String(a.id)}
        onRowClick={(a) => setEditing(a)}
        activeRowKey={editing ? String(editing.id) : undefined}
        toolbar={
          <SectionToolbar actions={newButton}>
            <SearchInput value={search} onChange={setSearch} label={t('admin.apis.search')} />
          </SectionToolbar>
        }
        empty={
          search ? (
            <EmptyState
              title={t('admin.noMatch')}
              action={<Button onClick={() => setSearch('')}>{t('admin.clearSearch')}</Button>}
            />
          ) : (
            <EmptyState
              icon={LayoutList}
              title={t('admin.apis.emptyTitle')}
              description={canCreate ? t('admin.apis.emptyBody') : t('admin.apis.emptyBodyOwner')}
              action={newButton}
            />
          )
        }
      />
      {creating && (
        <ApiWizard
          groups={groups.data ?? []}
          allApis={apis.data ?? []}
          managesAll={managesAll}
          onClose={() => setCreating(false)}
          onCreated={() => setCreating(false)}
        />
      )}
      {editing && (
        <ApiDrawer
          key={editing.id}
          apiDef={editing}
          groups={groups.data ?? []}
          allApis={apis.data ?? []}
          managesAll={managesAll}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function SpecCell({ apiDef: a }: { apiDef: ApiDefinition }) {
  const { t } = useTranslation();
  const failed = !!a.lastSpecStatus && /^error/i.test(a.lastSpecStatus);
  if (!a.lastSpecRefreshAt && !failed) return <Badge variant="warning">{t('api.neverRefreshed')}</Badge>;
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-[13px]">
      {failed ? (
        <Badge variant="destructive" title={a.lastSpecStatus}>
          {t('admin.apis.specError')}
        </Badge>
      ) : (
        a.operationCount !== undefined && (
          <span className="tabular-nums">{t('admin.apis.operations', { count: a.operationCount })}</span>
        )
      )}
      {a.specVersion && <Badge variant="outline">v{a.specVersion}</Badge>}
      {a.lastSpecRefreshAt && <span className="text-muted-foreground">{formatRelative(a.lastSpecRefreshAt)}</span>}
    </span>
  );
}
