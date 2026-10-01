import { useState } from 'react';
import { CompanyHeader } from './CompanyHeader.js';
import { CompanySidebar } from './CompanySidebar.js';

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
  title,
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
  title: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <div className="flex h-dvh overflow-hidden bg-app-background text-app-foreground">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-lg bg-app-surface p-3 focus:translate-y-0"
      >
        Skip to content
      </a>
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
      />
      {sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          aria-label="Close navigation overlay"
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CompanyHeader
          title={title}
          onMenu={() => setSidebarOpen(true)}
          onLogout={onLogout}
          onNavigate={onNavigate}
        />
        <main id="main-content" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
