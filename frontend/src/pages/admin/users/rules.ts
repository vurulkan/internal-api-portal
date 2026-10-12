import type { TFunction } from 'i18next';
import type { User } from '@/lib/api';

/**
 * The account-safety rules the backend enforces (nobody deactivates or demotes
 * themselves, the last active administrator stays), stated up front in the UI so
 * the controls explain themselves instead of failing on save.
 */
export function userRules(users: User[], meId: number | undefined, t: TFunction) {
  const activeAdmins = users.filter((u) => u.isAdmin && u.isActive).length;
  const isSelf = (u: User) => u.id === meId;
  const isLastAdmin = (u: User) => u.isAdmin && u.isActive && activeAdmins <= 1;
  return {
    activeAdmins,
    isSelf,
    isLastAdmin,
    /** Why the user can't be deactivated, or undefined. */
    statusLock(u: User): string | undefined {
      if (!u.isActive) return undefined;
      if (isSelf(u)) return t('admin.users.lockSelf');
      if (isLastAdmin(u)) return t('admin.users.lockLastAdmin');
      return undefined;
    },
    /** Why the user can't lose admin rights, or undefined. */
    adminLock(u: User): string | undefined {
      if (!u.isAdmin) return undefined;
      if (isSelf(u)) return t('admin.users.lockSelfAdmin');
      if (isLastAdmin(u)) return t('admin.users.lockLastAdmin');
      return undefined;
    },
  };
}

export type UserRules = ReturnType<typeof userRules>;
