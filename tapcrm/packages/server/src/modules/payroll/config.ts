import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

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
  readonly acceptedAt: string;
  readonly caHrApproval: string;
  readonly status: 'active' | 'voided' | 'superseded';
  readonly supersedes_config_id: string | null;
  readonly createdAt: string;
}

/** Resolve the latest active config version for a given period_start. */
export async function resolveConfig(
  tx: Tx,
  organizationId: string,
  periodStart: string,
): Promise<PayrollConfigRow | null> {
  return tx.maybeOne<PayrollConfigRow>(sql`
    SELECT id, organization_id AS "organizationId", effective_from::text AS "effectiveFrom",
           settings, schema_version AS "schemaVersion", accepted_by AS "acceptedBy",
           accepted_at::text AS "acceptedAt", ca_hr_approval AS "caHrApproval",
           status, supersedes_config_id AS "supersedesConfigId", created_at::text AS "createdAt"
    FROM payroll_config
    WHERE organization_id = ${organizationId}
      AND status = 'active'
      AND effective_from <= ${periodStart}::date
    ORDER BY effective_from DESC
    LIMIT 1
  `);
}

export async function listConfigs(ctx: RequestContext): Promise<PayrollConfigRow[]> {
  return db.transaction(ctx, (tx) =>
    tx.query<PayrollConfigRow>(sql`
      SELECT id, organization_id AS "organizationId", effective_from::text AS "effectiveFrom",
             settings, schema_version AS "schemaVersion", accepted_by AS "acceptedBy",
             accepted_at::text AS "acceptedAt", ca_hr_approval AS "caHrApproval",
             status, supersedes_config_id AS "supersedesConfigId", created_at::text AS "createdAt"
      FROM payroll_config
      ORDER BY effective_from DESC
    `),
  );
}

export async function acceptConfig(
  ctx: RequestContext,
  input: AcceptConfigInput,
): Promise<{ id: string }> {
  return db.transaction(ctx, async (tx) => {
    // If superseding, mark old version superseded first
    if (input.supersedesConfigId) {
      const old = await tx.maybeOne<{ id: string; status: string }>(sql`
        SELECT id, status FROM payroll_config
        WHERE organization_id = ${ctx.organizationId}
          AND id = ${input.supersedesConfigId}::uuid
        FOR UPDATE
      `);
      if (!old) throw new Error('Config to supersede not found');
      if (old.status !== 'active') throw new Error('Can only supersede an active config');

      await tx.query(sql`
        UPDATE payroll_config
        SET status = 'superseded',
            superseded_at = now(),
            supersession_actor = ${ctx.principal.id},
            supersession_reason = ${'superseded by new version'}
        WHERE id = ${input.supersedesConfigId}::uuid
      `);
    }

    const row = await tx.one<{ id: string }>(sql`
      INSERT INTO payroll_config
        (organization_id, effective_from, settings, schema_version, accepted_by, ca_hr_approval,
         supersedes_config_id)
      VALUES (
        ${ctx.organizationId}, ${input.effectiveFrom}::date,
        ${JSON.stringify(input.settings)}::jsonb,
        ${input.schemaVersion ?? 'v1'},
        ${ctx.principal.id},
        ${input.caHrApproval},
        ${input.supersedesConfigId ?? null}::uuid
      )
      RETURNING id
    `);

    if (input.sources.length > 0) {
      for (const src of input.sources) {
        await tx.query(sql`
          INSERT INTO payroll_config_source
            (organization_id, config_id, statutory_choice, issuer, title, reference,
             source_date, effective_date, retained_object_key, retained_sha256)
          VALUES (
            ${ctx.organizationId}, ${row.id}::uuid,
            ${src.statutoryChoice}, ${src.issuer}, ${src.title}, ${src.reference},
            ${src.sourceDate}::date, ${src.effectiveDate}::date,
            ${src.retainedObjectKey ?? null}, ${src.retainedSha256 ?? null}
          )
        `);
      }
    }

    return { id: row.id };
  });
}
