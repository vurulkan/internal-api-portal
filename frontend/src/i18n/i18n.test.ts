import { describe, expect, it } from 'vitest';
import { ALL_ADMIN_SECTIONS } from '@/hooks/queries';
import { en } from './en';
import { tr } from './tr';

type Dict = Record<string, unknown>;

function flatten(obj: Dict, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v as Dict, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

// i18next plurals: t('x', { count }) resolves x_one / x_other.
function has(dict: Dict, key: string) {
  const get = (k: string) => k.split('.').reduce<unknown>((a, p) => (a as Dict | undefined)?.[p], dict);
  return [key, `${key}_one`, `${key}_other`].some((k) => typeof get(k) === 'string');
}

describe('i18n dictionaries', () => {
  it('EN and TR define exactly the same keys', () => {
    const enKeys = new Set(flatten(en));
    const trKeys = new Set(flatten(tr));
    expect(
      [...enKeys].filter((k) => !trKeys.has(k)),
      'missing in TR',
    ).toEqual([]);
    expect(
      [...trKeys].filter((k) => !enKeys.has(k)),
      'missing in EN',
    ).toEqual([]);
  });

  it('no value is empty and every placeholder exists in both languages', () => {
    const enDict = en as Dict;
    const trDict = tr as Dict;
    const problems: string[] = [];
    for (const key of flatten(enDict)) {
      const get = (d: Dict) => key.split('.').reduce<unknown>((a, p) => (a as Dict)[p], d) as string;
      const [e, t] = [get(enDict), get(trDict)];
      if (!e.trim() || !t.trim()) problems.push(`empty: ${key}`);
      const vars = (s: string) =>
        [...s.matchAll(/{{(\w+)}}/g)]
          .map((m) => m[1])
          .sort()
          .join(',');
      if (vars(e) !== vars(t)) problems.push(`placeholders differ: ${key} (${vars(e)} / ${vars(t)})`);
    }
    expect(problems).toEqual([]);
  });

  it('every literal key used in the source exists in both languages', () => {
    const files = import.meta.glob(['../**/*.tsx', '../**/*.ts', '!../**/*.test.*', '!../i18n/*.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const missing: string[] = [];
    for (const [file, src] of Object.entries(files)) {
      for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        const key = m[1];
        if (!key.includes('.')) continue;
        for (const [lang, dict] of [
          ['en', en],
          ['tr', tr],
        ] as const) {
          if (!has(dict as Dict, key)) missing.push(`${lang}: ${key} (${file})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('keys built at runtime exist', () => {
    const dynamic = [
      ...ALL_ADMIN_SECTIONS.flatMap((id) => [`admin.sections.${id}`, `admin.descriptions.${id}`]),
      ...['local', 'ldap', 'azuread'].map((s) => `authSource.${s}`),
      ...['light', 'dark', 'system'].map((s) => `theme.${s}`),
      ...['en', 'tr'].map((s) => `language.${s}`),
      ...['invoke', 'view', 'none'].map((s) => `catalog.accessLevel.${s}`),
      ...['success', 'denied', 'failed'].map((s) => `admin.audit.outcomes.${s}`),
      ...['view', 'invoke', 'manage', 'delete'].map((s) => `admin.roles.action.${s}`),
      ...['read', 'write', 'destructive'].map((s) => `admin.roles.family.${s}`),
      ...[
        'azure_not_configured',
        'azure_state',
        'azure_denied',
        'azure_failed',
        'azure_groups',
        'account_disabled',
      ].map((s) => `login.authErrors.${s}`),
      'warnings.encryption_key_in_database',
      ...['path', 'query', 'header'].map((s) => `api.groups.${s}`),
      ...['path', 'query', 'header', 'cookie'].map((s) => `api.in.${s}`),
      ...['portal', 'user', 'blocked', 'unknown'].map((s) => `api.security.${s}`),
      ...['required', 'integer', 'number', 'boolean', 'enum', 'json'].map((s) => `api.validation.${s}`),
      ...['initial', 'changed', 'failed'].map((s) => `api.activity.kind.${s}`),
      ...['added', 'removed', 'changed'].map((s) => `api.activity.${s}`),
      ...['overview', 'reference', 'classic', 'access', 'activity'].map((s) => `api.tabs.${s}`),
    ];
    const missing = dynamic.flatMap((key) =>
      [
        ['en', en],
        ['tr', tr],
      ]
        .filter(([, d]) => !has(d as Dict, key))
        .map(([lang]) => `${lang}: ${key}`),
    );
    expect(missing).toEqual([]);
  });
});
