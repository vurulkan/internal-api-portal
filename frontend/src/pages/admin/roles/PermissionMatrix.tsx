import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import type { ApiDefinition, ScopeDef } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Badge, Checkbox, EmptyState, Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui';

const PER_API_ACTIONS = ['view', 'invoke', 'manage', 'delete'] as const;

const FAMILY_VARIANT: Record<ScopeDef['family'], 'neutral' | 'warning' | 'destructive'> = {
  read: 'neutral',
  write: 'warning',
  destructive: 'destructive',
};

/**
 * Portal-wide scopes as labelled checkboxes per area, then per-API scopes as a
 * table: one row per API, one column per action, each cell a named checkbox.
 */
export function PermissionMatrix({
  defs,
  apis,
  apisLoading,
  scopes,
  onToggle,
}: {
  defs: ScopeDef[];
  apis: ApiDefinition[];
  apisLoading: boolean;
  scopes: string[];
  onToggle: (scope: string, on: boolean) => void;
}) {
  const { t } = useTranslation();
  const has = useMemo(() => new Set(scopes), [scopes]);
  const groups = Array.from(new Set(defs.filter((d) => !d.perApi).map((d) => d.group)));
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <fieldset key={group} className="min-w-0">
          <legend className="mb-2 text-sm font-semibold">{group}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {defs
              .filter((d) => !d.perApi && d.group === group)
              .map((def) => (
                <div
                  key={def.scope}
                  className={cn(
                    'rounded-md border border-border p-2',
                    has.has(def.scope) && 'border-input bg-muted/60',
                  )}
                >
                  <Checkbox
                    checked={has.has(def.scope)}
                    onCheckedChange={(on) => onToggle(def.scope, on)}
                    label={
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold">{def.scope}</span>
                        <Badge variant={FAMILY_VARIANT[def.family]}>{t(`admin.roles.family.${def.family}`)}</Badge>
                      </span>
                    }
                    description={def.description}
                  />
                </div>
              ))}
          </div>
        </fieldset>
      ))}
      <div>
        <h3 className="mb-2 text-sm font-semibold">{t('admin.roles.perApi')}</h3>
        <TableContainer>
          <Table>
            <caption className="sr-only">{t('admin.roles.perApi')}</caption>
            <THead>
              <tr>
                <TH scope="col">{t('admin.roles.api')}</TH>
                {PER_API_ACTIONS.map((action) => {
                  const def = defs.find((d) => d.perApi && d.action === action);
                  return (
                    <TH key={action} scope="col" className="text-center" title={def?.description}>
                      <span className="inline-flex items-center gap-1">
                        {t(`admin.roles.action.${action}`)}
                        {def?.family === 'destructive' && (
                          <TriangleAlert
                            className="size-3.5 text-destructive"
                            aria-label={t('admin.roles.family.destructive')}
                          />
                        )}
                      </span>
                    </TH>
                  );
                })}
              </tr>
            </THead>
            <TBody>
              {apis.map((item) => (
                <TR key={item.id}>
                  <TH scope="row" className="text-left font-normal whitespace-normal text-foreground">
                    <p className="font-medium">{item.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{item.slug}</p>
                  </TH>
                  {PER_API_ACTIONS.map((action) => {
                    const scope = `api:${item.id}:${action}`;
                    return (
                      <TD key={scope} className="text-center">
                        <span className="inline-flex justify-center">
                          <Checkbox
                            aria-label={t('admin.roles.apiAction', {
                              api: item.name,
                              action: t(`admin.roles.action.${action}`),
                            })}
                            checked={has.has(scope)}
                            onCheckedChange={(on) => onToggle(scope, on)}
                          />
                        </span>
                      </TD>
                    );
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
          {apis.length === 0 && !apisLoading && (
            <EmptyState className="border-t border-border py-6" title={t('admin.roles.noApis')} />
          )}
        </TableContainer>
      </div>
    </div>
  );
}
