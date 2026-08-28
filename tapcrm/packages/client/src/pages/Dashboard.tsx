import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import Organizations from './Organizations';
import './Dashboard.css';

interface User {
  id: string;
  organizationId: string;
  accountType: string;
  email: string;
  fullName: string;
  status: string;
}

interface MeResponse {
  success: boolean;
  data: {
    user: User;
  };
  meta: {
    requestId: string;
  };
}

interface ApiErrorResponse {
  success?: boolean;
  code?: string;
  message?: string;
  error?: string;
}

interface NavItem {
  label: string;
  icon: React.ReactNode;
  key: string;
}

export default function Dashboard() {
  const navigate = useNavigate();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('tapcrm-theme') === 'dark';
  });

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  /*
   * IMPORTANT
   *
   * This controls which content is shown inside the same dashboard layout.
   *
   * dashboard       -> Dashboard view
   * organizations   -> Organization view
   */
  const [activeMenu, setActiveMenu] = useState('dashboard');

  const [loggingOut, setLoggingOut] = useState(false);

  /* ============================================================
     LOAD AUTHENTICATED USER
  ============================================================ */

  useEffect(() => {
    let mounted = true;

    const loadCurrentUser = async (): Promise<void> => {
      try {
        setLoading(true);
        setError('');

        const response = await api.get<MeResponse>('/auth/me');

        console.log('ME RESPONSE:', response.data);

        if (!mounted) {
          return;
        }

        setUser(response.data.data.user);
      } catch (error: unknown) {
        if (!mounted) {
          return;
        }

        const apiError = getApiError(error);

        console.error('ME ERROR:', apiError);

        if (apiError.status === 401) {
          void navigate('/login', {
            replace: true,
          });

          return;
        }

        setError(apiError.message ?? 'Unable to load your account.');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadCurrentUser();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  /* ============================================================
     THEME
  ============================================================ */

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');

    localStorage.setItem('tapcrm-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  /* ============================================================
     LOGOUT
  ============================================================ */

  const handleLogout = async (): Promise<void> => {
    try {
      setLoggingOut(true);

      await api.post('/auth/logout');

      void navigate('/login', {
        replace: true,
      });
    } catch (error: unknown) {
      console.error('LOGOUT ERROR:', getApiError(error));

      /*
       * Even if backend logout fails,
       * don't leave the user stuck on dashboard.
       */

      void navigate('/login', {
        replace: true,
      });
    } finally {
      setLoggingOut(false);
    }
  };

  /* ============================================================
     SIDEBAR NAVIGATION
  ============================================================ */

  const workspaceItems: NavItem[] = [
    {
      key: 'dashboard',
      label: 'Dashboard',
      icon: <DashboardIcon />,
    },
    {
      key: 'organizations',
      label: 'Organizations',
      icon: <OrganizationIcon />,
    },
    {
      key: 'users',
      label: 'Users',
      icon: <UsersIcon />,
    },
    {
      key: 'customers',
      label: 'Customers',
      icon: <CustomerIcon />,
    },
    {
      key: 'contacts',
      label: 'Contacts',
      icon: <ContactIcon />,
    },
    {
      key: 'deals',
      label: 'Deals',
      icon: <DealsIcon />,
    },
    {
      key: 'tasks',
      label: 'Tasks',
      icon: <TaskIcon />,
    },
  ];

  const administrationItems: NavItem[] = [
    {
      key: 'roles',
      label: 'Roles & Permissions',
      icon: <RolesIcon />,
    },
    {
      key: 'teams',
      label: 'Teams',
      icon: <TeamIcon />,
    },
    {
      key: 'audit-logs',
      label: 'Audit Logs',
      icon: <AuditIcon />,
    },
    {
      key: 'activity',
      label: 'Activity',
      icon: <ActivityIcon />,
    },
  ];

  const systemItems: NavItem[] = [
    {
      key: 'reports',
      label: 'Reports',
      icon: <ReportIcon />,
    },
    {
      key: 'changes',
      label: 'Changes',
      icon: <ChangesIcon />,
    },
    {
      key: 'integrations',
      label: 'Integrations',
      icon: <IntegrationIcon />,
    },
    {
      key: 'settings',
      label: 'Settings',
      icon: <SettingsIcon />,
    },
  ];

  /* ============================================================
     MENU CLICK
  ============================================================ */

  const handleMenuClick = (key: string): void => {
    setActiveMenu(key);
    setMobileSidebarOpen(false);

    /*
     * IMPORTANT:
     *
     * Do NOT navigate to /organizations.
     *
     * We stay on the same Dashboard page and simply
     * change the content displayed in the main area.
     */
  };

  /* ============================================================
     LOADING
  ============================================================ */

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="loading-brand">
          <div className="loading-logo">T</div>

          <div>
            <strong>TapCRM</strong>

            <span>Loading workspace...</span>
          </div>
        </div>

        <div className="loading-spinner" />
      </div>
    );
  }

  /* ============================================================
     ERROR
  ============================================================ */

  if (error) {
    return (
      <div className="dashboard-error">
        <div className="error-card">
          <div className="error-icon">!</div>

          <h2>Unable to load dashboard</h2>

          <p>{error}</p>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="primary-button"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  /* ============================================================
     DASHBOARD
  ============================================================ */

  return (
    <div className={`dashboard-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* ========================================================
          MOBILE OVERLAY
      ======================================================== */}

      {mobileSidebarOpen && (
        <div className="mobile-overlay" onClick={() => setMobileSidebarOpen(false)} />
      )}

      {/* ========================================================
          SIDEBAR
      ======================================================== */}

      <aside className={`sidebar ${mobileSidebarOpen ? 'mobile-open' : ''}`}>
        {/* LOGO */}

        <div className="sidebar-brand">
          <div className="sidebar-logo">T</div>

          {!sidebarCollapsed && (
            <div className="sidebar-brand-text">
              <strong>TapCRM</strong>

              <span>CRM PLATFORM</span>
            </div>
          )}

          <button
            className="mobile-close-button"
            onClick={() => setMobileSidebarOpen(false)}
            type="button"
            aria-label="Close sidebar"
          >
            ×
          </button>
        </div>

        {/* ORGANIZATION */}

        {!sidebarCollapsed && (
          <div className="organization-box">
            <div className="organization-avatar">T</div>

            <div className="organization-info">
              <strong>Tapvera</strong>

              <span>Organization</span>
            </div>

            <span className="organization-status" />
          </div>
        )}

        {/* NAVIGATION */}

        <nav className="sidebar-navigation">
          {/* WORKSPACE */}

          <div className="navigation-section">
            {!sidebarCollapsed && <span className="navigation-title">WORKSPACE</span>}

            {workspaceItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`navigation-item ${activeMenu === item.key ? 'active' : ''}`}
                onClick={() => handleMenuClick(item.key)}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <span className="navigation-icon">{item.icon}</span>

                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            ))}
          </div>

          {/* ADMINISTRATION */}

          <div className="navigation-section">
            {!sidebarCollapsed && (
              <span className="navigation-title">ADMINISTRATION</span>
            )}

            {administrationItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`navigation-item ${activeMenu === item.key ? 'active' : ''}`}
                onClick={() => handleMenuClick(item.key)}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <span className="navigation-icon">{item.icon}</span>

                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            ))}
          </div>

          {/* SYSTEM */}

          <div className="navigation-section">
            {!sidebarCollapsed && <span className="navigation-title">SYSTEM</span>}

            {systemItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`navigation-item ${activeMenu === item.key ? 'active' : ''}`}
                onClick={() => handleMenuClick(item.key)}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <span className="navigation-icon">{item.icon}</span>

                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            ))}
          </div>
        </nav>

        {/* SIDEBAR BOTTOM */}

        <div className="sidebar-bottom">
          {!sidebarCollapsed && (
            <div className="security-status">
              <div className="security-icon">
                <ShieldIcon />
              </div>

              <div>
                <strong>Secure session</strong>

                <span>Authentication active</span>
              </div>

              <span className="online-dot" />
            </div>
          )}

          <button
            className="logout-button"
            onClick={() => {
              void handleLogout();
            }}
            disabled={loggingOut}
            title={sidebarCollapsed ? 'Sign out' : undefined}
            type="button"
          >
            <LogoutIcon />

            {!sidebarCollapsed && (
              <span>{loggingOut ? 'Signing out...' : 'Sign out'}</span>
            )}
          </button>
        </div>
      </aside>

      {/* ========================================================
          MAIN AREA
      ======================================================== */}

      <div className="dashboard-main">
        {/* ======================================================
            TOPBAR
        ====================================================== */}

        <header className="topbar">
          <div className="topbar-left">
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed((current) => !current)}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              type="button"
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <MenuIcon />
            </button>

            <button
              className="mobile-menu-button"
              onClick={() => setMobileSidebarOpen(true)}
              type="button"
              aria-label="Open sidebar"
            >
              <MenuIcon />
            </button>

            <div className="breadcrumb">
              <span>Workspace</span>

              <ChevronRightIcon />

              <strong>{formatMenuName(activeMenu)}</strong>
            </div>
          </div>

          <div className="topbar-right">
            {/* THEME */}

            <button
              className="icon-button"
              onClick={() => setDarkMode((current) => !current)}
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              type="button"
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <SunIcon /> : <MoonIcon />}
            </button>

            {/* NOTIFICATIONS */}

            <button
              className="icon-button notification-button"
              title="Notifications"
              type="button"
              aria-label="Notifications"
            >
              <BellIcon />

              <span />
            </button>

            <div className="topbar-divider" />

            {/* USER */}

            <div className="topbar-user">
              <div className="user-avatar">{getInitials(user.fullName)}</div>

              <div className="topbar-user-info">
                <strong>{user.fullName}</strong>

                <span>{formatAccountType(user.accountType)}</span>
              </div>

              <ChevronDownIcon />
            </div>
          </div>
        </header>

        {/* ======================================================
            CONTENT
        ====================================================== */}

        <main className="dashboard-content">
          {/*
           * =====================================================
           * ORGANIZATION VIEW
           * =====================================================
           *
           * Sidebar and Topbar remain untouched.
           *
           * Only the content changes.
           */}

          {activeMenu === 'organizations' ? (
            <Organizations />
          ) : (
            <>
              {/* ==================================================
                  DASHBOARD WELCOME
              ================================================== */}

              <section className="welcome-section">
                <div>
                  <div className="welcome-label">
                    <span className="welcome-dot" />
                    Workspace overview
                  </div>

                  <h1>
                    Good morning, <span>{getFirstName(user.fullName)}</span>.
                  </h1>

                  <p>Here&apos;s what&apos;s happening across your organization today.</p>
                </div>

                <div className="date-card">
                  <CalendarIcon />

                  <div>
                    <span>Today</span>

                    <strong>
                      {new Intl.DateTimeFormat('en-US', {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric',
                      }).format(new Date())}
                    </strong>
                  </div>
                </div>
              </section>

              {/* ==================================================
                  STATS
              ================================================== */}

              <section className="stats-grid">
                <StatCard
                  title="Total Customers"
                  value="0"
                  change="Ready to add"
                  icon={<UsersIcon />}
                />

                <StatCard
                  title="Active Deals"
                  value="0"
                  change="No active deals"
                  icon={<DealsIcon />}
                />

                <StatCard
                  title="Open Tasks"
                  value="0"
                  change="Everything is clear"
                  icon={<TaskIcon />}
                />

                <StatCard
                  title="Team Members"
                  value="1"
                  change="1 active member"
                  icon={<TeamIcon />}
                />
              </section>

              {/* ==================================================
                  MAIN GRID
              ================================================== */}

              <section className="dashboard-grid">
                {/* QUICK ACTIONS */}

                <div className="dashboard-card quick-actions-card">
                  <div className="card-title-row">
                    <div>
                      <h2>Quick actions</h2>

                      <p>Common actions for your workspace.</p>
                    </div>

                    <div className="card-icon">
                      <ZapIcon />
                    </div>
                  </div>

                  <div className="quick-actions">
                    <QuickAction
                      icon={<UserPlusIcon />}
                      title="Add customer"
                      description="Create a new customer"
                    />

                    <QuickAction
                      icon={<PlusIcon />}
                      title="Create deal"
                      description="Start a new opportunity"
                    />

                    <QuickAction
                      icon={<TaskIcon />}
                      title="Add task"
                      description="Create a task"
                    />

                    <QuickAction
                      icon={<ReportIcon />}
                      title="View reports"
                      description="Analyze performance"
                    />
                  </div>
                </div>

                {/* ACCOUNT */}

                <div className="dashboard-card account-card">
                  <div className="card-title-row">
                    <div>
                      <h2>Your account</h2>

                      <p>Authentication information.</p>
                    </div>

                    <div className="verified-badge">
                      <CheckIcon />
                      Active
                    </div>
                  </div>

                  <div className="account-profile">
                    <div className="large-avatar">{getInitials(user.fullName)}</div>

                    <div>
                      <h3>{user.fullName}</h3>

                      <p>{user.email}</p>
                    </div>
                  </div>

                  <div className="account-details">
                    <DetailRow
                      label="Account type"
                      value={formatAccountType(user.accountType)}
                    />

                    <DetailRow label="Status" value="Active" status />

                    <DetailRow label="Organization" value="Tapvera" />
                  </div>
                </div>
              </section>

              {/* ==================================================
                  BOTTOM
              ================================================== */}

              <section className="bottom-grid">
                <div className="dashboard-card activity-card">
                  <div className="card-title-row">
                    <div>
                      <h2>Recent activity</h2>

                      <p>Latest events in your workspace.</p>
                    </div>

                    <button className="view-all-button" type="button">
                      View all
                    </button>
                  </div>

                  <div className="empty-state">
                    <div className="empty-icon">
                      <ActivityIcon />
                    </div>

                    <h3>No recent activity</h3>

                    <p>Activity will appear here as you start using TapCRM.</p>
                  </div>
                </div>

                <div className="dashboard-card security-card">
                  <div className="security-card-icon">
                    <ShieldIcon />
                  </div>

                  <h2>Security status</h2>

                  <p>Your account is protected with a secure authentication session.</p>

                  <div className="security-check">
                    <CheckIcon />

                    <span>Authenticated session</span>
                  </div>

                  <div className="security-check">
                    <CheckIcon />

                    <span>HTTP-only cookies</span>
                  </div>

                  <div className="security-check">
                    <CheckIcon />

                    <span>Role-based access</span>
                  </div>
                </div>
              </section>

              {/* ==================================================
                  FOOTER
              ================================================== */}

              <footer className="dashboard-footer">
                <span>TapCRM • Customer Relationship Management</span>

                <span>Organization ID: {user.organizationId}</span>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/* ============================================================
   ERROR HELPERS
============================================================ */

interface NormalizedApiError {
  status?: number;
  message?: string;
  response?: ApiErrorResponse;
}

function getApiError(error: unknown): NormalizedApiError {
  if (typeof error !== 'object' || error === null) {
    return {
      message: 'An unexpected error occurred.',
    };
  }

  const candidate = error as {
    response?: {
      status?: unknown;
      data?: unknown;
    };
    message?: unknown;
  };

  const responseData =
    typeof candidate.response?.data === 'object' && candidate.response.data !== null
      ? (candidate.response.data as ApiErrorResponse)
      : undefined;

  const status =
    typeof candidate.response?.status === 'number'
      ? candidate.response.status
      : undefined;

  const message =
    typeof responseData?.message === 'string'
      ? responseData.message
      : typeof responseData?.error === 'string'
        ? responseData.error
        : typeof candidate.message === 'string'
          ? candidate.message
          : undefined;

  const normalizedError: NormalizedApiError = {};

  if (status !== undefined) {
    normalizedError.status = status;
  }

  if (message !== undefined) {
    normalizedError.message = message;
  }

  if (responseData !== undefined) {
    normalizedError.response = responseData;
  }

  return normalizedError;
}

/* ============================================================
   STAT CARD
============================================================ */

interface StatCardProps {
  title: string;
  value: string;
  change: string;
  icon: React.ReactNode;
}

function StatCard({ title, value, change, icon }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <div className="stat-icon">{icon}</div>

        <span className="stat-menu">•••</span>
      </div>

      <div className="stat-value">{value}</div>

      <div className="stat-title">{title}</div>

      <div className="stat-change">
        <span>↗</span>

        {change}
      </div>
    </div>
  );
}

/* ============================================================
   QUICK ACTION
============================================================ */

interface QuickActionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function QuickAction({ icon, title, description }: QuickActionProps) {
  return (
    <button className="quick-action" type="button">
      <div className="quick-action-icon">{icon}</div>

      <div>
        <strong>{title}</strong>

        <span>{description}</span>
      </div>

      <ChevronRightIcon />
    </button>
  );
}

/* ============================================================
   DETAIL ROW
============================================================ */

interface DetailRowProps {
  label: string;
  value: string;
  status?: boolean;
}

function DetailRow({ label, value, status }: DetailRowProps) {
  return (
    <div className="detail-row">
      <span>{label}</span>

      <strong className={status ? 'status-value' : ''}>
        {status && <span className="status-dot" />}

        {value}
      </strong>
    </div>
  );
}

/* ============================================================
   HELPERS
============================================================ */

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function getFirstName(name: string): string {
  return name.split(' ')[0] || name;
}

function formatAccountType(type: string): string {
  return type
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatMenuName(key: string): string {
  return key
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/* ============================================================
   ICONS
============================================================ */

function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function OrganizationIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function CustomerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function ContactIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2.5" />
      <path d="M5.5 17a4 4 0 0 1 7-2.5" />
      <path d="M15 9h3" />
      <path d="M15 13h3" />
      <path d="M15 17h2" />
    </svg>
  );
}

function DealsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M3 17l6-6 4 4 8-9" />
      <path d="M17 6h4v4" />
      <path d="M3 21h18" />
    </svg>
  );
}

function TaskIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="m8 12 2.5 2.5L16 9" />
    </svg>
  );
}

function RolesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 3 20 7v5c0 4.5-3 7.8-8 9-5-1.2-8-4.5-8-9V7l8-4Z" />
      <circle cx="12" cy="10" r="2" />
      <path d="M8.5 17a4 4 0 0 1 7 0" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="7" r="3" />
      <circle cx="17" cy="9" r="2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M14 15a5 5 0 0 1 7 5" />
    </svg>
  );
}

function AuditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  );
}

function ChangesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 7h16" />
      <path d="M4 12h10" />
      <path d="M4 17h16" />
      <circle cx="17" cy="12" r="2" />
    </svg>
  );
}

function IntegrationIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M8 12h8" />
      <path d="M12 8v8" />
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  );
}

function ReportIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7 15 3-4 3 2 4-6" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.4 1.4-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V20h-2v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-1.4-1.4.06-.06A1.7 1.7 0 0 0 8.6 15a1.7 1.7 0 0 0-1.55-1H7v-2h.05a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.88L8.2 9.06l1.4-1.4.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1-1.55V6h2v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.4 1.4-.06.06A1.7 1.7 0 0 0 19.4 10c.18.6.74 1 1.4 1H21v2h-.2c-.66 0-1.22.4-1.4 1Z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 3 20 6v5c0 5.2-3.4 8.7-8 10-4.6-1.3-8-4.8-8-10V6l8-3Z" />
      <path d="m8.5 12 2.2 2.2 4.8-5" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M21 3v18" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  );
}

function UserPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0" />
      <path d="M19 8v6" />
      <path d="M16 11h6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </svg>
  );
}
