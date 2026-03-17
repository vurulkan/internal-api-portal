import { FormEvent, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Divider, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
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
    api.authProviders().then((providers) => setAzureEnabled(Boolean(providers.azureAd))).catch(() => undefined);
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

  return (
    <Box display="flex" alignItems="center" justifyContent="center" minHeight="100vh">
      <Card sx={{ width: '90vw', maxWidth: 420, boxShadow: 4 }}>
        <CardContent>
          {logoDataUrl ? (
            <Box display="flex" justifyContent="center" mb={2}>
              <Box component="img" src={logoDataUrl} alt={brandTitle} sx={{ width: '100%', maxWidth: 220, height: 'auto', objectFit: 'contain' }} />
            </Box>
          ) : null}
          <Typography variant="h5" fontWeight={600} gutterBottom>
            {brandTitle}
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Sign in with your account.
          </Typography>
          {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
          {azureEnabled ? (
            <>
              <Button variant="outlined" fullWidth sx={{ mb: 2 }} onClick={() => api.startAzureLogin()}>
                Sign in with Microsoft
              </Button>
              <Divider sx={{ mb: 2 }}>or</Divider>
            </>
          ) : null}
          <Box component="form" onSubmit={onSubmit} display="flex" flexDirection="column" gap={2}>
            <TextField label="Username" value={username} onChange={(event) => setUsername(event.target.value)} fullWidth />
            <TextField label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} fullWidth />
            <Button type="submit" variant="contained" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
