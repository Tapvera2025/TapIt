import { IdentityLayout } from '../components/IdentityLayout.js';
import { LoginForm } from '../components/LoginForm.js';
import type { DevPasswordReset, IdentityLoginResult } from '../api/authApi.js';

export function IdentityLoginPage({ onSuccess, onForgotPassword, devReset = null }: {
  onSuccess: (result: IdentityLoginResult) => void;
  onForgotPassword: (email: string) => void;
  /** Development only: a new admin password made on the "Forgot password" page. */
  devReset?: DevPasswordReset | null;
}) {
  return <IdentityLayout><LoginForm onSuccess={onSuccess} onForgotPassword={onForgotPassword} devReset={devReset} /></IdentityLayout>;
}
