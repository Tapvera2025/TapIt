import type { Scope } from './scope.js';
import type { Action } from './registry.generated.js';

/** PRD §2 — every principal falls into exactly one account type. */
export type AccountType = 'super-admin' | 'employee' | 'client' | 'service';

export type OrganizationId = string;
export type UserId = string;
export type TeamId = string;
export type DepartmentId = string;
export type PositionId = string;
/**
 * PRD §4.1 / §4.4 — a permission policy is an action plus its reach. An
 * override is a full policy, not a boolean, which is what makes "grant this one
 * person a narrower or wider slice" real.
 */
export interface PermissionPolicy {
  readonly action: Action;
  readonly allowed: boolean;
  readonly scope: Scope;
  /** Field-level narrowing. Undefined means the resource's default projection. */
  readonly fields?: readonly string[];
  /** Ids of constraints declared on this policy, evaluated at pipeline step 8. */
  readonly constraints?: readonly string[];
  /** Where this policy came from. The access explorer (AM-4) renders it. */
  readonly source: 'position' | 'override' | 'client' | 'service';
}

/**
 * The resolved policy set for one principal.
 *
 * AZ-I5: `cacheDeadline` is the earliest `expires_at` among the principal's
 * unexpired overrides, or the session expiry if there are none. A cached set
 * can never outlive an override expiry.
 */
export interface PermissionSet {
  readonly policies: Readonly<Partial<Record<Action, PermissionPolicy>>>;
  readonly cacheDeadline: Date;
  readonly resolvedAt: Date;
}

interface PrincipalBase {
  readonly id: UserId;
  readonly organizationId: OrganizationId;
  readonly accountType: AccountType;
  readonly sessionVersion: number;
}

export interface EmployeePrincipal extends PrincipalBase {
  readonly accountType: 'employee';
  readonly positionId: PositionId;
  readonly departmentId: DepartmentId;
  readonly teamId: TeamId | null;
  readonly reportsTo: UserId | null;
  /**
   * PRD §4.3 — an organizational attribute used by delegation, approval
   * routing and tie-breaking. It is NEVER consulted when deciding whether a
   * user may read a record.
   */
  readonly organizationalLevel: number;
}

export interface SuperAdminPrincipal extends PrincipalBase {
  readonly accountType: 'super-admin';
}

export interface ClientPrincipal extends PrincipalBase {
  readonly accountType: 'client';
  /** A2 — the isolation boundary, evaluated before any policy resolution. */
  readonly clientId: string;
}

export interface ServicePrincipal extends PrincipalBase {
  readonly accountType: 'service';
  /** SV-2 — explicit list. Wildcards are not supported. */
  readonly allowedActions: readonly Action[];
  readonly allowedResources: readonly string[];
  /** SV-3 — mandatory, maximum 365 days. */
  readonly expiresAt: Date;
}

export type Principal =
  | EmployeePrincipal
  | SuperAdminPrincipal
  | ClientPrincipal
  | ServicePrincipal;

/**
 * PRD §4.7 — `globalAccess` is DERIVED, never stored.
 *
 *   "No column, no policy, no override, no delegation path, no interface
 *    control. A boolean on a record is a boolean somebody can set."
 *
 * This is the single definition in the codebase. `tools/ci/check-global-access.ts`
 * fails the build on any assignment to a `globalAccess` field anywhere else.
 */
export function globalAccess(principal: Pick<Principal, 'accountType'>): boolean {
  return principal.accountType === 'super-admin';
}
