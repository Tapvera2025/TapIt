import { BrandLogo } from '../ui/BrandLogo.js';
import { useState } from 'react';

export function AcceptInvitation() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const success = message.startsWith('Account created');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch('/api/identity/invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, fullName, password }),
      });
      const b = (await r.json()) as { message?: string };
      if (!r.ok) throw new Error(b.message ?? 'Invitation failed');
      setMessage('Account created. You can now sign in to the company CRM.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Invitation failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_15%_20%,rgba(244,139,60,0.12),transparent_28rem)] bg-app-background px-4 py-8 font-sans text-app-foreground">
      <section className="grid min-h-[570px] w-full max-w-[910px] overflow-hidden rounded-[20px] border border-app-border bg-app-surface shadow-2xl min-[701px]:grid-cols-[minmax(280px,0.86fr)_minmax(360px,1.14fr)] max-[700px]:min-h-0">
        <aside className="flex flex-col bg-[linear-gradient(150deg,#1c2730,#101820_66%,#34271e)] px-[25px] py-[25px] min-[701px]:p-[34px] min-[701px]:min-h-0 max-[700px]:min-h-[255px]">
          <div className="flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[-0.03em] text-[#edf4f4]">
            <BrandLogo className="w-[200px]" />
          </div>
          <div className="my-auto max-[700px]:mt-[42px] max-[700px]:mb-0">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">Company workspace</p>
            <h1 className="font-display text-[clamp(31px,4vw,44px)] font-bold leading-[1.05] tracking-[-0.05em]">You&apos;re invited<br />to lead the way.</h1>
            <p className="mt-[18px] max-w-[260px] text-sm leading-[1.6] text-[#a5b8bc] max-[700px]:hidden">Set up your administrator account and get started with your company CRM.</p>
          </div>
          <div className="grid gap-3 text-xs text-[#71898f] max-[700px]:hidden">
            <span className="flex items-center gap-2.5 text-[#edf4f4]"><b className="text-[10px] text-app-accent">01</b> Create your profile</span>
            <span className="flex items-center gap-2.5"><b className="text-[10px]">02</b> Enter your workspace</span>
          </div>
        </aside>
        <div className="self-center px-[25px] py-[34px] min-[701px]:px-[clamp(30px,6vw,78px)] min-[701px]:py-[58px]">
          {success ? (
            <div className="max-w-[390px]">
              <span className="mb-[25px] grid size-[52px] place-items-center rounded-2xl bg-app-accent text-[28px] font-bold text-app-on-accent">✓</span>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">You&apos;re all set</p>
              <h2 className="font-display text-[37px] font-bold tracking-[-0.05em]">Account created.</h2>
              <p className="mt-3 text-sm leading-[1.6] text-app-muted">You can now sign in to your company CRM with your new administrator account.</p>
              <a className="mt-[27px] block w-full rounded-[9px] bg-app-accent px-4 py-[13px] text-center font-bold text-app-on-accent no-underline transition hover:-translate-y-px hover:brightness-110" href="/">Go to sign in</a>
            </div>
          ) : (
            <>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-app-accent">Admin invitation</p>
              <h2 className="font-display text-[clamp(28px,4vw,37px)] font-bold tracking-[-0.05em]">Complete your account</h2>
              <p className="mb-8 mt-3 text-sm leading-[1.55] text-app-muted">Enter your details below to activate your company administrator access.</p>
              {!token && <p className="mt-[18px] text-[13px] leading-[1.5] text-app-danger">This invitation link is missing its access token.</p>}
              <form onSubmit={(e) => { void submit(e); }}>
                <label className="mt-[19px] block">
                  <span className="mb-2 block text-xs font-semibold text-app-muted">Full name</span>
                  <input className="block w-full rounded-[9px] border border-app-border bg-app-background px-3.5 py-[13px] text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" placeholder="Your full name" />
                </label>
                <label className="mt-[19px] block">
                  <span className="mb-2 block text-xs font-semibold text-app-muted">Create password</span>
                  <span className="relative block">
                    <input className="block w-full rounded-[9px] border border-app-border bg-app-background px-3.5 py-[13px] pr-12 text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20" type={showPassword ? 'text' : 'password'} minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" placeholder="At least 12 characters" />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 grid size-[34px] -translate-y-1/2 place-items-center rounded-[7px] border-0 bg-transparent p-0 text-app-muted transition hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-1"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      <svg className="size-[18px] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        {showPassword ? (
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
                <p className="mt-3 flex items-center gap-[7px] text-[11px] text-app-muted"><span className="grid size-4 place-items-center rounded-full border border-app-accent text-[10px] text-app-accent">i</span> Use at least 12 characters for a secure password.</p>
                <button className="mt-[27px] block w-full rounded-[9px] bg-app-accent px-4 py-[13px] font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55" type="submit" disabled={busy || !token}>
                  {busy ? 'Creating account…' : 'Create Admin Account'}
                </button>
              </form>
              {message && <p className="mt-[18px] text-[13px] leading-[1.5] text-app-danger" aria-live="polite">{message}</p>}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
