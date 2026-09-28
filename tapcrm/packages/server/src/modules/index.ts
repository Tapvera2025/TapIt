import { registerBreakPolicyResolver } from './attendance/facade.js';
import { breakPolicyResolverImpl } from './break-management/resolver-service.js';
import { registerBreakPolicies } from './break-management/policy.js';
import { registerBreakManagementRoutes } from './break-management/routes.js';
import { registerOrganizationPolicies } from './organization/policy.js';
import { registerOrganizationRoutes } from './organization/routes.js';
import { registerEmployeePolicies } from './employee/policy.js';
import { registerEmployeeRoutes } from './employee/routes.js';
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

/**
 * Port initialization — MUST be called before registerAllPolicies, registerAllRoutes,
 * registerAllJobs, and any attendance recalculation consumer.
 * Application startup must fail if either required port is absent after this call.
 *
 * Both ports follow the same pattern as the PresenceProjector port in attendance:
 * the break-management module registers the BreakPolicyResolver into attendance's
 * port slot; payroll registers the BreakDeductionWriter into break-management's
 * port slot. Neither direction imports the other module's internals.
 */
export function initializePorts(): void {
  registerBreakPolicyResolver(breakPolicyResolverImpl);
  // Task 6: registerBreakDeductionWriter(breakDeductionWriterImpl)
}

/**
 * The module registry.
 *
 * One place that names every implemented module, so that both the application
 * bootstrap and the CI coverage check see the SAME set. Grepping source for
 * registrations would undercount any policy created by a factory, and a
 * coverage gate that silently undercounts is worse than none.
 *
 * Modules are added here as their phase lands. PRD §18 sequencing:
 * P0 Foundation → P1 People / P3 Sales → P2, P4 → P5 → P6; P7 any time after P0.
 */
export function registerAllPolicies(): void {
  registerOrganizationPolicies();
  registerEmployeePolicies();
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
}

let jobsRegistered = false;

/** Background jobs (attendance design §5.4). Called once, before `startJobs`. */
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
}
