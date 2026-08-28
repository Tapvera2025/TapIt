import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { NotFoundError } from '../../platform/http/error-handler.js';

export interface PolicyInput {
  readonly action: string;
  readonly allowed?: boolean | undefined;
  readonly scope: 'own' | 'participant' | 'pool' | 'team' | 'department' | 'all-people';
  readonly fields?: readonly string[] | null | undefined;
  readonly constraints?: readonly string[] | null | undefined;
}

export interface PolicySnapshot {
  readonly action: string;
  readonly allowed: boolean;
  readonly scope: string;
  readonly fields: readonly string[] | null;
  readonly constraints: readonly string[] | null;
}

export interface PolicyChange {
  readonly action: string;
  readonly before: {
    allowed: boolean;
    scope: string;
    fields: readonly string[] | null;
    constraints: readonly string[] | null;
  } | null;
  readonly after: {
    allowed: boolean;
    scope: string;
    fields: readonly string[] | null;
    constraints: readonly string[] | null;
  } | null;
  readonly type: 'added' | 'removed' | 'changed';
}

export interface PositionImpactPreview {
  readonly position: {
    id: string;
    code: string;
    name: string;
    departmentId: string;
    organizationalLevel: number;
    status: string;
  };
  readonly holderCount: number;
  readonly holders: readonly {
    id: string;
    fullName: string;
    email: string | null;
  }[];
  readonly currentPolicies: readonly PolicySnapshot[];
  readonly proposedPolicies: readonly PolicySnapshot[];
  readonly added: readonly PolicyChange[];
  readonly removed: readonly PolicyChange[];
  readonly changed: readonly PolicyChange[];
}

function normalisePolicy(policy: PolicyInput | PolicySnapshot): PolicySnapshot {
  return {
    action: policy.action,
    allowed: policy.allowed ?? true,
    scope: policy.scope,
    fields:
      policy.fields === null || policy.fields === undefined
        ? null
        : [...new Set(policy.fields)].sort(),
    constraints:
      policy.constraints === null || policy.constraints === undefined
        ? null
        : [...new Set(policy.constraints)].sort(),
  };
}

function sameArray(
  left: readonly string[] | null,
  right: readonly string[] | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function samePolicy(left: PolicySnapshot, right: PolicySnapshot): boolean {
  return (
    left.allowed === right.allowed &&
    left.scope === right.scope &&
    sameArray(left.fields, right.fields) &&
    sameArray(left.constraints, right.constraints)
  );
}

function diffPolicies(
  current: readonly PolicySnapshot[],
  proposed: readonly PolicySnapshot[],
): {
  added: PolicyChange[];
  removed: PolicyChange[];
  changed: PolicyChange[];
} {
  const currentMap = new Map(current.map((policy) => [policy.action, policy]));

  const proposedMap = new Map(proposed.map((policy) => [policy.action, policy]));

  const added: PolicyChange[] = [];
  const removed: PolicyChange[] = [];
  const changed: PolicyChange[] = [];

  for (const [action, after] of proposedMap) {
    const before = currentMap.get(action);

    if (!before) {
      added.push({
        action,
        before: null,
        after: {
          allowed: after.allowed,
          scope: after.scope,
          fields: after.fields,
          constraints: after.constraints,
        },
        type: 'added',
      });
      continue;
    }

    if (!samePolicy(before, after)) {
      changed.push({
        action,
        before: {
          allowed: before.allowed,
          scope: before.scope,
          fields: before.fields,
          constraints: before.constraints,
        },
        after: {
          allowed: after.allowed,
          scope: after.scope,
          fields: after.fields,
          constraints: after.constraints,
        },
        type: 'changed',
      });
    }
  }

  for (const [action, before] of currentMap) {
    if (!proposedMap.has(action)) {
      removed.push({
        action,
        before: {
          allowed: before.allowed,
          scope: before.scope,
          fields: before.fields,
          constraints: before.constraints,
        },
        after: null,
        type: 'removed',
      });
    }
  }

  return {
    added,
    removed,
    changed,
  };
}

async function readCurrentPolicies(
  tx: Tx,
  organizationId: string,
  positionId: string,
): Promise<PolicySnapshot[]> {
  return tx.query<PolicySnapshot>(
    sql`
      SELECT
        action,
        allowed,
        scope,
        fields,
        constraints
      FROM position_policy
      WHERE organization_id = ${organizationId}
        AND position_id = ${positionId}
      ORDER BY action
    `,
  );
}

export async function buildPositionImpactPreview(
  ctx: RequestContext,
  positionId: string,
  proposedPolicies: readonly PolicyInput[],
): Promise<PositionImpactPreview> {
  const position = await db.maybeOne<{
    id: string;
    code: string;
    name: string;
    departmentId: string;
    organizationalLevel: number;
    status: string;
  }>(
    ctx,
    sql`
      SELECT
        id,
        code,
        name,
        department_id AS "departmentId",
        organizational_level AS "organizationalLevel",
        status
      FROM position
      WHERE id = ${positionId}
        AND organization_id = ${ctx.organizationId}
    `,
  );

  if (!position) {
    throw new NotFoundError('Position');
  }

  const currentPolicies = await db.query<PolicySnapshot>(
    ctx,
    sql`
      SELECT
        action,
        allowed,
        scope,
        fields,
        constraints
      FROM position_policy
      WHERE organization_id = ${ctx.organizationId}
        AND position_id = ${positionId}
      ORDER BY action
    `,
  );

  const holders = await db.query<{
    id: string;
    fullName: string;
    email: string | null;
  }>(
    ctx,
    sql`
      SELECT
        id,
        full_name AS "fullName",
        email
      FROM app_user
      WHERE organization_id = ${ctx.organizationId}
        AND position_id = ${positionId}
        AND account_type = 'employee'
        AND status = 'active'
      ORDER BY full_name
    `,
  );

  const proposed = proposedPolicies.map(normalisePolicy);

  const duplicateActions = new Set<string>();

  for (const policy of proposed) {
    if (duplicateActions.has(policy.action)) {
      throw new Error(`Duplicate policy action: ${policy.action}`);
    }

    duplicateActions.add(policy.action);
  }

  const current = currentPolicies.map(normalisePolicy);

  const diff = diffPolicies(current, proposed);

  return {
    position,
    holderCount: holders.length,
    holders,
    currentPolicies: current,
    proposedPolicies: proposed,
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
  };
}

export async function readPositionPoliciesForTransaction(
  tx: Tx,
  organizationId: string,
  positionId: string,
): Promise<PolicySnapshot[]> {
  return readCurrentPolicies(tx, organizationId, positionId);
}
