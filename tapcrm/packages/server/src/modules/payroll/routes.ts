import { holdsPolicy, type Resource } from '@tapcrm/authz';
import { decimal } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { route } from '../../platform/http/route.js';
import { organizationToday } from '../../platform/organization-time.js';
import { writePayrollAudit } from './audit.js';
import {
  listConfigs, acceptConfig, type AcceptConfigInput,
} from './config.js';
import {
  PAYROLL_ERROR_CODES,
  PayrollNotFoundError,
  PayrollValidationError,
} from './errors.js';
import {
  listStructures, listStructureSummaries, createStructure, type CreateStructureInput,
} from './structure.js';
import {
  insertManualInput, listInputs, revokeManualInput,
} from './input.js';
import {
  cancelRun, createRun, listRunEmployeesForReview, listRuns, readRun, recalculateRun, startRun,
} from './run.js';
import { markInputsChanged, publishRun, PublishBlockedError, type PublishBlocker } from './publish.js';
import { reviseSlip } from './revision.js';
import { getDocument } from './document.js';
import {
  createRunSchema, acceptConfigSchema, createStructureSchema,
  createInputSchema, listInputsQuerySchema, revokeInputSchema, reviseSlipSchema, patchRunSchema,
  structuresQuerySchema,
} from './validators.js';

// ── Resource loaders ──────────────────────────────────────────────────────

async function loadPayrollRun(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<{ id: string; organizationId: string }>(
    ctx,
    sql`SELECT id, organization_id AS "organizationId" FROM payroll_run WHERE id = ${id}::uuid`,
  );
  return row ? { type: 'payrollRun', id: row.id, organizationId: row.organizationId } : null;
}


/**
 * P2 (payslip privacy) reads `subjectId` and `__holderHasPayrollManage`: a
 * payslip is readable by its subject and by payroll holders, never through
 * team scope (design §9, Task 7).
 */
async function loadPayslip(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<{ id: string; organizationId: string; userId: string }>(
    ctx,
    sql`SELECT id, organization_id AS "organizationId", user_id AS "userId" FROM payslip WHERE id = ${id}::uuid`,
  );
  if (!row) return null;
  return {
    type: 'payslip',
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    subjectId: row.userId,
    __holderHasPayrollManage: await holdsPolicy(ctx, 'payroll:manage'),
  };
}

async function loadStructureUser(ctx: RequestContext, userId: string): Promise<Resource | null> {
  const row = await db.maybeOne<{ id: string; organizationId: string }>(
    ctx,
    sql`SELECT id, organization_id AS "organizationId" FROM app_user WHERE id = ${userId}::uuid`,
  );
  return row ? { type: 'payrollRun', id: row.id, organizationId: row.organizationId } : null;
}

/** Blockers with the people's names, so the screen can say who is holding the run up. */
async function namedBlockers(
  ctx: RequestContext,
  blockers: readonly PublishBlocker[],
): Promise<(PublishBlocker & { fullName: string | null })[]> {
  const ids = [...new Set(blockers.flatMap((b) => (b.userId === null ? [] : [b.userId])))];
  const names = ids.length === 0
    ? []
    : await db.query<{ id: string; fullName: string }>(ctx, sql`
        SELECT id, full_name AS "fullName" FROM app_user
        WHERE organization_id = ${ctx.organizationId} AND id = ANY(${ids}::uuid[])
      `);
  const byId = new Map(names.map((n) => [n.id, n.fullName]));
  return blockers.map((b) => ({ ...b, fullName: b.userId === null ? null : (byId.get(b.userId) ?? null) }));
}

// ── Routes ────────────────────────────────────────────────────────────────

export function registerPayrollRoutes(): void {
  // GET /api/payroll/cycle — own-scope callers get their own slip status
  route({
    method: 'GET',
    path: '/api/payroll/cycle',
    action: 'payroll:view',
    module: 'payroll',
    handler: async ({ ctx }) => {
      const slip = await db.maybeOne<{ id: string; periodStart: string; status: string; revisionNumber: number; netPaise: string }>(
        ctx,
        sql`
          SELECT id, period_start::text AS "periodStart", status, revision_number AS "revisionNumber",
                 net_paise::text AS "netPaise"
          FROM payslip
          WHERE organization_id = ${ctx.organizationId}
            AND user_id = ${ctx.principal.id}::uuid
            AND status = 'published'
          ORDER BY period_start DESC, revision_number DESC
          LIMIT 1
        `,
      );
      return { currentSlip: slip };
    },
  });

  // GET /api/payroll/payslips/mine — own published slips only (before /:id).
  // Only the latest revision of each month is current.
  route({
    method: 'GET',
    path: '/api/payroll/payslips/mine',
    action: 'payroll:view',
    module: 'payroll',
    handler: async ({ ctx }) => {
      const slips = await db.query<{ id: string; periodStart: string; periodEnd: string; revisionNumber: number; grossPaise: string; deductionsPaise: string; netPaise: string; publishedAt: string | null }>(
        ctx,
        sql`
          SELECT DISTINCT ON (period_start)
                 id, period_start::text AS "periodStart", period_end::text AS "periodEnd",
                 revision_number AS "revisionNumber",
                 gross_paise::text AS "grossPaise", deductions_paise::text AS "deductionsPaise",
                 net_paise::text AS "netPaise", published_at::text AS "publishedAt"
          FROM payslip
          WHERE organization_id = ${ctx.organizationId}
            AND user_id = ${ctx.principal.id}::uuid
            AND status = 'published'
          ORDER BY period_start DESC, revision_number DESC
        `,
      );
      return { slips };
    },
  });

  // GET /api/payroll/payslips/:id — a published payslip with its lines
  route({
    method: 'GET',
    path: '/api/payroll/payslips/:id',
    action: 'payroll:view',
    module: 'payroll',
    resourceParam: 'id',
    loadResource: loadPayslip,
    handler: async ({ ctx, params }) => {
      return db.transaction(ctx, async (tx) => {
        const slip = await tx.maybeOne<{
          id: string; userId: string; status: string; periodStart: string; periodEnd: string;
          revisionNumber: number; grossPaise: string; netPaise: string; deductionsPaise: string;
          employerContributionPaise: string | null; publishedAt: string | null;
          fullName: string; employeeCode: string | null; departmentName: string | null;
          positionName: string | null; organizationName: string | null;
        }>(sql`
          SELECT p.id, p.user_id AS "userId", p.status, p.period_start::text AS "periodStart",
                 p.period_end::text AS "periodEnd", p.revision_number AS "revisionNumber",
                 p.gross_paise::text AS "grossPaise", p.net_paise::text AS "netPaise",
                 p.deductions_paise::text AS "deductionsPaise",
                 p.employer_contribution_paise::text AS "employerContributionPaise",
                 p.published_at::text AS "publishedAt",
                 u.full_name AS "fullName", u.employee_id AS "employeeCode",
                 d.name AS "departmentName", pos.name AS "positionName", o.name AS "organizationName"
          FROM payslip p
          JOIN app_user u ON u.organization_id = p.organization_id AND u.id = p.user_id
          LEFT JOIN department d ON d.organization_id = u.organization_id AND d.id = u.department_id
          LEFT JOIN position pos ON pos.organization_id = u.organization_id AND pos.id = u.position_id
          LEFT JOIN organization o ON o.id = p.organization_id
          WHERE p.organization_id = ${ctx.organizationId}
            AND p.id = ${params['id']!}::uuid AND p.status = 'published'
        `);
        if (!slip) return null;
        const lines = await tx.query<{ code: string; label: string; kind: string; amountPaise: string; sortOrder: number }>(sql`
          SELECT code, label, kind, amount_paise::text AS "amountPaise", sort_order AS "sortOrder"
          FROM payslip_line
          WHERE organization_id = ${ctx.organizationId} AND payslip_id = ${slip.id}::uuid
          ORDER BY sort_order, code
        `);
        return { ...slip, lines };
      });
    },
  });

  // GET /api/payroll/payslips/:id/document
  route({
    method: 'GET',
    path: '/api/payroll/payslips/:id/document',
    action: 'payroll:view',
    module: 'payroll',
    resourceParam: 'id',
    loadResource: loadPayslip,
    handler: async ({ ctx, params }) => {
      return db.transaction(ctx, (tx) => getDocument(tx, ctx.organizationId, params['id']!));
    },
  });

  // GET /api/payroll/runs
  route({
    method: 'GET',
    path: '/api/payroll/runs',
    action: 'payroll:manage',
    module: 'payroll',
    handler: async ({ ctx }) => {
      const runs = await db.transaction(ctx, (tx) => listRuns(tx, ctx.organizationId));
      return { runs };
    },
  });

  // POST /api/payroll/runs
  route({
    method: 'POST',
    path: '/api/payroll/runs',
    action: 'payroll:manage',
    module: 'payroll',
    handler: async ({ ctx, body }) => {
      const input = createRunSchema.parse(body);
      const result = await createRun(ctx, input);
      return { ...result, blockers: await namedBlockers(ctx, result.blockers) };
    },
  });

  // GET /api/payroll/runs/:id
  route({
    method: 'GET',
    path: '/api/payroll/runs/:id',
    action: 'payroll:manage',
    module: 'payroll',
    resourceParam: 'id',
    loadResource: loadPayrollRun,
    handler: async ({ ctx, params }) => {
      const run = await db.transaction(ctx, (tx) => readRun(tx, ctx.organizationId, params['id']!));
      if (!run) throw new PayrollNotFoundError('Payroll run not found');
      return run;
    },
  });

  // GET /api/payroll/runs/:id/employees — the review list
  route({
    method: 'GET',
    path: '/api/payroll/runs/:id/employees',
    action: 'payroll:manage',
    module: 'payroll',
    resourceParam: 'id',
    loadResource: loadPayrollRun,
    handler: async ({ ctx, params }) => {
      const employees = await db.transaction(ctx, (tx) =>
        listRunEmployeesForReview(tx, ctx.organizationId, params['id']!),
      );
      return { employees };
    },
  });

  // PATCH /api/payroll/runs/:id — start | cancel | recalculate
  route({
    method: 'PATCH',
    path: '/api/payroll/runs/:id',
    action: 'payroll:manage',
    module: 'payroll',
    resourceParam: 'id',
    loadResource: loadPayrollRun,
    handler: async ({ ctx, params, body }) => {
      const input = patchRunSchema.parse(body);
      const runId = params['id']!;
      if (input.action === 'start') return startRun(ctx, runId);
      if (input.action === 'recalculate') return recalculateRun(ctx, runId);
      return cancelRun(ctx, runId);
    },
  });

  // POST /api/payroll/runs/:id/publish
  route({
    method: 'POST',
    path: '/api/payroll/runs/:id/publish',
    action: 'payroll:manage',
    module: 'payroll',
    resourceParam: 'id',
    loadResource: loadPayrollRun,
    status: 200,
    handler: async ({ ctx, params }) => {
      try {
        return await publishRun(ctx, params['id']!);
      } catch (err) {
        if (err instanceof PublishBlockedError) {
          if (err.blockers.some((b) => b.kind === 'inputs-changed')) await markInputsChanged(ctx, params['id']!);
          return { status: 'blocked', blockers: await namedBlockers(ctx, err.blockers) };
        }
        throw err;
      }
    },
  });

  // GET /api/payroll/runs/:id/drifts
  route({
    method: 'GET',
    path: '/api/payroll/runs/:id/drifts',
    action: 'payroll:manage',
    module: 'payroll',
    resourceParam: 'id',
    loadResource: loadPayrollRun,
    handler: async ({ ctx, params }) => {
      const drifts = await db.query<{ id: string; userId: string; fullName: string; kind: string; sourceType: string | null; resolvedAt: string | null }>(
        ctx,
        sql`
          SELECT dr.id, dr.user_id AS "userId", u.full_name AS "fullName", dr.kind,
                 dr.source_type AS "sourceType", dr.resolved_at::text AS "resolvedAt"
          FROM payroll_run_drift dr
          JOIN app_user u ON u.organization_id = dr.organization_id AND u.id = dr.user_id
          WHERE dr.organization_id = ${ctx.organizationId} AND dr.run_id = ${params['id']!}::uuid
          ORDER BY dr.opened_at
        `,
      );
      return { drifts };
    },
  });

  // POST /api/payroll/runs/:id/drifts/:driftId/remediate
  route({
    method: 'POST',
    path: '/api/payroll/runs/:id/drifts/:driftId/remediate',
    action: 'payroll:manage',
    module: 'payroll',
    resourceParam: 'id',
    loadResource: loadPayrollRun,
    status: 200,
    handler: async ({ ctx, params }) => {
      await db.transaction(ctx, (tx) =>
        tx.query(sql`
          UPDATE payroll_run_drift
          SET resolved_at = now(), resolution_actor = ${ctx.principal.id}, resolution_reason = 'manual'
          WHERE id = ${params['driftId']!}::uuid AND organization_id = ${ctx.organizationId} AND resolved_at IS NULL
        `),
      );
      return { ok: true };
    },
  });

  // POST /api/payroll/payslips/:id/revise
  route({
    method: 'POST',
    path: '/api/payroll/payslips/:id/revise',
    action: 'payroll:manage',
    module: 'payroll',
    resourceParam: 'id',
    loadResource: loadPayslip,
    handler: async ({ ctx, params, body }) => {
      const input = reviseSlipSchema.parse(body);
      return reviseSlip(ctx, { slipId: params['id']!, reason: input.reason });
    },
  });

  // GET /api/payroll/structures — one person's salary history (?userId=),
  // or every current employee with the salary in effect (?onDate=, default today)
  route({
    method: 'GET',
    path: '/api/payroll/structures',
    action: 'payroll:manage',
    module: 'payroll',
    handler: async ({ ctx, query }) => {
      const input = structuresQuerySchema.parse(query);
      if (input.userId) return { structures: await listStructures(ctx, input.userId) };
      const onDate = input.onDate ?? (await db.transaction(ctx, (tx) => organizationToday(tx)));
      return { onDate, employees: await listStructureSummaries(ctx, onDate) };
    },
  });

  // PUT /api/payroll/structures/:userId
  route({
    method: 'PUT',
    path: '/api/payroll/structures/:userId',
    action: 'payroll:manage',
    module: 'payroll',
    resourceParam: 'userId',
    loadResource: loadStructureUser,
    handler: async ({ ctx, params, body }) => {
      const parsed = createStructureSchema.parse(body);
      const userId = params['userId']!;
      if (parsed.userId !== undefined && parsed.userId !== userId) {
        throw new PayrollValidationError(
          PAYROLL_ERROR_CODES.STRUCTURE_INVALID,
          'The salary names a different employee from the one being edited.',
        );
      }
      const input: CreateStructureInput = {
        userId,
        currency: parsed.currency.toUpperCase(),
        effectiveFrom: parsed.effectiveFrom,
        ...(parsed.effectiveTo !== undefined ? { effectiveTo: parsed.effectiveTo } : {}),
        lines: parsed.lines.map((l, index) => ({
          code: l.code,
          label: l.label,
          kind: l.kind,
          amount: decimal(l.amount),
          prorated: l.prorated,
          statutoryTags: l.statutoryTags,
          sortOrder: l.sortOrder ?? (index + 1) * 10,
        })),
        replacesStructureId: parsed.replacesStructureId ?? null,
        reason: parsed.reason ?? null,
      };
      return createStructure(ctx, input);
    },
  });

  // GET /api/payroll/config
  route({
    method: 'GET',
    path: '/api/payroll/config',
    action: 'payroll:manage-config',
    module: 'payroll',
    handler: async ({ ctx }) => {
      return { configs: await listConfigs(ctx) };
    },
  });

  // PUT /api/payroll/config
  route({
    method: 'PUT',
    path: '/api/payroll/config',
    action: 'payroll:manage-config',
    module: 'payroll',
    handler: async ({ ctx, body }) => {
      const input = acceptConfigSchema.parse(body) as AcceptConfigInput;
      return acceptConfig(ctx, input);
    },
  });

  // GET /api/payroll/inputs?periodStart=YYYY-MM-01[&userId=] — bonuses, deductions, break charges
  route({
    method: 'GET',
    path: '/api/payroll/inputs',
    action: 'payroll:manage',
    module: 'payroll',
    handler: async ({ ctx, query }) => {
      const filter = listInputsQuerySchema.parse(query);
      const inputs = await db.transaction(ctx, (tx) => listInputs(tx, ctx.organizationId, filter));
      return { inputs };
    },
  });

  // POST /api/payroll/inputs
  route({
    method: 'POST',
    path: '/api/payroll/inputs',
    action: 'payroll:manage',
    module: 'payroll',
    handler: async ({ ctx, body }) => {
      const input = createInputSchema.parse(body);
      return db.transaction(ctx, async (tx) => {
        const person = await tx.maybeOne<{ accountType: string }>(sql`
          SELECT account_type AS "accountType" FROM app_user
          WHERE organization_id = ${ctx.organizationId} AND id = ${input.userId}::uuid
        `);
        if (!person || person.accountType !== 'employee') {
          throw new PayrollValidationError(
            PAYROLL_ERROR_CODES.NOT_AN_EMPLOYEE,
            'Payroll entries can only be added for employees.',
          );
        }
        const created = await insertManualInput(tx, ctx.organizationId, {
          userId: input.userId,
          periodStart: input.periodStart,
          kind: input.kind,
          amount: decimal(input.amount),
          label: input.label,
          reason: input.reason,
          createdBy: ctx.principal.id,
        });
        await writePayrollAudit(tx, ctx, {
          action: 'payroll.input-added',
          targetType: 'payrollInput',
          targetId: created.id,
          after: { userId: input.userId, periodStart: input.periodStart, kind: input.kind },
          reason: input.reason,
        });
        return created;
      });
    },
  });

  // PATCH /api/payroll/inputs/:id/revoke
  route({
    method: 'PATCH',
    path: '/api/payroll/inputs/:id/revoke',
    action: 'payroll:manage',
    module: 'payroll',
    handler: async ({ ctx, params, body }) => {
      const input = revokeInputSchema.parse(body);
      await db.transaction(ctx, async (tx) => {
        const revoked = await revokeManualInput(tx, ctx.organizationId, params['id']!, ctx.principal.id, input.reason);
        if (!revoked) {
          throw new PayrollNotFoundError(
            'No active manual entry with that id. Break deductions are withdrawn from the break queue.',
            PAYROLL_ERROR_CODES.INPUT_NOT_FOUND,
          );
        }
        await writePayrollAudit(tx, ctx, {
          action: 'payroll.input-revoked',
          targetType: 'payrollInput',
          targetId: params['id']!,
          after: { revoked: true },
          reason: input.reason,
        });
      });
      return { ok: true };
    },
  });
}
