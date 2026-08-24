import type {
  Action,
  DepartmentId,
  PermissionSet,
  Principal,
  Scope,
  TeamId,
  UserId,
} from '@tapcrm/contracts';
import type { SqlFragment } from './sql.js';

/**
 * Ports the engine needs from the outside world.
 *
 * The engine is called on every request by every module (TECH.md §3), so it
 * must not depend on the DAL — the DAL depends on it. These interfaces are the
 * seam: `packages/server/src/platform/authz-adapter.ts` implements them against
 * PostgreSQL and wires them at boot.
 *
 * The practical payoff is that the whole pipeline is unit-testable without a
 * database, which matters because TS-I1 requires the SAME logic to also be
 * tested through HTTP.
 */

/** The request-scoped context every authorization call receives. */
export interface AuthzContext {
  readonly principal: Principal;
  readonly organizationId: string;
  readonly requestId: string;
  /**
   * TECH.md §6.5 — scope resolution is "the expensive part. Computed once per
   * request and memoised on the context." NF-5 budgets the whole authorization
   * step at under 20 ms p95, which a per-call recursive CTE would not meet.
   */
  readonly memo: Map<string, unknown>;
}

/** A resource instance handed to the engine. */
export interface Resource {
  readonly type: string;
  readonly id: string;
  readonly [field: string]: unknown;
}

/**
 * TECH.md §6.5 — transitive closure via PostgreSQL recursive CTEs.
 *
 * BD-32 is RESOLVED as "recursive CTE at launch. Move to a maintained closure
 * table only if §18 load testing proves the CTE misses the authorization
 * budget." Do not pre-optimise a security-critical path into a cache that can
 * be wrong.
 */
export interface ScopeResolverPort {
  /** VIS-1 — transitive: walks the full `reports_to` subtree, not one level. */
  subordinateIds(ctx: AuthzContext): Promise<ReadonlySet<UserId>>;
  /**
   * Team descendants. Recursion starts at the principal's own team and descends
   * only through `parent_team_id`. It NEVER ascends to a parent and then
   * descends through a sibling branch — that is protected constraint P6.
   */
  teamIds(ctx: AuthzContext): Promise<ReadonlySet<TeamId>>;
  poolIds(ctx: AuthzContext): Promise<ReadonlySet<TeamId>>;
  poolMemberIds(ctx: AuthzContext): Promise<ReadonlySet<UserId>>;
  departmentId(ctx: AuthzContext): Promise<DepartmentId | null>;
}

/**
 * Position policies merged with unexpired overrides.
 *
 * AZ-I6: override expiry is evaluated AT RESOLUTION TIME — rows with
 * `expires_at <= now()` are excluded by the query. The nightly job only marks,
 * notifies and audits. "A permission that outlives its stated expiry by up to a
 * day is not an expiring permission."
 */
export interface PolicyStorePort {
  resolveSet(ctx: AuthzContext): Promise<PermissionSet>;
}

/** SE-7 / step 9 — sensitive actions are audited on USE, not only on grant. */
export interface AuthzAuditPort {
  sensitiveUse(ctx: AuthzContext, action: Action, resource?: Resource): void;
  /** Step 4 — every Super Admin bypass is recorded. */
  superAdminBypass(ctx: AuthzContext, action: Action, resource?: Resource): void;
  /** SD-5 — "a blocked self-approval is visible rather than silent." */
  segregationBlocked(ctx: AuthzContext, action: Action, resource?: Resource): void;
  /** PD-1 — a domain mismatch is a defect, logged as one. */
  defect(ctx: AuthzContext, defect: string, action: Action | null): void;
}

export interface AuthzPorts {
  readonly scope: ScopeResolverPort;
  readonly policies: PolicyStorePort;
  readonly audit: AuthzAuditPort;
  readonly now: () => Date;
}

/** Passed to a ResourcePolicy so it can resolve scope without importing the DAL. */
export interface PolicyEvaluationContext extends AuthzContext {
  readonly scope: ScopeResolverPort;
}

export type { Scope, SqlFragment };
