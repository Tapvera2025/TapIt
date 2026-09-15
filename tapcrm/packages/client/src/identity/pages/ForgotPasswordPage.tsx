import { useState } from 'react';
import { IdentityLayout } from '../components/IdentityLayout.js';
import { requestPasswordReset } from '../api/authApi.js';

export function ForgotPasswordPage({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await requestPasswordReset(email);
      setSubmitted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit password reset request');
    } finally {
      setBusy(false);
    }
  }

  return <IdentityLayout><form onSubmit={(event) => { void submit(event); }} className="rounded-[22px] border border-app-border bg-app-surface/95 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.2)] backdrop-blur-md max-[560px]:p-6">
    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-app-accent">Account recovery</p>
    <h1 className="font-display text-[clamp(30px,7vw,42px)] font-bold leading-none tracking-[-0.05em]">Reset your password.</h1>
    {submitted ? <p className="mt-5 rounded-lg border border-app-accent/25 bg-app-accent/10 px-3 py-3 text-sm leading-6 text-app-muted">If an active account exists for that email, password reset instructions have been sent.</p> : <>
      <p className="mt-3 text-sm leading-6 text-app-muted">Enter your company email. If the account is eligible, we will send reset instructions.</p>
      <label className="mt-7 block"><span className="mb-2 block text-xs font-semibold text-app-muted">Email address</span><input className="block w-full rounded-[10px] border border-app-border bg-app-background px-3.5 py-3 text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <button className="mt-6 block w-full rounded-[10px] bg-app-accent px-4 py-3 font-bold text-[#061412] transition hover:-translate-y-px hover:brightness-110 disabled:opacity-50" type="submit" disabled={busy}>{busy ? 'Sending...' : 'Send reset instructions'}</button>
    </>}
    {error && <p className="mt-4 rounded-lg border border-[#d86b6b]/30 bg-[#d86b6b]/10 px-3 py-2.5 text-sm text-[#d86b6b]" role="alert">{error}</p>}
    <button type="button" className="mx-auto mt-5 block border-0 bg-transparent p-0 text-xs font-semibold text-app-accent hover:underline" onClick={onBack}>Back to sign in</button>
  </form></IdentityLayout>;
}
