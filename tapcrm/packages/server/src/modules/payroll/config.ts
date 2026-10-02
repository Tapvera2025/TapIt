import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { writePayrollAudit } from './audit.js';
import {
  PAYROLL_ERROR_CODES,
  PayrollConflictError,
  PayrollNotFoundError,
  monthLabel,
} from './errors.js';

export interface ConfigSource {
  readonly statutoryChoice: string;
  readonly issuer: string;
  readonly title: string;
  readonly reference: string;
  readonly sourceDate: string;    // YYYY-MM-DD
  readonly effectiveDate: string; // YYYY-MM-DD
  readonly retainedObjectKey?: string | null;
  readonly retainedSha256?: string | null;
}

export interface AcceptConfigInput {
  readonly effectiveFrom: string;  // first of month, YYYY-MM-DD
  readonly settings: Record<string, unknown>;
  readonly schemaVersion?: string;
  readonly caHrApproval: string;
  readonly sources: ConfigSource[];
  readonly supersedesConfigId?: string | null;
}

export interface PayrollConfigRow {
  readonly id: string;
  readonly organizationId: string;
  readonly effectiveFrom: string;
  readonly settings: Record<string, unknown>;
  readonly schemaVersion: string;
  readonly acceptedBy: string;
  readonly acceptedByName?: string | null;
  readonly acceptedAt: string;
  readonly caHrApproval: string;
  readonly status: 'active' | 'voided' | 'superseded';
  readonly supersedesConfigId: string | null;
  readonly createdAt: string;
}

const CONFIG_COLUMNS = sql`
  c.id, c.organization_id AS "organizationId", c.effective_from::text AS "effectiveFrom",
  c.settings, c.schema_version AS "schemaVersion", c.accepted_by AS "acceptedBy",
  c.accepted_at::text AS "acceptedAt", c.ca_hr_approval AS "caHrApproval",
  c.status, c.supersedes_config_id AS "supersedesConfigId", c.created_at::text AS "createdAt"
`;

/** Resolve the latest active config version for a given period_start. */
export async function resolveConfig(
  tx: Tx,
  organizationId: string,
  periodStart: string,
): Promise<PayrollConfigRow | null> {
  return tx.maybeOne<PayrollConfigRow>(sql`
    SELECT ${CONFIG_COLUMNS}
    FROM payroll_config c
    WHERE c.organization_id = ${organizationId}
      AND c.status = 'active'
      AND c.effective_from <= ${periodStart}::date
    ORDER BY c.effective_from DESC
    LIMIT 1
  `);
}

export async function listConfigs(ctx: RequestContext): Promise<PayrollConfigRow[]> {
  return db.transaction(ctx, (tx) =>
    tx.query<PayrollConfigRow>(sql`
      SELECT ${CONFIG_COLUMNS}, u.full_name AS "acceptedByName"
      FROM payroll_config c
      LEFT JOIN app_user u ON u.organization_id = c.organization_id AND u.id = c.accepted_by
      WHERE c.organization_id = ${ctx.organizationId}
      ORDER BY c.effective_from DESC, c.created_at DESC
    `),
  );
}

/**
 * Accept payroll settings from a month on. Settings are evidence and never
 * change once accepted; a correction for the same month supersedes the active
 * version (it stays on record, pointing at its replacement).
 */
export async function acceptConfig(
  ctx: RequestContext,
  input: AcceptConfigInput,
): Promise<{ id: string; supersededConfigId: string | null }> {
  return db.transaction(ctx, async (tx) => {
    const active = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM payroll_config
      WHERE organization_id = ${ctx.organizationId}
        AND effective_from = ${input.effectiveFrom}::date
        AND status = 'active'
      FOR UPDATE
    `);
    const supersedes = input.supersedesConfigId ?? null;
    if (active && supersedes !== active.id) {
      throw new PayrollConflictError(
        PAYROLL_ERROR_CODES.CONFIG_EXISTS,
        `Settings effective ${monthLabel(input.effectiveFrom)} are already accepted. Replace them to change them.`,
        { configId: active.id },
      );
    }
    if (supersedes !== null && !active) {
      const old = await tx.maybeOne<{ status: string }>(sql`
        SELECT status FROM payroll_config
        WHERE organization_id = ${ctx.organizationId} AND id = ${supersedes}::uuid
      `);
      if (!old) throw new PayrollNotFoundError('The settings being replaced were not found');
      throw new PayrollConflictError(
        PAYROLL_ERROR_CODES.CONFIG_NOT_ACTIVE,
        'Only the active settings for the same month can be replaced.',
      );
    }

    // The new row's id is known first, so the old one can point at it
    // (both links are deferred foreign keys).
    const { id } = await tx.one<{ id: string }>(sql`SELECT uuidv7() AS id`);
    if (active) {
      await tx.query(sql`
        UPDATE payroll_config
        SET status = 'superseded',
            superseded_by = ${id}::uuid,
            superseded_at = now(),
            supersession_actor = ${ctx.principal.id}::uuid,
            supersession_reason = ${'Replaced by new settings'}
        WHERE organization_id = ${ctx.organizationId} AND id = ${active.id}::uuid
      `);
    }

    await tx.query(sql`
      INSERT INTO payroll_config
        (id, organization_id, effective_from, settings, schema_version, accepted_by, ca_hr_approval,
         supersedes_config_id)
      VALUES (
        ${id}::uuid, ${ctx.organizationId}, ${input.effectiveFrom}::date,
        ${JSON.stringify(input.settings)}::jsonb,
        ${input.schemaVersion ?? 'v1'},
        ${ctx.principal.id},
        ${input.caHrApproval.trim()},
        ${active?.id ?? null}::uuid
      )
    `);

    for (const src of input.sources) {
      await tx.query(sql`
        INSERT INTO payroll_config_source
          (organization_id, config_id, statutory_choice, issuer, title, reference,
           source_date, effective_date, retained_object_key, retained_sha256)
        VALUES (
          ${ctx.organizationId}, ${id}::uuid,
          ${src.statutoryChoice}, ${src.issuer}, ${src.title}, ${src.reference},
          ${src.sourceDate}::date, ${src.effectiveDate}::date,
          ${src.retainedObjectKey ?? null}, ${src.retainedSha256 ?? null}
        )
      `);
    }

    await writePayrollAudit(tx, ctx, {
      action: active ? 'payroll.config-replaced' : 'payroll.config-accepted',
      targetType: 'payrollConfig',
      targetId: id,
      before: active ? { configId: active.id } : null,
      after: { effectiveFrom: input.effectiveFrom, sources: input.sources.length },
      reason: input.caHrApproval.trim(),
    });

    return { id, supersededConfigId: active?.id ?? null };
  });
}
