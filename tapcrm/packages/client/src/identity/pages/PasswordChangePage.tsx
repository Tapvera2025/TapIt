import { useState } from 'react';
import { IdentityLayout } from '../components/IdentityLayout.js';
import { changeTemporaryPassword } from '../api/authApi.js';

export function PasswordChangePage({ onComplete }: { onComplete: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (newPassword.length < 12) {
      setError('Your new password must be at least 12 characters long.');
      return;
    }
    if (newPassword !== confirmation) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await changeTemporaryPassword(currentPassword, newPassword);
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Password change failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <IdentityLayout>
      <form onSubmit={(event) => { void submit(event); }} className="rounded-[22px] border border-app-border bg-app-surface/95 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.2)] backdrop-blur-md max-[560px]:p-6">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-app-accent">First sign-in</p>
        <h1 className="font-display text-[clamp(30px,7vw,42px)] font-bold leading-none tracking-[-0.05em]">Set your password.</h1>
        <p className="mt-3 text-sm leading-6 text-app-muted">Your temporary password must be replaced before you can open the CRM workspace.</p>
        <label className="mt-7 block">
          <span className="mb-2 block text-xs font-semibold text-app-muted">Temporary password</span>
          <input className="block w-full rounded-[10px] border border-app-border bg-app-background px-3.5 py-3 text-app-foreground outline-none focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
        </label>
        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-semibold text-app-muted">New password</span>
          <input className="block w-full rounded-[10px] border border-app-border bg-app-background px-3.5 py-3 text-app-foreground outline-none focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} required />
        </label>
        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-semibold text-app-muted">Confirm new password</span>
          <input className="block w-full rounded-[10px] border border-app-border bg-app-background px-3.5 py-3 text-app-foreground outline-none focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} required />
        </label>
        <button className="mt-6 block w-full rounded-[10px] bg-app-accent px-4 py-3 font-bold text-[#061412] transition hover:-translate-y-px hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={busy}>
          {busy ? 'Updating password...' : 'Set password and continue'}
        </button>
        {error && <p className="mt-4 rounded-lg border border-[#d86b6b]/30 bg-[#d86b6b]/10 px-3 py-2.5 text-sm text-[#d86b6b]" role="alert">{error}</p>}
      </form>
    </IdentityLayout>
  );
}
