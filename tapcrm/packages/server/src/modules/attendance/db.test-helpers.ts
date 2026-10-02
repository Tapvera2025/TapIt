import { platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

/** Test helpers that read attendance tables as the owner role. */

/** The organization's days whose answer is older than their inputs: what the queue would calculate. */
export async function staleRecordIds(organizationId: string): Promise<string[]> {
  const rows = await platformDb.query<{ id: string }>(
    'migration',
    'read stale days',
    sql`
    SELECT id FROM attendance_record
    WHERE organization_id = ${organizationId} AND calculated_input_version < input_version
    ORDER BY work_date, id`,
  );
  return rows.map((row) => row.id);
}
