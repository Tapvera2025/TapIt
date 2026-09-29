import type { Action, Scope } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { listCapabilityHolders } from './repository.js';

/**
 * Access management's public surface for other modules — MB-1, MB-5.
 *
 * Another module imports this file and nothing else from `access-management`.
 * Callers:
 *
 *   biometric  capabilityHolders — who is told about a device alert
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
