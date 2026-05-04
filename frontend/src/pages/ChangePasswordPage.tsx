import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Input } from '../components/ui';
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
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setError('');
    setLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      await onSuccess?.();
      setMessage('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password update failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="mb-1 text-xl font-bold text-gray-900">Update Your Password</h1>
          <p className="mb-6 text-sm text-gray-500">
            Your first login requires a password update.
          </p>

          {message && (
            <div className="mb-4">
              <Alert variant="success">{message}</Alert>
            </div>
          )}
          {error && (
            <div className="mb-4">
              <Alert variant="error">{error}</Alert>
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <Input
              label="Current Password"
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
              required
            />
            <Input
              label="New Password"
              type="password"
              value={newPassword}
              onChange={setNewPassword}
              required
            />
            <Button type="submit" variant="primary" disabled={loading} className="w-full justify-center py-2.5">
              {loading ? 'Updating...' : 'Update Password'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
