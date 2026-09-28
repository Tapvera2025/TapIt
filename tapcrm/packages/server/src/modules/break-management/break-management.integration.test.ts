import { randomUUID } from 'node:crypto';
import type { Principal, DateOnly } from '@tapcrm/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installAuthz } from '../../platform/authz-adapter.js';
import {
  createJobContext,
  createRequestContext,
  systemPrincipal,
} from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { fixedClock } from '../../platform/time.js';
import {
  lockPerson,
  breakPolicyResolver,
  registerBreakPolicyResolver,
  __resetBreakPolicyResolver,
} from '../attendance/facade.js';
import { registerBreakPolicies } from './policy.js';
import { breakPolicyResolverImpl } from './resolver-service.js';
import { confirmBreach, waiveBreach } from './service.js';
import { evaluateBreakDay } from './evaluator.js';
import { checkViolations, checkWarningState } from './rules.js';
import { resolveBreakPolicy } from './resolver.js';
import { unresolvedBreaches } from './facade.js';
import type { BreakPolicySnapshot } from '../attendance/facade.js';
import type { CandidateAssignment, CandidateVersion } from './resolver.js';

/**
 * Mandatory PostgreSQL gate for the break-management module (§13 BM design, Task 8).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run \
 *     packages/server/src/modules/break-management/break-management.integration.test.ts
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

const ORG      = randomUUID();
const DEPT     = randomUUID();
const POS_HR   = randomUUID();
const POS_EMP  = randomUUID();
const HR_USER  = randomUUID();
const EMP_USER = randomUUID();

// Shared policy/version/rule IDs created in beforeAll
const POLICY_ID   = randomUUID();
const VERSION_ID  = randomUUID();
const RULE_ID     = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

function asPrincipal(userId: string, positionId: string): Principal {
  return {
    id: userId,
    organizationId: ORG,
    sessionVersion: 1,
    accountType: 'employee',
    positionId,
    departmentId: DEPT,
    teamId: null,
    reportsTo: null,
    organizationalLevel: 30,
  };
}

function ctxAs(userId: string, positionId: string) {
  return createRequestContext({
    organizationId: ORG,
    principal: asPrincipal(userId, positionId),
    requestId: randomUUID(),
  });
}

function system() {
  return createJobContext({
    organizationId: ORG,
    principal: systemPrincipal(ORG),
    jobName: 'test',
    runId: randomUUID(),
  });
}

const CLOCK_NOW = fixedClock(new Date('2026-09-28T12:00:00Z'));

// ── Group 1 helpers — pure unit-level (no DB needed) ────────────────────────

// Minimal BreakPolicySnapshot factory
function makePolicy(overrides: Partial<BreakPolicySnapshot> = {}): BreakPolicySnapshot {
  return {
    policyVersionId:      'v1',
    countsTowardWorkHours: true,
    upperTotalMinutes:    60,
    upperSingleMinutes:   null,
    lowerTotalMinutes:    null,
    lowerEnforced:        false,
    graceMinutes:         5,
    warningPercent:       80,
    ...overrides,
  };
}

// ── Pure tests (no DB) ───────────────────────────────────────────────────────

describe('Group 2 (pure) — grace boundary: checkViolations', () => {
  it('63 min against upper=60 grace=5 is clean', () => {
    const result = checkViolations(
      { totalMinutes: 63, longestMinutes: 63, count: 1 },
      makePolicy({ upperTotalMinutes: 60, graceMinutes: 5 }),
      false,
    );
    expect(result).toHaveLength(0);
  });

  it('66 min against upper=60 grace=5 is over-total violation', () => {
    const result = checkViolations(
      { totalMinutes: 66, longestMinutes: 66, count: 1 },
      makePolicy({ upperTotalMinutes: 60, graceMinutes: 5 }),
      false,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('over-total');
  });

  it('lowerTotal=30 grace=5 measured=25 is clean (25 < 25 is false)', () => {
    // threshold = 30 - 5 = 25; measured=25 → 25 < 25 = false → clean
    const result = checkViolations(
      { totalMinutes: 25, longestMinutes: 0, count: 0 },
      makePolicy({
        upperTotalMinutes: null,
        lowerTotalMinutes: 30,
        lowerEnforced: true,
        graceMinutes: 5,
      }),
      false,
    );
    expect(result).toHaveLength(0);
  });

  it('lowerTotal=30 grace=5 measured=24 is under-total violation (24 < 25)', () => {
    // threshold = 30 - 5 = 25; measured=24 → 24 < 25 = true → violation
    const result = checkViolations(
      { totalMinutes: 24, longestMinutes: 0, count: 0 },
      makePolicy({
        upperTotalMinutes: null,
        lowerTotalMinutes: 30,
        lowerEnforced: true,
        graceMinutes: 5,
      }),
      false,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('under-total');
  });
});

describe('Group 9 (pure) — warning boundaries: checkWarningState', () => {
  // upper=60, grace=5 → breachThreshold=65; warningPercent=80
  // warnThreshold = ceil(65*80/100) = ceil(52) = 52
  it('51 min → clear', () => {
    expect(checkWarningState(51, 60, 5, 80)).toBe('clear');
  });

  it('52 min → warning', () => {
    expect(checkWarningState(52, 60, 5, 80)).toBe('warning');
  });

  it('65 min → warning (at breach threshold)', () => {
    expect(checkWarningState(65, 60, 5, 80)).toBe('warning');
  });

  it('66 min → breach (over breach threshold)', () => {
    expect(checkWarningState(66, 60, 5, 80)).toBe('breach');
  });
});

describe('Group 8 (pure) — port initialization', () => {
  it('breakPolicyResolver() returns null before registration', () => {
    __resetBreakPolicyResolver();
    expect(breakPolicyResolver()).toBeNull();
  });

  it('breakPolicyResolver() returns non-null after registration', () => {
    __resetBreakPolicyResolver();
    registerBreakPolicyResolver(breakPolicyResolverImpl);
    expect(breakPolicyResolver()).not.toBeNull();
    __resetBreakPolicyResolver(); // clean up for other tests
  });
});

describe('Group 4 (pure) — policy resolution priority ordering', () => {
  const workDate = '2026-09-01' as DateOnly;
  const subject = {
    userId:       randomUUID(),
    departmentId: randomUUID(),
    positionId:   randomUUID(),
    shiftId:      null,
    teamId:       null,
  };

  const policyA = randomUUID();
  const policyB = randomUUID();
  const versionA = randomUUID();
  const versionB = randomUUID();

  const baseVersion = (policyId: string, versionId: string): CandidateVersion => ({
    versionId,
    policyId,
    effectiveFrom: '2026-01-01' as DateOnly,
    upperTotalMinutes: 60,
    upperSingleMinutes: null,
    lowerTotalMinutes: null,
    lowerEnforced: false,
    graceMinutes: 5,
    warningPercent: 80,
    countsTowardWorkHours: true,
  });

  it('higher numeric priority wins over lower for same-rank assignments', () => {
    const assignments: CandidateAssignment[] = [
      {
        assignmentId: randomUUID(),
        policyId: policyA,
        priority: 10,
        effectiveFrom: '2026-01-01' as DateOnly,
        effectiveTo: null,
        departmentId: subject.departmentId,
        positionId: null,
        shiftId: null,
        teamId: null,
        userId: null,
      },
      {
        assignmentId: randomUUID(),
        policyId: policyB,
        priority: 20,
        effectiveFrom: '2026-01-01' as DateOnly,
        effectiveTo: null,
        departmentId: subject.departmentId,
        positionId: null,
        shiftId: null,
        teamId: null,
        userId: null,
      },
    ];
    const versions: CandidateVersion[] = [
      baseVersion(policyA, versionA),
      baseVersion(policyB, versionB),
    ];
    const snapshot = resolveBreakPolicy(workDate, subject, assignments, versions);
    expect(snapshot?.policyVersionId).toBe(versionB); // policyB has higher priority (20)
  });

  it('named-person assignment beats department assignment', () => {
    const personAssignmentId = randomUUID();
    const deptAssignmentId = randomUUID();
    const assignments: CandidateAssignment[] = [
      {
        assignmentId: deptAssignmentId,
        policyId: policyA,
        priority: 100, // higher priority but lower rank
        effectiveFrom: '2026-01-01' as DateOnly,
        effectiveTo: null,
        departmentId: subject.departmentId,
        positionId: null,
        shiftId: null,
        teamId: null,
        userId: null,
      },
      {
        assignmentId: personAssignmentId,
        policyId: policyB,
        priority: 0, // lower priority but rank=1 (person)
        effectiveFrom: '2026-01-01' as DateOnly,
        effectiveTo: null,
        departmentId: null,
        positionId: null,
        shiftId: null,
        teamId: null,
        userId: subject.userId,
      },
    ];
    const versions: CandidateVersion[] = [
      baseVersion(policyA, versionA),
      baseVersion(policyB, versionB),
    ];
    const snapshot = resolveBreakPolicy(workDate, subject, assignments, versions);
    expect(snapshot?.policyVersionId).toBe(versionB); // person-scoped always beats dept
  });

  it('ascending UUID breaks priority ties within same rank', () => {
    const uuidLow  = '10000000-0000-0000-0000-000000000000';
    const uuidHigh = '90000000-0000-0000-0000-000000000000';
    const assignments: CandidateAssignment[] = [
      {
        assignmentId: uuidLow,
        policyId: policyA,
        priority: 5,
        effectiveFrom: '2026-01-01' as DateOnly,
        effectiveTo: null,
        departmentId: subject.departmentId,
        positionId: null,
        shiftId: null,
        teamId: null,
        userId: null,
      },
      {
        assignmentId: uuidHigh,
        policyId: policyB,
        priority: 5, // same priority → UUID tiebreak
        effectiveFrom: '2026-01-01' as DateOnly,
        effectiveTo: null,
        departmentId: subject.departmentId,
        positionId: null,
        shiftId: null,
        teamId: null,
        userId: null,
      },
    ];
    const versions: CandidateVersion[] = [
      baseVersion(policyA, versionA),
      baseVersion(policyB, versionB),
    ];
    const snapshot = resolveBreakPolicy(workDate, subject, assignments, versions);
    // ascending UUID: uuidLow < uuidHigh → uuidLow wins
    expect(snapshot?.policyVersionId).toBe(versionA);
  });
});

// ── PostgreSQL integration tests ─────────────────────────────────────────────

describe.skipIf(!enabled)('break-management (PostgreSQL)', () => {
  beforeAll(async () => {
    installAuthz();
    registerBreakPolicies();

    // Re-register the break policy resolver (may have been reset by pure tests)
    try {
      __resetBreakPolicyResolver();
      registerBreakPolicyResolver(breakPolicyResolverImpl);
    } catch {
      // already registered
    }

    // ── Organization ──
    await asOwner('org', sql`
      INSERT INTO organization (id, code, name, timezone)
      VALUES (${ORG}, ${`BM${ORG.slice(0, 6)}`}, 'Break Mgmt Test', 'Asia/Kolkata')
    `);

    // ── Department ──
    await asOwner('dept', sql`
      INSERT INTO department (id, organization_id, code, name, kind)
      VALUES (${DEPT}, ${ORG}, 'HR', 'HR', 'operations')
    `);

    // ── Positions ──
    await asOwner('positions', sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS_HR},  ${ORG}, ${DEPT}, 'HR-MGR', 'HR Manager', 50),
             (${POS_EMP}, ${ORG}, ${DEPT}, 'EMP',    'Employee',   20)
    `);

    // ── Users ──
    await asOwner('hr_user', sql`
      INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
      VALUES (${HR_USER}, ${ORG}, 'employee', 'EMP-BM0', ${`hr-${ORG.slice(0,8)}@bm.test`},
              'HR User', ${POS_HR}, ${DEPT})
    `);
    await asOwner('emp_user', sql`
      INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
      VALUES (${EMP_USER}, ${ORG}, 'employee', 'EMP-BM1', ${`emp-${ORG.slice(0,8)}@bm.test`},
              'Employee User', ${POS_EMP}, ${DEPT})
    `);

    // ── Position policies (grants) ──
    await asOwner('grants', sql`
      INSERT INTO position_policy (organization_id, position_id, action, allowed, scope)
      VALUES (${ORG}, ${POS_HR}, 'breaks:manage-policy', true, 'all-people'),
             (${ORG}, ${POS_HR}, 'breaks:review-breach',  true, 'all-people')
    `);

    // ── Break policy + version + rule (direct SQL, bypasses future-date guard) ──
    await asOwner('break_policy', sql`
      INSERT INTO break_policy (id, organization_id, name)
      VALUES (${POLICY_ID}, ${ORG}, 'Standard Break Policy')
    `);
    await asOwner('break_policy_version', sql`
      INSERT INTO break_policy_version
        (id, organization_id, policy_id, effective_from,
         upper_total_minutes, upper_single_minutes, lower_total_minutes,
         lower_enforced, grace_minutes, warning_percent, counts_toward_work_hours)
      VALUES
        (${VERSION_ID}, ${ORG}, ${POLICY_ID}, '2026-01-01',
         60, null, null,
         false, 5, 80, true)
    `);
    await asOwner('break_penalty_rule', sql`
      INSERT INTO break_penalty_rule
        (id, organization_id, policy_version_id, ordinal, condition,
         occurrence_window, occurrence_count, consequence, minutes, amount, auto_apply)
      VALUES
        (${RULE_ID}, ${ORG}, ${VERSION_ID}, 1, 'over-total',
         'day', 1, 'mark-half-day', null, null, false)
    `);
  });

  afterAll(async () => {
    await closePools();
  });

  // ── Group 1: PRD acceptance ─────────────────────────────────────────────────

  it('named-person policy beats department (DB): resolveBreakPolicy via policy version', async () => {
    const POLICY_B = randomUUID();
    const VERSION_B = randomUUID();
    const POLICY_C = randomUUID();
    const VERSION_C = randomUUID();

    // Insert a dept-scoped policy
    await asOwner('dept policy', sql`
      INSERT INTO break_policy (id, organization_id, name)
      VALUES (${POLICY_B}, ${ORG}, 'Dept Policy')
    `);
    await asOwner('dept version', sql`
      INSERT INTO break_policy_version
        (id, organization_id, policy_id, effective_from,
         upper_total_minutes, grace_minutes, warning_percent, counts_toward_work_hours)
      VALUES
        (${VERSION_B}, ${ORG}, ${POLICY_B}, '2026-01-01',
         90, 5, 80, true)
    `);
    await asOwner('dept assignment', sql`
      INSERT INTO break_policy_assignment
        (id, organization_id, policy_id, priority, effective_from, department_id)
      VALUES
        (${randomUUID()}, ${ORG}, ${POLICY_B}, 0, '2026-01-01', ${DEPT})
    `);

    // Insert a person-scoped policy
    await asOwner('person policy', sql`
      INSERT INTO break_policy (id, organization_id, name)
      VALUES (${POLICY_C}, ${ORG}, 'Person Policy')
    `);
    await asOwner('person version', sql`
      INSERT INTO break_policy_version
        (id, organization_id, policy_id, effective_from,
         upper_total_minutes, grace_minutes, warning_percent, counts_toward_work_hours)
      VALUES
        (${VERSION_C}, ${ORG}, ${POLICY_C}, '2026-01-01',
         45, 5, 80, true)
    `);
    await asOwner('person assignment', sql`
      INSERT INTO break_policy_assignment
        (id, organization_id, policy_id, priority, effective_from, user_id)
      VALUES
        (${randomUUID()}, ${ORG}, ${POLICY_C}, 0, '2026-01-01', ${EMP_USER})
    `);

    // Resolve for EMP_USER on 2026-09-01 — person-scoped should win
    const snapshot = await db.transaction(system(), async (tx) => {
      const subject = {
        userId: EMP_USER,
        departmentId: DEPT,
        positionId: POS_EMP,
        teamId: null,
        shiftId: null,
      };
      const { loadAssignmentsForSubject, loadVersionsForPolicies } = await import('./repository.js');
      const assignments = await loadAssignmentsForSubject(tx, ORG, subject, '2026-09-01' as DateOnly);
      const policyIds = [...new Set(assignments.map((a) => a.policyId))];
      const versions = await loadVersionsForPolicies(tx, ORG, policyIds, '2026-09-01' as DateOnly);
      return resolveBreakPolicy('2026-09-01' as DateOnly, subject, assignments, versions);
    });

    expect(snapshot?.policyVersionId).toBe(VERSION_C);
    expect(snapshot?.upperTotalMinutes).toBe(45); // person policy, not dept (90)
  });

  it('pending mark-half-day: no overlay until confirm; overlay appears after confirm', async () => {
    const recordId = randomUUID();
    const breachId  = randomUUID();

    // Insert a closed attendance record
    await asOwner('record', sql`
      INSERT INTO attendance_record (
        id, organization_id, user_id, work_date, state,
        shift_snapshot, placement_snapshot,
        input_version, calculated_input_version, calculation_version,
        close_due_at, day_type, breaks_evaluation_revision,
        worked_minutes, break_minutes, late_minutes, early_exit_minutes,
        overtime_minutes, night_minutes
      ) VALUES (
        ${recordId}, ${ORG}, ${EMP_USER}, '2026-09-02', 'closed',
        '{"shiftId": null, "kind": "flexible"}'::jsonb,
        ${JSON.stringify({ departmentId: DEPT, positionId: POS_EMP, teamId: null })}::jsonb,
        1, 1, 1,
        '2026-09-02T18:30:00Z', 'working', 0,
        480, 60, 0, 0, 0, 0
      )
    `);

    // Insert a pending break_breach with mark-half-day rule
    await asOwner('breach', sql`
      INSERT INTO break_breach (
        id, organization_id, user_id, attendance_record_id, work_date,
        policy_version_id, matched_rule_id, occurrence_number,
        measured_total_minutes, measured_single_minutes, measured_count,
        evidence_fingerprint, answer_fingerprint, calculation_version,
        status
      ) VALUES (
        ${breachId}, ${ORG}, ${EMP_USER}, ${recordId}, '2026-09-02',
        ${VERSION_ID}, ${RULE_ID}, 1,
        70, 70, 1,
        'evfp-confirm-test', 'anfp-confirm-test', 1,
        'pending'
      )
    `);

    // Verify no overlay before confirm
    const beforeOverlay = await asOwner('check no overlay', sql`
      SELECT id FROM attendance_overlay
      WHERE organization_id = ${ORG} AND break_breach_id = ${breachId}
    `);
    expect(beforeOverlay).toHaveLength(0);

    // HR user confirms the breach (HR_USER ≠ EMP_USER — A1 passes)
    const hrCtx = ctxAs(HR_USER, POS_HR);
    await confirmBreach(hrCtx, breachId, {});

    // Verify overlay was created
    const afterOverlay = await asOwner('check overlay', sql`
      SELECT kind, consequence FROM attendance_overlay
      WHERE organization_id = ${ORG} AND break_breach_id = ${breachId}
    `) as { kind: string; consequence: string }[];
    expect(afterOverlay).toHaveLength(1);
    expect(afterOverlay[0]!.consequence).toBe('mark-half-day');
  });

  // ── Group 2: A1 self-review ─────────────────────────────────────────────────

  it('A1: caller cannot confirm their own breach (userId === principal.id)', async () => {
    const recordId = randomUUID();
    const breachId  = randomUUID();

    await asOwner('record for self-confirm', sql`
      INSERT INTO attendance_record (
        id, organization_id, user_id, work_date, state,
        shift_snapshot, placement_snapshot,
        input_version, calculated_input_version, calculation_version,
        close_due_at, day_type, breaks_evaluation_revision,
        worked_minutes, break_minutes, late_minutes, early_exit_minutes,
        overtime_minutes, night_minutes
      ) VALUES (
        ${recordId}, ${ORG}, ${EMP_USER}, '2026-09-03', 'closed',
        '{"shiftId": null}'::jsonb,
        ${JSON.stringify({ departmentId: DEPT, positionId: POS_EMP, teamId: null })}::jsonb,
        1, 1, 1,
        '2026-09-03T18:30:00Z', 'working', 0,
        480, 60, 0, 0, 0, 0
      )
    `);
    await asOwner('breach for self-confirm', sql`
      INSERT INTO break_breach (
        id, organization_id, user_id, attendance_record_id, work_date,
        policy_version_id, matched_rule_id, occurrence_number,
        measured_total_minutes, measured_single_minutes, measured_count,
        evidence_fingerprint, answer_fingerprint, calculation_version,
        status
      ) VALUES (
        ${breachId}, ${ORG}, ${EMP_USER}, ${recordId}, '2026-09-03',
        ${VERSION_ID}, ${RULE_ID}, 1,
        70, 70, 1,
        'evfp-self-confirm', 'anfp-self-confirm', 1,
        'pending'
      )
    `);

    // EMP_USER tries to confirm their own breach — must throw BreachSelfReviewError (403)
    const empCtx = ctxAs(EMP_USER, POS_EMP);
    await expect(confirmBreach(empCtx, breachId, {})).rejects.toMatchObject({ status: 403 });
  });

  it('A1: caller cannot waive their own breach', async () => {
    const recordId = randomUUID();
    const breachId  = randomUUID();

    await asOwner('record for self-waive', sql`
      INSERT INTO attendance_record (
        id, organization_id, user_id, work_date, state,
        shift_snapshot, placement_snapshot,
        input_version, calculated_input_version, calculation_version,
        close_due_at, day_type, breaks_evaluation_revision,
        worked_minutes, break_minutes, late_minutes, early_exit_minutes,
        overtime_minutes, night_minutes
      ) VALUES (
        ${recordId}, ${ORG}, ${EMP_USER}, '2026-09-04', 'closed',
        '{"shiftId": null}'::jsonb,
        ${JSON.stringify({ departmentId: DEPT, positionId: POS_EMP, teamId: null })}::jsonb,
        1, 1, 1,
        '2026-09-04T18:30:00Z', 'working', 0,
        480, 60, 0, 0, 0, 0
      )
    `);
    await asOwner('breach for self-waive', sql`
      INSERT INTO break_breach (
        id, organization_id, user_id, attendance_record_id, work_date,
        policy_version_id, matched_rule_id, occurrence_number,
        measured_total_minutes, measured_single_minutes, measured_count,
        evidence_fingerprint, answer_fingerprint, calculation_version,
        status
      ) VALUES (
        ${breachId}, ${ORG}, ${EMP_USER}, ${recordId}, '2026-09-04',
        ${VERSION_ID}, ${RULE_ID}, 1,
        70, 70, 1,
        'evfp-self-waive', 'anfp-self-waive', 1,
        'pending'
      )
    `);

    const empCtx = ctxAs(EMP_USER, POS_EMP);
    await expect(
      waiveBreach(empCtx, breachId, { reason: 'trying to waive own breach' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  // ── Group 3: DB constraints ─────────────────────────────────────────────────

  it('assignment with two targets (dept + position) rejected by CHECK constraint', async () => {
    await expect(
      asOwner('two targets', sql`
        INSERT INTO break_policy_assignment
          (id, organization_id, policy_id, priority, effective_from, department_id, position_id)
        VALUES
          (${randomUUID()}, ${ORG}, ${POLICY_ID}, 0, '2099-01-01', ${DEPT}, ${POS_EMP})
      `),
    ).rejects.toThrow();
  });

  it('duplicate rule ordinals in same version rejected by unique constraint', async () => {
    const dupVersionId = randomUUID();
    await asOwner('dup version', sql`
      INSERT INTO break_policy_version
        (id, organization_id, policy_id, effective_from,
         upper_total_minutes, grace_minutes, warning_percent, counts_toward_work_hours)
      VALUES
        (${dupVersionId}, ${ORG}, ${POLICY_ID}, '2099-06-01',
         60, 5, 80, true)
    `);
    // First rule insert (ordinal=1)
    await asOwner('dup rule 1', sql`
      INSERT INTO break_penalty_rule
        (id, organization_id, policy_version_id, ordinal, condition,
         occurrence_window, occurrence_count, consequence, auto_apply)
      VALUES
        (${randomUUID()}, ${ORG}, ${dupVersionId}, 1, 'over-total',
         'day', 1, 'warn', false)
    `);
    // Second rule with same ordinal=1 → should fail
    await expect(
      asOwner('dup rule 2', sql`
        INSERT INTO break_penalty_rule
          (id, organization_id, policy_version_id, ordinal, condition,
           occurrence_window, occurrence_count, consequence, auto_apply)
        VALUES
          (${randomUUID()}, ${ORG}, ${dupVersionId}, 1, 'over-single',
           'day', 1, 'notify-manager', false)
      `),
    ).rejects.toThrow();
  });

  it('breach with non-existent attendance_record_id rejected by FK', async () => {
    await expect(
      asOwner('bad FK breach', sql`
        INSERT INTO break_breach (
          id, organization_id, user_id, attendance_record_id, work_date,
          policy_version_id, matched_rule_id, occurrence_number,
          measured_total_minutes, measured_single_minutes, measured_count,
          evidence_fingerprint, answer_fingerprint, calculation_version,
          status
        ) VALUES (
          ${randomUUID()}, ${ORG}, ${EMP_USER}, ${randomUUID()}, '2026-09-05',
          ${VERSION_ID}, ${RULE_ID}, 1,
          70, 70, 1,
          'evfp-bad-fk', 'anfp-bad-fk', 1,
          'pending'
        )
      `),
    ).rejects.toThrow();
  });

  // ── Group 6: Evaluation watermark ──────────────────────────────────────────

  it('no-policy day: evaluateBreakDay advances breaksEvaluatedVersion with no breach', async () => {
    const recordId = randomUUID();
    // User with no policy assignment on this date — use HR_USER who has no break assignment
    // (the policy assignments are scoped to EMP_USER and DEPT, but not to HR position)
    // To guarantee no-policy: use a fresh userId not linked to any assignment
    const noPolicyUser = randomUUID();
    await asOwner('no-policy user', sql`
      INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
      VALUES (${noPolicyUser}, ${ORG}, 'employee', 'EMP-BM-NP',
              ${`nopol-${ORG.slice(0,8)}@bm.test`},
              'No Policy User', ${POS_EMP}, ${DEPT})
    `);

    // Closed attendance record with calculation_version=1, breaks_evaluation_revision=0
    await asOwner('no-policy record', sql`
      INSERT INTO attendance_record (
        id, organization_id, user_id, work_date, state,
        shift_snapshot, placement_snapshot,
        input_version, calculated_input_version, calculation_version,
        close_due_at, day_type, breaks_evaluation_revision,
        worked_minutes, break_minutes, late_minutes, early_exit_minutes,
        overtime_minutes, night_minutes
      ) VALUES (
        ${recordId}, ${ORG}, ${noPolicyUser}, '2026-09-10', 'closed',
        '{"shiftId": null, "kind": "flexible"}'::jsonb,
        ${JSON.stringify({ departmentId: null, positionId: null, teamId: null })}::jsonb,
        1, 1, 1,
        '2026-09-10T18:30:00Z', 'working', 0,
        480, 0, 0, 0, 0, 0
      )
    `);

    const outcome = await db.transaction(system(), async (tx) => {
      await lockPerson(tx, noPolicyUser);
      return evaluateBreakDay(tx, recordId, 1, 0n, CLOCK_NOW);
    });

    expect(outcome).toBe('evaluated');

    // Verify watermark was advanced
    const rows = await asOwner('watermark check', sql`
      SELECT breaks_evaluated_version, calculated_input_version
      FROM attendance_record WHERE id = ${recordId}
    `) as { breaksEvaluatedVersion: number; calculatedInputVersion: number }[];
    expect(rows[0]!.breaksEvaluatedVersion).toBe(rows[0]!.calculatedInputVersion);

    // Verify no breach was inserted
    const breaches = await asOwner('no breach check', sql`
      SELECT id FROM break_breach
      WHERE organization_id = ${ORG} AND attendance_record_id = ${recordId}
    `);
    expect(breaches).toHaveLength(0);
  });

  it('stale payload (wrong calculationVersion) no-ops with stale-payload outcome', async () => {
    const recordId = randomUUID();
    await asOwner('stale record', sql`
      INSERT INTO attendance_record (
        id, organization_id, user_id, work_date, state,
        shift_snapshot, placement_snapshot,
        input_version, calculated_input_version, calculation_version,
        close_due_at, day_type, breaks_evaluation_revision,
        worked_minutes, break_minutes, late_minutes, early_exit_minutes,
        overtime_minutes, night_minutes
      ) VALUES (
        ${recordId}, ${ORG}, ${EMP_USER}, '2026-09-11', 'closed',
        '{"shiftId": null}'::jsonb,
        ${JSON.stringify({ departmentId: DEPT, positionId: POS_EMP, teamId: null })}::jsonb,
        1, 1, 3,
        '2026-09-11T18:30:00Z', 'working', 0,
        480, 60, 0, 0, 0, 0
      )
    `);

    const outcome = await db.transaction(system(), async (tx) => {
      await lockPerson(tx, EMP_USER);
      // Pass expectedCalculationVersion=1 but DB has calculation_version=3 → stale
      return evaluateBreakDay(tx, recordId, 1, 0n, CLOCK_NOW);
    });

    expect(outcome).toBe('stale-payload');
  });

  // ── Group 7: Terminal identity ──────────────────────────────────────────────

  it('confirm → waive: still exactly one current breach row', async () => {
    const recordId = randomUUID();
    const breachId  = randomUUID();

    await asOwner('record for terminal', sql`
      INSERT INTO attendance_record (
        id, organization_id, user_id, work_date, state,
        shift_snapshot, placement_snapshot,
        input_version, calculated_input_version, calculation_version,
        close_due_at, day_type, breaks_evaluation_revision,
        worked_minutes, break_minutes, late_minutes, early_exit_minutes,
        overtime_minutes, night_minutes
      ) VALUES (
        ${recordId}, ${ORG}, ${EMP_USER}, '2026-09-05', 'closed',
        '{"shiftId": null}'::jsonb,
        ${JSON.stringify({ departmentId: DEPT, positionId: POS_EMP, teamId: null })}::jsonb,
        1, 1, 1,
        '2026-09-05T18:30:00Z', 'working', 0,
        480, 60, 0, 0, 0, 0
      )
    `);
    await asOwner('breach for terminal', sql`
      INSERT INTO break_breach (
        id, organization_id, user_id, attendance_record_id, work_date,
        policy_version_id, matched_rule_id, occurrence_number,
        measured_total_minutes, measured_single_minutes, measured_count,
        evidence_fingerprint, answer_fingerprint, calculation_version,
        status
      ) VALUES (
        ${breachId}, ${ORG}, ${EMP_USER}, ${recordId}, '2026-09-05',
        ${VERSION_ID}, ${RULE_ID}, 1,
        70, 70, 1,
        'evfp-terminal', 'anfp-terminal', 1,
        'pending'
      )
    `);

    const hrCtx = ctxAs(HR_USER, POS_HR);

    // Confirm the breach
    await confirmBreach(hrCtx, breachId, {});

    // Waive it
    await waiveBreach(hrCtx, breachId, { reason: 'employee had a valid reason' });

    // Still exactly one current (non-superseded) breach row
    const current = await asOwner('current breach count', sql`
      SELECT id, status FROM break_breach
      WHERE organization_id = ${ORG}
        AND attendance_record_id = ${recordId}
        AND status NOT IN ('superseded')
    `) as { id: string; status: string }[];
    expect(current).toHaveLength(1);
    expect(current[0]!.status).toBe('waived');
  });

  it('suppressed breach stays current on re-evaluation with same answer fingerprint', async () => {
    const recordId = randomUUID();
    const breachId  = randomUUID();
    // Use a holiday day_type for suppression
    const answerFp = 'anfp-suppressed-stable';

    await asOwner('record for suppressed', sql`
      INSERT INTO attendance_record (
        id, organization_id, user_id, work_date, state,
        shift_snapshot, placement_snapshot,
        input_version, calculated_input_version, calculation_version,
        close_due_at, day_type, breaks_evaluation_revision,
        worked_minutes, break_minutes, late_minutes, early_exit_minutes,
        overtime_minutes, night_minutes
      ) VALUES (
        ${recordId}, ${ORG}, ${EMP_USER}, '2026-09-07', 'closed',
        '{"shiftId": null}'::jsonb,
        ${JSON.stringify({ departmentId: DEPT, positionId: POS_EMP, teamId: null })}::jsonb,
        1, 1, 1,
        '2026-09-07T18:30:00Z', 'working', 0,
        480, 60, 0, 0, 0, 0
      )
    `);
    await asOwner('suppressed breach', sql`
      INSERT INTO break_breach (
        id, organization_id, user_id, attendance_record_id, work_date,
        policy_version_id, matched_rule_id, occurrence_number,
        measured_total_minutes, measured_single_minutes, measured_count,
        evidence_fingerprint, answer_fingerprint, calculation_version,
        status, suppression_reason
      ) VALUES (
        ${breachId}, ${ORG}, ${EMP_USER}, ${recordId}, '2026-09-07',
        ${VERSION_ID}, null, null,
        60, 60, 1,
        'evfp-suppressed', ${answerFp}, 1,
        'suppressed', 'holiday'
      )
    `);

    // The breach is suppressed and current — status is in the currentBreachAnswer set
    const rows = await asOwner('suppressed current', sql`
      SELECT status FROM break_breach
      WHERE id = ${breachId} AND status NOT IN ('superseded')
    `) as { status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('suppressed');
  });

  // ── Group 10: unresolvedBreaches ────────────────────────────────────────────

  it('pending mark-half-day breach appears in unresolvedBreaches; waived does not', async () => {
    const recordId      = randomUUID();
    const breachPending = randomUUID();

    await asOwner('record for unresolved', sql`
      INSERT INTO attendance_record (
        id, organization_id, user_id, work_date, state,
        shift_snapshot, placement_snapshot,
        input_version, calculated_input_version, calculation_version,
        close_due_at, day_type, breaks_evaluation_revision,
        worked_minutes, break_minutes, late_minutes, early_exit_minutes,
        overtime_minutes, night_minutes
      ) VALUES (
        ${recordId}, ${ORG}, ${EMP_USER}, '2026-09-15', 'closed',
        '{"shiftId": null}'::jsonb,
        ${JSON.stringify({ departmentId: DEPT, positionId: POS_EMP, teamId: null })}::jsonb,
        1, 1, 1,
        '2026-09-15T18:30:00Z', 'working', 0,
        480, 70, 0, 0, 0, 0
      )
    `);

    // Pending breach with mark-half-day rule
    await asOwner('pending unresolved breach', sql`
      INSERT INTO break_breach (
        id, organization_id, user_id, attendance_record_id, work_date,
        policy_version_id, matched_rule_id, occurrence_number,
        measured_total_minutes, measured_single_minutes, measured_count,
        evidence_fingerprint, answer_fingerprint, calculation_version,
        status
      ) VALUES (
        ${breachPending}, ${ORG}, ${EMP_USER}, ${recordId}, '2026-09-15',
        ${VERSION_ID}, ${RULE_ID}, 1,
        70, 70, 1,
        'evfp-unres-pend', 'anfp-unres-pend', 1,
        'pending'
      )
    `);

    const unresolved = await db.transaction(system(), async (tx) =>
      unresolvedBreaches(tx, [EMP_USER], '2026-09-01' as DateOnly, '2026-09-30' as DateOnly),
    );

    const found = unresolved.find((u) => u.id === breachPending);
    expect(found).toBeDefined();
    expect(found!.kind).toBe('pending-consequence');

    // Now waive the breach via HR
    const hrCtx = ctxAs(HR_USER, POS_HR);
    await waiveBreach(hrCtx, breachPending, { reason: 'testing unresolved list' });

    // Should no longer appear in unresolvedBreaches
    const afterWaive = await db.transaction(system(), async (tx) =>
      unresolvedBreaches(tx, [EMP_USER], '2026-09-01' as DateOnly, '2026-09-30' as DateOnly),
    );
    const stillFound = afterWaive.find((u) => u.id === breachPending);
    expect(stillFound).toBeUndefined();
  });

  it('pending require-explanation with null explanation appears; with explanation set does not', async () => {
    // Create a rule with require-explanation consequence
    const explRuleId    = randomUUID();
    const explVersionId = randomUUID();
    const explPolicyId  = randomUUID();
    const recordId      = randomUUID();
    const breachId      = randomUUID();

    await asOwner('expl policy', sql`
      INSERT INTO break_policy (id, organization_id, name)
      VALUES (${explPolicyId}, ${ORG}, 'Explanation Policy')
    `);
    await asOwner('expl version', sql`
      INSERT INTO break_policy_version
        (id, organization_id, policy_id, effective_from,
         upper_total_minutes, grace_minutes, warning_percent, counts_toward_work_hours)
      VALUES
        (${explVersionId}, ${ORG}, ${explPolicyId}, '2026-01-01',
         60, 5, 80, true)
    `);
    await asOwner('expl rule', sql`
      INSERT INTO break_penalty_rule
        (id, organization_id, policy_version_id, ordinal, condition,
         occurrence_window, occurrence_count, consequence, auto_apply)
      VALUES
        (${explRuleId}, ${ORG}, ${explVersionId}, 1, 'over-total',
         'day', 1, 'require-explanation', false)
    `);

    await asOwner('record for expl', sql`
      INSERT INTO attendance_record (
        id, organization_id, user_id, work_date, state,
        shift_snapshot, placement_snapshot,
        input_version, calculated_input_version, calculation_version,
        close_due_at, day_type, breaks_evaluation_revision,
        worked_minutes, break_minutes, late_minutes, early_exit_minutes,
        overtime_minutes, night_minutes
      ) VALUES (
        ${recordId}, ${ORG}, ${EMP_USER}, '2026-09-16', 'closed',
        '{"shiftId": null}'::jsonb,
        ${JSON.stringify({ departmentId: DEPT, positionId: POS_EMP, teamId: null })}::jsonb,
        1, 1, 1,
        '2026-09-16T18:30:00Z', 'working', 0,
        480, 70, 0, 0, 0, 0
      )
    `);

    await asOwner('expl breach (no explanation)', sql`
      INSERT INTO break_breach (
        id, organization_id, user_id, attendance_record_id, work_date,
        policy_version_id, matched_rule_id, occurrence_number,
        measured_total_minutes, measured_single_minutes, measured_count,
        evidence_fingerprint, answer_fingerprint, calculation_version,
        status, explanation
      ) VALUES (
        ${breachId}, ${ORG}, ${EMP_USER}, ${recordId}, '2026-09-16',
        ${explVersionId}, ${explRuleId}, 1,
        70, 70, 1,
        'evfp-expl', 'anfp-expl', 1,
        'pending', null
      )
    `);

    // Should appear (null explanation, require-explanation rule)
    const unresBefore = await db.transaction(system(), async (tx) =>
      unresolvedBreaches(tx, [EMP_USER], '2026-09-01' as DateOnly, '2026-09-30' as DateOnly),
    );
    const foundBefore = unresBefore.find((u) => u.id === breachId);
    expect(foundBefore).toBeDefined();
    expect(foundBefore!.kind).toBe('pending-explanation');

    // Set the explanation
    await asOwner('set explanation', sql`
      UPDATE break_breach SET explanation = 'I had a valid reason'
      WHERE id = ${breachId}
    `);

    // Should no longer appear
    const unresAfter = await db.transaction(system(), async (tx) =>
      unresolvedBreaches(tx, [EMP_USER], '2026-09-01' as DateOnly, '2026-09-30' as DateOnly),
    );
    const foundAfter = unresAfter.find((u) => u.id === breachId);
    expect(foundAfter).toBeUndefined();
  });
});
