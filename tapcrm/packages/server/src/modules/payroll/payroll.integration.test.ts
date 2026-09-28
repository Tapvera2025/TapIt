import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installAuthz } from '../../platform/authz-adapter.js';
import { createJobContext, createRequestContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { rupeesToPaise, roundToRupee, prorateAndRound, paiseToRupees } from './money.js';
import { computePayslip, type ComputePayslipInput } from './calculate.js';
import { buildRunPostingIntent, buildRevisionPostingIntent, type SlipComponent } from './posting.js';
import { fingerprint, periodEndFor } from './run.js';
import { resolveConfig, acceptConfig } from './config.js';
import { createStructure } from './structure.js';
import { insertManualInput, listActiveInputsForPeriod } from './input.js';
import { post } from '../accounting/facade.js';
import { registerPayrollPolicies } from './policy.js';

/**
 * Mandatory PostgreSQL gate for the payroll module (§9 Payroll design, Task 8).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run \
 *     packages/server/src/modules/payroll/payroll.integration.test.ts
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

// ── shared org provisioned once ──────────────────────────────────────────────
const ORG  = randomUUID();
const DEPT = randomUUID();
const POS  = randomUUID();
const EMP  = randomUUID();

beforeAll(async () => {
  if (!enabled) return;
  installAuthz();
  registerPayrollPolicies();

  await platformDb.transaction('seed', 'payroll integration test setup', async (tx) => {
    await tx.query(sql`
      INSERT INTO organization (id, code, name, timezone)
      VALUES (${ORG}, ${`PR${ORG.slice(0, 6)}`}, 'Payroll Test Org', 'Asia/Kolkata')
    `);
    await tx.query(sql`
      INSERT INTO department (id, organization_id, code, name, kind)
      VALUES (${DEPT}, ${ORG}, 'ENG', 'Engineering', 'delivery')
    `);
    await tx.query(sql`
      INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
      VALUES (${POS}, ${ORG}, ${DEPT}, 'SWE', 'Software Engineer', 20)
    `);
    await tx.query(sql`
      INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id, joined_on)
      VALUES (${EMP}, ${ORG}, 'employee', 'EMP-PR1', ${`emp-${ORG.slice(0, 8)}@pr.test`},
              'Test Employee', ${POS}, ${DEPT}, '2025-01-01'::date)
    `);
  });
});

afterAll(async () => {
  await closePools();
});

function makeCtx() {
  // Use EMP as the service principal id so FK constraints (accepted_by, created_by)
  // resolve to the provisioned app_user row.
  const principal = {
    id: EMP,
    organizationId: ORG,
    sessionVersion: 1,
    accountType: 'service' as const,
    allowedActions: [] as import('@tapcrm/contracts').Action[],
    allowedResources: [] as string[],
    expiresAt: new Date(Date.now() + 3_600_000),
  };
  return createRequestContext({
    organizationId: ORG,
    principal,
    requestId: randomUUID(),
  });
}

// ── Pure tests (no DB) ────────────────────────────────────────────────────────

describe('money helpers — pure', () => {
  it('rupeesToPaise converts correctly', () => {
    expect(rupeesToPaise('100')).toBe(10000n);
    expect(rupeesToPaise('33333')).toBe(3333300n);
    expect(rupeesToPaise('0.50')).toBe(50n);
  });

  it('roundToRupee rounds half-up', () => {
    expect(roundToRupee(149n)).toBe(100n);
    expect(roundToRupee(150n)).toBe(200n);
    expect(roundToRupee(100n)).toBe(100n);
  });

  it('prorateAndRound: §14.3 example', () => {
    // 33333 * 57 / 60 = 31666.35 → rounds to ₹31,666
    const amountPaise = rupeesToPaise('33333');
    const result = prorateAndRound(amountPaise, 57, 60);
    expect(paiseToRupees(result)).toMatch(/^31666\.00$/);
  });
});

describe('periodEndFor — pure', () => {
  it('January 2025', () => expect(periodEndFor('2025-01-01')).toBe('2025-01-31'));
  it('February 2025 (non-leap)', () => expect(periodEndFor('2025-02-01')).toBe('2025-02-28'));
  it('February 2024 (leap)', () => expect(periodEndFor('2024-02-01')).toBe('2024-02-29'));
  it('December', () => expect(periodEndFor('2025-12-01')).toBe('2025-12-31'));
});

describe('fingerprint — pure', () => {
  it('is deterministic regardless of key order', () => {
    expect(fingerprint({ b: 2, a: 1 })).toBe(fingerprint({ a: 1, b: 2 }));
  });
  it('differs for different values', () => {
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});

describe('computePayslip line-sum invariant — pure', () => {
  it('gross = sum of earning lines, net = gross - deductions', () => {
    const days = Array.from({ length: 31 }, (_, i) => ({
      workDate: `2025-01-${String(i + 1).padStart(2, '0')}`,
      state: 'closed' as const,
      presentUnits: 2,
      paidLeaveUnits: 0,
      unpaidLeaveUnits: 0,
      absentUnits: 0,
      holidayUnits: 0,
      nightMinutes: 0,
      overtimeMinutes: 0,
    }));
    const input: ComputePayslipInput = {
      userId: 'u',
      periodStart: '2025-01-01',
      periodEnd: '2025-01-31',
      employmentFrom: '2025-01-01',
      employmentTo: null,
      days,
      structureSegments: [{
        structureId: 's',
        currency: 'INR',
        effectiveFrom: '2025-01-01',
        effectiveTo: null,
        lines: [
          { code: 'B', label: 'Basic', kind: 'earning', amountStr: '30000', prorated: true, statutoryTags: [], sortOrder: 1 },
          { code: 'D', label: 'PF', kind: 'deduction', amountStr: '3600', prorated: true, statutoryTags: [], sortOrder: 2 },
        ],
      }],
      inputs: [],
      config: { schemaVersion: 'v1', settings: {} },
    };
    const result = computePayslip(input);
    const earnSum = result.lines
      .filter(l => l.kind === 'earning')
      .reduce((s, l) => s + l.amountPaise, 0n);
    const dedSum = result.lines
      .filter(l => l.kind === 'deduction')
      .reduce((s, l) => s + l.amountPaise, 0n);
    expect(result.grossPaise).toBe(earnSum);
    expect(result.deductionsPaise).toBe(dedSum);
    expect(result.netPaise).toBe(result.grossPaise - result.deductionsPaise);
  });
});

describe('posting mapper — pure', () => {
  const makeComp = (code: string, paise: bigint): SlipComponent => ({
    code,
    kind: 'earning',
    amountPaise: paise,
    debitRole: 'salary-expense',
    creditRole: 'salary-payable',
  });

  it('zero-delta revision: same amounts', () => {
    const c = makeComp('B', 3000000n);
    const r = buildRevisionPostingIntent([c], [c]);
    expect(r.kind).toBe('zero-delta-revision');
    expect(r.lines).toHaveLength(0);
  });

  it('positive delta: normal roles', () => {
    const r = buildRevisionPostingIntent([makeComp('B', 3000000n)], [makeComp('B', 4000000n)]);
    expect(r.kind).toBe('posting');
    expect(r.debitTotalPaise).toBe(1000000n);
    expect(r.lines.find(l => l.side === 'debit')?.role).toBe('salary-expense');
    for (const l of r.lines) expect(l.amountPaise).toBeGreaterThan(0n);
  });

  it('negative delta reversal: swapped roles, positive amounts', () => {
    const r = buildRevisionPostingIntent([makeComp('B', 5000000n)], [makeComp('B', 4500000n)]);
    expect(r.debitTotalPaise).toBe(500000n);
    expect(r.lines.find(l => l.side === 'debit')?.role).toBe('salary-payable');
    for (const l of r.lines) expect(l.amountPaise).toBeGreaterThan(0n);
  });

  it('run posting intent is balanced', () => {
    const r = buildRunPostingIntent([makeComp('B', 3000000n)]);
    expect(r.debitTotalPaise).toBe(r.creditTotalPaise);
  });
});

// ── DB tests ─────────────────────────────────────────────────────────────────

describe.skipIf(!enabled)('config acceptance (PostgreSQL)', () => {
  it('accepts a config and resolves it for the period', async () => {
    const ctx = makeCtx();
    const result = await acceptConfig(ctx, {
      effectiveFrom: '2025-01-01',
      settings: { pf: { enabled: false } },
      caHrApproval: 'CA ref 001',
      sources: [{
        statutoryChoice: 'pf-rate',
        issuer: 'EPFO',
        title: 'PF rate notification',
        reference: 'EPFO/2025/01',
        sourceDate: '2025-01-01',
        effectiveDate: '2025-01-01',
      }],
    });
    expect(result.id).toBeTruthy();

    const resolved = await db.transaction(ctx, (tx) =>
      resolveConfig(tx, ORG, '2025-01-01'),
    );
    expect(resolved?.id).toBe(result.id);
    expect(resolved?.status).toBe('active');
  });

  it('second accept for same month without supersession fails unique index', async () => {
    const ctx = makeCtx();
    await expect(acceptConfig(ctx, {
      effectiveFrom: '2025-01-01',
      settings: { pf: { enabled: true } },
      caHrApproval: 'CA ref 002',
      sources: [],
    })).rejects.toThrow();
  });
});

describe.skipIf(!enabled)('salary structure (PostgreSQL)', () => {
  it('creates a structure with lines', async () => {
    const ctx = makeCtx();
    const result = await createStructure(ctx, {
      userId: EMP,
      currency: 'INR',
      effectiveFrom: '2025-01-01',
      lines: [{
        code: 'BASIC',
        label: 'Basic Salary',
        kind: 'earning',
        amount: '30000' as import('@tapcrm/contracts').Decimal,
        prorated: true,
        statutoryTags: [],
        sortOrder: 1,
      }],
    });
    expect(result.id).toBeTruthy();
  });

  it('overlapping structures are rejected', async () => {
    const ctx = makeCtx();
    // Try inserting another structure for the same person overlapping Jan 2025
    await expect(createStructure(ctx, {
      userId: EMP,
      currency: 'INR',
      effectiveFrom: '2025-01-15',
      lines: [{
        code: 'B',
        label: 'B',
        kind: 'earning',
        amount: '10000' as import('@tapcrm/contracts').Decimal,
        prorated: true,
        statutoryTags: [],
        sortOrder: 1,
      }],
    })).rejects.toThrow();
  });
});

describe.skipIf(!enabled)('manual inputs (PostgreSQL)', () => {
  it('two manual inputs for same person/period are both stored', async () => {
    const ctx = makeCtx();
    await db.transaction(ctx, (tx) =>
      insertManualInput(tx, ORG, {
        userId: EMP,
        periodStart: '2025-03-01',
        kind: 'bonus',
        amount: '5000' as import('@tapcrm/contracts').Decimal,
        label: 'Q1 bonus',
        reason: 'Performance Q1',
        createdBy: EMP,
      }),
    );
    await db.transaction(ctx, (tx) =>
      insertManualInput(tx, ORG, {
        userId: EMP,
        periodStart: '2025-03-01',
        kind: 'adjustment',
        amount: '1000' as import('@tapcrm/contracts').Decimal,
        label: 'Correction',
        reason: 'Pay correction',
        createdBy: EMP,
      }),
    );
    const inputs = await db.transaction(ctx, (tx) =>
      listActiveInputsForPeriod(tx, ORG, [EMP], '2025-03-01'),
    );
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });
});

describe.skipIf(!enabled)('published payslip immutability (PostgreSQL)', () => {
  it('UPDATE on immutable payslip gross_paise is rejected by trigger', async () => {
    const runId  = randomUUID();
    const slipId = randomUUID();
    const ctx    = makeCtx();

    await db.transaction(ctx, async (tx) => {
      await tx.query(sql`
        INSERT INTO payroll_run (id, organization_id, period_start, period_end, config_id, created_by)
        SELECT ${runId}::uuid, ${ORG}, '2025-04-01'::date, '2025-04-30'::date, pc.id, ${EMP}::uuid
        FROM payroll_config pc WHERE pc.organization_id = ${ORG} LIMIT 1
      `);
      await tx.query(sql`
        INSERT INTO payslip (id, organization_id, run_id, user_id, period_start, period_end,
          gross_paise, deductions_paise, net_paise, employer_contribution_paise,
          status, immutable, revision_number)
        VALUES (${slipId}::uuid, ${ORG}, ${runId}::uuid, ${EMP}::uuid,
          '2025-04-01'::date, '2025-04-30'::date,
          3000000, 0, 3000000, 0, 'published', true, 0)
      `);
    });

    await expect(
      db.transaction(ctx, (tx) =>
        tx.query(sql`UPDATE payslip SET gross_paise = 999 WHERE id = ${slipId}::uuid`),
      ),
    ).rejects.toThrow();
  });
});

describe.skipIf(!enabled)('ledger posting intent (PostgreSQL)', () => {
  it('balanced intent inserts successfully', async () => {
    const runId = randomUUID();
    const ctx   = makeCtx();

    await db.transaction(ctx, async (tx) => {
      await tx.query(sql`
        INSERT INTO payroll_run (id, organization_id, period_start, period_end, config_id, created_by)
        SELECT ${runId}::uuid, ${ORG}, '2025-05-01'::date, '2025-05-31'::date, pc.id, ${EMP}::uuid
        FROM payroll_config pc WHERE pc.organization_id = ${ORG} LIMIT 1
      `);
    });

    const { intentId } = await db.transaction(ctx, (tx) =>
      post(tx, {
        organizationId: ORG,
        runId,
        payslipId: null,
        kind: 'posting',
        lines: [
          { role: 'salary-expense', amountPaise: 3000000n, side: 'debit' },
          { role: 'salary-payable', amountPaise: 3000000n, side: 'credit' },
        ],
        debitTotalPaise: 3000000n,
        creditTotalPaise: 3000000n,
      }),
    );
    expect(intentId).toBeTruthy();
  });

  it('unbalanced intent throws', async () => {
    const ctx = makeCtx();
    await expect(
      db.transaction(ctx, (tx) =>
        post(tx, {
          organizationId: ORG,
          runId: randomUUID(),
          payslipId: null,
          kind: 'posting',
          lines: [{ role: 'salary-expense', amountPaise: 100n, side: 'debit' }],
          debitTotalPaise: 100n,
          creditTotalPaise: 200n,
        }),
      ),
    ).rejects.toThrow('LEDGER_UNBALANCED');
  });

  it('empty posting lines throws', async () => {
    const ctx = makeCtx();
    await expect(
      db.transaction(ctx, (tx) =>
        post(tx, {
          organizationId: ORG,
          runId: randomUUID(),
          payslipId: null,
          kind: 'posting',
          lines: [],
          debitTotalPaise: 0n,
          creditTotalPaise: 0n,
        }),
      ),
    ).rejects.toThrow('LEDGER_EMPTY_POSTING');
  });

  it('zero-delta-revision with lines throws', async () => {
    const ctx = makeCtx();
    await expect(
      db.transaction(ctx, (tx) =>
        post(tx, {
          organizationId: ORG,
          runId: randomUUID(),
          payslipId: null,
          kind: 'zero-delta-revision',
          lines: [{ role: 'salary-expense', amountPaise: 1n, side: 'debit' }],
          debitTotalPaise: 0n,
          creditTotalPaise: 0n,
        }),
      ),
    ).rejects.toThrow('LEDGER_ZERO_WITH_LINES');
  });
});
