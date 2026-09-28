import type { DateOnly, Decimal } from '@tapcrm/contracts';
import { decimal } from '@tapcrm/contracts';
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
  ConfirmBreachBody,
  WaiveBreachBody,
  ExplanationBody,
  ListBreachesQuery,
} from './validators.js';
import type { BreakPolicySnapshot } from '../attendance/facade.js';
import {
  applyOverlay,
  removeOverlays,
  lockPerson,
} from '../attendance/facade.js';
import { breakDeductionWriter } from './ports.js';

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

// ── Breach review errors ──────────────────────────────────────────────────────

export class BreachNotFoundError extends Error {
  readonly status = 404;
  constructor() { super('Break breach not found'); this.name = 'BreachNotFoundError'; }
}

export class BreachSelfReviewError extends Error {
  readonly status = 403;
  constructor() { super('Reviewer cannot be the same person as the breach subject'); this.name = 'BreachSelfReviewError'; }
}

export class BreachTransitionError extends Error {
  readonly status = 422;
  constructor(message: string) { super(message); this.name = 'BreachTransitionError'; }
}

// ── Breach review service functions (Task 6) ─────────────────────────────────

/**
 * Confirm a pending/advisory breach.
 *
 * Enforces:
 * - Status must be 'pending' or 'advisory'
 * - Reviewer must not be the breach subject (anti-self-review)
 * - Writes overlay (for attendance consequences) or payroll deduction in the same TX
 */
export async function confirmBreach(
  ctx: RequestContext,
  breachId: string,
  _body: ConfirmBreachBody,
): Promise<{ id: string; status: string }> {
  return db.transaction(ctx, async (tx) => {
    const orgId = await repo.currentOrganizationId(tx);

    // Load breach FOR UPDATE (row lock)
    const breach = await repo.loadBreachForUpdate(tx, breachId);
    if (!breach) throw new BreachNotFoundError();

    // G4: forbid self-review
    if (breach.userId === ctx.principal.id) throw new BreachSelfReviewError();

    // Status guard
    if (breach.status === 'suppressed') {
      throw new BreachTransitionError('Cannot confirm a suppressed breach');
    }
    if (breach.status === 'waived') {
      throw new BreachTransitionError('Cannot confirm a waived breach');
    }
    if (breach.status === 'superseded') {
      throw new BreachTransitionError('Cannot confirm a superseded breach');
    }
    if (breach.status === 'confirmed') {
      throw new BreachTransitionError('Breach is already confirmed');
    }
    // Must be 'pending' or 'advisory'
    if (breach.status !== 'pending' && breach.status !== 'advisory') {
      throw new BreachTransitionError(`Cannot confirm breach in status '${breach.status}'`);
    }

    // Take person lock (D24)
    await lockPerson(tx, breach.userId);

    // Load matched rule to determine consequence
    let consequence: string | null = null;
    let ruleMinutes: number | null = null;
    let ruleAmount: string | null = null;

    if (breach.matchedRuleId !== null) {
      const rule = await repo.loadRuleForBreach(tx, orgId, breach.matchedRuleId);
      if (rule) {
        consequence = rule.consequence;
        ruleMinutes = rule.minutes;
        ruleAmount = rule.amount;
      }
    }

    // Apply attendance overlay or payroll deduction based on consequence
    if (
      consequence === 'mark-late' ||
      consequence === 'mark-half-day' ||
      consequence === 'mark-absent' ||
      consequence === 'deduct-minutes'
    ) {
      await applyOverlay(tx, {
        sourceKind: 'break-breach',
        sourceId: breach.id,
        userId: breach.userId,
        workDate: breach.workDate,
        kind: 'breach-consequence',
        consequence: consequence as 'mark-late' | 'mark-half-day' | 'mark-absent' | 'deduct-minutes',
        minutes: consequence === 'deduct-minutes' ? (ruleMinutes ?? null) : null,
      });
    } else if (consequence === 'deduct-amount') {
      // Compute periodStart: first day of the breach's work month
      const periodStart = (breach.workDate.slice(0, 7) + '-01') as DateOnly;
      await breakDeductionWriter().writeDeduction(tx, {
        organizationId: orgId,
        userId: breach.userId,
        periodStart,
        amount: decimal(ruleAmount ?? '0') as Decimal,
        label: `Break deduction – ${breach.workDate}`,
        breakBreachId: breach.id,
      });
    } else {
      // warn / notify-manager / require-explanation: no attendance/pay effect
      console.info(
        JSON.stringify({
          level: 'info',
          msg: 'break-breach confirmed with no-op consequence',
          breachId: breach.id,
          consequence,
        }),
      );
    }

    // Transition the breach status
    await repo.confirmBreach(tx, breachId, ctx.principal.id);

    return { id: breachId, status: 'confirmed' };
  });
}

/**
 * Waive a pending, advisory, or confirmed breach.
 *
 * Enforces:
 * - Must supply a non-empty reason
 * - Reviewer must not be the breach subject
 * - Removes any overlay or payroll deduction created during confirmation
 */
export async function waiveBreach(
  ctx: RequestContext,
  breachId: string,
  body: WaiveBreachBody,
): Promise<{ id: string; status: string }> {
  return db.transaction(ctx, async (tx) => {
    const orgId = await repo.currentOrganizationId(tx);

    // Load breach FOR UPDATE
    const breach = await repo.loadBreachForUpdate(tx, breachId);
    if (!breach) throw new BreachNotFoundError();

    // G4: forbid self-review
    if (breach.userId === ctx.principal.id) throw new BreachSelfReviewError();

    // Status guard — can waive pending, advisory, confirmed
    if (breach.status === 'suppressed') {
      throw new BreachTransitionError('Cannot waive a suppressed breach');
    }
    if (breach.status === 'superseded') {
      throw new BreachTransitionError('Cannot waive a superseded breach');
    }
    if (breach.status === 'waived') {
      throw new BreachTransitionError('Breach is already waived');
    }
    if (
      breach.status !== 'pending' &&
      breach.status !== 'advisory' &&
      breach.status !== 'confirmed'
    ) {
      throw new BreachTransitionError(`Cannot waive breach in status '${breach.status}'`);
    }

    // Take person lock (D24)
    await lockPerson(tx, breach.userId);

    // Load matched rule to determine if we need to revoke a deduction
    let consequence: string | null = null;
    if (breach.matchedRuleId !== null) {
      const rule = await repo.loadRuleForBreach(tx, orgId, breach.matchedRuleId);
      if (rule) consequence = rule.consequence;
    }

    // Remove overlay (covers mark-late, mark-half-day, mark-absent, deduct-minutes)
    await removeOverlays(tx, 'break-breach', breachId);

    // Revoke payroll deduction if applicable
    if (consequence === 'deduct-amount') {
      await breakDeductionWriter().revokeDeduction(tx, breachId);
    }

    // Transition the breach status
    await repo.waiveBreach(tx, breachId, ctx.principal.id, body.reason);

    return { id: breachId, status: 'waived' };
  });
}

/**
 * Add or update an explanation on a breach that requires one.
 * Own-scope: only the breach subject may submit their own explanation.
 */
export async function addExplanation(
  ctx: RequestContext,
  breachId: string,
  body: ExplanationBody,
): Promise<{ id: string }> {
  return db.transaction(ctx, async (tx) => {
    const breach = await repo.loadBreachForUpdate(tx, breachId);
    if (!breach) throw new BreachNotFoundError();

    // Own-scope enforcement (service-level, belt-and-suspenders)
    if (breach.userId !== ctx.principal.id) {
      throw new BreachTransitionError('Only the breach subject may add an explanation');
    }

    // Must be pending or confirmed to accept an explanation
    if (breach.status !== 'pending' && breach.status !== 'confirmed') {
      throw new BreachTransitionError(
        `Cannot add explanation to breach in status '${breach.status}'`,
      );
    }

    await repo.setBreachExplanation(tx, breachId, body.explanation);

    return { id: breachId };
  });
}

/**
 * List breaches for the organization with optional filters.
 */
export async function listBreaches(
  ctx: RequestContext,
  query: ListBreachesQuery,
): Promise<repo.BreachListRow[]> {
  return db.transaction(ctx, async (tx) => {
    const opts: Parameters<typeof repo.listBreaches>[2] = { limit: query.limit };
    if (query.userId !== undefined) opts.userId = query.userId;
    if (query.status !== undefined) opts.status = query.status;
    if (query.fromDate !== undefined) opts.fromDate = query.fromDate;
    if (query.toDate !== undefined) opts.toDate = query.toDate;
    if (query.after !== undefined) opts.after = query.after;
    return repo.listBreaches(tx, ctx.organizationId, opts);
  });
}
