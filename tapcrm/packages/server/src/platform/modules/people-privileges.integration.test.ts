import { afterAll, describe, expect, it } from 'vitest';
import { platformDb } from '../dal/db.js';
import { closePools } from '../dal/pool.js';
import { sql } from '../dal/sql.js';

/**
 * What the app role may do to each People table (migrations 0047–0058).
 * Migration 0001 grants every new table SELECT, INSERT, UPDATE and DELETE by
 * default, so a rule like "never deleted" or "append-only" holds only if a
 * migration revokes the rest. This pins the result, table by table.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

const EXPECTED: Record<string, string> = {
  shift: 'INSERT,SELECT,UPDATE',
  shift_version: 'INSERT,SELECT',
  shift_rotation: 'INSERT,SELECT,UPDATE',
  shift_rotation_day: 'INSERT,SELECT',
  shift_assignment: 'INSERT,SELECT,UPDATE',
  shift_request: 'INSERT,SELECT,UPDATE',
  shift_override: 'DELETE,INSERT,SELECT',
  department_shift_default: 'INSERT,SELECT,UPDATE',
  shift_setting: 'INSERT,SELECT',
  holiday: 'INSERT,SELECT,UPDATE',
  holiday_scope: 'DELETE,INSERT,SELECT',
  attendance_event: 'INSERT,SELECT',
  attendance_record: 'INSERT,SELECT,UPDATE',
  attendance_event_assignment: 'DELETE,INSERT,SELECT,UPDATE',
  attendance_overlay: 'DELETE,INSERT,SELECT',
  attendance_setting: 'INSERT,SELECT',
  arrival_policy_override: 'INSERT,SELECT,UPDATE',
  arrival_exception: 'INSERT,SELECT',
  attendance_day_open_state: 'INSERT,SELECT,UPDATE',
  attendance_month_summary: 'INSERT,SELECT,UPDATE',
  attendance_refresh_request: 'INSERT,SELECT,UPDATE',
  attendance_export_request: 'INSERT,SELECT,UPDATE',
  biometric_connector: 'INSERT,SELECT,UPDATE',
  biometric_device: 'INSERT,SELECT,UPDATE',
  biometric_reader: 'DELETE,INSERT,SELECT,UPDATE',
  biometric_pin_mapping: 'INSERT,SELECT,UPDATE',
  biometric_punch: 'INSERT,SELECT,UPDATE',
  biometric_alert: 'INSERT,SELECT,UPDATE',
  biometric_replay_request: 'INSERT,SELECT,UPDATE',
  biometric_review_item: 'INSERT,SELECT,UPDATE',
  leave_type: 'INSERT,SELECT,UPDATE',
  leave_request: 'INSERT,SELECT,UPDATE',
  leave_attachment: 'INSERT,SELECT',
  leave_balance_entry: 'INSERT,SELECT',
  work_from_home_day: 'DELETE,INSERT,SELECT,UPDATE',
  attendance_correction: 'INSERT,SELECT,UPDATE',
  attendance_review_item: 'INSERT,SELECT,UPDATE',
  break_policy: 'INSERT,SELECT,UPDATE',
  break_policy_version: 'INSERT,SELECT',
  break_penalty_rule: 'INSERT,SELECT',
  break_policy_assignment: 'INSERT,SELECT,UPDATE',
  break_breach: 'INSERT,SELECT,UPDATE',
  payroll_input: 'INSERT,SELECT,UPDATE',
  payroll_config: 'INSERT,SELECT,UPDATE',
  payroll_config_source: 'INSERT,SELECT',
  salary_structure: 'INSERT,SELECT,UPDATE',
  salary_structure_line: 'INSERT,SELECT',
  payroll_run: 'INSERT,SELECT,UPDATE',
  payroll_run_employee: 'INSERT,SELECT,UPDATE',
  payslip: 'INSERT,SELECT,UPDATE',
  payslip_line: 'DELETE,INSERT,SELECT',
  payslip_salary_use: 'DELETE,INSERT,SELECT',
  payslip_document: 'INSERT,SELECT',
  payslip_flag: 'INSERT,SELECT,UPDATE',
  payroll_run_drift: 'INSERT,SELECT,UPDATE',
  ledger_posting_intent: 'INSERT,SELECT,UPDATE',
};

describe.skipIf(!enabled)('People table privileges for the app role (PostgreSQL)', () => {
  afterAll(async () => {
    await closePools();
  });

  it('each table allows exactly what its rules need', async () => {
    const rows = await platformDb.query<{ tableName: string; privileges: string }>(
      'migration',
      'read People table privileges',
      sql`
      SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.table_privileges
      WHERE grantee = 'tapcrm_app' AND table_name = ANY(${Object.keys(EXPECTED)}::text[])
        AND table_schema = 'public'
        AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      GROUP BY table_name`,
    );
    const actual = Object.fromEntries(rows.map((row) => [row.tableName, row.privileges]));
    expect(actual).toEqual(EXPECTED);
  });
});
