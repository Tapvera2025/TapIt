import type { Action, PermissionPolicy } from '@tapcrm/contracts';
import { REGISTRY, isAction, globalAccess, isScopeDefinedForDomain } from '@tapcrm/contracts';
import type { AuthzContext, AuthzPorts, PolicyEvaluationContext, Resource } from './ports.js';
import { AuthorizationError, AuthorizationConfigError } from './errors.js';
import { assertConstraints } from './constraints/registry.js';
import { assertSegregationOfDuties } from './sod.js';
import { policyFor, resolveDomain } from './resource-policy.js';
import { MATCH_NOTHING, type SqlFragment } from './sql.js';
import { projectRecord } from './projection.js';

/**
 * The authorization engine — TECH.md §6.
 *
 * NF-24: "No authorization decision is made outside the authorization engine."
 * G2: "Every access decision resolved by one authorization engine with
 * per-action scope. No permission logic scattered across handlers."
 *
 * There are exactly three public functions (TECH.md §6.2). Everything else is
 * internal.
 */

let ports: AuthzPorts | null = null;

export function configureAuthz(configured: AuthzPorts): void {
  ports = configured;
}

function requirePorts(): AuthzPorts {
  if (ports === null) {
    // Fails closed. An unconfigured engine denies rather than allowing.
    throw new AuthorizationConfigError(
      'Authorization engine is not configured. Call configureAuthz() during boot.',
    );
  }
  return ports;
}

function evalContext(ctx: AuthzContext): PolicyEvaluationContext {
  return { ...ctx, scope: requirePorts().scope };
}

/* ==================================================================== *
 * authorize — single record
 * ==================================================================== */

/**
 * Implements AUTHORIZATION.md §3 in its EXACT order.
 *
 *   "Evaluated in this exact order. The order is the specification — in
 *    particular, segregation of duties precedes the privilege bypass."
 *
 * The authoritative pipeline has TEN steps. TECH.md §6.3 renders it as nine by
 * folding projection away; where the two disagree AUTHORIZATION.md is correct
 * (TECH.md §1). The ten map onto this package as:
 *
 *    1  authentication / account state   → http/context.ts middleware
 *    2  segregation of duties           ┐
 *    3  absolute constraints            │
 *    4  super admin bypass              │
 *    5  privileged constraints          ├─ authorize(), below
 *    6  policy resolution               │
 *    7  scope evaluation                │
 *    8  constraint evaluation           ┘
 *    9  field projection                → project(), at the response boundary
 *   10  audit                           → authorize() step 10, below
 *
 * Step 9 lives in `project()` rather than here because AZ-I4 requires
 * serialization to happen ONCE, at the response boundary, for every response —
 * including list responses that never call `authorize` per record.
 *
 * Steps 2 and 3 running BEFORE the bypass at step 4 is what makes AC-3 ("every
 * principal INCLUDING Super Admin is refused when approving their own request")
 * true rather than aspirational. §3.1: "If the root principal can do both, the
 * control does not exist — it is a convention that happens to be followed."
 *
 * AZ-I1 — throws on denial; never returns a boolean a caller might forget.
 */
export async function authorize(
  ctx: AuthzContext,
  action: Action,
  resource?: Resource,
): Promise<void> {
  const p = requirePorts();

  // SE-2 — unknown actions DENY. The system fails closed.
  if (!isAction(action)) {
    throw new AuthorizationError(
      action,
      'unknown_action',
      `Unknown action "${String(action)}" — denying.`,
    );
  }
  const definition = REGISTRY[action];

  // ── 1. Authentication and account state ────────────────────────────
  // Performed by middleware BEFORE this call: session version compared,
  // account active. See platform/http/context.ts.

  // ── 2. Segregation of duties — BEFORE any privilege ────────────────
  await assertSegregationOfDuties(ctx, action, resource, p.audit);

  // ── 3. Absolute constraints A1..A4 — also before privilege ─────────
  await assertConstraints(ctx, action, resource, 'absolute');

  // ── 4. Super Admin bypass ──────────────────────────────────────────
  // globalAccess is DERIVED, never read from storage (PRD §4.7).
  if (globalAccess(ctx.principal)) {
    p.audit.superAdminBypass(ctx, action, resource);
    return;
  }

  // ── 4b. Service accounts carry their own policy object ─────────────
  // SV-1: "A service account NEVER inherits a Position policy and can never be
  // assigned one. The two models do not mix." So it does not fall through to
  // policy resolution below.
  if (ctx.principal.accountType === 'service') {
    if (ctx.principal.expiresAt.getTime() <= p.now().getTime()) {
      throw new AuthorizationError(action, 'expired_credential', 'SV-3: credential has expired.');
    }
    // SV-5 — a service account can never hold these.
    if (definition.grantPolicy.superAdminOnly) {
      throw new AuthorizationError(
        action,
        'service_not_permitted',
        `SV-5: ${action} is a protected capability and is never held by a service account.`,
      );
    }
    if (!ctx.principal.allowedActions.includes(action)) {
      throw new AuthorizationError(
        action,
        'service_not_permitted',
        `SV-2: ${action} is not in this credential's explicit allowedActions.`,
      );
    }
    await assertConstraints(ctx, action, resource, 'privileged');
    if (definition.sensitive) p.audit.sensitiveUse(ctx, action, resource);
    return;
  }

  // ── 5. Privileged constraints P1..P8 ───────────────────────────────
  await assertConstraints(ctx, action, resource, 'privileged');

  // ── 6. Policy resolution ───────────────────────────────────────────
  const policy = await resolvePolicy(ctx, action);
  if (!policy || !policy.allowed) {
    throw new AuthorizationError(
      action,
      policy ? 'not_allowed' : 'no_policy',
      `No policy grants ${action} to this principal.`,
    );
  }

  // ── 7. Scope — delegated to the resource policy ────────────────────
  if (resource !== undefined) {
    if (definition.resource !== null && definition.resource !== resource.type) {
      throw new AuthorizationConfigError(
        `${action} declares resource "${definition.resource}" but was given "${resource.type}".`,
        action,
      );
    }

    const rp = policyFor(resource.type);
    const domain = resolveDomain(rp, resource);

    // PD-1 — evaluating `all-people` against a business-domain resource is a
    // PROGRAMMING ERROR that fails closed and logs as a defect, not a denial.
    // The distinction matters: this pages an engineer; a denial does not.
    if (!isScopeDefinedForDomain(policy.scope, domain)) {
      p.audit.defect(
        ctx,
        `PD-1: scope "${policy.scope}" is undefined against ${domain}-domain resource ` +
          `"${resource.type}" for action ${action}.`,
        action,
      );
      throw new AuthorizationError(
        action,
        'domain_mismatch',
        `PD-1: scope "${policy.scope}" is not defined for the ${domain} domain.`,
      );
    }

    const inScope = await rp.check(evalContext(ctx), action, resource, policy.scope);
    if (!inScope) {
      throw new AuthorizationError(
        action,
        'out_of_scope',
        `${resource.type}:${resource.id} is outside this principal's ${policy.scope} scope.`,
      );
    }
  }

  // ── 8. Constraints declared on the policy itself ───────────────────
  if (policy.constraints && policy.constraints.length > 0) {
    await assertConstraints(ctx, action, resource, 'privileged');
  }

  // ── 9. Field projection ────────────────────────────────────────────
  // Applied by `project()` at the response boundary, not here (AZ-I4).

  // ── 10. Audit — sensitive actions on USE, not only on grant (SE-7) ─
  // 65 of the 147 registry actions are sensitive.
  if (definition.sensitive) {
    p.audit.sensitiveUse(ctx, action, resource);
  }
}

/* ==================================================================== *
 * visibilityFilter — list queries
 * ==================================================================== */

/**
 * AZ-2 — list endpoints build their filter from the scope BEFORE querying.
 * AZ-I2 — returns MATCH_NOTHING on denial, NEVER an empty fragment.
 * AZ-4 — counts, exports and reports use this same function as the list they
 *        summarize. "A count that reveals the existence of invisible records is
 *        a leak."
 */
export async function visibilityFilter(
  ctx: AuthzContext,
  action: Action,
  resourceType?: string,
): Promise<SqlFragment> {
  const p = requirePorts();

  if (!isAction(action)) return MATCH_NOTHING;
  const definition = REGISTRY[action];
  const type = resourceType ?? definition.resource;
  if (type === null) return MATCH_NOTHING;

  // Super Admin sees the whole organization — but never across organizations.
  // MT-6: "Super Admin is scoped to ONE organization." The tenant predicate is
  // applied by the DAL and by RLS regardless of what this returns.
  if (globalAccess(ctx.principal)) {
    p.audit.superAdminBypass(ctx, action);
    return { sql: 'TRUE', parameters: [] };
  }

  const policy = await resolvePolicy(ctx, action);
  if (!policy || !policy.allowed) return MATCH_NOTHING;

  const rp = policyFor(type);

  // PD-1 again, on the list path. A fixed-domain resource can be checked here;
  // a derived-domain one is checked per instance at step 7 of `authorize`.
  if (typeof rp.domain === 'string' && !isScopeDefinedForDomain(policy.scope, rp.domain)) {
    p.audit.defect(
      ctx,
      `PD-1: scope "${policy.scope}" is undefined against ${rp.domain}-domain resource "${type}".`,
      action,
    );
    return MATCH_NOTHING;
  }

  return rp.filter(evalContext(ctx), action, policy.scope);
}

/* ==================================================================== *
 * project — serialization
 * ==================================================================== */

/**
 * AZ-I3 / AZ-5 — DELETES denied keys from the object. It does not set them to
 * null: "A field the caller cannot see is OMITTED from the response, not
 * nulled." A null tells the caller the field exists and they cannot have it,
 * which for `Deal.commercials` is itself information (AC-4d).
 *
 * AZ-I4 — serialization happens ONCE, at the response boundary, and every
 * response passes through it. Handlers return domain objects; the framework
 * serializes.
 */
export async function project<T extends Record<string, unknown>>(
  ctx: AuthzContext,
  action: Action,
  record: T,
  resourceType?: string,
): Promise<Partial<T>> {
  if (!isAction(action)) return {};

  const definition = REGISTRY[action];
  const type = resourceType ?? definition.resource;
  if (type === null) return record;

  if (globalAccess(ctx.principal)) return record;

  const policy = await resolvePolicy(ctx, action);
  const held = await heldActions(ctx);

  return projectRecord(record, {
    fieldPolicy: policyFor(type).fieldPolicy,
    allowedFields: policy?.fields,
    heldActions: held,
  });
}

/* ==================================================================== *
 * Internals
 * ==================================================================== */

/**
 * TECH.md §6.4 — resolved once and memoised per request, then Redis.
 *
 * AZ-I5: the cached set's deadline is the earliest override expiry, so a cached
 * set can never outlive one. AZ-I6: expiry is evaluated at RESOLUTION time.
 */
async function resolvePolicy(
  ctx: AuthzContext,
  action: Action,
): Promise<PermissionPolicy | null> {
  const set = await requirePorts().policies.resolveSet(ctx);
  return set.policies[action] ?? null;
}

async function heldActions(ctx: AuthzContext): Promise<ReadonlySet<Action>> {
  const set = await requirePorts().policies.resolveSet(ctx);
  const held = new Set<Action>();
  for (const [action, policy] of Object.entries(set.policies)) {
    if (policy?.allowed) held.add(action as Action);
  }
  return held;
}

/**
 * The one sanctioned boolean form, for rendering UI affordances and for
 * constraint predicates like P2's `hasPolicy(p, 'payroll:manage')`.
 *
 * Deliberately NOT exported as `can()`: it must never stand in for `authorize`
 * on a request path. CI-19 asserts no route handler calls it in place of the
 * framework's binding.
 */
export async function holdsPolicy(ctx: AuthzContext, action: Action): Promise<boolean> {
  if (globalAccess(ctx.principal)) return true;
  const policy = await resolvePolicy(ctx, action);
  return policy?.allowed === true;
}
