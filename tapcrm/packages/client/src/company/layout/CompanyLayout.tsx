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
  canViewTerritories,
  canViewLeads,
  canViewCallbacks,
  canViewHandovers,
  canViewChat,
  canViewClients,
  canViewProjects,
  canViewLiveBoard,
  canViewAttendanceReports,
  canReviewCorrections,
  canReviewBreaches,
  canManageBreakPolicies,
  canManageShifts,
  canManagePayroll,
  canManagePayrollConfig,
  canViewTa,
  canManageTa,
  canManageBiometric,
  canViewAdvances,
  canManageAdvances,
  canViewPenalties,
  canManagePenalties,
  canViewExpenses,
  canApproveExpenses,
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
  canViewTerritories: boolean;
  canViewLeads: boolean;
  canViewCallbacks: boolean;
  canViewHandovers: boolean;
  canViewChat: boolean;
  canViewClients: boolean;
  canViewProjects: boolean;
  canViewLiveBoard: boolean;
  canViewAttendanceReports: boolean;
  canReviewCorrections: boolean;
  canReviewBreaches: boolean;
  canManageBreakPolicies: boolean;
  canManageShifts: boolean;
  canManagePayroll: boolean;
  canManagePayrollConfig: boolean;
  canViewTa: boolean;
  canManageTa: boolean;
  canManageBiometric: boolean;
  canViewAdvances: boolean;
  canManageAdvances: boolean;
  canViewPenalties: boolean;
  canManagePenalties: boolean;
  canViewExpenses: boolean;
  canApproveExpenses: boolean;
  isHr: boolean;
  hasRecruitment: boolean;
  title: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <div className="flex h-full min-h-full overflow-hidden bg-app-background text-app-foreground">
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
        canViewTerritories={canViewTerritories}
        canViewLeads={canViewLeads}
        canViewCallbacks={canViewCallbacks}
        canViewHandovers={canViewHandovers}
        canViewChat={canViewChat}
        canViewClients={canViewClients}
        canViewProjects={canViewProjects}
        canViewLiveBoard={canViewLiveBoard}
        canViewAttendanceReports={canViewAttendanceReports}
        canReviewCorrections={canReviewCorrections}
        canReviewBreaches={canReviewBreaches}
        canManageBreakPolicies={canManageBreakPolicies}
        canManageShifts={canManageShifts}
        canManagePayroll={canManagePayroll}
        canManagePayrollConfig={canManagePayrollConfig}
        canViewTa={canViewTa}
        canManageTa={canManageTa}
        canManageBiometric={canManageBiometric}
        canViewAdvances={canViewAdvances}
        canManageAdvances={canManageAdvances}
        canViewPenalties={canViewPenalties}
        canManagePenalties={canManagePenalties}
        canViewExpenses={canViewExpenses}
        canApproveExpenses={canApproveExpenses}
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
      <div className="fixed inset-y-0 right-0 left-0 flex min-h-0 min-w-0 flex-col overflow-hidden md:left-64">
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
