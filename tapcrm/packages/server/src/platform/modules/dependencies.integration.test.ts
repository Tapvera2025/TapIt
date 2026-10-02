import { afterAll, describe, expect, it } from 'vitest';
import { platformDb } from '../dal/db.js';
import { closePools } from '../dal/pool.js';
import { sql } from '../dal/sql.js';

/**
 * Migration 0046 — PRD §5.8 dependencies for the People modules, and the
 * btree_gist extension later steps' overlap constraints need.
 *
 * Opt-in: TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';

async function closureOf(key: string): Promise<string[]> {
  const rows = await platformDb.query<{ key: string }>(
    'migration',
    `dependency closure of ${key}`,
    sql`
      WITH RECURSIVE closure(id) AS (
        SELECT id FROM module WHERE key = ${key}
        UNION
        SELECT md.depends_on_module_id FROM module_dependency md JOIN closure c ON md.module_id = c.id
      )
      SELECT m.key FROM closure c JOIN module m ON m.id = c.id WHERE m.key <> ${key} ORDER BY m.key
    `,
  );
  return rows.map((row) => row.key);
}

describe.skipIf(!enabled)('People module dependencies (PostgreSQL)', () => {
  afterAll(async () => {
    await closePools();
  });

  it('enabling payroll brings attendance, leave, break-management and shifts with it', async () => {
    expect(await closureOf('payroll')).toEqual(
      expect.arrayContaining(['attendance', 'break-management', 'leave', 'shifts']),
    );
  });

  it('follows PRD §5.8 for the rest of the People modules', async () => {
    expect(await closureOf('live-status')).toEqual(expect.arrayContaining(['attendance', 'shifts']));
    expect(await closureOf('biometric')).toEqual(expect.arrayContaining(['attendance', 'shifts']));
    expect(await closureOf('holidays')).toEqual(expect.arrayContaining(['shifts']));
    expect(await closureOf('shifts')).not.toContain('attendance');
  });

  it('has btree_gist installed', async () => {
    const rows = await platformDb.query<{ extname: string }>(
      'migration',
      'check btree_gist',
      sql`SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`,
    );
    expect(rows).toHaveLength(1);
  });
});
