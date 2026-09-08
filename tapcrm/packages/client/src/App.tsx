import { useEffect, useState } from 'react';
import { PlatformDashboard, PlatformLogin } from './platform/screen.js';
import { AcceptInvitation } from './platform/accept.js';
import { AUTH_EXPIRED_EVENT, getAccessToken } from './platform/api.js';
import { IdentityLoginPage, getIdentityAccessToken, identityLogout } from './identity/index.js';

export function App(): React.JSX.Element {
  const [authenticated, setAuthenticated] = useState(Boolean(getAccessToken()));
  const [companyAuthenticated, setCompanyAuthenticated] = useState(Boolean(getIdentityAccessToken()));

  useEffect(() => {
    const handleAuthExpired = () => setAuthenticated(false);
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  if (window.location.pathname === '/accept-invitation') return <AcceptInvitation />;
  if (window.location.pathname.startsWith('/platform'))
    return authenticated ? (
      <PlatformDashboard onLogout={() => setAuthenticated(false)} />
    ) : (
      <PlatformLogin onLogin={() => setAuthenticated(true)} />
    );
  if (window.location.pathname === '/login') {
    return companyAuthenticated ? (
      <main className="grid min-h-screen place-items-center bg-app-background p-6 text-app-foreground">
        <p className="text-sm text-app-muted">Redirecting to the company dashboard...</p>
      </main>
    ) : (
      <IdentityLoginPage onSuccess={() => {
        setCompanyAuthenticated(true);
        window.history.pushState({}, '', '/company/dashboard');
      }} />
    );
  }
  if (window.location.pathname === '/company/dashboard') {
    if (!companyAuthenticated) {
      window.history.replaceState({}, '', '/login');
      return <IdentityLoginPage onSuccess={() => {
        setCompanyAuthenticated(true);
        window.history.pushState({}, '', '/company/dashboard');
      }} />;
    }
    return (
      <main className="grid min-h-screen place-items-center gap-4 bg-app-background p-6 text-app-foreground">
        <p className="text-sm text-app-muted">Company Super Admin dashboard route ready.</p>
        <button
          type="button"
          className="rounded-[9px] bg-app-accent px-4 py-2.5 font-bold text-[#061412] transition hover:-translate-y-px hover:brightness-110"
          onClick={() => {
            void identityLogout().finally(() => {
              setCompanyAuthenticated(false);
              window.history.pushState({}, '', '/login');
            });
          }}
        >
          Log out
        </button>
      </main>
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
