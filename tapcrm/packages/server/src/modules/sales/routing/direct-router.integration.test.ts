import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal } from '@tapcrm/contracts';
import { createJobContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { expire } from '../bidding/service.js';

/**
 * Sales v1.1 — direct-router fairness under concurrency (R1 plan step 1.4).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 *
 * Four `pool_open` leads expire concurrently in a two-agent pool. The pool
 * advisory lock serializes routing per pool, so the second pick already
 * sees the first pick's committed lead; each agent ends up with exactly
 * two leads.
 */

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
// Digits only: RUN is embedded in E.164 phone numbers (contact_primary_phone_check).
const RUN = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const ORG = randomUUID();
// Digits only (E.164 phone numbers), unique per contact within a run.
let PHONE_SEQ = 0;
const DEPARTMENT = randomUUID();
const POSITION = randomUUID();
const POOL_TEAM = randomUUID();
const AGENT_A = randomUUID();
const AGENT_B = randomUUID();
const SOURCE = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

const principal = (userId: string): Principal => ({
  id: userId,
  organizationId: ORG,
  sessionVersion: 0,
  accountType: 'employee',
  teamId: POOL_TEAM,
  departmentId: DEPARTMENT,
  positionId: POSITION,
  reportsTo: null,
  organizationalLevel: 1,
});

const ctxFor = (userId: string) =>
  createJobContext({
    organizationId: ORG,
    principal: principal(userId),
    jobName: 'sales.routing.test',
    runId: RUN,
  });

async function insertExpiredPoolLead(now = new Date()): Promise<string> {
  const leadId = randomUUID();
  const contactId = randomUUID();
  const expiresAt = new Date(now.getTime() - 60_000);
  await asOwner(
    'create contact',
    sql`
      INSERT INTO contact (id, organization_id, full_name, primary_phone, preferred_timezone, created_by)
      VALUES (${contactId}, ${ORG}, ${'Routing ' + leadId.slice(0, 4)},
              ${'+9198001' + String(++PHONE_SEQ).padStart(5, '0')}, 'Asia/Kolkata', ${AGENT_A})
    `,
  );
  await asOwner(
    'create lead already past deadline',
    sql`
      INSERT INTO lead (
        id, organization_id, source_id, contact_id, contact_name, status, routing_status,
        sales_pool_id, sales_team_id, created_by,
        entry_method, direction, bid_state, bid_pool_opened_at, bid_pool_expires_at,
        lead_stage, lead_outcome
      ) VALUES (
        ${leadId}, ${ORG}, ${SOURCE}, ${contactId}, ${'Routing ' + leadId.slice(0, 4)},
        'new', 'unrouted',
        ${POOL_TEAM}, ${POOL_TEAM}, ${AGENT_A},
        'website', 'inbound', 'pool_open', ${new Date(now.getTime() - 11 * 60_000)}, ${expiresAt},
        'new', 'active'
      )
    `,
  );
  return leadId;
}

async function makeAgentEligible(userId: string): Promise<void> {
  const now = new Date();
  const workDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
  const windowStart = new Date(now.getTime() - 60 * 60_000);
  const windowEnd = new Date(now.getTime() + 12 * 60 * 60_000);
  await asOwner(
    'upsert user_status WORKING',
    sql`
      INSERT INTO user_status (organization_id, user_id, work_date, state, since, last_event_at, window_start, window_end, rollover_due_at)
      VALUES (${ORG}, ${userId}, ${workDate}, 'WORKING', ${now}, ${now}, ${windowStart}, ${windowEnd}, ${windowEnd})
      ON CONFLICT (organization_id, user_id) DO UPDATE
        SET state = 'WORKING', day_group = NULL, work_date = EXCLUDED.work_date,
            since = EXCLUDED.since, last_event_at = EXCLUDED.last_event_at,
            window_start = EXCLUDED.window_start, window_end = EXCLUDED.window_end,
            rollover_due_at = EXCLUDED.rollover_due_at
    `,
  );
}

describe.skipIf(!enabled)('sales direct-router (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`SR${RUN}`}, 'Sales Routing Test', 'Asia/Kolkata')`,
    );
    await asOwner(
      'create department',
      sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPARTMENT}, ${ORG}, 'SALES', 'Sales', 'sales')`,
    );
    await asOwner(
      'create position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level) VALUES (${POSITION}, ${ORG}, ${DEPARTMENT}, 'SALES_AGENT', 'Sales Agent', 1)`,
    );
    await asOwner(
      'create sales pool team',
      sql`INSERT INTO team (id, organization_id, department_id, kind, name) VALUES (${POOL_TEAM}, ${ORG}, ${DEPARTMENT}, 'sales-pool', 'Pool A')`,
    );
    await asOwner(
      'create agent A',
      sql`
        INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, employee_id)
        VALUES (${AGENT_A}, ${ORG}, 'employee', 'Agent A', 'active', ${POSITION}, ${DEPARTMENT}, ${POOL_TEAM}, 'E-' || upper(left(replace(${AGENT_A}::text, '-', ''), 12)))
      `,
    );
    await asOwner(
      'create agent B',
      sql`
        INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, employee_id)
        VALUES (${AGENT_B}, ${ORG}, 'employee', 'Agent B', 'active', ${POSITION}, ${DEPARTMENT}, ${POOL_TEAM}, 'E-' || upper(left(replace(${AGENT_B}::text, '-', ''), 12)))
      `,
    );
    await asOwner(
      'create lead source',
      sql`INSERT INTO lead_source (id, organization_id, name, direction, status) VALUES (${SOURCE}, ${ORG}, ${`Website ${RUN}`}, 'inbound', 'active')`,
    );
    await makeAgentEligible(AGENT_A);
    await makeAgentEligible(AGENT_B);
  });

  afterAll(async () => {
    await asOwner('cleanup routing',    sql`DELETE FROM sales_routing_decision WHERE organization_id = ${ORG}`);
    await asOwner('cleanup bid views',  sql`DELETE FROM bid_pool_view          WHERE organization_id = ${ORG}`);
    await asOwner('cleanup leads',      sql`DELETE FROM lead                   WHERE organization_id = ${ORG}`);
    await asOwner('cleanup contacts',   sql`DELETE FROM contact                WHERE organization_id = ${ORG}`);
    await asOwner('cleanup statuses',   sql`DELETE FROM user_status            WHERE organization_id = ${ORG}`);
    await asOwner('cleanup users',      sql`DELETE FROM app_user               WHERE organization_id = ${ORG}`);
    await asOwner('cleanup sources',    sql`DELETE FROM lead_source            WHERE organization_id = ${ORG}`);
    await asOwner('cleanup pool',       sql`DELETE FROM team                   WHERE organization_id = ${ORG}`);
    await asOwner('cleanup position',   sql`DELETE FROM position               WHERE organization_id = ${ORG}`);
    await asOwner('cleanup department', sql`DELETE FROM department             WHERE organization_id = ${ORG}`);
    await asOwner('cleanup org',        sql`DELETE FROM organization           WHERE id              = ${ORG}`);
    await closePools();
  });

  it('four leads arriving simultaneously to a 2-agent pool: each agent ends with two', async () => {
    const leadIds = await Promise.all([
      insertExpiredPoolLead(),
      insertExpiredPoolLead(),
      insertExpiredPoolLead(),
      insertExpiredPoolLead(),
    ]);

    // Run four fallback expiries concurrently; the pool advisory lock
    // serializes them so each pick sees the committed state of the prior.
    const results = await Promise.all(leadIds.map((id) => expire(ctxFor(AGENT_A), id)));
    for (const r of results) expect(r.outcome).toBe('fallback_assigned');

    const counts = await asOwner(
      'count leads per owner',
      sql`
        SELECT owner_id AS "ownerId", count(*)::int AS "count"
          FROM lead
         WHERE organization_id = ${ORG} AND id = ANY(${leadIds}::uuid[])
         GROUP BY owner_id
         ORDER BY owner_id
      `,
    );
    expect(counts).toHaveLength(2);
    for (const row of counts) {
      expect((row as { count: number }).count).toBe(2);
    }
  });
});
