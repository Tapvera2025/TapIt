import { useEffect, useState } from 'react';
import { PlatformDashboard, PlatformLogin } from './platform/screen.js';
import { AcceptInvitation } from './platform/accept.js';
import { AUTH_EXPIRED_EVENT, getAccessToken } from './platform/api.js';
import {
  ForgotPasswordPage,
  IdentityLoginPage,
  PasswordChangePage,
  ResetPasswordPage,
  clearIdentityTokens,
  getIdentityAccessToken,
  identityLogout,
} from './identity/index.js';
import { IDENTITY_EXPIRED_EVENT } from './identity/api/authApi.js';
import { CompanyWorkspace } from './company/CompanyWorkspace.js';
import type { IdentityLoginResult } from './identity/api/authApi.js';

export function App(): React.JSX.Element {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [authenticated, setAuthenticated] = useState(Boolean(getAccessToken()));
  const [companyAuthenticated, setCompanyAuthenticated] = useState(
    Boolean(getIdentityAccessToken()),
  );
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);

  function navigate(nextPath: string): void {
    window.history.pushState({}, '', nextPath);
    setPathname(nextPath);
  }

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const handleIdentityExpired = () => {
      setCompanyAuthenticated(false);
      setPasswordChangeRequired(false);
    };
    window.addEventListener(IDENTITY_EXPIRED_EVENT, handleIdentityExpired);
    return () =>
      window.removeEventListener(IDENTITY_EXPIRED_EVENT, handleIdentityExpired);
  }, []);

  function handleIdentityLogin(result: IdentityLoginResult) {
    setCompanyAuthenticated(true);
    setPasswordChangeRequired(result.passwordChangeRequired);
    navigate(
      result.passwordChangeRequired ? '/company/password-change' : '/company/dashboard',
    );
  }

  function openCompanyLogin() {
    navigate('/login');
  }

  useEffect(() => {
    const handleAuthExpired = () => setAuthenticated(false);
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  if (pathname === '/accept-invitation') return <AcceptInvitation />;
  if (pathname.startsWith('/platform'))
    return authenticated ? (
      <PlatformDashboard onLogout={() => setAuthenticated(false)} />
    ) : (
      <PlatformLogin onLogin={() => setAuthenticated(true)} />
    );
  if (pathname === '/login') {
    return companyAuthenticated ? (
      <main className="grid min-h-screen place-items-center bg-app-background p-6 text-app-foreground">
        <p className="text-sm text-app-muted">Redirecting to the company dashboard...</p>
      </main>
    ) : (
      <IdentityLoginPage
        onSuccess={handleIdentityLogin}
        onForgotPassword={() => navigate('/forgot-password')}
      />
    );
  }
  if (pathname === '/forgot-password')
    return <ForgotPasswordPage onBack={openCompanyLogin} />;
  if (pathname === '/reset-password') {
    const params = new URLSearchParams(window.location.search);
    return (
      <ResetPasswordPage
        token={params.get('token') ?? ''}
        organizationCode={params.get('org') ?? ''}
        onComplete={openCompanyLogin}
      />
    );
  }
  if (pathname === '/company/password-change') {
    if (!companyAuthenticated || !passwordChangeRequired) {
      window.history.replaceState({}, '', '/login');
      return (
        <IdentityLoginPage
          onSuccess={handleIdentityLogin}
          onForgotPassword={() => navigate('/forgot-password')}
        />
      );
    }
    return (
      <PasswordChangePage
        onComplete={() => {
          clearIdentityTokens();
          setCompanyAuthenticated(false);
          setPasswordChangeRequired(false);
          navigate('/login');
        }}
      />
    );
  }
  if (pathname === '/company/dashboard') {
    if (!companyAuthenticated) {
      window.history.replaceState({}, '', '/login');
      return (
        <IdentityLoginPage
          onSuccess={handleIdentityLogin}
          onForgotPassword={() => navigate('/forgot-password')}
        />
      );
    }
    return (
      <CompanyWorkspace
        pathname={pathname}
        onNavigate={navigate}
        onLogout={() => {
          void identityLogout().finally(() => {
            setCompanyAuthenticated(false);
            setPasswordChangeRequired(false);
            navigate('/login');
          });
        }}
      />
    );
  }
  if (pathname === '/organization' || pathname.startsWith('/organization/')) {
    if (!companyAuthenticated) {
      window.history.replaceState({}, '', '/login');
      return (
        <IdentityLoginPage
          onSuccess={handleIdentityLogin}
          onForgotPassword={() => navigate('/forgot-password')}
        />
      );
    }
    window.history.replaceState({}, '', `/company${pathname}`);
    return (
      <CompanyWorkspace
        pathname={`/company${pathname}`}
        onNavigate={navigate}
        onLogout={() => {
          void identityLogout().finally(() => {
            setCompanyAuthenticated(false);
            setPasswordChangeRequired(false);
            navigate('/login');
          });
        }}
      />
    );
  }
  if (pathname.startsWith('/company/')) {
    if (!companyAuthenticated) {
      window.history.replaceState({}, '', '/login');
      return (
        <IdentityLoginPage
          onSuccess={handleIdentityLogin}
          onForgotPassword={() => navigate('/forgot-password')}
        />
      );
    }
    return (
      <CompanyWorkspace
        pathname={pathname}
        onNavigate={navigate}
        onLogout={() => {
          void identityLogout().finally(() => {
            setCompanyAuthenticated(false);
            setPasswordChangeRequired(false);
            navigate('/login');
          });
        }}
      />
    );
  }
  return (
    <main style={{ fontFamily: 'system-ui', padding: 32 }}>
      <h1>TapCRM</h1>
      <p>
        Open <a href="/platform/login">/platform/login</a> for Master Admin.
      </p>
    </main>
  );
}
