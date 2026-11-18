import { BrandLogo } from '../../ui/index.js';
import { ThemeToggle } from '../../theme/ThemeToggle.js';
import { useRef, useState } from 'react';
import {
  devInstantPasswordReset,
  identityLogin,
  IdentityApiError,
  type DevPasswordReset,
  type IdentityLoginResult,
  type GeolocationInput,
} from '../api/authApi.js';
import { DevPasswordNotice } from './DevPasswordNotice.js';
import { ErrorToast } from '../../ui/ErrorToast.js';

export interface LoginFormCopy {
  eyebrow: string;
  description: string;
  submitLabel: string;
  footnote: string;
  placeholder: string;
}

const COMPANY_COPY: LoginFormCopy = {
  eyebrow: 'Company workspace',
  description: 'Sign in with your company account to continue to your workspace.',
  submitLabel: 'Sign in to company workspace',
  footnote: 'Platform administrators sign in through the separate Master Admin portal.',
  placeholder: 'admin@company.com',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm({
  onSuccess,
  onForgotPassword,
  devReset: givenDevReset = null,
  copy = COMPANY_COPY,
  notice,
  variant = 'default',
}: {
  onSuccess: (result: IdentityLoginResult) => void | Promise<void>;
  /** Opens the emailed-link page, carrying over the address typed here. */
  onForgotPassword: (email: string) => void;
  /** Development only: a new admin password made on the "Forgot password" page. */
  devReset?: DevPasswordReset | null;
  copy?: LoginFormCopy;
  /** Extra message shown with sign-in errors (e.g. a rejected account type). */
  notice?: string;
  variant?: 'default' | 'workspace';
}) {
  const workspace = variant === 'workspace';
  const submitting = useRef(false);
  const [email, setEmail] = useState(givenDevReset?.email ?? '');
  const [password, setPassword] = useState(givenDevReset?.password ?? '');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [devReset, setDevReset] = useState<DevPasswordReset | null>(givenDevReset);
  const [resetting, setResetting] = useState(false);
  const [location, setLocation] = useState<GeolocationInput | undefined>();
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>(
    {},
  );

  function authenticationMessage(cause: unknown) {
    if (!(cause instanceof IdentityApiError))
      return cause instanceof Error ? cause.message : 'Company login failed';
    switch (cause.code) {
      case 'IDENTITY_INVALID_CREDENTIALS':
        return 'Email or password is incorrect.';
      case 'IDENTITY_ACCOUNT_LOCKED':
        return 'Your account is temporarily locked. Please try again later.';
      case 'IDENTITY_ORGANIZATION_SUSPENDED':
        return 'This company workspace is currently suspended.';
      case 'IDENTITY_LOCATION_REQUIRED':
        return 'Location access is required to sign in. Please allow browser location access and try again.';
      default:
        return cause.message;
    }
  }

  function requestLocation(): Promise<GeolocationInput> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('This browser does not support location access.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMetres: Math.ceil(position.coords.accuracy),
          }),
        () =>
          reject(
            new Error(
              'Location permission is required for this account. Allow location access in your browser and try again.',
            ),
          ),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const nextErrors: { email?: string; password?: string } = {};
    if (!email.trim()) nextErrors.email = 'Email is required.';
    else if (!EMAIL_PATTERN.test(email.trim()))
      nextErrors.email = 'Enter a valid email address.';
    if (!password) nextErrors.password = 'Password is required.';
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      let result: IdentityLoginResult;
      try {
        result = await identityLogin(email, password, location);
      } catch (cause) {
        if (
          !(cause instanceof IdentityApiError) ||
          cause.code !== 'IDENTITY_LOCATION_REQUIRED'
        )
          throw cause;
        const currentLocation = await requestLocation();
        setLocation(currentLocation);
        result = await identityLogin(email, password, currentLocation);
      }
      await onSuccess(result);
    } catch (cause) {
      setError(authenticationMessage(cause));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  /**
   * In development, with DEV_INSTANT_PASSWORD_RESET on in the API, a company
   * admin who typed their email gets a new password right here. Everyone else
   * (and every production build) goes to the emailed-link page.
   */
  async function forgotPassword() {
    const typed = email.trim();
    if (!import.meta.env.DEV || !EMAIL_PATTERN.test(typed)) {
      onForgotPassword(typed);
      return;
    }
    setResetting(true);
    setError('');
    try {
      const reset = await devInstantPasswordReset(typed);
      if (!reset) {
        onForgotPassword(typed);
        return;
      }
      setDevReset(reset);
      setEmail(reset.email);
      setPassword(reset.password);
      setFieldErrors({});
    } catch (cause) {
      if (
        cause instanceof IdentityApiError &&
        cause.code === 'IDENTITY_DEV_RESET_ADMIN_ONLY'
      ) {
        onForgotPassword(typed);
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Could not make a new password.');
    } finally {
      setResetting(false);
    }
  }

  const recoveryButton = (
    <button
      type="button"
      className="login-forgot mx-auto mt-4 block border-0 bg-transparent p-0 text-xs font-semibold text-app-accent hover:underline disabled:cursor-wait disabled:opacity-60 disabled:no-underline"
      onClick={() => {
        void forgotPassword();
      }}
      disabled={resetting || busy}
    >
      {resetting ? 'Making a new password...' : 'Forgot password?'}
    </button>
  );

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      noValidate={workspace}
      aria-busy={busy}
      className={`${workspace ? 'workspace-login-card' : ''} relative rounded-[22px] border border-app-border bg-app-surface p-8 shadow-[0_24px_80px_rgba(0,0,0,0.14)] max-[560px]:p-6`}
    >
      <ThemeToggle
        compact
        className="login-theme-toggle absolute right-5 top-5 max-[560px]:right-4 max-[560px]:top-4"
      />
      <div className="login-brand mb-9 flex items-center gap-2.5 pr-12 font-display text-[17px] font-bold tracking-[-0.03em]">
        <BrandLogo className="w-[200px]" />
      </div>
      {!workspace && (
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-app-accent">
          {copy.eyebrow}
        </p>
      )}
      <h1 className="font-display text-[clamp(30px,7vw,42px)] font-bold leading-none tracking-[-0.05em]">
        {workspace ? 'Welcome Back' : 'Welcome back.'}
      </h1>
      <p className="login-description mt-3 text-sm leading-6 text-app-muted">
        {workspace
          ? 'Access your company workspace and continue managing your operations.'
          : copy.description}
      </p>
      {devReset && <DevPasswordNotice reset={devReset} />}
      <label className="login-email mt-7 block">
        <span className="mb-2 block text-xs font-semibold text-app-muted">
          Email address
        </span>
        <span className="login-input-wrap relative block">
          {workspace && (
            <svg
              className="login-field-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 5h18v14H3z m0 0 9 7 9-7" />
            </svg>
          )}
          <input
            className="block w-full rounded-[10px] border border-app-border bg-app-background px-3.5 py-3 text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setFieldErrors((current) => {
                const next = { ...current };
                delete next.email;
                return next;
              });
            }}
            placeholder={copy.placeholder}
            aria-invalid={Boolean(fieldErrors.email)}
          />
        </span>
        {fieldErrors.email && (
          <span className="mt-1 block text-xs text-app-danger" role="alert">
            {fieldErrors.email}
          </span>
        )}
      </label>
      <label className="login-password mt-4 block">
        <span className="mb-2 block text-xs font-semibold text-app-muted">Password</span>
        <span className="login-input-wrap relative block">
          {workspace && (
            <svg
              className="login-field-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3" />
            </svg>
          )}
          <input
            className="block w-full rounded-[10px] border border-app-border bg-app-background px-3.5 py-3 pr-12 text-app-foreground outline-none placeholder:text-app-muted focus:border-app-accent focus:ring-[3px] focus:ring-app-accent/20"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setFieldErrors((current) => {
                const next = { ...current };
                delete next.password;
                return next;
              });
            }}
            placeholder="Your password"
            aria-invalid={Boolean(fieldErrors.password)}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 grid size-[34px] -translate-y-1/2 place-items-center rounded-[7px] border-0 bg-transparent p-0 text-app-muted transition hover:bg-app-accent/10 hover:text-app-accent focus-visible:outline-2 focus-visible:outline-app-accent focus-visible:outline-offset-1"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
          >
            <svg
              className="size-[18px] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
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
        {fieldErrors.password && (
          <span className="mt-1 block text-xs text-app-danger" role="alert">
            {fieldErrors.password}
          </span>
        )}
      </label>
      {workspace && recoveryButton}
      <button
        className="login-submit mt-6 block w-full rounded-[10px] bg-app-accent px-4 py-3 font-bold text-app-on-accent transition hover:-translate-y-px hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        type="submit"
        disabled={busy}
      >
        {busy ? (
          <>
            <span className="login-spinner" aria-hidden="true" />
            Signing in...
          </>
        ) : (
          <>
            {workspace ? 'Sign In' : copy.submitLabel}
            {workspace && (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 12h16m-6-6 6 6-6 6" />
              </svg>
            )}
          </>
        )}
      </button>
      {!workspace && recoveryButton}
      {(error || notice) && <ErrorToast message={error || notice} />}
      {!workspace && (
        <p className="mt-6 text-center text-xs text-app-muted">{copy.footnote}</p>
      )}
    </form>
  );
}
