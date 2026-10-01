import { BrandLogo } from './ui/BrandLogo.js';
import { useEffect, useState } from 'react';
import { APP_NAVIGATE_EVENT } from './navigationEvent.js';
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
import { PublicApplicationPage } from './company/recruitment/pages/PublicApplicationPage.js';
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
    // `pathname` always mirrors `window.location.pathname` (query-free, per its
    // initial value above) — a caller linking to e.g. "/company/messages?x=1"
    // (a notification deep link) must still match the exact-string routing
    // checks throughout CompanyWorkspace; the destination page reads the query
    // itself via `window.location.search`.
    setPathname(nextPath.split('?')[0]!);
    // Also fires when the path is unchanged (e.g. a second deep link while
    // already on that page) — setPathname alone would be a no-op then, and a
    // page relying only on a mount effect would never see the new query.
    window.dispatchEvent(new CustomEvent(APP_NAVIGATE_EVENT, { detail: nextPath }));
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

  if (pathname.startsWith('/apply/')) {
    const token = pathname.replace(/^\/apply\/?/, '');
    return <PublicApplicationPage token={token} />;
  }
  if (pathname === '/accept-invitation') return <AcceptInvitation />;
  if (pathname.startsWith('/platform'))
    return authenticated ? (
      <PlatformDashboard onLogout={() => setAuthenticated(false)} />
    ) : (
      <PlatformLogin onLogin={() => setAuthenticated(true)} />
    );
  if (pathname === '/login') {
    if (companyAuthenticated) {
      window.history.replaceState({}, '', '/company/dashboard');
      return (
        <CompanyWorkspace
          pathname="/company/dashboard"
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
      <h1><BrandLogo className="mb-6 w-[240px]" /></h1>
      <p>
        Open <a href="/platform/login">/platform/login</a> for Master Admin.
      </p>
    </main>
  );
}
