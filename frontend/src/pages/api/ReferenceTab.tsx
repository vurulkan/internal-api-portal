import { useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FileWarning, PanelRightClose, PanelRightOpen, SearchX } from 'lucide-react';
import { cn } from '@/lib/cn';
import { readPref, writePref } from '@/lib/storage';
import { firstOperation } from '@/lib/openapi';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { SectionPanel } from '@/components/shell/shell-context';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingRegion,
  Skeleton,
} from '@/components/ui';
import { operationPath, useApiWorkspace } from './context';
import { OperationDoc } from './reference/OperationDoc';
import { OperationTree } from './reference/OperationTree';
import { TryItConsole } from './reference/TryIt';

const CONSOLE_KEY = 'portal.consoleCollapsed';

/** Reference: the operation tree (side panel), the operation's docs and the try-it console. */
export default function ReferenceTab() {
  const { t } = useTranslation();
  const { apiDef, spec, specQuery, base } = useApiWorkspace();
  const { opKey } = useParams();
  const [params, setParams] = useSearchParams();
  const wide = useMediaQuery('(min-width: 1280px)');
  const [collapsed, setCollapsed] = useState(() => readPref(CONSOLE_KEY) === '1');

  if (specQuery.isPending) {
    return (
      <LoadingRegion className="grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </LoadingRegion>
    );
  }
  if (specQuery.isError || !spec) {
    return (
      <Card>
        <ErrorState error={specQuery.error} onRetry={() => void specQuery.refetch()} />
      </Card>
    );
  }
  if (spec.operations.length === 0) {
    return (
      <Card>
        <EmptyState icon={FileWarning} title={t('api.noOperations')} description={t('api.noOperationsBody')} />
      </Card>
    );
  }
  // /reference opens the first operation; an unknown key says so.
  if (!opKey) return <Navigate to={operationPath(base, firstOperation(spec)!.key)} replace />;
  const op = spec.operations.find((o) => o.key === opKey);
  const panel = (
    <SectionPanel title={t('api.operations')}>
      <OperationTree spec={spec} base={base} selected={op?.key} />
    </SectionPanel>
  );
  if (!op) {
    return (
      <>
        {panel}
        <Card>
          <EmptyState
            icon={SearchX}
            title={t('api.operationNotFound')}
            description={t('api.operationNotFoundBody', { key: opKey })}
            action={
              <Button asChild>
                <Link to={operationPath(base, firstOperation(spec)!.key)}>{t('api.firstOperation')}</Link>
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  const pane = params.get('pane') === 'try' ? 'try' : 'docs';
  const doc = <OperationDoc spec={spec} op={op} apiDef={apiDef} />;
  const consolePane = <TryItConsole spec={spec} op={op} apiDef={apiDef} />;

  if (!wide) {
    // Below 1280px the console is a tab next to the docs.
    return (
      <>
        {panel}
        <div
          role="tablist"
          aria-label={t('api.panes')}
          className="mb-4 inline-flex rounded-md border border-border bg-card p-0.5"
        >
          {(['docs', 'try'] as const).map((p) => (
            <button
              key={p}
              role="tab"
              type="button"
              aria-selected={pane === p}
              aria-controls={`pane-${p}`}
              id={`pane-tab-${p}`}
              onClick={() => {
                const next = new URLSearchParams(params);
                if (p === 'try') next.set('pane', 'try');
                else next.delete('pane');
                setParams(next, { replace: true });
              }}
              className={cn(
                'cursor-pointer rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground',
                pane === p && 'bg-muted text-foreground',
              )}
            >
              {p === 'docs' ? t('api.documentation') : t('api.tryIt')}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`pane-${pane}`} aria-labelledby={`pane-tab-${pane}`}>
          <Card>
            <CardContent>{pane === 'docs' ? doc : consolePane}</CardContent>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      {panel}
      <div
        className={cn(
          'grid min-w-0 items-start gap-5',
          collapsed ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]',
        )}
      >
        <Card>
          <CardContent>{doc}</CardContent>
        </Card>
        {collapsed ? (
          <IconButton
            variant="secondary"
            label={t('api.showConsole')}
            tooltipSide="left"
            icon={<PanelRightOpen aria-hidden="true" />}
            aria-expanded={false}
            onClick={() => {
              writePref(CONSOLE_KEY, '0');
              setCollapsed(false);
            }}
          />
        ) : (
          <Card className="sticky top-[4.5rem] max-h-[calc(100dvh-5.5rem)] overflow-y-auto">
            <div className="flex justify-end px-2 pt-2">
              <IconButton
                size="icon-sm"
                label={t('api.hideConsole')}
                tooltipSide="left"
                icon={<PanelRightClose aria-hidden="true" />}
                aria-expanded
                onClick={() => {
                  writePref(CONSOLE_KEY, '1');
                  setCollapsed(true);
                }}
              />
            </div>
            <CardContent className="pt-0">{consolePane}</CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
