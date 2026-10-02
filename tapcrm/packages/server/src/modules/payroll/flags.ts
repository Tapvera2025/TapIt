import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export interface DriftInput {
  readonly runId: string;
  readonly userId: string;
  readonly kind: 'population-entry' | 'population-reduced' | 'blocker';
  readonly sourceType?: string;
  readonly sourceId?: string;
}

export async function openDrift(
  tx: Tx,
  organizationId: string,
  input: DriftInput,
): Promise<{ id: string } | null> {
  // Idempotent: do not open if already open
  const existing = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM payroll_run_drift
    WHERE organization_id = ${organizationId}
      AND run_id = ${input.runId}::uuid
      AND user_id = ${input.userId}::uuid
      AND kind = ${input.kind}
      AND (${input.sourceType ?? null}::text IS NULL OR source_type = ${input.sourceType ?? null})
      AND (${input.sourceId ?? null}::text IS NULL OR source_id = ${input.sourceId ?? null})
      AND resolved_at IS NULL
  `);
  if (existing) return null;

  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO payroll_run_drift
      (organization_id, run_id, user_id, kind, source_type, source_id)
    VALUES (
      ${organizationId}, ${input.runId}::uuid, ${input.userId}::uuid,
      ${input.kind}, ${input.sourceType ?? null}, ${input.sourceId ?? null}
    )
    RETURNING id
  `);
  return row;
}

export async function openFlag(
  tx: Tx,
  organizationId: string,
  payslipId: string,
  sourceType: string,
  sourceId: string,
  kind: 'inputs-changed' | 'blocker' | 'population-change',
): Promise<void> {
  // Idempotent per (payslip, source_type, source_id) unique index
  await tx.query(sql`
    INSERT INTO payslip_flag (organization_id, payslip_id, source_type, source_id, kind)
    VALUES (${organizationId}, ${payslipId}::uuid, ${sourceType}, ${sourceId}, ${kind})
    ON CONFLICT (organization_id, payslip_id, source_type, source_id) DO NOTHING
  `);
}

/** Find the latest published slip for a person/period. */
export async function latestPublishedSlip(
  tx: Tx,
  organizationId: string,
  userId: string,
  periodStart: string,
): Promise<{ id: string; inputsFingerprint: string | null; revisionNumber: number } | null> {
  return tx.maybeOne<{ id: string; inputsFingerprint: string | null; revisionNumber: number }>(sql`
    SELECT id, inputs_fingerprint AS "inputsFingerprint", revision_number AS "revisionNumber"
    FROM payslip
    WHERE organization_id = ${organizationId}
      AND user_id = ${userId}::uuid
      AND period_start = ${periodStart}::date
      AND status = 'published'
    ORDER BY revision_number DESC
    LIMIT 1
  `);
}

/** Find the published run for an org/period. */
export async function publishedRunForPeriod(
  tx: Tx,
  organizationId: string,
  periodStart: string,
): Promise<{ id: string } | null> {
  return tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM payroll_run
    WHERE organization_id = ${organizationId}
      AND period_start = ${periodStart}::date
      AND status = 'published'
    LIMIT 1
  `);
}
