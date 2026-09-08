import { IdentityLayout } from '../components/IdentityLayout.js';
import { LoginForm } from '../components/LoginForm.js';
import type { IdentityUser } from '../api/authApi.js';

export function IdentityLoginPage({ onSuccess }: { onSuccess: (user: IdentityUser) => void }) {
  return <IdentityLayout><LoginForm onSuccess={onSuccess} /></IdentityLayout>;
}
