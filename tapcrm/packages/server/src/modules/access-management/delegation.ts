import { effectivePolicy, type PolicyEvaluationContext } from '@tapcrm/authz';
import {
  REGISTRY,
  globalAccess,
  isScopeDefinedForDomain,
  isWithinCeiling,
  type Action,
  type Scope,
} from '@tapcrm/contracts';
import { ACCESS_ERROR_CODES, AccessValidationError } from './errors.js';

/**
 * The delegation guard — PRD §4.6.
 *
 * Four constraints stand between "holds `access:delegate`" and "may write THIS
 * grant". The framework's `authorize()` answered the first question before the
 * handler ran; this answers the second, about the payload.
 *
 * It lives here rather than in the authorization engine because engine
 * constraints judge `(ctx, action, resource)` — a resource being acted upon —
 * whereas these judge a proposed policy. `effectivePolicy()` is exported by the
 * engine for exactly this ("ceiling validation by domain services"), and the
 * organization module already validates position policies the same way.
 */

export interface ProposedGrant {
  readonly action: Action;
  readonly allowed: boolean;
  readonly scope: Scope;
  readonly fields: readonly string[] | null;
}

export interface DelegationTarget {
  readonly id: string;
  readonly organizationId: string;
  readonly departmentId: string | null;
  readonly teamId: string | null;
  readonly organizationalLevel: number;
}

function refuse(code: string, message: string, details: Record<string, unknown>): never {
  throw new AccessValidationError(code, message, details);
}

/**
 * Is the target inside the actor's reach for `access:delegate`?
 *
 * Implemented against the scope resolver rather than by reusing the employee
 * module's `userPolicy`: a module may not import another module's policy
 * (TECH.md §3), and the boundary question here is about a person, which the
 * resolver already answers.
 */
async function withinBoundary(
  ctx: PolicyEvaluationContext,
  target: DelegationTarget,
  scope: Scope,
): Promise<boolean> {
  if (target.organizationId !== ctx.organizationId) return false;

  switch (scope) {
    case 'all-people':
      return true;
    case 'department': {
      const department = await ctx.scope.departmentId(ctx);
      return department !== null && target.departmentId === department;
    }
    case 'team':
      return target.teamId !== null && (await ctx.scope.teamIds(ctx)).has(target.teamId);
    case 'pool':
      return (await ctx.scope.poolMemberIds(ctx)).has(target.id);
    case 'participant':
      // No two-sided record exists between two people, so the only person an
      // actor is a named party to is themselves — which seniority already bars.
      return target.id === ctx.principal.id;
    case 'own':
      return target.id === ctx.principal.id;
  }
}

export async function assertDelegationAllowed(
  ctx: PolicyEvaluationContext,
  grant: ProposedGrant,
  target: DelegationTarget,
): Promise<void> {
  const definition = REGISTRY[grant.action];

  /* ---- Domain validity (PD-1), before anything else ----
   * A scope undefined for the action's domain is a programming error, not a
   * permission question, so it is refused before we ask who is asking. */
  const domain = definition.domain === 'derived' ? 'people' : definition.domain;
  if (!isScopeDefinedForDomain(grant.scope, domain)) {
    refuse(
      ACCESS_ERROR_CODES.OVERRIDE_SCOPE_INVALID_FOR_DOMAIN,
      `Scope "${grant.scope}" is undefined for ${domain}-domain action "${grant.action}"`,
      { unmet: ['domain'], action: grant.action, scope: grant.scope, domain },
    );
  }

  /* ---- Root of trust, and delegability ----
   * Two separate refusals the registry already distinguishes:
   *
   *   superAdminOnly actions         reserved TO Super Admin — access:delegate
   *                                    remains one of them (§4.6)
   *   delegationAllowed=false (65)     not handed out by a delegate at all. Every
   *                                    sensitive action is in here, by the CHECK
   *                                    constraint in migration 0002.
   *
   * Both are conditions on a DELEGATE. Super Admin is the root authority, not a
   * delegate, so neither binds them — PD-4 says the same of mandatory field
   * policies: "changed only by Super Admin". */
  const isSuperAdmin = globalAccess(ctx.principal);
  if (!isSuperAdmin) {
    if (definition.grantPolicy.superAdminOnly) {
      refuse(
        ACCESS_ERROR_CODES.DELEGATION_ROOT_OF_TRUST,
        `"${grant.action}" may only be granted by Super Admin`,
        { unmet: ['root-of-trust'], action: grant.action },
      );
    }
    if (!definition.grantPolicy.delegationAllowed) {
      refuse(
        ACCESS_ERROR_CODES.DELEGATION_NOT_DELEGABLE,
        `"${grant.action}" cannot be granted by delegation`,
        {
          unmet: ['delegable'],
          action: grant.action,
          sensitive: definition.sensitive,
        },
      );
    }
  }

  // The remaining three constrain a delegate, not the root of trust. The engine
  // audits the Super Admin bypass separately.
  if (isSuperAdmin) return;

  /* ---- Ceiling ----
   * Skipped for a revocation: taking access away cannot exceed what the actor
   * holds. */
  if (grant.allowed) {
    const ceiling = await effectivePolicy(ctx, grant.action);
    if (ceiling === null || !ceiling.allowed) {
      refuse(
        ACCESS_ERROR_CODES.DELEGATION_CEILING_EXCEEDED,
        `Cannot grant "${grant.action}" — you do not hold it`,
        { unmet: ['ceiling'], action: grant.action, heldScope: null },
      );
    }
    if (!isWithinCeiling(grant.scope, ceiling.scope)) {
      refuse(
        ACCESS_ERROR_CODES.DELEGATION_CEILING_EXCEEDED,
        `Cannot grant "${grant.action}" at "${grant.scope}" — you hold "${ceiling.scope}"`,
        {
          unmet: ['ceiling'],
          action: grant.action,
          requestedScope: grant.scope,
          heldScope: ceiling.scope,
        },
      );
    }
    // Field narrowing cannot widen: you cannot grant sight of a field you
    // cannot read yourself.
    if (ceiling.fields !== undefined) {
      const beyond = (grant.fields ?? []).filter((field) => !ceiling.fields?.includes(field));
      if (grant.fields === null || beyond.length > 0) {
        refuse(
          ACCESS_ERROR_CODES.DELEGATION_CEILING_EXCEEDED,
          `Cannot grant fields of "${grant.action}" beyond your own`,
          {
            unmet: ['ceiling'],
            action: grant.action,
            heldFields: ceiling.fields,
            beyondCeiling: grant.fields === null ? 'all' : beyond,
          },
        );
      }
    }
  }

  /* ---- Seniority ----
   * Strictly lower. Equal level fails, which also stops an actor editing their
   * own access. */
  const actorLevel =
    'organizationalLevel' in ctx.principal ? ctx.principal.organizationalLevel : 0;
  if (target.organizationalLevel >= actorLevel) {
    refuse(
      ACCESS_ERROR_CODES.DELEGATION_SENIORITY,
      "The target's organizational level must be strictly below your own",
      {
        unmet: ['seniority'],
        actorLevel,
        targetLevel: target.organizationalLevel,
      },
    );
  }

  /* ---- Boundary ----
   * The target must sit inside the actor's own reach for access:delegate. */
  const delegatePolicy = await effectivePolicy(ctx, 'access:delegate');
  const delegateScope: Scope | null =
    delegatePolicy !== null && delegatePolicy.allowed ? delegatePolicy.scope : null;
  if (delegateScope === null || !(await withinBoundary(ctx, target, delegateScope))) {
    refuse(
      ACCESS_ERROR_CODES.DELEGATION_BOUNDARY,
      'The target is outside the people you may manage access for',
      { unmet: ['boundary'], delegateScope, targetId: target.id },
    );
  }
}
