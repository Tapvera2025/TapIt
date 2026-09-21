import { isAction, isScope, type Action, type Scope } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { scopeResolver } from '../../platform/authz-adapter.js';
import { db } from '../../platform/dal/db.js';
import { assertDelegationAllowed } from './delegation.js';
import { ACCESS_ERROR_CODES, AccessNotFoundError, AccessValidationError } from './errors.js';
import {
  enqueueAccessAudit,
  findDelegationTarget,
  insertOverride,
  revokeOverrideRow,
} from './repository.js';

export interface GrantOverrideInput {
  readonly userId: string;
  readonly action: string;
  readonly allowed: boolean;
  readonly scope: string;
  readonly fields: readonly string[] | null;
  readonly reason: string;
  readonly expiresAt: Date | null;
}

/**
 * AM-6 — an override is a full policy with a mandatory reason and an optional
 * expiry, not a boolean.
 *
 * The framework has already authorized `access:delegate` against the target
 * before this runs. What happens here is the §4.6 guard on the payload, then
 * the write and its audit record in one transaction.
 */
export async function grantOverride(
  ctx: RequestContext,
  input: GrantOverrideInput,
): Promise<{ id: string }> {
  if (!isAction(input.action)) {
    throw new AccessValidationError(
      ACCESS_ERROR_CODES.UNKNOWN_ACTION,
      `"${input.action}" is not an action in the registry`,
      { unmet: ['known-action'] },
    );
  }
  if (!isScope(input.scope)) {
    throw new AccessValidationError(
      ACCESS_ERROR_CODES.OVERRIDE_SCOPE_INVALID_FOR_DOMAIN,
      `"${input.scope}" is not a scope`,
      { unmet: ['known-scope'] },
    );
  }
  const reason = input.reason.trim();
  if (reason === '') {
    throw new AccessValidationError(
      ACCESS_ERROR_CODES.OVERRIDE_REASON_REQUIRED,
      'An override requires a reason (AM-6)',
      { unmet: ['reason'] },
    );
  }
  if (input.expiresAt !== null && input.expiresAt.getTime() <= Date.now()) {
    throw new AccessValidationError(
      ACCESS_ERROR_CODES.OVERRIDE_EXPIRY_IN_PAST,
      'An override expiry must be in the future',
      { unmet: ['expiry'] },
    );
  }

  const target = await findDelegationTarget(ctx, input.userId);
  if (target === null) {
    throw new AccessNotFoundError(ACCESS_ERROR_CODES.USER_NOT_FOUND, 'User not found');
  }

  const action: Action = input.action;
  const scope: Scope = input.scope;

  await assertDelegationAllowed(
    evaluationContext(ctx),
    { action, allowed: input.allowed, scope, fields: input.fields },
    target,
  );

  return db.transaction(ctx, async (tx) => {
    const created = await insertOverride(tx, {
      organizationId: ctx.organizationId,
      userId: input.userId,
      action,
      allowed: input.allowed,
      scope,
      fields: input.fields,
      reason,
      grantedBy: ctx.principal.id,
      expiresAt: input.expiresAt,
    });
    await enqueueAccessAudit(tx, ctx, {
      action: 'access.override_granted',
      targetId: input.userId,
      before: null,
      after: {
        overrideId: created.id,
        action,
        allowed: input.allowed,
        scope,
        fields: input.fields ?? null,
        expiresAt: input.expiresAt?.toISOString() ?? null,
      },
      reason,
    });
    return created;
  });
}

/** Revocation marks; it never deletes. AM-7: as auditable as the grant. */
export async function revokeOverride(
  ctx: RequestContext,
  overrideId: string,
): Promise<{ id: string; revoked: true }> {
  return db.transaction(ctx, async (tx) => {
    const revoked = await revokeOverrideRow(tx, ctx.organizationId, overrideId);
    if (revoked === null) {
      throw new AccessNotFoundError(
        ACCESS_ERROR_CODES.OVERRIDE_NOT_FOUND,
        'Override not found, or already revoked',
      );
    }
    await enqueueAccessAudit(tx, ctx, {
      action: 'access.override_revoked',
      targetId: revoked.userId,
      before: {
        overrideId: revoked.id,
        action: revoked.action,
        allowed: revoked.allowed,
        scope: revoked.scope,
      },
      after: null,
      reason: revoked.reason,
    });
    return { id: revoked.id, revoked: true as const };
  });
}

/**
 * The guard needs a `PolicyEvaluationContext`: a RequestContext plus the scope
 * resolver. The platform layer already owns one and the engine is configured
 * with it, so the module borrows that rather than building a second resolver
 * that could answer differently.
 */
function evaluationContext(ctx: RequestContext) {
  return { ...ctx, scope: scopeResolver };
}
