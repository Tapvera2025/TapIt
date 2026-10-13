import { BrandLogo } from '../../ui/BrandLogo.js';
import { useEffect, useState } from 'react';
import { IdentityLayout } from '../components/IdentityLayout.js';
import {
  setupEmployeePassword,
  verifyEmployeeSetupToken,
  type EmployeeSetupVerification,
} from '../api/authApi.js';

interface EmployeeSetupPageProps {
  token: string;
  organizationCode: string;
  onComplete: () => void;
}

export function EmployeeSetupPage({
  token,
  organizationCode,
  onComplete,
}: EmployeeSetupPageProps) {
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<EmployeeSetupVerification | null>(null);
  const [verifyError, setVerifyError] = useState('');
  const [errorCode, setErrorCode] = useState('');

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkToken() {
      if (!token || !organizationCode) {
        setVerifyError('Missing setup token or company code in the link.');
        setErrorCode('MISSING_PARAMETERS');
        setLoading(false);
        return;
      }

      try {
        const details = await verifyEmployeeSetupToken(token, organizationCode);
        if (!cancelled) {
          setMeta(details);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Invalid or expired setup link.';
          const code =
            typeof err === 'object' && err !== null && 'code' in err
              ? String(err.code)
              : '';
          setVerifyError(message);
          setErrorCode(code);
          setLoading(false);
        }
      }
    }

    void checkToken();
    return () => {
      cancelled = true;
    };
  }, [token, organizationCode]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError('');

    if (password.length < 12) {
      setSubmitError('Your permanent password must be at least 12 characters long.');
      return;
    }

    if (password !== confirmation) {
      setSubmitError('The passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await setupEmployeePassword(token, organizationCode, password);
      setSuccess(true);
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error ? err.message : 'Failed to set permanent password. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  // 1. Loading State
  if (loading) {
    return (
      <IdentityLayout>
        <div className="rounded-[22px] border border-app-border bg-app-surface/95 p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.2)] backdrop-blur-md max-[560px]:p-6">
          <BrandLogo className="mx-auto mb-6 w-[200px]" />
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-app-accent">
            Account setup
          </p>
          <h1 className="font-display text-2xl font-bold leading-tight">
            Verifying your invitation…
          </h1>
          <p className="mt-3 text-sm text-app-muted">
            Checking your activation link with the server. Please wait a moment.
          </p>
        </div>
      </IdentityLayout>
    );
  }

  // 2. Token Error State (Missing, Expired, Revoked, Used)
  if (verifyError) {
    const isUsed = errorCode === 'IDENTITY_SETUP_TOKEN_ALREADY_USED';
    const isExpired = errorCode === 'IDENTITY_SETUP_TOKEN_EXPIRED';

    return (
      <IdentityLayout>
        <div className="rounded-[22px] border border-app-border bg-app-surface/95 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.2)] backdrop-blur-md max-[560px]:p-6">
          <BrandLogo className="mb-6 w-[200px]" />
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-app-danger">
            {isUsed ? 'Already Activated' : isExpired ? 'Link Expired' : 'Invalid Link'}
          </p>
          <h1 className="font-display text-[clamp(26px,6vw,34px)] font-bold leading-tight tracking-[-0.04em]">
            {isUsed
              ? 'Account already activated'
              : isExpired
              ? 'This link has expired'
              : 'Setup link unavailable'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-app-muted">
            {isUsed
              ? 'This setup link has already been used to configure a password. You can sign in directly with your email and password.'
              : isExpired
              ? 'This invitation link has expired for security reasons. Please contact your company administrator to receive a fresh setup link.'
              : verifyError}
          </p>

          <button
            type="button"
            className="mt-6 block w-full rounded-[10px] bg-app-accent px-4 py-3 text-center font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110"
            onClick={onComplete}
          >
            {isUsed ? 'Proceed to Sign In' : 'Back to Sign In'}
          </button>
        </div>
      </IdentityLayout>
    );
  }

  // 3. Success State
  if (success) {
    return (
      <IdentityLayout>
        <div className="rounded-[22px] border border-app-border bg-app-surface/95 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.2)] backdrop-blur-md max-[560px]:p-6">
          <BrandLogo className="mb-6 w-[200px]" />
          <div className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <svg
              className="size-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-emerald-600 dark:text-emerald-400">
            Setup Complete
          </p>
          <h1 className="font-display text-[clamp(26px,6vw,34px)] font-bold leading-tight tracking-[-0.04em]">
            Account activated!
          </h1>
          <p className="mt-3 text-sm leading-6 text-app-muted">
            Your permanent password has been configured successfully. You can now sign in to your TapCRM account with your email and new password.
          </p>

          <button
            type="button"
            className="mt-7 block w-full rounded-[10px] bg-app-accent px-4 py-3 font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110"
            onClick={onComplete}
          >
            Proceed to Sign In
          </button>
        </div>
      </IdentityLayout>
    );
  }

  // 4. Form State (Ready for password creation)
  return (
    <IdentityLayout>
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className="rounded-[22px] border border-app-border bg-app-surface/95 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.2)] backdrop-blur-md max-[560px]:p-6"
      >
        <BrandLogo className="mb-6 w-[200px]" />
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-app-accent">
          Employee account setup
        </p>
        <h1 className="font-display text-[clamp(28px,6vw,38px)] font-bold leading-tight tracking-[-0.04em]">
          {meta?.fullName ? `Welcome, ${meta.fullName}` : 'Welcome to TapCRM'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-app-muted">
          Configure a permanent password to complete your account activation
          {meta?.organizationName ? ` at ${meta.organizationName}` : ''}.
        </p>

        {meta?.email && (
          <div className="mt-4 rounded-xl border border-app-border/80 bg-app-surface-raised/70 px-4 py-3 text-xs">
            <span className="font-semibold text-app-muted">Account Email: </span>
            <span className="font-bold text-app-foreground">{meta.email}</span>
          </div>
        )}

        <label className="mt-6 block">
          <span className="mb-2 block text-xs font-semibold text-app-muted">
            Permanent password
          </span>
          <input
            id="setup-password-input"
            className="block w-full rounded-[10px] border border-app-border bg-app-background px-3.5 py-3 text-app-foreground outline-none focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
            type="password"
            autoComplete="new-password"
            minLength={12}
            placeholder="At least 12 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-semibold text-app-muted">
            Confirm permanent password
          </span>
          <input
            id="setup-password-confirm"
            className="block w-full rounded-[10px] border border-app-border bg-app-background px-3.5 py-3 text-app-foreground outline-none focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
            type="password"
            autoComplete="new-password"
            minLength={12}
            placeholder="Re-enter your password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
        </label>

        <button
          id="setup-submit-btn"
          className="mt-7 block w-full rounded-[10px] bg-app-accent px-4 py-3 font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110 disabled:opacity-50"
          type="submit"
          disabled={busy}
        >
          {busy ? 'Activating account…' : 'Set permanent password'}
        </button>

        {submitError && (
          <p
            id="setup-error-msg"
            className="mt-4 rounded-lg border border-[#d86b6b]/30 bg-[#d86b6b]/10 px-3 py-2.5 text-sm text-app-danger"
            role="alert"
          >
            {submitError}
          </p>
        )}

        <button
          type="button"
          className="mx-auto mt-5 block border-0 bg-transparent p-0 text-xs font-semibold text-app-accent hover:underline"
          onClick={onComplete}
        >
          Back to sign in
        </button>
      </form>
    </IdentityLayout>
  );
}
