import type { Action, Scope } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import {
  clearActiveOverridesForPositionChange,
  enqueueAccessAudit,
  listCapabilityHolders,
} from './repository.js';

/**
 * Access management's public surface for other modules — MB-1, MB-5.
 *
 * Another module imports this file and nothing else from `access-management`.
 * Callers:
 *
 *   biometric  capabilityHolders — who is told about a device alert
 *   employee   clearOverridesForPositionChange — a direct placement change
 */

export interface CapabilityHolder {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string | null;
  /** Null for Super Admin, whose reach is the whole organization. */
  readonly scope: Scope | null;
}

/**
 * Everyone in the caller's organization who holds `action` now: position
 * policy, an active override in its place, or Super Admin — resolved the way
 * the authorization engine resolves it (AM-5).
 */
export async function capabilityHolders(
  ctx: RequestContext,
  action: Action,
): Promise<CapabilityHolder[]> {
  const rows = await listCapabilityHolders(ctx, action);
  return rows.map((row) => ({
    userId: row.id,
    fullName: row.fullName,
    email: row.email,
    scope: row.source === 'super-admin' ? null : row.scope,
  }));
}

/**
 * User overrides are relative to a position, so a position change ends them —
 * the same rule a role-change approval applies. Each one is audited.
 */
export async function clearOverridesForPositionChange(
  tx: Tx,
  ctx: RequestContext,
  userId: string,
): Promise<number> {
  const cleared = await clearActiveOverridesForPositionChange(tx, ctx.organizationId, userId);
  for (const override of cleared) {
    await enqueueAccessAudit(tx, ctx, {
      action: 'access.override_cleared_position_change',
      targetId: userId,
      before: { overrideId: override.id, action: override.action, scope: override.scope },
      after: null,
      reason: 'Position changed; user overrides are position-relative',
    });
  }
  return cleared.length;
}
