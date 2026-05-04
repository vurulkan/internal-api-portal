import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Input } from '../components/ui';
import { api, setToken } from '../services/api';

type Props = {
  brandTitle: string;
  logoDataUrl?: string;
  onLogin: () => Promise<void> | void;
};

export function LoginPage({ brandTitle, logoDataUrl, onLogin }: Props) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [azureEnabled, setAzureEnabled] = useState(false);

  useEffect(() => {
    api.authProviders()
      .then((providers) => setAzureEnabled(Boolean(providers.azureAd)))
      .catch(() => undefined);
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await api.login(username, password);
      setToken(response.token);
      await onLogin();
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  const title = brandTitle || 'Internal API Portal';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 px-4">
      <div className="w-full max-w-sm">
        {/* Card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl shadow-gray-100/50">
          {/* Branding */}
          <div className="mb-7 text-center">
            {logoDataUrl ? (
              <img src={logoDataUrl} alt={title} className="mx-auto mb-4 h-16 object-contain" />
            ) : (
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-xl font-bold text-white shadow-md shadow-blue-200">
                {title.charAt(0).toUpperCase()}
              </div>
            )}
            <h1 className="text-xl font-bold text-gray-900">{title}</h1>
            <p className="mt-1 text-sm text-gray-500">Sign in to your account</p>
          </div>

          {error && (
            <div className="mb-4">
              <Alert variant="error">{error}</Alert>
            </div>
          )}

          {azureEnabled && (
            <>
              <button
                type="button"
                onClick={() => api.startAzureLogin()}
                className="mb-4 flex w-full items-center justify-center gap-2.5 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
              >
                {/* Microsoft logo */}
                <svg className="h-5 w-5" viewBox="0 0 21 21" fill="none">
                  <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                  <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                  <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                  <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
                </svg>
                Sign in with Microsoft
              </button>
              <div className="relative mb-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-xs text-gray-400">or continue with</span>
                </div>
              </div>
            </>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <Input
              label="Username"
              value={username}
              onChange={setUsername}
              placeholder="Enter your username"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="Enter your password"
              required
            />
            <Button
              type="submit"
              variant="primary"
              disabled={loading}
              className="w-full justify-center py-2.5"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
