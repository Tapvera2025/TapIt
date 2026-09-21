import { BrandLogo } from '../../ui/BrandLogo.js';
import { useState } from 'react';
import { identityLogin, IdentityApiError, type IdentityLoginResult, type GeolocationInput } from '../api/authApi.js';

export function LoginForm({ onSuccess, onForgotPassword }: { onSuccess: (result: IdentityLoginResult) => void; onForgotPassword: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [location, setLocation] = useState<GeolocationInput | undefined>();

  function requestLocation(): Promise<GeolocationInput> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('This browser does not support location access.')); return; }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMetres: Math.ceil(position.coords.accuracy) }),
        () => reject(new Error('Location permission is required for this account. Allow location access in your browser and try again.')),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      let result: IdentityLoginResult;
      try {
        result = await identityLogin(email, password, location);
      } catch (cause) {
        if (!(cause instanceof IdentityApiError) || cause.code !== 'IDENTITY_LOCATION_REQUIRED') throw cause;
        const currentLocation = await requestLocation();
        setLocation(currentLocation);
        result = await identityLogin(email, password, currentLocation);
      }
      onSuccess(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Company login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => { void submit(event); }} className="rounded-[22px] border border-app-border bg-app-surface/95 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.2)] backdrop-blur-md max-[560px]:p-6">
      <div className="mb-9 flex items-center gap-2.5 font-display text-[17px] font-bold tracking-[-0.03em]">
        <BrandLogo className="w-[200px]" />
      </div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-app-accent">Company workspace</p>
      <h1 className="font-display text-[clamp(30px,7vw,42px)] font-bold leading-none tracking-[-0.05em]">Welcome back.</h1>
      <p className="mt-3 text-sm leading-6 text-app-muted">Sign in with your company account to continue to your workspace.</p>
      <label className="mt-7 block">
        <span className="mb-2 block text-xs font-semibold text-app-muted">Email address</span>
        <input className="block w-full rounded-[10px] border border-app-border bg-app-background px-3.5 py-3 text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@company.com" required />
      </label>
      <label className="mt-4 block">
        <span className="mb-2 block text-xs font-semibold text-app-muted">Password</span>
        <span className="relative block">
          <input className="block w-full rounded-[10px] border border-app-border bg-app-background px-3.5 py-3 pr-12 text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" required />
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
      <button className="mt-6 block w-full rounded-[10px] bg-app-accent px-4 py-3 font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={busy}>
        {busy ? 'Signing in...' : 'Sign in to company workspace'}
      </button>
      <button type="button" className="mx-auto mt-4 block border-0 bg-transparent p-0 text-xs font-semibold text-app-accent hover:underline" onClick={onForgotPassword}>Forgot password?</button>
      {error && <p className="mt-4 rounded-lg border border-[#d86b6b]/30 bg-[#d86b6b]/10 px-3 py-2.5 text-sm text-app-danger" role="alert">{error}</p>}
      <p className="mt-6 text-center text-xs text-app-muted">Platform administrators sign in through the separate Master Admin portal.</p>
    </form>
  );
}
