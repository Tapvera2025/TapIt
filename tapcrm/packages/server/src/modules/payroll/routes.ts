import type { Resource } from '@tapcrm/authz';
import type { Decimal } from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { route } from '../../platform/http/route.js';
import {
  listConfigs, acceptConfig, type AcceptConfigInput,
} from './config.js';
import {
  listStructures, createStructure, type CreateStructureInput,
} from './structure.js';
import {
  insertManualInput, revokeManualInput,
} from './input.js';
import {
  createRun, getRunById, getRunEmployees, transitionRun,
} from './run.js';
import { publishRun, PublishBlockedError } from './publish.js';
import { reviseSlip } from './revision.js';
import { getDocument } from './document.js';
import {
  createRunSchema, acceptConfigSchema, createStructureSchema,
  createInputSchema, revokeInputSchema, reviseSlipSchema, patchRunSchema,
} from './validators.js';

// ── Resource loaders ──────────────────────────────────────────────────────

async function loadPayrollRun(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<{ id: string; organizationId: string }>(
    ctx,
    sql`SELECT id, organization_id AS "organizationId" FROM payroll_run WHERE id = ${id}::uuid`,
  );
  return row ? { type: 'payrollRun', id: row.id, organizationId: row.organizationId } : null;
}


async function loadPayslip(ctx: RequestContext, id: string): Promise<Resource | null> {
  const row = await db.maybeOne<{ id: string; organizationId: string; userId: string }>(
    ctx,
    sql`SELECT id, organization_id AS "organizationId", user_id AS "userId" FROM payslip WHERE id = ${id}::uuid`,
  );
  return row ? { type: 'payslip', id: row.id, organizationId: row.organizationId, userId: row.userId } : null;
}

async function loadStructureUser(ctx: RequestContext, userId: string): Promise<Resource | null> {
  const row = await db.maybeOne<{ id: string; organizationId: string }>(
    ctx,
    sql`SELECT id, organization_id AS "organizationId" FROM app_user WHERE id = ${userId}::uuid`,
  );
  return row ? { type: 'payrollRun', id: row.id, organizationId: row.organizationId } : null;
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
      const slip = await db.maybeOne<{ id: string; periodStart: string; status: string; revisionNumber: number }>(
        ctx,
        sql`
          SELECT id, period_start::text AS "periodStart", status, revision_number AS "revisionNumber"
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

  // GET /api/payroll/payslips/mine — own published slips only (before /:id)
  route({
    method: 'GET',
    path: '/api/payroll/payslips/mine',
    action: 'payroll:view',
    module: 'payroll',
    handler: async ({ ctx }) => {
      const slips = await db.query<{ id: string; periodStart: string; revisionNumber: number; grossPaise: string; netPaise: string }>(
        ctx,
        sql`
          SELECT id, period_start::text AS "periodStart", revision_number AS "revisionNumber",
                 gross_paise::text AS "grossPaise", net_paise::text AS "netPaise"
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

  // GET /api/payroll/payslips/:id
  route({
    method: 'GET',
    path: '/api/payroll/payslips/:id',
    action: 'payroll:view',
    module: 'payroll',
    resourceParam: 'id',
    loadResource: loadPayslip,
    handler: async ({ ctx, params }) => {
      const slip = await db.maybeOne<{ id: string; status: string; periodStart: string; grossPaise: string; netPaise: string; deductionsPaise: string }>(
        ctx,
        sql`
          SELECT id, status, period_start::text AS "periodStart",
                 gross_paise::text AS "grossPaise", net_paise::text AS "netPaise",
                 deductions_paise::text AS "deductionsPaise"
          FROM payslip
          WHERE id = ${params['id']!}::uuid AND status = 'published'
        `,
      );
      return slip;
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
      const runs = await db.query<{ id: string; periodStart: string; status: string }>(
        ctx,
        sql`SELECT id, period_start::text AS "periodStart", status FROM payroll_run WHERE organization_id = ${ctx.organizationId} ORDER BY period_start DESC`,
      );
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
      return createRun(ctx, input);
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
      return db.transaction(ctx, (tx) => getRunById(tx, params['id']!));
    },
  });

  // GET /api/payroll/runs/:id/employees
  route({
    method: 'GET',
    path: '/api/payroll/runs/:id/employees',
    action: 'payroll:manage',
    module: 'payroll',
    resourceParam: 'id',
    loadResource: loadPayrollRun,
    handler: async ({ ctx, params }) => {
      const employees = await db.transaction(ctx, (tx) => getRunEmployees(tx, params['id']!, ctx.organizationId));
      return { employees };
    },
  });

  // PATCH /api/payroll/runs/:id
  route({
    method: 'PATCH',
    path: '/api/payroll/runs/:id',
    action: 'payroll:manage',
    module: 'payroll',
    resourceParam: 'id',
    loadResource: loadPayrollRun,
    handler: async ({ ctx, params, body }) => {
      const input = patchRunSchema.parse(body);
      if (input.action === 'start') {
        await db.transaction(ctx, (tx) => transitionRun(tx, params['id']!, ctx.organizationId, 'draft', 'computing'));
      } else if (input.action === 'cancel') {
        await db.transaction(ctx, (tx) => transitionRun(tx, params['id']!, ctx.organizationId, 'review', 'cancelled'));
      }
      return { ok: true };
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
    handler: async ({ ctx, params }) => {
      try {
        return await publishRun(ctx, params['id']!);
      } catch (err) {
        if (err instanceof PublishBlockedError) {
          return { status: 'blocked', blockers: err.blockers };
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
      const drifts = await db.query<{ id: string; userId: string; kind: string; resolvedAt: string | null }>(
        ctx,
        sql`
          SELECT id, user_id AS "userId", kind, resolved_at::text AS "resolvedAt"
          FROM payroll_run_drift
          WHERE organization_id = ${ctx.organizationId} AND run_id = ${params['id']!}::uuid
          ORDER BY opened_at
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

  // GET /api/payroll/structures
  route({
    method: 'GET',
    path: '/api/payroll/structures',
    action: 'payroll:manage',
    module: 'payroll',
    handler: async ({ ctx, query }) => {
      const userId = (query as Record<string, string>)['userId'];
      if (!userId) return { structures: [] };
      return { structures: await listStructures(ctx, userId) };
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
    handler: async ({ ctx, body }) => {
      const parsed = createStructureSchema.parse(body);
      const input: CreateStructureInput = {
        userId: parsed.userId,
        currency: parsed.currency,
        effectiveFrom: parsed.effectiveFrom,
        ...(parsed.effectiveTo !== undefined ? { effectiveTo: parsed.effectiveTo } : {}),
        lines: parsed.lines.map(l => ({ ...l, amount: String(l.amount) as Decimal })),
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

  // POST /api/payroll/inputs
  route({
    method: 'POST',
    path: '/api/payroll/inputs',
    action: 'payroll:manage',
    module: 'payroll',
    handler: async ({ ctx, body }) => {
      const input = createInputSchema.parse(body);
      return db.transaction(ctx, (tx) =>
        insertManualInput(tx, ctx.organizationId, {
          userId: input.userId,
          periodStart: input.periodStart,
          kind: input.kind,
          amount: String(input.amount) as Decimal,
          label: input.label,
          reason: input.reason,
          createdBy: ctx.principal.id,
        }),
      );
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
      await db.transaction(ctx, (tx) =>
        revokeManualInput(tx, ctx.organizationId, params['id']!, ctx.principal.id, input.reason),
      );
      return { ok: true };
    },
  });
}
