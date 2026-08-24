/**
 * @tapcrm/authz — the authorization engine.
 *
 * TECH.md §3: "The authorization engine. No module imports another module's
 * internals; everything imports this."
 *
 * TECH.md §6.2 states the public surface is THREE functions. They are
 * `authorize`, `visibilityFilter` and `project`. Everything else exported here
 * is either a type, a registration helper used at boot, or a test utility.
 */

export { authorize, visibilityFilter, project, configureAuthz, holdsPolicy } from './engine.js';

export { AuthorizationError, AuthorizationConfigError } from './errors.js';

export {
  MATCH_NOTHING,
  MATCH_ALL,
  isMatchNothing,
  and,
  or,
  type SqlFragment,
} from './sql.js';

export {
  registerResourcePolicy,
  policyFor,
  registeredResourceTypes,
  assertResourcePolicyCompleteness,
  resolveDomain,
  __resetResourcePolicies,
  type ResourcePolicy,
} from './resource-policy.js';

export {
  registerConstraint,
  constraintsFor,
  registeredConstraints,
  assertConstraints,
  __resetConstraints,
  PASS,
  DENY,
  type Constraint,
  type ConstraintKind,
  type ConstraintResult,
} from './constraints/registry.js';

export { registerAbsoluteConstraints } from './constraints/absolute.js';
export { registerPrivilegedConstraints } from './constraints/privileged.js';

export { assertSegregationOfDuties } from './sod.js';
export { projectRecord, projectRecords, type ProjectionOptions } from './projection.js';

export {
  SUBORDINATES_CTE,
  TEAM_DESCENDANTS_CTE,
  POOL_MEMBERS,
  MEMO_KEYS,
} from './scope-resolver.js';

export type {
  AuthzContext,
  AuthzPorts,
  AuthzAuditPort,
  PolicyStorePort,
  ScopeResolverPort,
  PolicyEvaluationContext,
  Resource,
} from './ports.js';

import { registerAbsoluteConstraints } from './constraints/absolute.js';
import { registerPrivilegedConstraints } from './constraints/privileged.js';

/**
 * Registers A1–A4 and P1–P8. Called once at boot, before the first request.
 *
 * A1 itself is not a registry entry — it runs at step 2 from `sod.ts`, earlier
 * than any registered constraint can.
 */
export function registerProtectedConstraints(): void {
  registerAbsoluteConstraints();
  registerPrivilegedConstraints();
}
