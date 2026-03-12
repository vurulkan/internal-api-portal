import { FormEvent, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';

type Props = {
  onSuccess?: () => Promise<void> | void;
};

export function ChangePasswordPage({ onSuccess }: Props) {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      await api.changePassword(currentPassword, newPassword);
      await onSuccess?.();
      setMessage('Password updated.');
      setCurrentPassword('');
      setNewPassword('');
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password update failed');
    }
  }

  return (
    <Box display="flex" alignItems="center" justifyContent="center" minHeight="70vh">
      <Card sx={{ width: '100%', maxWidth: 480, boxShadow: 4 }}>
        <CardContent>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            Update Your Password
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Your first login requires a password update.
          </Typography>
          {message ? <Alert severity="success" sx={{ mb: 2 }}>{message}</Alert> : null}
          {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
          <Box component="form" onSubmit={onSubmit} display="flex" flexDirection="column" gap={2}>
            <TextField label="Current Password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} fullWidth />
            <TextField label="New Password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} fullWidth />
            <Button type="submit" variant="contained">Update Password</Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
