import { registerBreakPolicyResolver } from './attendance/facade.js';
import { breakPolicyResolverImpl } from './break-management/resolver-service.js';
import { registerPayrollJobs, registerPayrollPorts } from './payroll/facade.js';
import { registerBreakPolicies } from './break-management/policy.js';
import { registerBreakManagementRoutes } from './break-management/routes.js';
import { registerOrganizationPolicies } from './organization/policy.js';
import { registerOrganizationRoutes } from './organization/routes.js';
import { registerEmployeePolicies } from './employee/policy.js';
import { registerEmployeeRoutes } from './employee/routes.js';
import { registerOnboardingPolicies } from './onboarding/policy.js';
import { registerOnboardingRoutes } from './onboarding/routes.js';
import { registerVerificationRoutes } from './verification/facade.js';
import { registerGeofencePolicies } from './identity/geofence/policy.js';
import { registerGeofenceRoutes } from './identity/geofence/routes.js';
import { registerIdentityRoutes } from './identity/routes.js';
import { registerAccessManagementRoutes } from './access-management/routes.js';
import { registerAuditPolicies } from './audit/policy.js';
import { registerAuditRoutes } from './audit/routes.js';
import { registerShiftPolicies } from './shifts/policy.js';
import { registerShiftRoutes } from './shifts/routes.js';
import { registerHolidayPolicies } from './holidays/policy.js';
import { registerHolidayRoutes } from './holidays/routes.js';
import { registerIdentityJobs } from './identity/jobs.js';
import { registerAccessManagementJobs } from './access-management/jobs.js';
import { registerAuditJobs } from './audit/jobs.js';
import { registerAttendanceJobs } from './attendance/jobs.js';
import { registerAttendancePolicies } from './attendance/policy.js';
import { registerAttendanceRoutes } from './attendance/routes.js';
import {
  registerBiometricJobs,
  registerBiometricPolicies,
  registerBiometricRoutes,
} from './biometric/index.js';
import {
  registerLiveStatusJobs,
  registerLiveStatusPolicies,
  registerLiveStatusProjector,
  registerLiveStatusRoutes,
  registerStatusChannel,
} from './live-status/index.js';
import { registerLeavePolicies, registerLeaveRoutes, registerLeaveJobs } from './leave/index.js';
import { registerBreakJobs } from './break-management/jobs.js';
import { registerPayrollPolicies } from './payroll/policy.js';
import { registerPayrollRoutes } from './payroll/routes.js';
import { registerTasksPolicies } from './tasks/policy.js';
import { registerTasksRoutes } from './tasks/routes.js';
import { registerTerritoryPolicies } from './sales/territories/policy.js';
import { registerTerritoryRoutes } from './sales/territories/routes.js';
import { registerLeadPolicies } from './sales/leads/policy.js';
import { registerLeadRoutes } from './sales/leads/routes.js';
import { registerHandoverPolicies } from './sales/handover/policy.js';
import { registerHandoverRoutes } from './sales/handover/routes.js';
import { registerCallbackPolicies } from './sales/leads/callback-policy.js';
import { registerCallbackRoutes } from './sales/leads/callback-routes.js';
import { registerSalesJobs } from './sales/leads/jobs.js';
import { registerRecruitmentPolicies } from './recruitment/policy.js';
import { registerRecruitmentRoutes } from './recruitment/routes.js';
import { registerNotificationJobs } from './notifications/jobs.js';
import {
  registerMyNotepadAdminRoutes,
  registerMyNotepadRoutes,
  registerNotepadPolicies,
} from './myNotepad/index.js';
import { registerChatPolicies, registerChatRealtime, registerChatRoutes } from './chat/index.js';
import { registerClientPolicies, registerClientRoutes } from './clients/index.js';
import { registerProjectPolicies, registerProjectRoutes } from './projects/index.js';
import { registerMyTodoRoutes } from './myTodo/routes.js';

/**
 * Port initialization — MUST run before policies, routes and jobs. The
 * attendance and break modules depend on these ports without importing one
 * another's internals.
 */
export function initializePorts(): void {
  registerBreakPolicyResolver(breakPolicyResolverImpl);
  registerPayrollPorts();
}

export function registerAllPolicies(): void {
  registerOrganizationPolicies();
  registerEmployeePolicies();
  registerOnboardingPolicies();
  registerGeofencePolicies();
  registerAuditPolicies();
  registerShiftPolicies();
  registerHolidayPolicies();
  registerAttendancePolicies();
  registerLiveStatusPolicies();
  registerStatusChannel();
  registerLiveStatusProjector();
  registerBiometricPolicies();
  registerLeavePolicies();
  registerBreakPolicies();
  registerPayrollPolicies();
  registerTasksPolicies();
  registerTerritoryPolicies();
  registerLeadPolicies();
  registerHandoverPolicies();
  registerCallbackPolicies();
  registerRecruitmentPolicies();
  registerNotepadPolicies();
  registerChatPolicies();
  registerClientPolicies();
  registerProjectPolicies();
}

/** Realtime wiring that has no route/policy shape of its own (the typing relay). */
export function registerAllRealtime(): void {
  registerChatRealtime();
}

export function registerAllRoutes(): void {
  registerIdentityRoutes();
  registerAccessManagementRoutes();
  registerOrganizationRoutes();
  registerEmployeeRoutes();
  registerGeofenceRoutes();
  registerAuditRoutes();
  registerShiftRoutes();
  registerHolidayRoutes();
  registerAttendanceRoutes();
  registerLiveStatusRoutes();
  registerBiometricRoutes();
  registerLeaveRoutes();
  registerBreakManagementRoutes();
  registerPayrollRoutes();
  registerTasksRoutes();
  registerTerritoryRoutes();
  registerLeadRoutes();
  registerHandoverRoutes();
  registerCallbackRoutes();
  registerRecruitmentRoutes();
  registerMyNotepadRoutes();
  registerMyNotepadAdminRoutes();
  registerChatRoutes();
  registerClientRoutes();
  registerProjectRoutes();
  registerMyTodoRoutes();
  registerOnboardingRoutes();
  registerVerificationRoutes();
}

let jobsRegistered = false;

/** Background jobs are declared once before the durable runner starts. */
export function registerAllJobs(): void {
  if (jobsRegistered) return;
  jobsRegistered = true;
  registerIdentityJobs();
  registerAccessManagementJobs();
  registerAuditJobs();
  registerAttendanceJobs();
  registerLiveStatusJobs();
  registerBiometricJobs();
  registerLeaveJobs();
  registerBreakJobs();
  registerPayrollJobs();
  registerNotificationJobs();
  registerSalesJobs();
}
