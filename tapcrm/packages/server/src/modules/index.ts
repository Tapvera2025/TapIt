import { registerOrganizationPolicies } from './organization/policy.js';
import { registerOrganizationRoutes } from './organization/routes.js';

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
}

export function registerAllRoutes(): void {
  registerOrganizationRoutes();
}
