import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { AccountPage } from './pages/AccountPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { ApiDetailsPage } from './pages/ApiDetailsPage';
import { AdminPage } from './pages/AdminPage';
import { api, ApiError, ApiSummary, MeResponse, SystemSettings } from './services/api';

export default function App() {
  const location = useLocation();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [catalog, setCatalog] = useState<ApiSummary[]>([]);
  const [publicSettings, setPublicSettings] = useState<SystemSettings>({
    brandTitle: 'Internal API Portal',
    logoDataUrl: '',
  });
  const [loading, setLoading] = useState(true);

  async function loadSession() {
    try {
      const meResponse = await api.me();
      // Until a forced password change is done the backend refuses everything but /me
      // and change-password, so don't ask for the catalog.
      const mustChange = meResponse.user.mustChangePassword && meResponse.user.authSource === 'local';
      const catalogResponse = mustChange ? [] : await api.catalog();
      setMe({
        ...meResponse,
        permissions: meResponse.permissions ?? [],
        groupIds: meResponse.groupIds ?? [],
        branding: meResponse.branding ?? publicSettings,
      });
      setCatalog(catalogResponse ?? []);
    } catch (err) {
      // 401: not signed in (or the session ended). Anything else is shown on the
      // login page as a sign-in problem rather than looping.
      if (!(err instanceof ApiError) || err.status !== 401) {
        console.error(err);
      }
      setMe(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // The session may already be gone; the local state is cleared either way.
    }
    setCatalog([]);
    setMe(null);
    setLoading(false);
  }

  useEffect(() => {
    api.publicSettings().then(setPublicSettings).catch(() => undefined);
    loadSession();
  }, []);

  useEffect(() => {
    const brandTitle = me?.branding.brandTitle || publicSettings.brandTitle || 'Internal API Portal';
    document.title = brandTitle;
  }, [me?.branding.brandTitle, publicSettings.brandTitle]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!me) {
    return (
      <LoginPage
        brandTitle={publicSettings.brandTitle}
        logoDataUrl={publicSettings.logoDataUrl}
        onLogin={loadSession}
      />
    );
  }

  // The admin console opens for anyone with at least one admin section (delegated
  // administrators included), not only isAdmin.
  const canAdmin = me.user.isAdmin || (me.capabilities?.adminSections.length ?? 0) > 0;

  return (
    <Layout
      brandTitle={me.branding.brandTitle || publicSettings.brandTitle}
      logoDataUrl={me.branding.logoDataUrl || publicSettings.logoDataUrl}
      username={me.user.username}
      isAdmin={canAdmin}
      warnings={me.warnings ?? []}
      onLogout={handleLogout}
    >
      <Routes>
        <Route
          path="/"
          element={
            me.user.mustChangePassword && location.pathname !== '/change-password' ? (
              <Navigate to="/change-password" replace />
            ) : (
              <DashboardPage apis={catalog} refresh={loadSession} />
            )
          }
        />
        <Route
          path="/change-password"
          element={
            me.user.authSource === 'local' ? (
              <AccountPage me={me} forced={me.user.mustChangePassword} onPasswordChanged={loadSession} />
            ) : (
              <Navigate to="/account" replace />
            )
          }
        />
        <Route
          path="/account"
          element={
            me.user.mustChangePassword && me.user.authSource === 'local' ? (
              <Navigate to="/change-password" replace />
            ) : (
              <AccountPage me={me} forced={false} onPasswordChanged={loadSession} />
            )
          }
        />
        <Route
          path="/apis/:id"
          element={
            me.user.mustChangePassword ? (
              <Navigate to="/change-password" replace />
            ) : (
              <ApiDetailsPage />
            )
          }
        />
        <Route
          path="/admin"
          element={
            canAdmin && !me.user.mustChangePassword ? (
              <AdminPage me={me} />
            ) : (
              <Navigate to={me.user.mustChangePassword ? '/change-password' : '/'} replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
