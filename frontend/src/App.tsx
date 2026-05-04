import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { ApiDetailsPage } from './pages/ApiDetailsPage';
import { AdminPage } from './pages/AdminPage';
import { api, ApiSummary, clearToken, getToken, MeResponse, SystemSettings } from './services/api';

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
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      const [meResponse, catalogResponse] = await Promise.all([api.me(), api.catalog()]);
      setMe({
        ...meResponse,
        permissions: meResponse.permissions ?? [],
        groupIds: meResponse.groupIds ?? [],
        branding: meResponse.branding ?? publicSettings,
      });
      setCatalog(catalogResponse ?? []);
    } catch {
      clearToken();
      setMe(null);
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    clearToken();
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

  return (
    <Layout
      brandTitle={me.branding.brandTitle || publicSettings.brandTitle}
      logoDataUrl={me.branding.logoDataUrl || publicSettings.logoDataUrl}
      username={me.user.username}
      isAdmin={me.user.isAdmin}
      canChangePassword={me.user.authSource === 'local'}
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
              <ChangePasswordPage onSuccess={loadSession} />
            ) : (
              <Navigate to="/" replace />
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
            me.user.isAdmin && !me.user.mustChangePassword ? (
              <AdminPage />
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
