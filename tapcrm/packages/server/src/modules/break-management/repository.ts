import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { CandidateAssignment, CandidateVersion, SubjectContext } from './resolver.js';
import type { CreatePolicyBody, RevisePolicyBody, AssignPolicyBody } from './validators.js';

/**
 * DB loaders for the break policy resolver (§13 BM design, Task 3).
 *
 * No imports from attendance internals — only facade.js of sibling modules.
 * Callers pass all context via parameters so the queries are composable and
 * independently testable.
 */

/**
 * Load all break_policy_assignment rows for the organization that are active
 * or potentially active on workDate (including future-dated ones that break-management
 * needs to resolve). For evaluation, the caller passes workDate to resolveBreakPolicy.
 */
export async function loadAssignmentsForSubject(
  tx: Tx,
  organizationId: string,
  subject: SubjectContext,
  workDate: DateOnly,
): Promise<CandidateAssignment[]> {
  return tx.query<CandidateAssignment>(sql`
    SELECT id AS "assignmentId", policy_id AS "policyId", priority,
           effective_from::text AS "effectiveFrom",
           effective_to::text AS "effectiveTo",
           department_id AS "departmentId", position_id AS "positionId",
           shift_id AS "shiftId", team_id AS "teamId", user_id AS "userId"
    FROM break_policy_assignment
    WHERE organization_id = ${organizationId}
      AND effective_from <= ${workDate}
      AND (effective_to IS NULL OR effective_to > ${workDate})
      AND (
        user_id = ${subject.userId}::uuid
        OR (team_id IS NOT NULL AND team_id = ${subject.teamId ?? null}::uuid)
        OR (shift_id IS NOT NULL AND shift_id = ${subject.shiftId ?? null}::uuid)
        OR (position_id IS NOT NULL AND position_id = ${subject.positionId ?? null}::uuid)
        OR (department_id IS NOT NULL AND department_id = ${subject.departmentId ?? null}::uuid)
        OR (department_id IS NULL AND position_id IS NULL AND shift_id IS NULL AND team_id IS NULL AND user_id IS NULL)
      )
  `);
}

export async function loadVersionsForPolicies(
  tx: Tx,
  organizationId: string,
  policyIds: readonly string[],
  workDate: DateOnly,
): Promise<CandidateVersion[]> {
  if (policyIds.length === 0) return [];
  return tx.query<CandidateVersion>(sql`
    SELECT id AS "versionId", policy_id AS "policyId",
           effective_from::text AS "effectiveFrom",
           upper_total_minutes AS "upperTotalMinutes",
           upper_single_minutes AS "upperSingleMinutes",
           lower_total_minutes AS "lowerTotalMinutes",
           lower_enforced AS "lowerEnforced",
           grace_minutes AS "graceMinutes",
           warning_percent AS "warningPercent",
           counts_toward_work_hours AS "countsTowardWorkHours"
    FROM break_policy_version
    WHERE organization_id = ${organizationId}
      AND policy_id = ANY(${[...policyIds]}::uuid[])
      AND effective_from <= ${workDate}
    ORDER BY policy_id, effective_from DESC
  `);
}

// ── Policy CRUD (Task 4) ───────────────────────────────────────────────────────

export interface PolicyRow {
  id: string;
  organizationId: string;
  name: string;
  createdAt: string;
}

export interface PenaltyRuleRow {
  id: string;
  organizationId: string;
  policyVersionId: string;
  ordinal: number;
  condition: string;
  occurrenceWindow: string;
  occurrenceCount: number;
  consequence: string;
  minutes: number | null;
  amount: string | null;
  autoApply: boolean;
  attestedBy: string | null;
  attestedMonth: string | null;
  attestedAt: string | null;
}

export interface VersionRow {
  id: string;
  organizationId: string;
  policyId: string;
  effectiveFrom: DateOnly;
  upperTotalMinutes: number | null;
  upperSingleMinutes: number | null;
  lowerTotalMinutes: number | null;
  lowerEnforced: boolean;
  graceMinutes: number;
  warningPercent: number;
  countsTowardWorkHours: boolean;
  createdAt: string;
}

export interface AssignmentRow {
  id: string;
  organizationId: string;
  policyId: string;
  priority: number;
  effectiveFrom: DateOnly;
  effectiveTo: DateOnly | null;
  departmentId: string | null;
  positionId: string | null;
  shiftId: string | null;
  teamId: string | null;
  userId: string | null;
  createdAt: string;
}

export interface FullPolicyRow extends PolicyRow {
  versions: VersionRow[];
  rules: PenaltyRuleRow[];
  assignments: AssignmentRow[];
}

export async function listPolicies(
  tx: Tx,
  organizationId: string,
  after?: string,
  limit: number = 20,
): Promise<PolicyRow[]> {
  return tx.query<PolicyRow>(sql`
    SELECT id, organization_id AS "organizationId", name, created_at::text AS "createdAt"
    FROM break_policy
    WHERE organization_id = ${organizationId}
      AND (${after ?? null} IS NULL OR id > ${after ?? null}::uuid)
    ORDER BY created_at, id
    LIMIT ${limit}
  `);
}

export async function createPolicy(
  tx: Tx,
  organizationId: string,
  input: CreatePolicyBody,
): Promise<{ policyId: string; versionId: string }> {
  // 1. Insert the policy identity row
  const policy = await tx.one<{ id: string }>(sql`
    INSERT INTO break_policy (organization_id, name)
    VALUES (${organizationId}, ${input.name})
    RETURNING id
  `);
  const policyId = policy.id;

  // 2. Insert the first version (immutable)
  const version = await tx.one<{ id: string }>(sql`
    INSERT INTO break_policy_version
      (organization_id, policy_id, effective_from,
       upper_total_minutes, upper_single_minutes, lower_total_minutes,
       lower_enforced, grace_minutes, warning_percent, counts_toward_work_hours)
    VALUES
      (${organizationId}, ${policyId}, ${input.effectiveFrom},
       ${input.upperTotalMinutes ?? null}, ${input.upperSingleMinutes ?? null},
       ${input.lowerTotalMinutes ?? null},
       ${input.lowerEnforced}, ${input.graceMinutes}, ${input.warningPercent},
       ${input.countsTowardWorkHours})
    RETURNING id
  `);
  const versionId = version.id;

  // 3. Insert rules (immutable, no attestation for create — no autoApply attestations here)
  for (const rule of input.rules) {
    await tx.query(sql`
      INSERT INTO break_penalty_rule
        (organization_id, policy_version_id, ordinal, condition, occurrence_window,
         occurrence_count, consequence, minutes, amount, auto_apply)
      VALUES
        (${organizationId}, ${versionId}, ${rule.ordinal}, ${rule.condition},
         ${rule.occurrenceWindow}, ${rule.occurrenceCount}, ${rule.consequence},
         ${rule.minutes ?? null}, ${rule.amount ?? null}, ${rule.autoApply})
    `);
  }

  return { policyId, versionId };
}

export async function revisePolicy(
  tx: Tx,
  organizationId: string,
  policyId: string,
  input: RevisePolicyBody,
  attestationMap: Map<number, { attestedByUserId: string; attestedMonth: string }>,
): Promise<{ versionId: string }> {
  // Insert a new version (immutable — never update existing)
  const version = await tx.one<{ id: string }>(sql`
    INSERT INTO break_policy_version
      (organization_id, policy_id, effective_from,
       upper_total_minutes, upper_single_minutes, lower_total_minutes,
       lower_enforced, grace_minutes, warning_percent, counts_toward_work_hours)
    VALUES
      (${organizationId}, ${policyId}, ${input.effectiveFrom},
       ${input.upperTotalMinutes ?? null}, ${input.upperSingleMinutes ?? null},
       ${input.lowerTotalMinutes ?? null},
       ${input.lowerEnforced}, ${input.graceMinutes}, ${input.warningPercent},
       ${input.countsTowardWorkHours})
    RETURNING id
  `);
  const versionId = version.id;

  // Insert new rules (immutable)
  for (const rule of input.rules) {
    const att = rule.autoApply ? attestationMap.get(rule.ordinal) : undefined;
    const attestedAt = att ? new Date() : null;
    await tx.query(sql`
      INSERT INTO break_penalty_rule
        (organization_id, policy_version_id, ordinal, condition, occurrence_window,
         occurrence_count, consequence, minutes, amount, auto_apply,
         attested_by, attested_month, attested_at)
      VALUES
        (${organizationId}, ${versionId}, ${rule.ordinal}, ${rule.condition},
         ${rule.occurrenceWindow}, ${rule.occurrenceCount}, ${rule.consequence},
         ${rule.minutes ?? null}, ${rule.amount ?? null}, ${rule.autoApply},
         ${att?.attestedByUserId ?? null},
         ${att?.attestedMonth ?? null},
         ${attestedAt})
    `);
  }

  return { versionId };
}

export async function assignPolicy(
  tx: Tx,
  organizationId: string,
  policyId: string,
  input: AssignPolicyBody,
): Promise<{ assignmentId: string }> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO break_policy_assignment
      (organization_id, policy_id, priority, effective_from, effective_to,
       department_id, position_id, shift_id, team_id, user_id)
    VALUES
      (${organizationId}, ${policyId}, ${input.priority},
       ${input.effectiveFrom}, ${input.effectiveTo ?? null},
       ${input.departmentId ?? null}, ${input.positionId ?? null},
       ${input.shiftId ?? null}, ${input.teamId ?? null}, ${input.userId ?? null})
    RETURNING id
  `);
  return { assignmentId: row.id };
}

export async function loadPolicy(
  tx: Tx,
  organizationId: string,
  policyId: string,
): Promise<FullPolicyRow | null> {
  const policy = await tx.maybeOne<PolicyRow>(sql`
    SELECT id, organization_id AS "organizationId", name, created_at::text AS "createdAt"
    FROM break_policy
    WHERE organization_id = ${organizationId} AND id = ${policyId}
  `);
  if (!policy) return null;

  const versions = await tx.query<VersionRow>(sql`
    SELECT id, organization_id AS "organizationId", policy_id AS "policyId",
           effective_from::text AS "effectiveFrom",
           upper_total_minutes AS "upperTotalMinutes",
           upper_single_minutes AS "upperSingleMinutes",
           lower_total_minutes AS "lowerTotalMinutes",
           lower_enforced AS "lowerEnforced",
           grace_minutes AS "graceMinutes",
           warning_percent AS "warningPercent",
           counts_toward_work_hours AS "countsTowardWorkHours",
           created_at::text AS "createdAt"
    FROM break_policy_version
    WHERE organization_id = ${organizationId} AND policy_id = ${policyId}
    ORDER BY effective_from DESC
  `);

  const versionIds = versions.map((v) => v.id);
  const rules = versionIds.length > 0
    ? await tx.query<PenaltyRuleRow>(sql`
        SELECT id, organization_id AS "organizationId",
               policy_version_id AS "policyVersionId",
               ordinal, condition, occurrence_window AS "occurrenceWindow",
               occurrence_count AS "occurrenceCount",
               consequence, minutes, amount::text AS amount,
               auto_apply AS "autoApply",
               attested_by AS "attestedBy",
               attested_month::text AS "attestedMonth",
               attested_at::text AS "attestedAt"
        FROM break_penalty_rule
        WHERE organization_id = ${organizationId}
          AND policy_version_id = ANY(${versionIds}::uuid[])
        ORDER BY policy_version_id, ordinal
      `)
    : [];

  const assignments = await tx.query<AssignmentRow>(sql`
    SELECT id, organization_id AS "organizationId", policy_id AS "policyId",
           priority, effective_from::text AS "effectiveFrom",
           effective_to::text AS "effectiveTo",
           department_id AS "departmentId", position_id AS "positionId",
           shift_id AS "shiftId", team_id AS "teamId", user_id AS "userId",
           created_at::text AS "createdAt"
    FROM break_policy_assignment
    WHERE organization_id = ${organizationId} AND policy_id = ${policyId}
    ORDER BY created_at DESC
  `);

  return { ...policy, versions, rules, assignments };
}

export async function loadPolicyResource(
  tx: Tx,
  organizationId: string,
  policyId: string,
): Promise<{ id: string; organizationId: string } | null> {
  return tx.maybeOne<{ id: string; organizationId: string }>(sql`
    SELECT id, organization_id AS "organizationId"
    FROM break_policy
    WHERE organization_id = ${organizationId} AND id = ${policyId}
  `);
}

export async function currentOrganizationId(tx: Tx): Promise<string> {
  const row = await tx.one<{ v: string }>(sql`
    SELECT current_setting('app.organization_id') AS v
  `);
  return row.v;
}

// ── Evaluator helpers (Task 5) ────────────────────────────────────────────────

import type { CandidateRule } from './rules.js';

/**
 * Load all penalty rules for a given policy version, ordered by ordinal.
 */
export async function loadRulesForVersion(
  tx: Tx,
  organizationId: string,
  policyVersionId: string,
): Promise<CandidateRule[]> {
  return tx.query<CandidateRule>(sql`
    SELECT id AS "ruleId", ordinal, condition, occurrence_window AS "occurrenceWindow",
           occurrence_count AS "occurrenceCount", consequence,
           minutes, amount, auto_apply AS "autoApply"
    FROM break_penalty_rule
    WHERE organization_id = ${organizationId}
      AND policy_version_id = ${policyVersionId}
    ORDER BY ordinal
  `);
}

export interface CurrentBreachAnswer {
  id: string;
  answerFingerprint: string;
  status: string;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  waivedBy: string | null;
  waivedAt: Date | null;
  autoApplied: boolean;
  suppressionReason: string | null;
  explanation: string | null;
}

/**
 * Load the current breach answer for a given attendance record.
 * "Current" means status in (pending | confirmed | waived | advisory | suppressed).
 */
export async function currentBreachAnswer(
  tx: Tx,
  organizationId: string,
  attendanceRecordId: string,
): Promise<CurrentBreachAnswer | null> {
  return tx.maybeOne<CurrentBreachAnswer>(sql`
    SELECT id, answer_fingerprint AS "answerFingerprint", status,
           confirmed_by AS "confirmedBy", confirmed_at AS "confirmedAt",
           waived_by AS "waivedBy", waived_at AS "waivedAt",
           auto_applied AS "autoApplied",
           suppression_reason AS "suppressionReason",
           explanation
    FROM break_breach
    WHERE organization_id = ${organizationId}
      AND attendance_record_id = ${attendanceRecordId}
      AND status IN ('pending', 'confirmed', 'waived', 'advisory', 'suppressed')
    LIMIT 1
  `);
}

/**
 * Count qualifying occurrence days in a window for a given rule.
 * Waived still counts; suppressed and superseded do not.
 * excludeRecordId is used to avoid double-counting the current record being inserted.
 */
export async function countOccurrences(
  tx: Tx,
  organizationId: string,
  userId: string,
  ruleId: string,
  windowStart: DateOnly,
  windowEnd: DateOnly,
  excludeRecordId: string,
): Promise<number> {
  const row = await tx.one<{ count: string }>(sql`
    SELECT COUNT(*) AS count
    FROM break_breach
    WHERE organization_id = ${organizationId}
      AND user_id = ${userId}
      AND matched_rule_id = ${ruleId}
      AND status IN ('pending', 'confirmed', 'waived')
      AND work_date >= ${windowStart}
      AND work_date <= ${windowEnd}
      AND attendance_record_id != ${excludeRecordId}
  `);
  return Number(row.count);
}

export interface BreachInsert {
  organizationId: string;
  userId: string;
  attendanceRecordId: string;
  workDate: DateOnly;
  policyVersionId: string;
  matchedRuleId: string | null;
  occurrenceNumber: number | null;
  measuredTotalMinutes: number;
  measuredSingleMinutes: number;
  measuredCount: number;
  evidenceFingerprint: string;
  answerFingerprint: string;
  calculationVersion: number;
  status: 'pending' | 'confirmed' | 'advisory' | 'suppressed';
  suppressionReason: 'leave' | 'holiday' | null;
  autoApplied: boolean;
  confirmedAt: Date | null;
}

/**
 * Insert a new break_breach row and return its generated id.
 */
export async function insertBreach(
  tx: Tx,
  breach: BreachInsert,
): Promise<string> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO break_breach (
      organization_id, user_id, attendance_record_id, work_date,
      policy_version_id, matched_rule_id, occurrence_number,
      measured_total_minutes, measured_single_minutes, measured_count,
      evidence_fingerprint, answer_fingerprint, calculation_version,
      status, suppression_reason, auto_applied, confirmed_at
    ) VALUES (
      ${breach.organizationId}, ${breach.userId}, ${breach.attendanceRecordId}, ${breach.workDate},
      ${breach.policyVersionId}, ${breach.matchedRuleId}, ${breach.occurrenceNumber},
      ${breach.measuredTotalMinutes}, ${breach.measuredSingleMinutes}, ${breach.measuredCount},
      ${breach.evidenceFingerprint}, ${breach.answerFingerprint}, ${breach.calculationVersion},
      ${breach.status}, ${breach.suppressionReason}, ${breach.autoApplied}, ${breach.confirmedAt}
    )
    RETURNING id
  `);
  return row.id;
}

/**
 * Mark a breach as superseded (status transition, no delete).
 */
export async function supersedeBreach(
  tx: Tx,
  breachId: string,
): Promise<void> {
  await tx.query(sql`
    UPDATE break_breach
    SET status = 'superseded', updated_at = now()
    WHERE id = ${breachId}
  `);
}
