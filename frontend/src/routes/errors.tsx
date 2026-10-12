import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FileQuestion, TriangleAlert } from 'lucide-react';
import i18n from '@/i18n';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { Button, EmptyState } from '@/components/ui';

export function NotFoundPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('errors.notFoundTitle'));
  return (
    <EmptyState
      headingLevel={1}
      icon={FileQuestion}
      title={t('errors.notFoundTitle')}
      description={t('errors.notFoundBody')}
      action={
        <Button asChild variant="primary">
          <Link to="/">{t('errors.backToCatalog')}</Link>
        </Button>
      }
      className="py-20"
    />
  );
}

function CrashDetails({ error }: { error: unknown }) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return (
    <details className="mt-3 max-w-xl text-left text-xs text-muted-foreground">
      <summary className="cursor-pointer">{i18n.t('errors.details')}</summary>
      <pre className="mt-2 overflow-auto rounded-md bg-muted p-2 font-mono whitespace-pre-wrap break-token">
        {message}
      </pre>
    </details>
  );
}

/** Route errorElement: a crash or a failed lazy chunk shows this instead of a blank page. */
export function RouteError() {
  const error = useRouteError();
  const { t } = useTranslation();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  return (
    <div className="flex flex-col items-center px-4 py-20 text-center">
      <EmptyState
        headingLevel={1}
        icon={TriangleAlert}
        title={t('errors.crashTitle')}
        description={t('errors.crashBody')}
        action={
          <Button variant="primary" onClick={() => window.location.reload()}>
            {t('errors.reload')}
          </Button>
        }
      />
      <CrashDetails error={error} />
    </div>
  );
}

/** Last line of defence outside the router. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
        <p className="text-base font-semibold">{i18n.t('errors.crashTitle')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{i18n.t('errors.crashBody')}</p>
        <Button className="mt-4" variant="primary" onClick={() => window.location.reload()}>
          {i18n.t('errors.reload')}
        </Button>
        <CrashDetails error={this.state.error} />
      </div>
    );
  }
}
