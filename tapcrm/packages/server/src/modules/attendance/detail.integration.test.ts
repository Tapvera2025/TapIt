import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobContext, systemPrincipal } from '../../platform/dal/context.js';
import { db, platformDb } from '../../platform/dal/db.js';
import { closePools } from '../../platform/dal/pool.js';
import { sql } from '../../platform/dal/sql.js';
import { toDateOnly } from '../../platform/time.js';
import { staleRecordIds } from './db.test-helpers.js';
import { appendEvent, applyOverlay, retireEvent } from './facade.js';
import { recalculateRecord } from './recalculate.js';
import { dayDetail } from './service.js';

/**
 * AT-12 day detail against real PostgreSQL: composed from what the day
 * stored, so a past day still shows the department and shift it was judged
 * with after a transfer (§8.1).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */
const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const ORG = randomUUID();
const OPS = randomUUID();
const SALES = randomUUID();
const OPS_POS = randomUUID();
const SALES_POS = randomUUID();
const HR = randomUUID();
const PERSON = randomUUID();
const DAY = randomUUID();
const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);
const ctx = () =>
  createJobContext({
    organizationId: ORG,
    principal: systemPrincipal(ORG),
    jobName: 'test',
    runId: randomUUID(),
  });
const ist = (local: string) => new Date(`${local}+05:30`);
const DATE = toDateOnly('2026-10-05');

/** Calculates every stale day of the organization, as the queue would. */
async function settle(): Promise<void> {
  for (const id of await staleRecordIds(ORG)) {
    await db.transaction(ctx(), (tx) => recalculateRecord(tx, id));
  }
}

describe.skipIf(!enabled)('attendance day detail (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`DD${ORG.slice(0, 6)}`}, 'Detail Test', 'Asia/Kolkata')`,
    );
    await asOwner(
      'departments',
      sql`INSERT INTO department (id, organization_id, code, name, kind)
          VALUES (${OPS}, ${ORG}, 'OPS', 'Operations', 'operations'), (${SALES}, ${ORG}, 'SAL', 'Sales', 'sales')`,
    );
    await asOwner(
      'positions',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level)
          VALUES (${OPS_POS}, ${ORG}, ${OPS}, 'OPS-1', 'Operator', 20), (${SALES_POS}, ${ORG}, ${SALES}, 'SAL-1', 'Seller', 20)`,
    );
    for (const [index, id] of [HR, PERSON].entries()) {
      await asOwner(
        'people',
        sql`INSERT INTO app_user (id, organization_id, account_type, employee_id, email, full_name, position_id, department_id)
            VALUES (${id}, ${ORG}, 'employee', ${`EMP-DD${index}`}, ${`p${index}-${id}@t.io`}, ${`Person ${index}`}, ${OPS_POS}, ${OPS})`,
      );
    }
    await asOwner(
      'shift',
      sql`INSERT INTO shift (id, organization_id, code, name, kind, created_by) VALUES (${DAY}, ${ORG}, 'DAY', 'Day', 'fixed', ${HR})`,
    );
    await asOwner(
      'version',
      sql`INSERT INTO shift_version (organization_id, shift_id, effective_from, start_time, end_time, grace_minutes,
                                     full_day_minutes, half_day_minutes, created_by)
          VALUES (${ORG}, ${DAY}, '2026-01-01', '09:00', '18:00', 10, 450, 240, ${HR})`,
    );
    await asOwner(
      'a four-hour closing extension (Q3)',
      sql`INSERT INTO shift_setting (organization_id, effective_from, max_closing_extension_minutes, created_by)
          VALUES (${ORG}, '2026-01-01', 240, ${HR})`,
    );
    await asOwner(
      'template',
      sql`INSERT INTO shift_assignment (organization_id, user_id, kind, shift_id, effective_from, created_by)
          VALUES (${ORG}, ${PERSON}, 'template', ${DAY}, '2026-01-01', ${HR})`,
    );
  });

  afterAll(async () => {
    await closePools();
  });

  it('composes the day from what it stored, and keeps its department after a transfer', async () => {
    const punch = (kind: 'in' | 'out', local: string) =>
      db.transaction(ctx(), (tx) =>
        appendEvent(tx, {
          userId: PERSON,
          kind,
          at: ist(local),
          source: 'web',
          evidence: 'confirmed',
          remote: true,
        }),
      );
    await punch('in', '2026-10-05T09:04:00');
    const out = await punch('out', '2026-10-05T18:02:00');
    await db.transaction(ctx(), (tx) =>
      applyOverlay(tx, {
        sourceKind: 'wfh',
        sourceId: randomUUID(),
        userId: PERSON,
        workDate: DATE,
        kind: 'wfh',
      }),
    );
    await settle();

    await asOwner(
      'move to sales',
      sql`UPDATE app_user SET department_id = ${SALES}, position_id = ${SALES_POS} WHERE id = ${PERSON}`,
    );
    const detail = await dayDetail(ctx(), PERSON, DATE);
    expect(detail.record).toMatchObject({
      status: 'present',
      dayType: 'working',
      shiftSource: 'template',
      placement: { departmentId: OPS },
      isWfh: true,
      minutes: { worked: 538, late: 0 },
    });
    expect(detail.record.shift).toMatchObject({
      shiftId: DAY,
      start: '09:00',
      end: '18:00',
    });
    expect(
      detail.events.effective.map((event) => (event as { kind: string }).kind),
    ).toEqual(['in', 'out']);
    expect(detail.events.superseded).toEqual([]);
    expect(detail.overlays).toMatchObject([{ kind: 'wfh', sourceKind: 'wfh' }]);
    expect(detail.corrections).toEqual([]);

    // Retiring the departure moves it to the ledger's history, beside the
    // system void row that retired it.
    await db.transaction(ctx(), (tx) => retireEvent(tx, out.eventId));
    const after = await dayDetail(ctx(), PERSON, DATE);
    expect(
      after.events.effective.map((event) => (event as { kind: string }).kind),
    ).toEqual(['in']);
    const [retired, voidRow] = after.events.superseded as {
      id: string;
      kind: string;
      isVoid: boolean;
      source: string;
      supersededBy: string | null;
    }[];
    expect(retired).toMatchObject({ id: out.eventId, kind: 'out', isVoid: false });
    expect(voidRow).toMatchObject({ kind: 'out', isVoid: true, source: 'system' });
    expect(retired!.supersededBy).toBe(voidRow!.id);
  });

  it('a date with no day is 404 ATTENDANCE_DAY_NOT_FOUND', async () => {
    await expect(
      dayDetail(ctx(), PERSON, toDateOnly('2026-10-20')),
    ).rejects.toMatchObject({
      status: 404,
      code: 'ATTENDANCE_DAY_NOT_FOUND',
    });
  });
});
