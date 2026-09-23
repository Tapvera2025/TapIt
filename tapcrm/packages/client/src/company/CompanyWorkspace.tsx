import { useEffect, useState } from 'react';
import { getCompanyIdentity, type CompanyIdentity } from './api/companyApi.js';
import { CompanyLayout } from './layout/CompanyLayout.js';
import { DashboardPage } from './dashboard/DashboardPage.js';
import { EmployeesPage } from './employees/EmployeesPage.js';
import { SessionsPage } from '../identity/pages/SessionsPage.js';
import { GeofencingPage } from '../identity/pages/GeofencingPage.js';
import { OrganizationWorkspace } from '../organization/index.js';
import { TasksPage } from './tasks/index.js';

export function CompanyWorkspace({
  pathname,
  onNavigate,
  onLogout,
}: {
  pathname: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}): React.JSX.Element {
  const [identity, setIdentity] = useState<CompanyIdentity | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void getCompanyIdentity()
      .then(setIdentity)
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : 'Unable to load company workspace.',
        ),
      );
  }, []);
  if (error)
    return (
      <div className="grid min-h-screen place-items-center bg-app-background p-6 text-center text-app-foreground">
        <div>
          <p className="text-app-danger">{error}</p>
          <button
            type="button"
            onClick={onLogout}
            className="mt-4 rounded-lg bg-app-accent px-4 py-2.5 text-sm font-bold text-app-on-accent"
          >
            Return to login
          </button>
        </div>
      </div>
    );
  if (!identity)
    return (
      <div className="grid min-h-screen place-items-center bg-app-background text-sm text-app-muted">
        Loading company workspace...
      </div>
    );
  const isSuperAdmin = identity.user.accountType === 'super-admin';
  const isOrganization =
    isSuperAdmin &&
    (pathname === '/company/organization' ||
      pathname.startsWith('/company/organization/'));
  const title = isOrganization
    ? 'Organization'
    : pathname === '/company/employees'
      ? 'Employees'
      : pathname === '/company/sessions'
        ? 'Sessions & Devices'
        : pathname === '/company/geofencing'
          ? 'Geofencing'
          : pathname === '/company/tasks'
            ? 'Tasks'
            : 'Dashboard';
  const content = isOrganization ? (
    <OrganizationWorkspace pathname={pathname} />
  ) : pathname === '/company/sessions' ? (
    <SessionsPage
      onBack={() => onNavigate('/company/dashboard')}
      onSignedOut={onLogout}
    />
  ) : pathname === '/company/tasks' ? (
    <TasksPage isSuperAdmin={isSuperAdmin} currentUserId={identity.user.id} />
  ) : !isSuperAdmin ? (
    <div className="grid min-h-[60vh] place-items-center p-6 text-center">
      <div>
        <h1 className="font-display text-2xl font-bold">
          Employee workspace is coming soon
        </h1>
        <p className="mt-2 text-sm text-app-muted">
          Your account can still review its active Sessions &amp; Devices.
        </p>
      </div>
    </div>
  ) : pathname === '/company/employees' ? (
    <EmployeesPage />
  ) : pathname === '/company/geofencing' ? (
    <GeofencingPage onBack={() => onNavigate('/company/dashboard')} />
  ) : (
    <DashboardPage identity={identity} onNavigate={onNavigate} />
  );
  return (
    <CompanyLayout
      pathname={pathname}
      identity={identity.user}
      organizationName={identity.organization?.name ?? null}
      accountType={identity.user.accountType}
      title={title}
      onNavigate={onNavigate}
      onLogout={onLogout}
    >
      {content}
    </CompanyLayout>
  );
}
