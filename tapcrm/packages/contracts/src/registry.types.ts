import type { DomainDeclaration } from './domain.js';
import type { ModuleName } from './module.js';

/**
 * The shape of an action registry entry — TECH.md §6.1.
 *
 * The registry itself lives in AUTHORIZATION.md §6.4 and is the authoritative
 * source. It is NOT retyped by hand into code: `tools/extract-registry.ts`
 * parses it into `registry.generated.ts`, CI regenerates and diffs, and drift
 * fails the build (RG-I1).
 *
 * This file holds only the types, so that the generated file can be deleted
 * and rebuilt at any time without taking the type definitions with it.
 */

export type ResourceType = string;

export interface GrantPolicy {
  /**
   * AC-4b — no action with `positionGrantable = false` can be written into any
   * Position policy through the interface or the API.
   */
  readonly positionGrantable: boolean;
  readonly delegationAllowed: boolean;
  /** PRD §4.7 protected capabilities: granted by Super Admin only. */
  readonly superAdminOnly: boolean;
}

export interface ActionDefinition<A extends string = string> {
  readonly action: A;
  readonly module: ModuleName;
  readonly resource: ResourceType | null;
  readonly domain: DomainDeclaration;
  /** SE-7 — a sensitive action writes an audit entry on USE, not only on grant. */
  readonly sensitive: boolean;
  readonly approvalBearing: boolean;
  /**
   * A1 / SD-1 — "there is no universal `raisedBy`, and assuming one would
   * silently disable the control wherever the field is named differently."
   *
   * GP-5 / CI-7: an approvalBearing action with a null initiatorField fails the
   * build. AZ-I12: a declared field missing from the record DENIES.
   */
  readonly initiatorField: string | null;
  readonly grantPolicy: GrantPolicy;
  readonly description: string;
}

/** TECH.md §6.5 — a route binding declared in AUTHORIZATION.md. */
export interface ActionBinding<A extends string = string> {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly action: A;
  /** RM-14 / CI-6 — mandatory when the action names a resource. */
  readonly resourceParam: string | null;
}

/**
 * Registry invariants RG-1..RG-6, asserted by the extractor at BUILD time
 * (RG-I4) rather than at runtime. An invalid registry cannot be compiled.
 */
export const REGISTRY_INVARIANTS = {
  RG1: 'DelegationAllowed requires Sensitive = no. A sensitive action is never delegable.',
  RG2: 'SuperAdminOnly implies DelegationAllowed = no (GP-2).',
  RG3: 'PositionGrantable = no implies DelegationAllowed = no and SuperAdminOnly = yes (GP-1).',
  RG4: 'ApprovalBearing requires a non-null initiatorField (GP-5).',
  RG5: 'Every action names a resource or is explicitly none.',
  RG6: 'Every action has at least one API binding.',
} as const;
