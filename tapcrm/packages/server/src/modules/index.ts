import { registerOrganizationPolicies } from './organization/policy.js';

import { registerOrganizationRoutes } from './organization/routes.js';
import { registerIdentityRoutes } from './identity/routes.js';
import { registerAccessRoutes } from './access-management/routes.js';
import { registerEmployeeDirectoryRoutes } from './employee-directory/route.js';

export function registerAllPolicies(): void {
  registerOrganizationPolicies();
}

export function registerAllRoutes(): void {
  registerIdentityRoutes();
  registerOrganizationRoutes();
  registerAccessRoutes();
  registerEmployeeDirectoryRoutes();
}
