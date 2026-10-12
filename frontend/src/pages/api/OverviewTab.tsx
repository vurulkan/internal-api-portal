import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { operationsByTag } from '@/lib/openapi';
import { Badge, Button, Card, CardContent, CardHeader, KeyValueList } from '@/components/ui';
import { Markdown } from '@/components/api/Markdown';
import { operationPath, useApiWorkspace } from './context';

export default function OverviewTab() {
  const { t } = useTranslation();
  const { apiDef, spec, ref, base } = useApiWorkspace();
  const manage = !!apiDef.permissions?.manage;
  const groups = spec ? operationsByTag(spec, t('api.untagged')) : [];
  const describe = (list?: string[], all?: string) => (list?.length ? list.join(', ') : all);
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        {(spec?.description || apiDef.description) && (
          <Card>
            <CardHeader
              title={spec?.title || apiDef.name}
              description={spec?.version ? `v${spec.version}` : undefined}
            />
            <CardContent>
              <Markdown>{spec?.description || apiDef.description}</Markdown>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader
            title={t('api.overview.groups')}
            description={t('api.operationCount', { count: spec?.operations.length ?? 0 })}
          />
          <CardContent className="py-1">
            {groups.length === 0 ? (
              <p className="py-3 text-[13px] text-muted-foreground">{t('api.noOperations')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {groups.map(([tag, ops]) => (
                  <li key={tag} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <Link to={operationPath(base, ops[0].key)} className="font-medium hover:underline">
                        {tag}
                      </Link>
                      {spec?.tags.find((x) => x.name === tag)?.description && (
                        <span className="block text-[13px] text-muted-foreground">
                          {spec.tags.find((x) => x.name === tag)!.description}
                        </span>
                      )}
                    </span>
                    <Badge variant="outline">{t('api.operationCount', { count: ops.length })}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader title={t('api.overview.facts')} />
          <CardContent className="py-1">
            <KeyValueList
              items={[
                {
                  label: t('catalog.owner'),
                  value: apiDef.ownerTeam ? (
                    <Link to={`/?owner=${encodeURIComponent(apiDef.ownerTeam)}`} className="text-link hover:underline">
                      {apiDef.ownerTeam}
                    </Link>
                  ) : (
                    t('catalog.unassigned')
                  ),
                },
                { label: t('catalog.slug'), value: apiDef.slug, mono: true },
                {
                  label: t('catalog.version'),
                  value: apiDef.specVersion ? `v${apiDef.specVersion}` : '–',
                  mono: !!apiDef.specVersion,
                },
                { label: 'OpenAPI', value: spec?.openapi || '–', mono: true },
                {
                  label: t('api.lastRefresh'),
                  value: apiDef.lastSpecRefreshAt ? (
                    <span title={formatDateTime(apiDef.lastSpecRefreshAt)}>
                      {formatRelative(apiDef.lastSpecRefreshAt)}
                    </span>
                  ) : (
                    t('api.neverRefreshed')
                  ),
                },
                { label: t('api.tryIt'), value: apiDef.tryItEnabled ? t('common.enabled') : t('common.disabled') },
                {
                  label: t('api.rateLimit'),
                  value: apiDef.rateLimitPerMinute
                    ? t('api.perMinute', { count: apiDef.rateLimitPerMinute })
                    : t('api.defaultLimit'),
                },
                { label: t('api.timeout'), value: t('api.seconds', { count: apiDef.timeoutSeconds || 30 }) },
                {
                  label: t('api.allowedMethods'),
                  value: describe(apiDef.allowedMethods, t('api.allDocumentedMethods')),
                },
                {
                  label: t('api.allowedPaths'),
                  value: describe(apiDef.allowedPathPrefixes, t('api.allDocumentedPaths')),
                  mono: !!apiDef.allowedPathPrefixes?.length,
                },
                ...(manage
                  ? [
                      { label: t('admin.apis.baseUrl'), value: apiDef.internalBaseUrl || '–', mono: true },
                      { label: t('admin.apis.openapiUrl'), value: apiDef.internalOpenapiUrl || '–', mono: true },
                    ]
                  : []),
              ]}
            />
            {apiDef.specError && <p className="mb-2 text-xs text-destructive break-token">{apiDef.specError}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader title={t('api.overview.download')} />
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={api.specDownloadUrl(ref, 'json')} download>
                <Download aria-hidden="true" />
                JSON
              </a>
            </Button>
            <Button asChild>
              <a href={api.specDownloadUrl(ref, 'yaml')} download>
                <Download aria-hidden="true" />
                YAML
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
