import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Card, CardContent, ErrorState, LoadingRegion, Skeleton } from '@/components/ui';
import type { SpecObject } from '@/lib/openapi';
import { useApiWorkspace } from './context';

// Swagger UI is ~370 KB gzip: loaded only when this tab opens.
const SwaggerDocs = lazy(() => import('@/components/SwaggerDocs'));

export default function ClassicTab() {
  const { t } = useTranslation();
  const { specQuery } = useApiWorkspace();
  return (
    <Card>
      <CardContent className="space-y-3">
        <Alert variant="info">{t('api.classicNote')}</Alert>
        {specQuery.isPending ? (
          <LoadingRegion>
            <Skeleton className="h-96" />
          </LoadingRegion>
        ) : specQuery.isError ? (
          <ErrorState error={specQuery.error} onRetry={() => void specQuery.refetch()} />
        ) : (
          <Suspense
            fallback={
              <LoadingRegion>
                <Skeleton className="h-96" />
              </LoadingRegion>
            }
          >
            <SwaggerDocs spec={specQuery.data as SpecObject} />
          </Suspense>
        )}
      </CardContent>
    </Card>
  );
}
