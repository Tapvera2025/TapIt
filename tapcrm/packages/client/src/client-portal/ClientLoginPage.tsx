import { useState } from 'react';
import { IdentityLayout } from '../identity/components/IdentityLayout.js';
import { LoginForm, type LoginFormCopy } from '../identity/components/LoginForm.js';
import { identityLogout, type IdentityLoginResult } from '../identity/api/authApi.js';

const CLIENT_COPY: LoginFormCopy = {
  eyebrow: 'Client portal',
  description: 'Sign in to follow your projects, progress and updates.',
  submitLabel: 'Sign in to client portal',
  footnote: 'Need access? Ask your account manager to set up your login.',
  placeholder: 'you@yourbusiness.com',
};

/**
 * Same credential endpoint as the company login, but this page only admits
 * client accounts: anyone else is signed straight back out so an employee
 * session is never silently created through the client door.
 */
export function ClientLoginPage({ onSuccess, onForgotPassword }: {
  onSuccess: (result: IdentityLoginResult) => void;
  onForgotPassword: () => void;
}): React.JSX.Element {
  const [notice, setNotice] = useState('');

  function handleSuccess(result: IdentityLoginResult): void {
    if (result.user.accountType !== 'client') {
      void identityLogout();
      setNotice('This sign-in is for client accounts. Team members should use the company login at /login.');
      return;
    }
    onSuccess(result);
  }

  return (
    <IdentityLayout>
      <LoginForm copy={CLIENT_COPY} notice={notice} onSuccess={handleSuccess} onForgotPassword={onForgotPassword} />
    </IdentityLayout>
  );
}
