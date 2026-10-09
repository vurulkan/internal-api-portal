import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Circle, LogOut, Monitor } from 'lucide-react';
import { Alert, Badge, Button, Input } from '../components/ui';
import { api, MeResponse, Session } from '../services/api';

type Props = {
  me: MeResponse;
  // forced: the account must change its password before anything else.
  forced: boolean;
  onPasswordChanged?: () => Promise<void> | void;
};

function relative(iso: string) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleString();
}

// A short device label from the user agent; the full string is in the tooltip.
function device(userAgent: string) {
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Chrome\//.test(userAgent) ? 'Chrome' : /Firefox\//.test(userAgent) ? 'Firefox' : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  const os = /Windows/.test(userAgent) ? 'Windows' : /Mac OS X/.test(userAgent) ? 'macOS' : /Android/.test(userAgent) ? 'Android' : /iPhone|iPad/.test(userAgent) ? 'iOS' : /Linux/.test(userAgent) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function AccountPage({ me, forced, onPasswordChanged }: Props) {
  const navigate = useNavigate();
  const isLocal = me.user.authSource === 'local';
  const minLength = me.passwordPolicy?.minLength ?? 12;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsError, setSessionsError] = useState('');

  const rules = useMemo(
    () => [
      { label: `At least ${minLength} characters`, ok: [...newPassword].length >= minLength },
      { label: 'Does not contain your username', ok: newPassword !== '' && !newPassword.toLowerCase().includes(me.user.username.toLowerCase()) },
      { label: 'Both new password fields match', ok: newPassword !== '' && newPassword === confirmPassword },
    ],
    [newPassword, confirmPassword, minLength, me.user.username],
  );

  async function loadSessions() {
    try {
      const response = await api.mySessions();
      setSessions(response.items ?? []);
      setSessionsError('');
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Could not load sessions');
    }
  }

  useEffect(() => {
    if (!forced) void loadSessions();
  }, [forced]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setError('');
    if (newPassword !== confirmPassword) {
      setError('The new password fields do not match.');
      return;
    }
    setSaving(true);
    try {
      const result = await api.changePassword(currentPassword, newPassword) as { sessionsRevoked?: number };
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      const revoked = result?.sessionsRevoked ?? 0;
      setMessage(revoked > 0 ? `Password updated. You were signed out of ${revoked} other session${revoked === 1 ? '' : 's'}.` : 'Password updated.');
      await onPasswordChanged?.();
      if (forced) navigate('/', { replace: true });
      else void loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password update failed');
    } finally {
      setSaving(false);
    }
  }

  async function signOut(session: Session) {
    try {
      await api.revokeMySession(session.id);
      await loadSessions();
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Could not sign out the session');
    }
  }

  async function signOutOthers() {
    try {
      await api.revokeMyOtherSessions();
      await loadSessions();
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Could not sign out the sessions');
    }
  }

  const others = sessions.filter((s) => !s.current).length;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{forced ? 'Set a new password' : 'Account'}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {forced
            ? 'Your password was set by an administrator or this is your first sign-in. Choose a new password to continue.'
            : `Signed in as ${me.user.username}${isLocal ? '' : ` (${me.user.authSource === 'ldap' ? 'LDAP' : 'Azure AD'} account)`}.`}
        </p>
      </div>

      {isLocal ? (
        <section aria-labelledby="password-heading" className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 id="password-heading" className="mb-4 text-base font-semibold text-gray-900">Change password</h2>
          {message && <div className="mb-4"><Alert variant="success">{message}</Alert></div>}
          {error && <div className="mb-4" role="alert"><Alert variant="error">{error}</Alert></div>}
          <form onSubmit={onSubmit} className="space-y-4">
            <Input label="Current password" type="password" autoComplete="current-password" value={currentPassword} onChange={setCurrentPassword} required />
            <Input label="New password" type="password" autoComplete="new-password" value={newPassword} onChange={setNewPassword} required />
            <Input label="Confirm new password" type="password" autoComplete="new-password" value={confirmPassword} onChange={setConfirmPassword} required />
            <ul className="space-y-1 text-sm" aria-label="Password requirements">
              {rules.map((rule) => (
                <li key={rule.label} className={rule.ok ? 'flex items-center gap-2 text-green-700' : 'flex items-center gap-2 text-gray-500'}>
                  {rule.ok ? <Check className="h-4 w-4" aria-hidden="true" /> : <Circle className="h-4 w-4" aria-hidden="true" />}
                  <span>{rule.label}<span className="sr-only">{rule.ok ? ' (met)' : ' (not met yet)'}</span></span>
                </li>
              ))}
              <li className="text-xs text-gray-500">Commonly used passwords are refused.</li>
            </ul>
            <Button type="submit" variant="primary" disabled={saving || !rules.every((r) => r.ok) || currentPassword === ''} className="w-full justify-center py-2.5">
              {saving ? 'Updating…' : 'Update password'}
            </Button>
          </form>
        </section>
      ) : (
        <Alert variant="info">Your password is managed by {me.user.authSource === 'ldap' ? 'the directory (LDAP)' : 'Microsoft (Azure AD)'}; change it there.</Alert>
      )}

      {!forced && (
        <section aria-labelledby="sessions-heading" className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="sessions-heading" className="text-base font-semibold text-gray-900">Active sessions</h2>
            <Button variant="secondary" size="sm" disabled={others === 0} onClick={signOutOthers}>
              <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out other sessions
            </Button>
          </div>
          {sessionsError && <div className="mb-3"><Alert variant="error">{sessionsError}</Alert></div>}
          <ul className="divide-y divide-gray-100">
            {sessions.map((session) => (
              <li key={session.id} className="flex items-center gap-3 py-3">
                <Monitor className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-gray-900" title={session.userAgent}>
                    {device(session.userAgent)}
                    {session.current && <Badge variant="green">This browser</Badge>}
                  </p>
                  <p className="text-xs text-gray-500">
                    {session.ip || 'unknown address'} · active {relative(session.lastUsedAt)} · signed in {new Date(session.createdAt).toLocaleString()}
                  </p>
                </div>
                {!session.current && (
                  <Button variant="ghost" size="sm" onClick={() => signOut(session)}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
