import { IdentityLayout } from '../components/IdentityLayout.js';
import { LoginForm } from '../components/LoginForm.js';
import type { IdentityLoginResult } from '../api/authApi.js';

export function IdentityLoginPage({ onSuccess, onForgotPassword }: { onSuccess: (result: IdentityLoginResult) => void; onForgotPassword: () => void }) {
  return <IdentityLayout><LoginForm onSuccess={onSuccess} onForgotPassword={onForgotPassword} /></IdentityLayout>;
}
