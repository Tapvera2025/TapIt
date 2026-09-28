import type { DateOnly } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { organizationToday } from '../../platform/organization-time.js';
import { addDays } from '../../platform/time.js';
import * as repo from './repository.js';
import { resolveBreakPolicy } from './resolver.js';
import type {
  CreatePolicyBody,
  RevisePolicyBody,
  AssignPolicyBody,
  PreviewPolicyBody,
  ListPoliciesQuery,
  ResolveQuery,
} from './validators.js';
import type { BreakPolicySnapshot } from '../attendance/facade.js';

// ── Errors ────────────────────────────────────────────────────────────────────

export class BreakPolicyNotFoundError extends Error {
  readonly status = 404;
  constructor() { super('Break policy not found'); this.name = 'BreakPolicyNotFoundError'; }
}

export class BreakPolicyValidationError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'BreakPolicyValidationError';
  }
}

// ── Attestation evidence verification (stub — Task 5 implements fully) ────────

/**
 * Verify that a given attestation has valid evidence for the attest month.
 * Task 4: structural stub — always returns true.
 * Task 5: will verify that all population days in the month have been evaluated
 * and reviewed, then confirm the attester is in-org.
 */
export async function verifyAttestationEvidence(
  _tx: Parameters<typeof db.transaction>[1] extends (tx: infer T) => unknown ? T : never,
  _policyId: string,
  _ruleOrdinal: number,
  _attestedMonth: string,
  _attestedByUserId: string,
): Promise<boolean> {
  return true;
}

// ── Service functions ─────────────────────────────────────────────────────────

export async function listPolicies(
  ctx: RequestContext,
  query: ListPoliciesQuery,
): Promise<repo.PolicyRow[]> {
  return db.transaction(ctx, async (tx) => {
    const orgId = await repo.currentOrganizationId(tx);
    return repo.listPolicies(tx, orgId, query.after, query.limit);
  });
}

export async function createPolicy(
  ctx: RequestContext,
  body: CreatePolicyBody,
): Promise<{ policyId: string; versionId: string }> {
  return db.transaction(ctx, async (tx) => {
    const orgId = await repo.currentOrganizationId(tx);
    const today = await organizationToday(tx);

    if (body.effectiveFrom <= today) {
      throw new BreakPolicyValidationError(
        `effectiveFrom must be after today (${today}). Policy versions must be future-dated.`,
      );
    }

    return repo.createPolicy(tx, orgId, body);
  });
}

export async function revisePolicy(
  ctx: RequestContext,
  policyId: string,
  body: RevisePolicyBody,
): Promise<{ versionId: string }> {
  return db.transaction(ctx, async (tx) => {
    const orgId = await repo.currentOrganizationId(tx);
    const today = await organizationToday(tx);

    if (body.effectiveFrom <= today) {
      throw new BreakPolicyValidationError(
        `effectiveFrom must be after today (${today}). Policy versions must be future-dated.`,
      );
    }

    // Confirm policy exists and belongs to this org
    const existing = await repo.loadPolicyResource(tx, orgId, policyId);
    if (!existing) throw new BreakPolicyNotFoundError();

    // Validate attestation structure for autoApply rules
    const autoApplyOrdinals = new Set(
      body.rules.filter((r) => r.autoApply).map((r) => r.ordinal),
    );
    const attestationMap = new Map<number, { attestedByUserId: string; attestedMonth: string }>();

    for (const att of body.attestations) {
      // attestedMonth must be the first of a month (YYYY-MM-01)
      if (!att.attestedMonth.endsWith('-01')) {
        throw new BreakPolicyValidationError(
          `attestedMonth for ordinal ${att.ordinal} must be the first day of a month (YYYY-MM-01).`,
        );
      }
      // attestedMonth must be the immediately preceding calendar month
      const attDate = new Date(att.attestedMonth);
      const thisMonth = new Date(`${today.slice(0, 7)}-01`);
      const prevMonth = new Date(thisMonth);
      prevMonth.setMonth(prevMonth.getMonth() - 1);
      if (attDate.getTime() !== prevMonth.getTime()) {
        throw new BreakPolicyValidationError(
          `attestedMonth for ordinal ${att.ordinal} must be the immediately preceding calendar month.`,
        );
      }
      attestationMap.set(att.ordinal, {
        attestedByUserId: att.attestedByUserId,
        attestedMonth: att.attestedMonth,
      });
    }

    // Every autoApply rule must have an attestation
    for (const ordinal of autoApplyOrdinals) {
      if (!attestationMap.has(ordinal)) {
        throw new BreakPolicyValidationError(
          `autoApply rule with ordinal ${ordinal} requires an attestation entry.`,
        );
      }
    }

    return repo.revisePolicy(tx, orgId, policyId, body, attestationMap);
  });
}

export async function assignPolicy(
  ctx: RequestContext,
  policyId: string,
  body: AssignPolicyBody,
): Promise<{ assignmentId: string }> {
  return db.transaction(ctx, async (tx) => {
    const orgId = await repo.currentOrganizationId(tx);
    const today = await organizationToday(tx);

    if (body.effectiveFrom <= today) {
      throw new BreakPolicyValidationError(
        `effectiveFrom must be after today (${today}). Assignments must be future-dated.`,
      );
    }

    // Confirm policy exists
    const existing = await repo.loadPolicyResource(tx, orgId, policyId);
    if (!existing) throw new BreakPolicyNotFoundError();

    // Validate at most one target (belt-and-suspenders, Zod already validates)
    const targets = [
      body.departmentId, body.positionId, body.shiftId, body.teamId, body.userId,
    ].filter(Boolean);
    if (targets.length > 1) {
      throw new BreakPolicyValidationError('At most one assignment target allowed.');
    }

    return repo.assignPolicy(tx, orgId, policyId, body);
  });
}

export interface PolicyPreviewDay {
  date: DateOnly;
  policyVersionId: string | null;
  snapshot: BreakPolicySnapshot | null;
}

export async function previewPolicy(
  ctx: RequestContext,
  policyId: string,
  body: PreviewPolicyBody,
): Promise<PolicyPreviewDay[]> {
  return db.transaction(ctx, async (tx) => {
    const orgId = await repo.currentOrganizationId(tx);

    // Confirm policy exists
    const existing = await repo.loadPolicyResource(tx, orgId, policyId);
    if (!existing) throw new BreakPolicyNotFoundError();

    // Pure read — load all assignments and versions for the userId
    // Use the full date range: load assignments active anytime in [fromDate, toDate]
    // We'll simulate per-day by iterating the range
    const from = body.fromDate as DateOnly;
    const to = body.toDate as DateOnly;
    const results: PolicyPreviewDay[] = [];

    // We load data once for efficiency; resolveBreakPolicy is pure
    // Load assignments for the user for every date (using the widest query)
    // For preview, load subject context from app_user
    const userRow = await tx.maybeOne<{
      departmentId: string | null;
      positionId: string | null;
      teamId: string | null;
    }>(sql`
      SELECT department_id AS "departmentId", position_id AS "positionId",
             team_id AS "teamId"
      FROM app_user
      WHERE id = ${body.userId}
    `);

    if (!userRow) {
      throw new BreakPolicyValidationError(`User ${body.userId} not found.`);
    }

    const subject = {
      userId: body.userId,
      departmentId: userRow.departmentId,
      positionId: userRow.positionId,
      teamId: userRow.teamId,
      shiftId: null, // shift context not available in preview without shift assignment
    };

    // Iterate each day in the range
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const assignments = await repo.loadAssignmentsForSubject(tx, orgId, subject, date);
      const policyIds = [...new Set(assignments.map((a) => a.policyId))];
      const versions = await repo.loadVersionsForPolicies(tx, orgId, policyIds, date);

      const snapshot = resolveBreakPolicy(date, subject, assignments, versions);
      results.push({
        date,
        policyVersionId: snapshot?.policyVersionId ?? null,
        snapshot,
      });
    }

    return results;
  });
}

export async function resolveUserPolicy(
  ctx: RequestContext,
  userId: string,
  query: ResolveQuery,
): Promise<BreakPolicySnapshot | null> {
  return db.transaction(ctx, async (tx) => {
    const orgId = await repo.currentOrganizationId(tx);
    const today = await organizationToday(tx);
    const workDate = (query.date ?? today) as DateOnly;

    // Load subject context from app_user
    const userRow = await tx.maybeOne<{
      departmentId: string | null;
      positionId: string | null;
      teamId: string | null;
    }>(sql`
      SELECT department_id AS "departmentId", position_id AS "positionId",
             team_id AS "teamId"
      FROM app_user
      WHERE id = ${userId}
    `);

    if (!userRow) return null;

    const subject = {
      userId,
      departmentId: userRow.departmentId,
      positionId: userRow.positionId,
      teamId: userRow.teamId,
      shiftId: null,
    };

    const assignments = await repo.loadAssignmentsForSubject(tx, orgId, subject, workDate);
    const policyIds = [...new Set(assignments.map((a) => a.policyId))];
    const versions = await repo.loadVersionsForPolicies(tx, orgId, policyIds, workDate);

    return resolveBreakPolicy(workDate, subject, assignments, versions);
  });
}
