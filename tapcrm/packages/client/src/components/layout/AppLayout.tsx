import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

import {
  DashboardIcon,
  OrganizationIcon,
  DepartmentIcon,
  TeamsIcon,
  PositionLadderIcon,
  DesignationIcon,
  ChartIcon,
  UsersIcon,
  CustomerIcon,
  DealsIcon,
  TasksIcon,
  RolesIcon,
  KeyIcon,
  ShieldIcon,
  AuditIcon,
  SunIcon,
  MoonIcon,
  MenuIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LogoutIcon,
} from '../common/Icons';

import './AppLayout.css';

export interface User {
  id: string;
  organizationId: string;
  accountType: string;
  email: string;
  fullName: string;
  status: string;
}

interface AppLayoutProps {
  children: React.ReactNode;
  user: User;
  onLogout: () => void;
}

const ORGANIZATION_ROUTES = [
  '/org/overview',
  '/org/departments',
  '/org/teams',
  '/org/positions',
  '/org/designations',
] as const;

const BREADCRUMB_TITLES: Record<string, string> = {
  '/dashboard': 'Workspace Overview',

  '/org/overview': 'Organization Chart & Overview',
  '/org/departments': 'Departments Management',
  '/org/teams': 'Teams & Sub-Teams',
  '/org/positions': 'Positions Ladder & Policies',
  '/org/designations': 'Designations & Specializations',

  '/users': 'User Directory & Roster',
  '/customers': 'Customer Management',
  '/deals': 'Deal Pipelines',
  '/tasks': 'Operational Tasks',

  '/roles': 'Roles & Authorization Matrix',
  '/access-management': 'Access Management & Permissions',
  '/access': 'Access Management & Permissions',
  '/security': 'Identity & Security Settings',
  '/audit-logs': 'System Audit Trail',
};

export default function AppLayout({ children, user, onLogout }: AppLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  /**
   * Organization route detection.
   *
   * We intentionally check against the known organization
   * routes instead of using startsWith('/org'), which could
   * accidentally match unrelated URLs.
   */
  const isOrgRoute = useMemo(
    () =>
      ORGANIZATION_ROUTES.some(
        (route) =>
          location.pathname === route || location.pathname.startsWith(`${route}/`),
      ),
    [location.pathname],
  );

  /**
   * Organization submenu is automatically open when
   * the current page belongs to Organization.
   */
  const [orgExpanded, setOrgExpanded] = useState(isOrgRoute);

  /**
   * Theme.
   */
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return localStorage.getItem('tapcrm-theme') === 'dark';
  });

  /**
   * If user enters any Organization page,
   * keep Organization submenu open.
   */
  useEffect(() => {
    if (isOrgRoute) {
      setOrgExpanded(true);
    }
  }, [isOrgRoute]);

  /**
   * Apply theme.
   */
  useEffect(() => {
    const theme = darkMode ? 'dark' : 'light';

    document.documentElement.setAttribute('data-theme', theme);

    localStorage.setItem('tapcrm-theme', theme);
  }, [darkMode]);

  /**
   * Close mobile sidebar after route change.
   */
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  /**
   * If mobile sidebar is opened while desktop sidebar
   * was collapsed, temporarily restore the expanded
   * navigation so mobile users can see labels.
   */
  useEffect(() => {
    if (mobileSidebarOpen) {
      setSidebarCollapsed(false);
    }
  }, [mobileSidebarOpen]);

  /**
   * Breadcrumb title.
   */
  const breadcrumbTitle = useMemo(() => {
    const exactTitle = BREADCRUMB_TITLES[location.pathname];

    if (exactTitle) {
      return exactTitle;
    }

    /**
     * Handle nested routes.
     */
    if (location.pathname.startsWith('/org/departments')) {
      return 'Departments Management';
    }

    if (location.pathname.startsWith('/org/teams')) {
      return 'Teams & Sub-Teams';
    }

    if (location.pathname.startsWith('/org/positions')) {
      return 'Positions Ladder & Policies';
    }

    if (location.pathname.startsWith('/org/designations')) {
      return 'Designations & Specializations';
    }

    if (location.pathname.startsWith('/users')) {
      return 'User Directory & Roster';
    }

    if (location.pathname.startsWith('/customers')) {
      return 'Customer Management';
    }

    if (location.pathname.startsWith('/deals')) {
      return 'Deal Pipelines';
    }

    if (location.pathname.startsWith('/tasks')) {
      return 'Operational Tasks';
    }

    return 'TapCRM';
  }, [location.pathname]);

  /**
   * User initials.
   */
const getInitials = (name: string): string => {
  const normalized = name.trim();

  if (!normalized) {
    return 'U';
  }

  const parts = normalized.split(/\s+/).filter(Boolean);

  const first = parts[0];

  if (!first) {
    return 'U';
  }

  if (parts.length === 1) {
    return first.charAt(0).toUpperCase();
  }

  const last = parts[parts.length - 1];

  if (!last) {
    return first.charAt(0).toUpperCase();
  }

  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
};

  /**
   * Display-friendly account type.
   */
  const displayAccountType = useMemo(() => {
    if (!user.accountType) {
      return 'User';
    }

    return user.accountType
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }, [user.accountType]);

  /**
   * Navigate and close mobile sidebar.
   */
  const navigateTo = (path: string) => {
    void navigate(path);
    setMobileSidebarOpen(false);
  };

  /**
   * Organization main click.
   *
   * IMPORTANT:
   * Clicking "Organization" always opens the organization
   * overview page.
   *
   * The separate chevron controls submenu expansion.
   */
  const handleOrganizationClick = () => {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
    }

    setOrgExpanded(true);
    navigateTo('/org/overview');
  };

  /**
   * Organization chevron click.
   *
   * This only controls submenu visibility.
   */
  const handleOrganizationToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
      setOrgExpanded(true);
      return;
    }

    setOrgExpanded((previous) => !previous);
  };

  /**
   * Mobile menu.
   */
  const openMobileSidebar = () => {
    setSidebarCollapsed(false);
    setMobileSidebarOpen(true);
  };

  const closeMobileSidebar = () => {
    setMobileSidebarOpen(false);
  };

  /**
   * Toggle desktop sidebar.
   */
  const toggleSidebar = () => {
    setSidebarCollapsed((previous) => !previous);
  };

  /**
   * Logout.
   */
  const handleLogout = () => {
    setMobileSidebarOpen(false);
    onLogout();
  };

  return (
    <div
      className={[
        'app-layout',
        sidebarCollapsed ? 'sidebar-collapsed' : '',
        mobileSidebarOpen ? 'mobile-sidebar-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* =========================================
          MOBILE BACKDROP
      ========================================== */}
      {mobileSidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={closeMobileSidebar}
          aria-label="Close navigation"
        />
      )}

      {/* =========================================
          SIDEBAR
      ========================================== */}
      <aside
        className={['app-sidebar', mobileSidebarOpen ? 'mobile-open' : '']
          .filter(Boolean)
          .join(' ')}
        aria-label="Application navigation"
      >
        {/* =======================================
            BRAND
        ======================================== */}
        <div className="sidebar-brand">
          <button
            type="button"
            className="brand-button"
            onClick={() => navigateTo('/dashboard')}
            title="Go to Dashboard"
            aria-label="TapCRM Dashboard"
          >
            <span className="brand-badge">T</span>

            {!sidebarCollapsed && (
              <span className="brand-info">
                <span className="brand-name">TapCRM</span>

                <span className="brand-tag">Enterprise OS</span>
              </span>
            )}
          </button>
        </div>

        {/* =======================================
            ORGANIZATION CARD
        ======================================== */}
        {!sidebarCollapsed && (
          <button
            type="button"
            className={['tenant-card', isOrgRoute ? 'active' : '']
              .filter(Boolean)
              .join(' ')}
            onClick={handleOrganizationClick}
            title="Open Organization"
          >
            <span className="tenant-avatar">T</span>

            <span className="tenant-details">
              <span className="tenant-name">Tapvera</span>

              <span className="tenant-status">Active Workspace</span>
            </span>

            <span className="tenant-dot" aria-hidden="true" />
          </button>
        )}

        {/* =======================================
            NAVIGATION
        ======================================== */}
        <nav className="sidebar-nav" aria-label="Main navigation">
          {/* =====================================
              WORKSPACE
          ====================================== */}
          <div className="nav-group">
            {!sidebarCollapsed && <span className="nav-group-title">WORKSPACE</span>}

            {/* DASHBOARD */}
            <NavLink
              to="/dashboard"
              end
              title="Dashboard"
              className={({ isActive }) =>
                ['nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
            >
              <DashboardIcon size={18} />

              {!sidebarCollapsed && <span>Dashboard</span>}
            </NavLink>

            {/* =================================
                ORGANIZATION
            ================================== */}
            <div
              className={[
                'nav-accordion',
                orgExpanded ? 'open' : '',
                isOrgRoute ? 'has-active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="organization-nav-row">
                {/* MAIN ORGANIZATION BUTTON */}
                <button
                  type="button"
                  className={[
                    'nav-link',
                    'accordion-trigger',
                    isOrgRoute ? 'route-active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={handleOrganizationClick}
                  title="Organization"
                  aria-current={isOrgRoute ? 'page' : undefined}
                >
                  <span className="nav-link-content">
                    <OrganizationIcon size={18} />

                    {!sidebarCollapsed && <span>Organization</span>}
                  </span>
                </button>

                {/* CHEVRON */}
                {!sidebarCollapsed && (
                  <button
                    type="button"
                    className="organization-chevron-button"
                    onClick={handleOrganizationToggle}
                    aria-label={
                      orgExpanded
                        ? 'Collapse Organization menu'
                        : 'Expand Organization menu'
                    }
                    aria-expanded={orgExpanded}
                    title={orgExpanded ? 'Collapse' : 'Expand'}
                  >
                    <span
                      className={['chevron-icon', orgExpanded ? 'expanded' : '']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <ChevronDownIcon size={14} />
                    </span>
                  </button>
                )}
              </div>

              {/* =================================
                  ORGANIZATION SUBMENU
              ================================== */}
              {orgExpanded && (
                <div className="nav-submenu">
                  <NavLink
                    to="/org/overview"
                    end
                    className={({ isActive }) =>
                      ['submenu-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
                    }
                    onClick={closeMobileSidebar}
                  >
                    <ChartIcon size={16} />
                    <span>Overview & Chart</span>
                  </NavLink>

                  <NavLink
                    to="/org/departments"
                    className={({ isActive }) =>
                      ['submenu-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
                    }
                    onClick={closeMobileSidebar}
                  >
                    <DepartmentIcon size={16} />
                    <span>Departments</span>
                  </NavLink>

                  <NavLink
                    to="/org/teams"
                    className={({ isActive }) =>
                      ['submenu-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
                    }
                    onClick={closeMobileSidebar}
                  >
                    <TeamsIcon size={16} />
                    <span>Teams & Sub-Teams</span>
                  </NavLink>

                  <NavLink
                    to="/org/positions"
                    className={({ isActive }) =>
                      ['submenu-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
                    }
                    onClick={closeMobileSidebar}
                  >
                    <PositionLadderIcon size={16} />
                    <span>Positions Ladder</span>
                  </NavLink>

                  <NavLink
                    to="/org/designations"
                    className={({ isActive }) =>
                      ['submenu-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
                    }
                    onClick={closeMobileSidebar}
                  >
                    <DesignationIcon size={16} />
                    <span>Designations</span>
                  </NavLink>
                </div>
              )}
            </div>

            {/* USERS */}
            <NavLink
              to="/users"
              className={({ isActive }) =>
                ['nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
              title="Users & Directory"
              onClick={closeMobileSidebar}
            >
              <UsersIcon size={18} />

              {!sidebarCollapsed && <span>Users & Directory</span>}
            </NavLink>

            {/* CUSTOMERS */}
            <NavLink
              to="/customers"
              className={({ isActive }) =>
                ['nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
              title="Customers"
              onClick={closeMobileSidebar}
            >
              <CustomerIcon size={18} />

              {!sidebarCollapsed && <span>Customers</span>}
            </NavLink>

            {/* DEALS */}
            <NavLink
              to="/deals"
              className={({ isActive }) =>
                ['nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
              title="Deals"
              onClick={closeMobileSidebar}
            >
              <DealsIcon size={18} />

              {!sidebarCollapsed && <span>Deals</span>}
            </NavLink>

            {/* TASKS */}
            <NavLink
              to="/tasks"
              className={({ isActive }) =>
                ['nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
              title="Tasks"
              onClick={closeMobileSidebar}
            >
              <TasksIcon size={18} />

              {!sidebarCollapsed && <span>Tasks</span>}
            </NavLink>
          </div>

          {/* =====================================
              ADMINISTRATION
          ====================================== */}
          <div className="nav-group">
            {!sidebarCollapsed && <span className="nav-group-title">ADMINISTRATION</span>}

            {/* ROLES */}
            <NavLink
              to="/roles"
              className={({ isActive }) =>
                ['nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
              title="Roles & Matrix"
              onClick={closeMobileSidebar}
            >
              <RolesIcon size={18} />

              {!sidebarCollapsed && <span>Roles & Matrix</span>}
            </NavLink>

            {/* ACCESS MANAGEMENT */}
            <NavLink
              to="/access-management"
              className={({ isActive }) =>
                ['nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
              title="Access Management"
              onClick={closeMobileSidebar}
            >
              <KeyIcon size={18} />

              {!sidebarCollapsed && <span>Access Management</span>}
            </NavLink>

            {/* SECURITY */}
            <NavLink
              to="/security"
              className={({ isActive }) =>
                ['nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
              title="Identity & Security"
              onClick={closeMobileSidebar}
            >
              <ShieldIcon size={18} />

              {!sidebarCollapsed && <span>Identity & Security</span>}
            </NavLink>

            {/* AUDIT LOGS */}
            <NavLink
              to="/audit-logs"
              className={({ isActive }) =>
                ['nav-link', isActive ? 'active' : ''].filter(Boolean).join(' ')
              }
              title="Audit Logs"
              onClick={closeMobileSidebar}
            >
              <AuditIcon size={18} />

              {!sidebarCollapsed && <span>Audit Logs</span>}
            </NavLink>
          </div>
        </nav>

        {/* =======================================
            SIDEBAR FOOTER
        ======================================== */}
        <div className="sidebar-footer">
          {!sidebarCollapsed && (
            <div className="session-status-card">
              <div className="session-icon">
                <ShieldIcon size={16} />
              </div>

              <div className="session-info">
                <span className="session-title">Secure Session</span>

                <span className="session-desc">HTTP-Only Auth</span>
              </div>

              <span className="live-dot" aria-label="Session active" />
            </div>
          )}

          <button
            type="button"
            className="sidebar-logout-btn"
            onClick={handleLogout}
            title="Sign out of account"
          >
            <LogoutIcon size={18} />

            {!sidebarCollapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* =========================================
          MAIN WRAPPER
      ========================================== */}
      <div className="app-main-wrap">
        {/* =======================================
            TOPBAR
        ======================================== */}
        <header className="app-topbar">
          <div className="topbar-left">
            {/* MOBILE MENU */}
            <button
              type="button"
              className="topbar-btn mobile-menu-toggle"
              onClick={openMobileSidebar}
              aria-label="Open navigation menu"
              title="Open navigation menu"
            >
              <MenuIcon size={20} />
            </button>

            {/* DESKTOP COLLAPSE */}
            <button
              type="button"
              className="topbar-btn desktop-collapse-toggle"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <MenuIcon size={18} />
            </button>

            {/* BREADCRUMB */}
            <div className="topbar-breadcrumb" aria-label="Breadcrumb">
              <span className="breadcrumb-root">TapCRM</span>

              <ChevronRightIcon size={14} />

              <strong className="breadcrumb-current">{breadcrumbTitle}</strong>
            </div>
          </div>

          <div className="topbar-right">
            {/* THEME */}
            <button
              type="button"
              className="topbar-btn theme-toggle-btn"
              onClick={() => setDarkMode((previous) => !previous)}
              title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {darkMode ? <SunIcon size={18} /> : <MoonIcon size={18} />}
            </button>

            <div className="topbar-divider" aria-hidden="true" />

            {/* USER PROFILE */}
            <button
              type="button"
              className="topbar-user-profile"
              onClick={() => navigateTo('/security')}
              title="Open security settings"
            >
              <span className="user-avatar-badge">{getInitials(user.fullName)}</span>

              <span className="user-meta">
                <span className="user-display-name">{user.fullName || 'User'}</span>

                <span className="user-role-badge">{displayAccountType}</span>
              </span>
            </button>
          </div>
        </header>

        {/* =======================================
            PAGE CONTENT
        ======================================== */}
        <main className="app-content-body">{children}</main>
      </div>
    </div>
  );
}
