import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import api from './lib/api';

import AppLayout, { type User } from './components/layout/AppLayout';

import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';

import DashboardPage from './pages/dashboard/DashboardPage';

import OrgOverviewPage from './pages/organization/OrgOverviewPage';
import DepartmentsPage from './pages/organization/DepartmentsPage';
import TeamsPage from './pages/organization/TeamsPage';
import PositionsPage from './pages/organization/PositionsPage';
import DesignationsPage from './pages/organization/DesignationsPage';

import UsersDirectoryPage from './pages/users/UsersDirectoryPage';
import AccessManagementPage from './pages/access-management/AccessManagementPage';
import IdentitySettingsPage from './pages/identity/IdentitySettingsPage';
import RolesPermissionsPage from './pages/roles/RolesPermissionsPage';
import CustomersPage from './pages/customers/CustomersPage';
import DealsPage from './pages/deals/DealsPage';
import TasksPage from './pages/tasks/TasksPage';
import AuditLogsPage from './pages/audit/AuditLogsPage';

interface MeResponse {
  success: boolean;
  data: {
    user: User;
  };
}

function LoadingScreen() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-app)',
        color: 'var(--text-primary)',
        gap: '16px',
      }}
    >
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: 'var(--radius-lg)',
          background:
            'linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '24px',
          fontWeight: 800,
          boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)',
        }}
      >
        T
      </div>

      <div className="spinner" />

      <span
        style={{
          fontSize: '13.5px',
          color: 'var(--text-muted)',
        }}
      >
        Initializing TapCRM Workspace...
      </span>
    </div>
  );
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  /*
   * Authentication bootstrap.
   *
   * The login page does not need /auth/me to render.
   * This prevents a dead API from making the entire frontend appear frozen.
   */
  const checkAuth = useCallback(async (): Promise<User | null> => {
    try {
      const response = await api.get<MeResponse>('/auth/me');

      const authenticatedUser = response.data?.data?.user ?? null;

      setUser(authenticatedUser);

      return authenticatedUser;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  /*
   * Initial application bootstrap.
   *
   * If the user is already on /login, render the login page immediately.
   * LoginPage itself will authenticate through /auth/login.
   */
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (location.pathname === '/login' || location.pathname === '/signup') {
        if (!cancelled) {
          setLoading(false);
        }
        return;
      }

      setLoading(true);

      try {
        await checkAuth();
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [checkAuth, location.pathname]);

  const handleLoginSuccess = useCallback(async () => {
    const authenticatedUser = await checkAuth();

    if (authenticatedUser) {
      void navigate('/dashboard', {
        replace: true,
      });
    }
  }, [checkAuth, navigate]);

  const handleLogout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /*
       * Even if the API is unavailable, remove the local authenticated
       * application state and send the user to login.
       */
    } finally {
      setUser(null);

      void navigate('/login', {
        replace: true,
      });
    }
  }, [navigate]);

  if (loading) {
    return <LoadingScreen />;
  }

  /*
   * Public login route.
   *
   * It is deliberately rendered before protected-route handling so
   * the login screen never depends on a successful /auth/me request.
   */
  if (!user) {
    return (
      <Routes>
        <Route path="/signup" element={<SignupPage />} />

        <Route
          path="/login"
          element={
            <LoginPage
              onLoginSuccess={() => {
                void handleLoginSuccess();
              }}
            />
          }
        />

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  /*
   * Authenticated users should not remain on /login.
   */
  if (location.pathname === '/login' || location.pathname === '/signup') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AppLayout
      user={user}
      onLogout={() => {
        void handleLogout();
      }}
    >
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        <Route path="/dashboard" element={<DashboardPage user={user} />} />

        {/* ORGANIZATION */}

        <Route path="/org" element={<Navigate to="/org/overview" replace />} />

        <Route path="/org/overview" element={<OrgOverviewPage />} />

        <Route path="/org/departments" element={<DepartmentsPage />} />

        <Route path="/org/teams" element={<TeamsPage />} />

        <Route path="/org/positions" element={<PositionsPage />} />

        <Route path="/org/designations" element={<DesignationsPage />} />

        {/* WORKSPACE */}

        <Route path="/users" element={<UsersDirectoryPage />} />

        <Route path="/customers" element={<CustomersPage />} />

        <Route path="/deals" element={<DealsPage />} />

        <Route path="/tasks" element={<TasksPage />} />

        {/* ADMINISTRATION */}

        <Route path="/roles" element={<RolesPermissionsPage />} />

        <Route path="/access-management" element={<AccessManagementPage />} />

        <Route path="/access" element={<Navigate to="/access-management" replace />} />

        <Route path="/security" element={<IdentitySettingsPage />} />

        <Route path="/audit-logs" element={<AuditLogsPage />} />

        {/* FALLBACK */}

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppLayout>
  );
}

export default App;
