import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, UserCheck, UserMinus, UserPlus, X } from 'lucide-react';
import type { Group, User } from '@/lib/api';
import { adminApi } from '@/lib/admin-api';
import { formatDateTime } from '@/lib/format';
import { queryKeys } from '@/lib/query';
import { useMe } from '@/hooks/queries';
import { AlertDialog, Button, Dialog, Field, Select } from '@/components/ui';
import { csvCell, downloadText, useAdminMutation } from '../common';
import type { UserRules } from './rules';

/** Bulk actions for the selected users, and a CSV export of the list. */
export function UserBulkActions({
  users,
  selected,
  groups,
  groupNames,
  canManage,
  rules,
  onDone,
}: {
  /** The filtered list (exported when nothing is selected). */
  users: User[];
  selected: User[];
  groups: Group[];
  groupNames: Map<number, string>;
  canManage: boolean;
  rules: UserRules;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const actorIsAdmin = !!me.data?.user.isAdmin;
  const [confirm, setConfirm] = useState<'deactivate' | 'activate' | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [groupId, setGroupId] = useState('');

  // Administrators are changed by administrators only; self and the last admin stay active.
  const changeable = selected.filter((u) => actorIsAdmin || !u.isAdmin);
  const toDeactivate = changeable.filter((u) => u.isActive && !rules.statusLock(u));
  const toActivate = changeable.filter((u) => !u.isActive);
  const skipped = selected.length - (confirm === 'activate' ? toActivate.length : toDeactivate.length);

  const status = useAdminMutation({
    mutationFn: ({ ids, active }: { ids: number[]; active: boolean }) => adminApi.bulkUserStatus(ids, active),
    success: (r, v) =>
      v.active
        ? t('admin.users.bulkActivated', { count: r.changed.length })
        : t('admin.users.bulkDeactivated', { count: r.changed.length }),
    invalidate: [queryKeys.admin.users, queryKeys.admin.sessions],
    onSuccess: onDone,
  });
  const addToGroup = useAdminMutation({
    mutationFn: ({ group, ids }: { group: number; ids: number[] }) => adminApi.addGroupMembers(group, ids),
    success: (r, v) => t('admin.users.bulkAdded', { count: r.added.length, group: groupNames.get(v.group) ?? '' }),
    invalidate: [queryKeys.admin.users, queryKeys.admin.groups],
    onSuccess: () => {
      setAddOpen(false);
      setGroupId('');
      onDone();
    },
  });

  function exportCsv() {
    const list = selected.length ? selected : users;
    const header = ['username', 'displayName', 'email', 'source', 'active', 'admin', 'groups', 'lastLogin', 'created'];
    const lines = list.map((u) =>
      [
        u.username,
        u.displayName,
        u.email,
        u.authSource,
        u.isActive,
        u.isAdmin,
        (u.groupIds ?? []).map((id) => groupNames.get(id) ?? id).join('; '),
        u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '',
        formatDateTime(u.createdAt),
      ]
        .map(csvCell)
        .join(','),
    );
    downloadText('users.csv', [header.join(','), ...lines].join('\r\n') + '\r\n');
  }

  return (
    <div
      className="flex min-h-9 flex-wrap items-center gap-2"
      role="region"
      aria-label={t('admin.users.bulkLabel')}
      aria-live="polite"
    >
      {selected.length > 0 && canManage ? (
        <>
          <span className="text-[13px] font-medium tabular-nums">
            {t('admin.users.selectedCount', { count: selected.length })}
          </span>
          <Button size="sm" disabled={toActivate.length === 0} onClick={() => setConfirm('activate')}>
            <UserCheck aria-hidden="true" />
            {t('admin.users.activate')}
          </Button>
          <Button size="sm" disabled={toDeactivate.length === 0} onClick={() => setConfirm('deactivate')}>
            <UserMinus aria-hidden="true" />
            {t('admin.users.deactivate')}
          </Button>
          <Button size="sm" disabled={groups.length === 0 || changeable.length === 0} onClick={() => setAddOpen(true)}>
            <UserPlus aria-hidden="true" />
            {t('admin.users.addToGroup')}
          </Button>
          <Button size="sm" onClick={exportCsv}>
            <Download aria-hidden="true" />
            {t('admin.users.exportSelected')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone}>
            <X aria-hidden="true" />
            {t('admin.users.clearSelection')}
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={exportCsv} disabled={users.length === 0}>
          <Download aria-hidden="true" />
          {t('admin.users.exportList', { count: users.length })}
        </Button>
      )}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        destructive={confirm === 'deactivate'}
        title={
          confirm === 'activate'
            ? t('admin.users.bulkActivateTitle', { count: toActivate.length })
            : t('admin.users.bulkDeactivateTitle', { count: toDeactivate.length })
        }
        description={
          <>
            {confirm === 'deactivate' ? t('admin.users.bulkDeactivateBody') : t('admin.users.bulkActivateBody')}
            {skipped > 0 && <span className="mt-2 block">{t('admin.users.bulkSkipped', { count: skipped })}</span>}
          </>
        }
        confirmLabel={confirm === 'activate' ? t('admin.users.activate') : t('admin.users.deactivate')}
        onConfirm={() =>
          status.mutateAsync({
            ids: (confirm === 'activate' ? toActivate : toDeactivate).map((u) => u.id),
            active: confirm === 'activate',
          })
        }
      />
      <Dialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title={t('admin.users.addToGroupTitle', { count: changeable.length })}
        description={t('admin.users.addToGroupBody')}
        footer={
          <>
            <Button onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!groupId}
              loading={addToGroup.isPending}
              onClick={() => addToGroup.mutate({ group: Number(groupId), ids: changeable.map((u) => u.id) })}
            >
              {t('admin.users.addToGroup')}
            </Button>
          </>
        }
      >
        <Field label={t('admin.users.group')} id="bulk-group">
          <Select
            value={groupId}
            placeholder={t('admin.users.chooseGroup')}
            onValueChange={setGroupId}
            options={groups.map((g) => ({ value: String(g.id), label: g.name }))}
          />
        </Field>
      </Dialog>
    </div>
  );
}
