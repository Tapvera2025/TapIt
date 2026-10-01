import { BrandLogo } from '../../ui/BrandLogo.js';
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
        <BrandLogo className="mb-6 w-[200px]" />
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-app-accent">First sign-in</p>
        <h1 className="font-display text-[clamp(30px,7vw,42px)] font-bold leading-none tracking-[-0.05em]">Set your password.</h1>
        <p className="mt-3 text-sm leading-6 text-app-muted">Your temporary password must be replaced before you can open the CRM workspace.</p>
        <PasswordField
          label="Temporary password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
        />
        <PasswordField
          label="New password"
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
          minLength={12}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          value={confirmation}
          onChange={setConfirmation}
          minLength={12}
        />
        <button className="mt-6 block w-full rounded-[10px] bg-app-accent px-4 py-3 font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={busy}>
          {busy ? 'Updating password...' : 'Set password and continue'}
        </button>
        {error && <p className="mt-4 rounded-lg border border-[#d86b6b]/30 bg-[#d86b6b]/10 px-3 py-2.5 text-sm text-app-danger" role="alert">{error}</p>}
      </form>
    </IdentityLayout>
  );
}

function PasswordField({
  label,
  autoComplete,
  value,
  onChange,
  minLength,
}: {
  label: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  minLength?: number;
}): React.JSX.Element {
  const [visible, setVisible] = useState(false);
  return (
    <label className="mt-4 block first:mt-7">
      <span className="mb-2 block text-xs font-semibold text-app-muted">{label}</span>
      <span className="relative block">
        <input
          className="block w-full rounded-[10px] border border-app-border bg-app-background px-3.5 py-3 pr-12 text-app-foreground outline-none focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          {...(minLength === undefined ? {} : { minLength })}
          required
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 grid size-[34px] -translate-y-1/2 place-items-center rounded-[7px] border-0 bg-transparent p-0 text-app-muted transition hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-1"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          <svg className="size-[18px] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            {visible ? (
              <>
                <path d="M3 3l18 18" />
                <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                <path d="M9.9 4.3A10.8 10.8 0 0 1 12 4c5.2 0 8.7 4 10 8a13.7 13.7 0 0 1-3.1 5" />
                <path d="M6.2 6.2C4.5 7.3 3.2 9.2 2 12c1.3 4 4.8 8 10 8a10.8 10.8 0 0 0 3.4-.5" />
              </>
            ) : (
              <>
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="2.5" />
              </>
            )}
          </svg>
        </button>
      </span>
    </label>
  );
}
