import { forwardRef, lazy, Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import type { InvokeResponse } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { decodeBase64Utf8, isJsonContentType, prettyBody } from '@/lib/openapi';
import {
  Badge,
  Button,
  CopyButton,
  Skeleton,
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
import { JsonTree } from '@/components/api/JsonTree';

const CodeEditor = lazy(() => import('@/components/api/CodeEditor'));

const REASONS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  410: 'Gone',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export const ResponseViewer = forwardRef<
  HTMLHeadingElement,
  { result: InvokeResponse; durationMs: number; fileName: string }
>(function ResponseViewer({ result, durationMs, fileName }, headingRef) {
  const { t } = useTranslation();
  const raw = useMemo(() => decodeBase64Utf8(result.bodyBase64), [result.bodyBase64]);
  const pretty = useMemo(() => prettyBody(raw, result.contentType), [raw, result.contentType]);
  const parsed = useMemo(() => {
    if (!raw.trim() || !(isJsonContentType(result.contentType) || /^\s*[[{]/.test(raw))) return undefined;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  }, [raw, result.contentType]);
  const headers = Object.entries(result.headers ?? {});

  function download() {
    const blob = new Blob([raw], { type: result.contentType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName + (parsed !== undefined ? '.json' : '.txt');
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="response-heading" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="response-heading" ref={headingRef} tabIndex={-1} className="text-sm font-semibold focus:outline-none">
          {t('api.response')}
        </h3>
        <StatusBadge status={result.statusCode} />
        {REASONS[result.statusCode] && (
          <span className="text-[13px] text-muted-foreground">{REASONS[result.statusCode]}</span>
        )}
        <Badge variant="outline" className="tabular-nums">
          {formatNumber(Math.round(durationMs))} ms
        </Badge>
        <Badge variant="outline" className="tabular-nums">
          {t('api.bytes', { count: result.responseBytes })}
        </Badge>
        {result.truncated && <Badge variant="warning">{t('api.truncated')}</Badge>}
        {result.rateLimit && (
          <Badge variant={result.rateLimit.remaining <= 1 ? 'warning' : 'outline'}>
            {t('api.rateLeft', { remaining: result.rateLimit.remaining, limit: result.rateLimit.limitPerMinute })}
          </Badge>
        )}
        <span className="ml-auto flex gap-1">
          <CopyButton value={pretty || raw} />
          <Button size="sm" variant="ghost" onClick={download} disabled={!raw}>
            <Download aria-hidden="true" />
            {t('api.download')}
          </Button>
        </span>
      </div>
      <Tabs defaultValue={parsed !== undefined ? 'pretty' : 'raw'}>
        <TabsList label={t('api.responseViews')}>
          {parsed !== undefined && <TabsTrigger value="pretty">{t('api.views.pretty')}</TabsTrigger>}
          {parsed !== undefined && <TabsTrigger value="tree">{t('api.views.tree')}</TabsTrigger>}
          <TabsTrigger value="raw">{t('api.views.raw')}</TabsTrigger>
          <TabsTrigger value="headers">{t('api.views.headers', { count: headers.length })}</TabsTrigger>
        </TabsList>
        {parsed !== undefined && (
          <TabsContent value="pretty">
            <Suspense fallback={<Skeleton className="h-40" />}>
              <CodeEditor
                value={pretty}
                readOnly
                label={t('api.responseBody', { status: result.statusCode })}
                minHeight="4rem"
              />
            </Suspense>
            <p className="mt-1 text-xs text-muted-foreground">{t('api.searchHint')}</p>
          </TabsContent>
        )}
        {parsed !== undefined && (
          <TabsContent value="tree">
            <JsonTree value={parsed} />
          </TabsContent>
        )}
        <TabsContent value="raw">
          <pre className="max-h-[28rem] overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-token">
            {raw || t('api.emptyBody')}
          </pre>
        </TabsContent>
        <TabsContent value="headers">
          <TableContainer>
            <Table>
              <caption className="sr-only">{t('api.responseHeaders')}</caption>
              <THead>
                <tr>
                  <TH>{t('api.header')}</TH>
                  <TH>{t('api.value')}</TH>
                </tr>
              </THead>
              <TBody>
                {headers.map(([name, value]) => (
                  <TR key={name}>
                    <TD className="font-mono text-xs whitespace-nowrap">{name}</TD>
                    <TD className="text-xs break-token">{value}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </TabsContent>
      </Tabs>
    </section>
  );
});
