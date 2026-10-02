import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export async function recordDocument(
  tx: Tx,
  organizationId: string,
  payslipId: string,
  objectKey: string,
  sha256: string,
): Promise<{ documentId: string }> {
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO payslip_document (organization_id, payslip_id, object_key, sha256)
    VALUES (${organizationId}, ${payslipId}::uuid, ${objectKey}, ${sha256})
    RETURNING id
  `);
  return { documentId: row.id };
}

export async function getDocument(
  tx: Tx,
  organizationId: string,
  payslipId: string,
): Promise<{ id: string; objectKey: string; sha256: string; renderedAt: string } | null> {
  return tx.maybeOne<{ id: string; objectKey: string; sha256: string; renderedAt: string }>(sql`
    SELECT id, object_key AS "objectKey", sha256, rendered_at::text AS "renderedAt"
    FROM payslip_document
    WHERE organization_id = ${organizationId} AND payslip_id = ${payslipId}::uuid
  `);
}
