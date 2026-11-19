import type { Action, Domain } from '@tapcrm/contracts';
import { REGISTRY } from '@tapcrm/contracts';
import type { PolicyEvaluationContext, Resource, Scope } from './ports.js';
import { MATCH_NOTHING, type SqlFragment } from './sql.js';
import { AuthorizationConfigError } from './errors.js';

/**
 * TECH.md §6.6 — one policy per resource type, registered at boot.
 *
 * PRD §4.8: "A Lead has one owner; a Project has a project manager, a delivery
 * owner, a client and an assigned team. A single generic owner-field check
 * cannot express both." Hence a policy per resource rather than a shared
 * owner-field helper.
 */
export interface ResourcePolicy<T extends Resource = Resource> {
  readonly resourceType: string;

  /**
   * A fixed domain, or a function for `derived` resources (documents,
   * notifications, chat messages, audit entries, notices) which resolve the
   * domain of the record they attach to — PER INSTANCE (PD-0).
   */
  readonly domain: Domain | ((resource: T) => Domain);

  /** Object-level check. AZ-1: every endpoint operating on an object runs this. */
  check(ctx: PolicyEvaluationContext, action: Action, resource: T, scope: Scope): Promise<boolean>;

  /**
   * Query filter for list endpoints. AZ-2: "List endpoints build their filter
   * from the scope BEFORE querying. No endpoint fetches broadly and rejects
   * rows afterwards."
   */
  filter(ctx: PolicyEvaluationContext, action: Action, scope: Scope): Promise<SqlFragment>;

  /** Field names that make a principal a named party, for `participant` scope. */
  participantFields(action: Action): readonly string[];

  /** A1 — the field naming this action's initiator on THIS resource. */
  initiatorField(action: Action): string | null;

  /**
   * Fields removed unless the caller holds the named action.
   * AZ-I3 / PD-3: mandatory field policies on sensitive people-domain resources
   * grant "breadth of subject, not depth of field."
   */
  readonly fieldPolicy?: Readonly<Record<string, Action>>;
}

const policies = new Map<string, ResourcePolicy>();

export function registerResourcePolicy<T extends Resource>(policy: ResourcePolicy<T>): void {
  if (policies.has(policy.resourceType)) {
    throw new AuthorizationConfigError(
      `Duplicate ResourcePolicy for resource type "${policy.resourceType}"`,
    );
  }
  policies.set(policy.resourceType, policy as unknown as ResourcePolicy);
}

export function policyFor(resourceType: string): ResourcePolicy {
  const policy = policies.get(resourceType);
  if (!policy) {
    // Fails closed. A resource with no policy is not "allow"; it is a defect
    // that must be caught at boot (AZ-I6b) and denies if it somehow is not.
    throw new AuthorizationConfigError(
      `No ResourcePolicy registered for resource type "${resourceType}"`,
    );
  }
  return policy;
}

export function registeredResourceTypes(): readonly string[] {
  return [...policies.keys()].sort();
}

/** Test-only. Never called by product code. */
export function __resetResourcePolicies(): void {
  policies.clear();
}

/** `resource (required by action)` for each action whose resource has no policy. */
function missingPolicies(actions: Iterable<Action>): string[] {
  const missing = new Set<string>();
  for (const action of actions) {
    const resource = REGISTRY[action].resource;
    if (resource !== null && !policies.has(resource)) {
      missing.add(`${resource} (required by ${action})`);
    }
  }
  return [...missing].sort();
}

function throwMissing(missing: readonly string[]): void {
  if (missing.length > 0) {
    throw new AuthorizationConfigError(
      `AZ-I6b: ${missing.length} registry resource(s) have no ResourcePolicy:\n  ` +
        missing.join('\n  '),
    );
  }
}

/**
 * AZ-I6b / CI-10 — the full completeness check, over the whole registry.
 *
 * "Every `resource` named in the registry must have a registered policy.
 *  Missing policy is a STARTUP FAILURE." While modules ship in phases this
 * includes resources no route can reach yet, so the server runs it only for a
 * release build (`strictManifest`); CI-10 reports the same gap.
 */
export function assertResourcePolicyCompleteness(): void {
  throwMissing(missingPolicies(Object.keys(REGISTRY) as Action[]));
}

/**
 * AZ-I6b for what this process can actually reach: every action a registered
 * route binds must name a resource whose policy is registered. The server runs
 * this at every start, in every environment. A missing policy discovered on a
 * request is a missing policy discovered by a user.
 */
export function assertResourcePoliciesForActions(actions: Iterable<Action>): void {
  throwMissing(missingPolicies(actions));
}

/** Registry resources still without a policy, for the startup report. */
export function missingResourcePolicies(): readonly string[] {
  return missingPolicies(Object.keys(REGISTRY) as Action[]);
}

export function resolveDomain<T extends Resource>(
  policy: ResourcePolicy<T>,
  resource: T,
): Domain {
  return typeof policy.domain === 'function' ? policy.domain(resource) : policy.domain;
}

export { MATCH_NOTHING };
