import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router';
import { AuthGate, ShellSkeleton } from '@/routes/AuthGate';
import { NotFoundPage, RouteError } from '@/routes/errors';
import LoginPage from '@/pages/LoginPage';
import CatalogPage from '@/pages/CatalogPage';

const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [{ path: '__ui', lazy: async () => ({ Component: (await import('@/pages/KitchenSinkPage')).default }) }]
  : [];

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  {
    path: '/',
    element: <AuthGate />,
    // Shown while the first route's lazy module loads.
    hydrateFallbackElement: <ShellSkeleton />,
    errorElement: <RouteError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <CatalogPage /> },
          { path: 'apis/:id', lazy: async () => ({ Component: (await import('@/pages/ApiDetailsPage')).default }) },
          { path: 'account', lazy: async () => ({ Component: (await import('@/pages/AccountPage')).default }) },
          {
            path: 'change-password',
            lazy: async () => ({ Component: (await import('@/pages/AccountPage')).ChangePasswordPage }),
          },
          { path: 'admin/:section?', lazy: async () => ({ Component: (await import('@/pages/AdminPage')).default }) },
          ...devRoutes,
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export function createRouter() {
  return createBrowserRouter(routes);
}

/** Tests: the same routes in memory. */
export function createTestRouter(initialPath: string) {
  return createMemoryRouter(routes, { initialEntries: [initialPath] }) as ReturnType<typeof createRouter>;
}
