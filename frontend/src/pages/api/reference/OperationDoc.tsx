import { useTranslation } from 'react-i18next';
import { KeyRound, Lock } from 'lucide-react';
import type { ApiDefinition } from '@/lib/api';
import {
  exampleFromSchema,
  headerAllowed,
  resolveRef,
  stringifyExample,
  typeLabel,
  type MediaType,
  type NormalizedSpec,
  type Operation,
  type Parameter,
} from '@/lib/openapi';
import {
  Alert,
  Badge,
  CodeBlock,
  CopyButton,
  MethodBadge,
  StatusBadge,
  Table,
  TableContainer,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';
import { Markdown } from '@/components/api/Markdown';
import { SchemaTree } from '@/components/api/SchemaTree';

export function OperationDoc({ spec, op, apiDef }: { spec: NormalizedSpec; op: Operation; apiDef: ApiDefinition }) {
  const { t } = useTranslation();
  const raw = spec.raw;
  return (
    <article aria-labelledby="operation-title" className="min-w-0 space-y-6">
      <header className="space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <MethodBadge method={op.method} />
          <code className="min-w-0 font-mono text-sm break-token">{op.path}</code>
          <CopyButton value={op.path} label={t('api.copyPath')} />
        </div>
        <h2 id="operation-title" className="text-xl font-semibold break-token">
          {op.summary || `${op.method} ${op.path}`}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {op.deprecated && <Badge variant="warning">{t('catalog.deprecated')}</Badge>}
          {op.operationId && (
            <Badge variant="outline" className="font-mono">
              {op.operationId}
            </Badge>
          )}
          {op.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              #{tag}
            </Badge>
          ))}
        </div>
        <Markdown>{op.description}</Markdown>
      </header>

      <SecurityNote op={op} apiDef={apiDef} />

      {op.parameters.length > 0 && (
        <section aria-labelledby="doc-parameters">
          <h3 id="doc-parameters" className="mb-2 text-sm font-semibold">
            {t('api.parameters')}
          </h3>
          <TableContainer>
            {/* Below ~520px the table scrolls inside its box instead of breaking names apart. */}
            <Table className="min-w-[32rem]">
              <caption className="sr-only">{t('api.parameters')}</caption>
              <THead>
                <tr>
                  <TH>{t('api.paramName')}</TH>
                  <TH>{t('api.paramIn')}</TH>
                  <TH>{t('api.paramType')}</TH>
                  <TH>{t('api.paramDescription')}</TH>
                </tr>
              </THead>
              <TBody>
                {op.parameters.map((p) => (
                  <ParameterRow key={`${p.in}:${p.name}`} spec={spec} p={p} apiDef={apiDef} />
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </section>
      )}

      {op.requestBody && op.requestBody.content.length > 0 && (
        <section aria-labelledby="doc-body">
          <h3 id="doc-body" className="mb-2 flex items-center gap-2 text-sm font-semibold">
            {t('api.requestBody')}
            {op.requestBody.required && <Badge variant="outline">{t('api.required')}</Badge>}
          </h3>
          <Markdown className="mb-2 text-[13px] text-muted-foreground">{op.requestBody.description}</Markdown>
          <MediaTabs spec={spec} content={op.requestBody.content} mode="request" label={t('api.requestBody')} />
        </section>
      )}

      <section aria-labelledby="doc-responses">
        <h3 id="doc-responses" className="mb-2 text-sm font-semibold">
          {t('api.responses')}
        </h3>
        {op.responses.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t('api.noResponses')}</p>
        ) : (
          <Tabs defaultValue={op.responses[0].status}>
            <TabsList label={t('api.responses')}>
              {op.responses.map((r) => (
                <TabsTrigger key={r.status} value={r.status}>
                  {/^\d{3}$/.test(r.status) ? (
                    <StatusBadge status={Number(r.status)} />
                  ) : (
                    <Badge variant="outline">{r.status}</Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {op.responses.map((r) => (
              <TabsContent key={r.status} value={r.status} className="space-y-3">
                <Markdown className="text-[13px]">{r.description || t('api.noDescription')}</Markdown>
                {r.content.length > 0 ? (
                  <MediaTabs
                    spec={spec}
                    content={r.content}
                    mode="response"
                    label={t('api.responseBody', { status: r.status })}
                  />
                ) : (
                  <p className="text-[13px] text-muted-foreground">{t('api.noBody')}</p>
                )}
                {r.headers.length > 0 && (
                  <ul className="space-y-1 text-[13px]">
                    {r.headers.map((h) => (
                      <li key={h.name}>
                        <code className="font-mono">{h.name}</code>{' '}
                        <span className="text-muted-foreground">{typeLabel(raw, h.schema)}</span>
                        {h.description && <span className="text-muted-foreground"> — {h.description}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </section>
    </article>
  );
}

function ParameterRow({ spec, p, apiDef }: { spec: NormalizedSpec; p: Parameter; apiDef: ApiDefinition }) {
  const { t } = useTranslation();
  const schema = resolveRef(spec.raw, p.schema) ?? {};
  const dropped =
    p.in === 'header' && !headerAllowed(p.name, apiDef.allowedRequestHeaders ?? [], !!apiDef.forwardAllXHeaders);
  const injected =
    p.in === 'header' && (apiDef.injectHeaderNames ?? []).some((n) => n.toLowerCase() === p.name.toLowerCase());
  return (
    <TR>
      <TD className="align-top">
        <span className="font-mono text-[13px] font-medium whitespace-nowrap">
          {p.name}
          {p.required && (
            <span className="text-destructive" aria-label={t('schema.required')}>
              *
            </span>
          )}
        </span>
        {p.deprecated && (
          <Badge variant="warning" className="ml-1.5">
            {t('catalog.deprecated')}
          </Badge>
        )}
      </TD>
      <TD className="align-top text-[13px] text-muted-foreground">{t(`api.in.${p.in}`)}</TD>
      <TD className="align-top font-mono text-xs">{typeLabel(spec.raw, p.schema)}</TD>
      <TD className="space-y-1 align-top">
        <Markdown className="text-[13px]">{p.description}</Markdown>
        {Array.isArray(schema.enum) && (
          <p className="flex flex-wrap gap-1 text-xs">
            {schema.enum.map((v: unknown) => (
              <code key={String(v)} className="rounded bg-muted px-1 font-mono">
                {String(v)}
              </code>
            ))}
          </p>
        )}
        {schema.default !== undefined && (
          <p className="text-xs text-muted-foreground">
            {t('schema.default')}: <code className="font-mono">{JSON.stringify(schema.default)}</code>
          </p>
        )}
        {injected ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" aria-hidden="true" />
            {t('api.headerInjected')}
          </p>
        ) : (
          dropped && <p className="text-xs text-warning">{t('api.headerNotForwarded')}</p>
        )}
      </TD>
    </TR>
  );
}

function MediaTabs({
  spec,
  content,
  mode,
  label,
}: {
  spec: NormalizedSpec;
  content: MediaType[];
  mode: 'request' | 'response';
  label: string;
}) {
  const { t } = useTranslation();
  const one = (m: MediaType) => {
    const example = m.example ?? m.examples[0]?.value ?? exampleFromSchema(spec.raw, m.schema, mode);
    return (
      <div className="space-y-2">
        {m.schema ? (
          <SchemaTree spec={spec.raw} schema={m.schema} mode={mode} />
        ) : (
          <p className="text-[13px] text-muted-foreground">{t('api.noSchema')}</p>
        )}
        {example !== undefined && (
          <details className="group">
            <summary className="cursor-pointer text-[13px] font-medium">{t('api.example')}</summary>
            <CodeBlock className="mt-2" code={stringifyExample(example)} label={m.contentType} />
          </details>
        )}
      </div>
    );
  };
  if (content.length === 1) {
    return (
      <div className="space-y-2">
        <p className="font-mono text-xs text-muted-foreground">{content[0].contentType}</p>
        {one(content[0])}
      </div>
    );
  }
  return (
    <Tabs defaultValue={content[0].contentType}>
      <TabsList label={t('api.contentTypes', { what: label })}>
        {content.map((m) => (
          <TabsTrigger key={m.contentType} value={m.contentType}>
            <span className="font-mono text-xs">{m.contentType}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {content.map((m) => (
        <TabsContent key={m.contentType} value={m.contentType}>
          {one(m)}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** Which credentials the operation needs, and whether the portal adds them. */
function SecurityNote({ op, apiDef }: { op: Operation; apiDef: ApiDefinition }) {
  const { t } = useTranslation();
  if (op.security.length === 0) return null;
  const injected = (apiDef.injectHeaderNames ?? []).map((n) => n.toLowerCase());
  const lines = op.security.flat().map((s) => {
    const header =
      s.type === 'apiKey' && s.in === 'header'
        ? s.name
        : s.type === 'http' || s.type === 'basic' || s.type === 'oauth2' || s.type === 'openIdConnect'
          ? 'Authorization'
          : undefined;
    const addedByPortal = !!header && injected.includes(header.toLowerCase());
    const userMaySend =
      !!header && headerAllowed(header, apiDef.allowedRequestHeaders ?? [], !!apiDef.forwardAllXHeaders);
    const what =
      s.type === 'apiKey'
        ? t('api.security.apiKey', { name: s.name, in: s.in })
        : s.type === 'http' || s.type === 'basic'
          ? t('api.security.http', { scheme: s.scheme ?? 'basic' })
          : t('api.security.other', { type: s.type });
    return {
      key: s.key,
      what,
      status: addedByPortal ? 'portal' : userMaySend ? 'user' : header ? 'blocked' : 'unknown',
    };
  });
  const blocked = lines.some((l) => l.status === 'blocked');
  return (
    <Alert variant={blocked ? 'warning' : 'info'} title={t('api.security.title')}>
      <ul className="space-y-0.5">
        {lines.map((l) => (
          <li key={l.key} className="flex flex-wrap items-center gap-1.5">
            {l.status === 'portal' ? (
              <Lock className="size-3.5" aria-hidden="true" />
            ) : (
              <KeyRound className="size-3.5" aria-hidden="true" />
            )}
            <span>{l.what}</span>
            <span>— {t(`api.security.${l.status}`)}</span>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
