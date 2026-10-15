import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal } from '@tapcrm/contracts';
import { createJobContext } from '../../../platform/dal/context.js';
import { db, platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { claim, expire, listBidPool, pass } from './service.js';
import { BidPoolAlreadyClaimedError, BidPoolInvalidStateError } from './errors.js';

/**
 * Sales v1.1 — bidding service end-to-end against PostgreSQL (R1 step 1.3).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 *
 * Covers:
 *   - claim transitions a pool_open lead and sets owner, holder, SLA
 *   - two concurrent claims: one wins, the other sees BidPoolAlreadyClaimedError
 *   - pass records a 5-minute cooling row for the acting agent only
 *   - pass on a claimed lead rejects with BidPoolInvalidStateError
 *   - expire of a pool_open lead moves it to triage
 *   - expire of an already-claimed lead is a no-op
 *   - listBidPool returns pool_open leads for pool members and hides passed cards
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
    jobName: 'sales.bidding.test',
    runId: RUN,
  });

async function insertPoolOpenLead(now = new Date()): Promise<string> {
  const leadId = randomUUID();
  const contactId = randomUUID();
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  await asOwner(
    'create contact',
    sql`
      INSERT INTO contact (id, organization_id, full_name, primary_phone, primary_email, preferred_timezone, created_by)
      VALUES (${contactId}, ${ORG}, ${'Test Lead ' + leadId.slice(0, 4)},
              ${'+9198000' + String(++PHONE_SEQ).padStart(5, '0')}, NULL, 'Asia/Kolkata', ${AGENT_A})
    `,
  );
  await asOwner(
    'create lead in pool_open',
    sql`
      INSERT INTO lead (
        id, organization_id, source_id, contact_id, contact_name, status, routing_status,
        sales_pool_id, sales_team_id, created_by,
        entry_method, direction, bid_state, bid_pool_opened_at, bid_pool_expires_at,
        lead_stage, lead_outcome
      ) VALUES (
        ${leadId}, ${ORG}, ${SOURCE}, ${contactId}, ${'Test Lead ' + leadId.slice(0, 4)},
        'new', 'unrouted',
        ${POOL_TEAM}, ${POOL_TEAM}, ${AGENT_A},
        'website', 'inbound', 'pool_open', ${now}, ${expiresAt},
        'new', 'active'
      )
    `,
  );
  await asOwner(
    'create submission for card payload',
    sql`
      INSERT INTO lead_submission (
        id, organization_id, source_received_at, outcome, lead_id, normalized_payload
      ) VALUES (
        ${randomUUID()}, ${ORG}, ${now}, 'created', ${leadId},
        ${JSON.stringify({ serviceRequested: 'Website', location: 'Pune', message: 'need a demo' })}::jsonb
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

describe.skipIf(!enabled)('sales bidding service (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`SB${RUN}`}, 'Sales Bidding Test', 'Asia/Kolkata')`,
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
    await asOwner('cleanup routing',     sql`DELETE FROM sales_routing_decision WHERE organization_id = ${ORG}`);
    await asOwner('cleanup bid views',   sql`DELETE FROM bid_pool_view          WHERE organization_id = ${ORG}`);
    await asOwner('cleanup submissions', sql`DELETE FROM lead_submission        WHERE organization_id = ${ORG}`);
    await asOwner('cleanup leads',       sql`DELETE FROM lead                   WHERE organization_id = ${ORG}`);
    await asOwner('cleanup contacts',    sql`DELETE FROM contact                WHERE organization_id = ${ORG}`);
    await asOwner('cleanup statuses',    sql`DELETE FROM user_status            WHERE organization_id = ${ORG}`);
    await asOwner('cleanup users',       sql`DELETE FROM app_user               WHERE organization_id = ${ORG}`);
    await asOwner('cleanup sources',     sql`DELETE FROM lead_source            WHERE organization_id = ${ORG}`);
    await asOwner('cleanup pool',        sql`DELETE FROM team                   WHERE organization_id = ${ORG}`);
    await asOwner('cleanup position',    sql`DELETE FROM position               WHERE organization_id = ${ORG}`);
    await asOwner('cleanup department',  sql`DELETE FROM department             WHERE organization_id = ${ORG}`);
    await asOwner('cleanup org',         sql`DELETE FROM organization           WHERE id              = ${ORG}`);
    await closePools();
  });

  it('claim transitions a pool_open lead to claimed with owner, holder and SLA set', async () => {
    const leadId = await insertPoolOpenLead();
    const result = await claim(ctxFor(AGENT_A), leadId);

    expect(result.leadId).toBe(leadId);
    expect(result.claimedByUserId).toBe(AGENT_A);
    expect(result.slaFirstContactDueAt.getTime()).toBeGreaterThan(result.claimedAt.getTime());

    const rows = await asOwner(
      'read claimed lead',
      sql`SELECT bid_state, owner_id, current_holder_id, originating_agent_id, claimed_at, routing_status FROM lead WHERE id = ${leadId}`,
    );
    expect(rows[0]).toMatchObject({
      bidState: 'claimed',
      ownerId: AGENT_A,
      currentHolderId: AGENT_A,
      originatingAgentId: AGENT_A,
      routingStatus: 'assigned',
    });
    expect((rows[0] as { claimedAt: Date | null }).claimedAt).toBeInstanceOf(Date);

    const views = await asOwner(
      'read view row',
      sql`SELECT action FROM bid_pool_view WHERE organization_id = ${ORG} AND lead_id = ${leadId} AND agent_id = ${AGENT_A}`,
    );
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ action: 'claimed' });

    const decisions = await asOwner(
      'read routing decision',
      sql`SELECT mode, reason FROM sales_routing_decision WHERE organization_id = ${ORG} AND lead_id = ${leadId}`,
    );
    expect(decisions[0]).toMatchObject({ mode: 'bidding', reason: 'claim' });
  });

  it('two concurrent claims: one wins, the other sees BidPoolAlreadyClaimedError', async () => {
    const leadId = await insertPoolOpenLead();
    const results = await Promise.allSettled([
      claim(ctxFor(AGENT_A), leadId),
      claim(ctxFor(AGENT_B), leadId),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BidPoolAlreadyClaimedError);

    const rows = await asOwner(
      'confirm single winner',
      sql`SELECT bid_state, owner_id FROM lead WHERE id = ${leadId}`,
    );
    expect(rows[0]).toMatchObject({ bidState: 'claimed' });
    const winner = (fulfilled[0] as PromiseFulfilledResult<{ claimedByUserId: string }>).value.claimedByUserId;
    expect((rows[0] as { ownerId: string }).ownerId).toBe(winner);
  });

  it('pass records a 5-minute cooling row for the acting agent only', async () => {
    const leadId = await insertPoolOpenLead();
    const before = new Date();
    await pass(ctxFor(AGENT_A), leadId, 'wrong_location');
    const views = await asOwner(
      'read agent A view',
      sql`SELECT action, pass_reason, pass_until FROM bid_pool_view WHERE organization_id = ${ORG} AND lead_id = ${leadId} AND agent_id = ${AGENT_A}`,
    );
    expect(views[0]).toMatchObject({ action: 'passed', passReason: 'wrong_location' });
    const until = (views[0] as { passUntil: Date }).passUntil;
    const minutesAhead = (until.getTime() - before.getTime()) / 60_000;
    expect(minutesAhead).toBeGreaterThan(4);
    expect(minutesAhead).toBeLessThan(6);

    // Lead itself is still pool_open; pass only writes a per-agent view row.
    const rows = await asOwner('read lead state', sql`SELECT bid_state FROM lead WHERE id = ${leadId}`);
    expect(rows[0]).toMatchObject({ bidState: 'pool_open' });

    const otherAgentViews = await asOwner(
      'confirm no view row for agent B',
      sql`SELECT 1 FROM bid_pool_view WHERE organization_id = ${ORG} AND lead_id = ${leadId} AND agent_id = ${AGENT_B}`,
    );
    expect(otherAgentViews).toHaveLength(0);
  });

  it('pass on a claimed lead rejects with BidPoolInvalidStateError', async () => {
    const leadId = await insertPoolOpenLead();
    await claim(ctxFor(AGENT_A), leadId);
    await expect(pass(ctxFor(AGENT_B), leadId, 'other')).rejects.toBeInstanceOf(BidPoolInvalidStateError);
  });

  it('expire of a pool_open lead moves it to triage', async () => {
    const leadId = await insertPoolOpenLead(new Date(Date.now() - 11 * 60_000));
    const result = await expire(ctxFor(AGENT_A), leadId);
    expect(result.outcome).toBe('triaged');
    const rows = await asOwner('read lead state', sql`SELECT bid_state FROM lead WHERE id = ${leadId}`);
    expect(rows[0]).toMatchObject({ bidState: 'triage' });
    const decisions = await asOwner(
      'read fallback decision',
      sql`SELECT mode FROM sales_routing_decision WHERE organization_id = ${ORG} AND lead_id = ${leadId}`,
    );
    expect(decisions[0]).toMatchObject({ mode: 'fallback' });
  });

  it('expire of an already-claimed lead is a no-op', async () => {
    const leadId = await insertPoolOpenLead();
    await claim(ctxFor(AGENT_A), leadId);
    const result = await expire(ctxFor(AGENT_A), leadId);
    expect(result.outcome).toBe('noop_claimed');
    const rows = await asOwner('read lead state', sql`SELECT bid_state FROM lead WHERE id = ${leadId}`);
    expect(rows[0]).toMatchObject({ bidState: 'claimed' });
  });

  it('listBidPool returns pool_open leads for pool members and hides passed cards', async () => {
    const leadVisible = await insertPoolOpenLead();
    const leadPassed = await insertPoolOpenLead();
    await pass(ctxFor(AGENT_A), leadPassed, 'at_capacity');

    const list = await db.transaction(ctxFor(AGENT_A), async () => listBidPool(ctxFor(AGENT_A)));
    const ids = list.map((card) => card.leadId);
    expect(ids).toContain(leadVisible);
    expect(ids).not.toContain(leadPassed);
  });
});
