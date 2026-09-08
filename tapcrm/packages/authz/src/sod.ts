import type { Action } from '@tapcrm/contracts';
import { REGISTRY } from '@tapcrm/contracts';
import type { AuthzAuditPort, AuthzContext, Resource } from './ports.js';
import { AuthorizationError, AuthorizationConfigError } from './errors.js';

/**
 * Segregation of duties — TECH.md §6.8, PRD A1 / SD-1..SD-5.
 *
 * This runs at pipeline step 2, BEFORE the Super Admin bypass (AZ-I13).
 * Super Admin is refused here like everyone else. AC-3 requires a test proving
 * it for every approval-bearing action.
 *
 * A1 is emphatic about why each action declares its own initiator field:
 *
 *   "Each approval-bearing action declares which field names its initiator —
 *    there is no universal `raisedBy`, and assuming one would silently disable
 *    the control wherever the field is named differently."
 */
export async function assertSegregationOfDuties(
  ctx: AuthzContext,
  action: Action,
  resource: Resource | undefined,
  audit: AuthzAuditPort,
): Promise<void> {
  const definition = REGISTRY[action];

  // Not an approval-bearing action — nothing to segregate.
  if (!definition.approvalBearing) return;

  // AZ-I11 / GP-5 / CI-7 — an approvalBearing action with a null initiatorField
  // fails the BUILD, so this branch is unreachable in a shipped artifact. It
  // exists to make that guarantee explicit rather than assumed.
  if (definition.initiatorField === null) {
    throw new AuthorizationConfigError(
      `${action} is approvalBearing but declares no initiatorField (GP-5). ` +
        'This should have failed CI-7.',
      action,
    );
  }

  // No resource means no initiator to compare against. Deny: an approval
  // decision without the item being decided is not a decision.
  if (resource === undefined) {
    throw new AuthorizationError(
      action,
      'sod_unresolved',
      `${action} is approval-bearing and requires a resource to check its initiator against.`,
    );
  }

  const initiator = readField(resource, definition.initiatorField);

  // AZ-I12 / SD-B — "A declared field MISSING from the record DENIES. A
  // segregation control that silently passes when the schema drifts is worse
  // than none, because it is believed."
  if (initiator === undefined) {
    throw new AuthorizationError(
      action,
      'sod_unresolved',
      `${action}: declared initiator field "${definition.initiatorField}" is absent from ` +
        `${resource.type}:${resource.id}. Denying rather than passing (SD-B).`,
    );
  }

  if (initiator !== null && initiator === ctx.principal.id) {
    // SD-5 — every enforcement is logged, so a blocked self-approval is
    // visible rather than silent.
    audit.segregationBlocked(ctx, action, resource);
    throw new AuthorizationError(
      action,
      'sod_self',
      `${action}: the initiator of an approval-bearing item may not be its approver (A1). ` +
        'This binds every principal including Super Admin.',
    );
  }
}

/**
 * Reads a possibly-dotted field path. Returns `undefined` when the path is
 * absent — which the caller treats as a denial, not a pass.
 */
function readField(resource: Resource, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = resource;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
