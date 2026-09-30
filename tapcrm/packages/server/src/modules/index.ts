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
import { registerTasksPolicies } from './tasks/policy.js';
import { registerTasksRoutes } from './tasks/routes.js';
import { registerTerritoryPolicies } from './sales/territories/policy.js';
import { registerTerritoryRoutes } from './sales/territories/routes.js';
import { registerLeadPolicies } from './sales/leads/policy.js';
import { registerLeadRoutes } from './sales/leads/routes.js';
import { registerHandoverPolicies } from './sales/leads/handover-policy.js';
import { registerHandoverRoutes } from './sales/leads/handover-routes.js';
import { registerCallbackPolicies } from './sales/leads/callback-policy.js';
import { registerCallbackRoutes } from './sales/leads/callback-routes.js';
import { registerRecruitmentPolicies } from './recruitment/policy.js';
import { registerRecruitmentRoutes } from './recruitment/routes.js';
import {
  registerMyNotepadAdminRoutes,
  registerMyNotepadRoutes,
  registerNotepadPolicies,
} from './myNotepad/index.js';
import { registerMyTodoRoutes } from './myTodo/routes.js';

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
  registerTasksPolicies();
  registerTerritoryPolicies();
  registerLeadPolicies();
  registerHandoverPolicies();
  registerCallbackPolicies();
  registerRecruitmentPolicies();
  registerNotepadPolicies();
}

export function registerAllRoutes(): void {
  registerIdentityRoutes();
  registerAccessManagementRoutes();
  registerOrganizationRoutes();
  registerEmployeeRoutes();
  registerGeofenceRoutes();
  registerAuditRoutes();
  registerTasksRoutes();
  registerTerritoryRoutes();
  registerLeadRoutes();
  registerHandoverRoutes();
  registerCallbackRoutes();
  registerRecruitmentRoutes();
  registerMyNotepadRoutes();
  registerMyNotepadAdminRoutes();
  registerMyTodoRoutes();
}
