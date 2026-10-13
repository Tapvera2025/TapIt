import { useEffect, useState } from 'react';
import { CompanySidebar } from './CompanySidebar.js';
import { Navbar } from './Navbar.js';

export function CompanyLayout({
  pathname,
  identity,
  organizationName,
  accountType,
  canRequestRoleChange,
  canViewAudit,
  canManageLeaveTypes,
  canViewLeaveBalances,
  canUseLeaveQueue,
  canViewEmployees,
  canViewTerritories,
  canViewLeads,
  canViewCallbacks,
  canViewHandovers,
  canViewChat,
  canViewClients,
  canViewProjects,
  canViewLiveBoard,
  canReviewCorrections,
  canReviewBreaches,
  canManageBreakPolicies,
  canManageShifts,
  canManagePayroll,
  canManagePayrollConfig,
  canManageBiometric,
  isHr,
  hasRecruitment,
  onNavigate,
  onLogout,
  children,
}: {
  pathname: string;
  identity: {
    fullName: string;
    email: string;
    accountType?: string;
    departmentCode?: string | null;
    departmentName?: string | null;
    positionCode?: string | null;
  };
  organizationName: string | null;
  accountType: string;
  canRequestRoleChange: boolean;
  canViewAudit: boolean;
  canManageLeaveTypes: boolean;
  canViewLeaveBalances: boolean;
  canUseLeaveQueue: boolean;
  canViewEmployees: boolean;
  canViewTerritories: boolean;
  canViewLeads: boolean;
  canViewCallbacks: boolean;
  canViewHandovers: boolean;
  canViewChat: boolean;
  canViewClients: boolean;
  canViewProjects: boolean;
  canViewLiveBoard: boolean;
  canReviewCorrections: boolean;
  canReviewBreaches: boolean;
  canManageBreakPolicies: boolean;
  canManageShifts: boolean;
  canManagePayroll: boolean;
  canManagePayrollConfig: boolean;
  canManageBiometric: boolean;
  isHr: boolean;
  hasRecruitment: boolean;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    window.localStorage.getItem('tapcrm:sidebar-collapsed') === 'true',
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const savedWidth = Number(window.localStorage.getItem('tapcrm:sidebar-width'));
    return Number.isFinite(savedWidth) && savedWidth >= 220 && savedWidth <= 420
      ? savedWidth
      : 256;
  });

  useEffect(() => {
    window.localStorage.setItem('tapcrm:sidebar-collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    window.localStorage.setItem('tapcrm:sidebar-width', String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleSidebar = () => {
    if (window.innerWidth >= 1280) {
      setSidebarCollapsed((collapsed) => !collapsed);
    } else {
      setSidebarOpen((open) => !open);
    }
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-app-background text-app-foreground">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-lg bg-app-surface p-3 focus:translate-y-0"
      >
        Skip to content
      </a>
      <button
        type="button"
        onClick={() => setSidebarOpen(false)}
        className={`mobile-sidebar-backdrop fixed inset-x-0 bottom-0 top-16 z-[55] bg-black/50 backdrop-blur-[3px] transition-opacity duration-300 ease-out xl:hidden ${sidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}
        aria-label="Close navigation overlay"
        aria-hidden={!sidebarOpen}
        tabIndex={sidebarOpen ? 0 : -1}
      />
      <Navbar
        identity={identity}
        organizationName={organizationName}
        sidebarCollapsed={sidebarCollapsed}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        onNavigate={onNavigate}
        onLogout={onLogout}
      />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <CompanySidebar
          pathname={pathname}
          identity={identity}
          organizationName={organizationName}
          accountType={accountType}
          canRequestRoleChange={canRequestRoleChange}
          canViewAudit={canViewAudit}
          canManageLeaveTypes={canManageLeaveTypes}
          canViewLeaveBalances={canViewLeaveBalances}
          canUseLeaveQueue={canUseLeaveQueue}
          canViewEmployees={canViewEmployees}
          canViewTerritories={canViewTerritories}
          canViewLeads={canViewLeads}
          canViewCallbacks={canViewCallbacks}
          canViewHandovers={canViewHandovers}
          canViewChat={canViewChat}
          canViewClients={canViewClients}
          canViewProjects={canViewProjects}
          canViewLiveBoard={canViewLiveBoard}
          canReviewCorrections={canReviewCorrections}
          canReviewBreaches={canReviewBreaches}
          canManageBreakPolicies={canManageBreakPolicies}
          canManageShifts={canManageShifts}
          canManagePayroll={canManagePayroll}
          canManagePayrollConfig={canManagePayrollConfig}
          canManageBiometric={canManageBiometric}
          isHr={isHr}
          hasRecruitment={hasRecruitment}
          onNavigate={onNavigate}
          onLogout={onLogout}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebar}
          width={sidebarWidth}
          onResize={setSidebarWidth}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <main id="main-content" className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
