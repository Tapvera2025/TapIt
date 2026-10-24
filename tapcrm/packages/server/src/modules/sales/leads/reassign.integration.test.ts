import { randomUUID } from 'node:crypto';
import { installAuthz } from '../../../platform/authz-adapter.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal } from '@tapcrm/contracts';
import { createJobContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { reassign } from './reassign.js';

/**
 * Sales v1.1 — reassignment service end-to-end (R1 plan step 1.5).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 *
 * Covers the two plan scenarios where the state transition is the
 * assertion:
 *   - HOD reassigns, keeps credit: `originating_agent_id` unchanged.
 *   - Super Admin reassigns + transfers credit: `originating_agent_id`
 *     advances to the new owner; the previous holder receives a
 *     notification; a reassignment routing_decision row is written.
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
const HOD = randomUUID();
const SUPER_ADMIN = randomUUID();
const AGENT_A = randomUUID();
const AGENT_B = randomUUID();
const SOURCE = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

const hodPrincipal = (): Principal => ({
  id: HOD,
  organizationId: ORG,
  sessionVersion: 0,
  accountType: 'employee',
  teamId: POOL_TEAM,
  departmentId: DEPARTMENT,
  positionId: POSITION,
  reportsTo: null,
  organizationalLevel: 5,
});

const superAdminPrincipal = (): Principal => ({
  id: SUPER_ADMIN,
  organizationId: ORG,
  sessionVersion: 0,
  accountType: 'super-admin',
});

const ctxHod = () =>
  createJobContext({
    organizationId: ORG,
    principal: hodPrincipal(),
    jobName: 'sales.reassign.test',
    runId: RUN,
  });

const ctxSuperAdmin = () =>
  createJobContext({
    organizationId: ORG,
    principal: superAdminPrincipal(),
    jobName: 'sales.reassign.test',
    runId: RUN,
  });

async function insertAssignedLead(
  originatingAgentId: string,
  currentHolderId: string,
): Promise<string> {
  const leadId = randomUUID();
  const contactId = randomUUID();
  await asOwner(
    'create contact',
    sql`
      INSERT INTO contact (id, organization_id, full_name, primary_phone, preferred_timezone, created_by)
      VALUES (${contactId}, ${ORG}, ${'Reassign ' + leadId.slice(0, 4)},
              ${'+9198002' + String(++PHONE_SEQ).padStart(5, '0')}, 'Asia/Kolkata', ${AGENT_A})
    `,
  );
  await asOwner(
    'create assigned lead',
    sql`
      INSERT INTO lead (
        id, organization_id, source_id, contact_id, contact_name, status, routing_status,
        sales_pool_id, sales_team_id, owner_id, current_holder_id, originating_agent_id,
        created_by,
        entry_method, direction, bid_state, claimed_at,
        lead_stage, lead_outcome
      ) VALUES (
        ${leadId}, ${ORG}, ${SOURCE}, ${contactId}, ${'Reassign ' + leadId.slice(0, 4)},
        'assigned', 'assigned',
        ${POOL_TEAM}, ${POOL_TEAM},
        ${currentHolderId}, ${currentHolderId}, ${originatingAgentId},
        ${currentHolderId},
        'manual', 'inbound', 'claimed', now(),
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

describe.skipIf(!enabled)('sales reassignment service (PostgreSQL)', () => {
  beforeAll(async () => {
    installAuthz();
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`RA${RUN}`}, 'Sales Reassign Test', 'Asia/Kolkata')`,
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
      'create HOD user',
      sql`
        INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, employee_id)
        VALUES (${HOD}, ${ORG}, 'employee', 'HOD', 'active', ${POSITION}, ${DEPARTMENT}, ${POOL_TEAM}, 'E-' || upper(left(replace(${HOD}::text, '-', ''), 12)))
      `,
    );
    await asOwner(
      'create super admin',
      sql`
        INSERT INTO app_user (id, organization_id, account_type, full_name, status)
        VALUES (${SUPER_ADMIN}, ${ORG}, 'super-admin', 'Admin', 'active')
      `,
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
    await asOwner('cleanup notifications', sql`DELETE FROM notification_outbox   WHERE organization_id = ${ORG}`);
    await asOwner('cleanup routing',       sql`DELETE FROM sales_routing_decision WHERE organization_id = ${ORG}`);
    await asOwner('cleanup audit',         sql`DELETE FROM audit_outbox           WHERE organization_id = ${ORG}`);
    await asOwner('cleanup callbacks',     sql`DELETE FROM lead_callback          WHERE organization_id = ${ORG}`);
    await asOwner('cleanup leads',         sql`DELETE FROM lead                   WHERE organization_id = ${ORG}`);
    await asOwner('cleanup contacts',      sql`DELETE FROM contact                WHERE organization_id = ${ORG}`);
    await asOwner('cleanup statuses',      sql`DELETE FROM user_status            WHERE organization_id = ${ORG}`);
    await asOwner('cleanup users',         sql`DELETE FROM app_user               WHERE organization_id = ${ORG}`);
    await asOwner('cleanup sources',       sql`DELETE FROM lead_source            WHERE organization_id = ${ORG}`);
    await asOwner('cleanup pool',          sql`DELETE FROM team                   WHERE organization_id = ${ORG}`);
    await asOwner('cleanup position',      sql`DELETE FROM position               WHERE organization_id = ${ORG}`);
    await asOwner('cleanup department',    sql`DELETE FROM department             WHERE organization_id = ${ORG}`);
    await asOwner('cleanup org',           sql`DELETE FROM organization           WHERE id              = ${ORG}`);
    await closePools();
  });

  it('super admin reassigning without credit transfer leaves originating_agent_id untouched', async () => {
    const leadId = await insertAssignedLead(AGENT_A, AGENT_A);
    const updated = await reassign(ctxSuperAdmin(), leadId, {
      newOwnerId: AGENT_B,
      reason: 'rebalancing pool load for the HOD',
      transferPendingCallbacks: true,
      transferScheduledActivities: true,
      transferSourcingCredit: false,
    });
    expect(updated.ownerId).toBe(AGENT_B);
    expect(updated.currentHolderId).toBe(AGENT_B);

    const rows = await asOwner(
      'read originating_agent_id',
      sql`SELECT originating_agent_id AS "originatingAgentId" FROM lead WHERE id = ${leadId}`,
    );
    expect((rows[0] as { originatingAgentId: string }).originatingAgentId).toBe(AGENT_A);

    const decisions = await asOwner(
      'read routing decision',
      sql`SELECT mode, reason FROM sales_routing_decision WHERE organization_id = ${ORG} AND lead_id = ${leadId}`,
    );
    expect(decisions[0]).toMatchObject({ mode: 'reassignment' });
  });

  it('super admin reassigning with credit transfer advances originating_agent_id and notifies the previous holder', async () => {
    const leadId = await insertAssignedLead(AGENT_A, AGENT_A);
    await reassign(ctxSuperAdmin(), leadId, {
      newOwnerId: AGENT_B,
      reason: 'moving sourcing credit after HOD review',
      transferPendingCallbacks: true,
      transferScheduledActivities: true,
      transferSourcingCredit: true,
    });

    const rows = await asOwner(
      'read reassigned columns',
      sql`SELECT owner_id, current_holder_id, originating_agent_id FROM lead WHERE id = ${leadId}`,
    );
    expect(rows[0]).toMatchObject({
      ownerId: AGENT_B,
      currentHolderId: AGENT_B,
      originatingAgentId: AGENT_B,
    });

    const notifications = await asOwner(
      'count notifications for previous holder',
      sql`SELECT count(*)::int AS n FROM notification_outbox WHERE organization_id = ${ORG} AND payload->>'type' = 'lead.reassigned' AND payload->'audience'->'users' @> ${JSON.stringify([AGENT_A])}::jsonb`,
    );
    expect((notifications[0] as { n: number }).n).toBeGreaterThanOrEqual(1);
  });

  it('HOD employee without leads:reassign-with-credit cannot transfer sourcing credit', async () => {
    const leadId = await insertAssignedLead(AGENT_A, AGENT_A);
    await expect(
      reassign(ctxHod(), leadId, {
        newOwnerId: AGENT_B,
        reason: 'trying to grab credit without the capability',
        transferPendingCallbacks: true,
        transferScheduledActivities: true,
        transferSourcingCredit: true,
      }),
    ).rejects.toMatchObject({ name: 'PlatformForbiddenError' });
  });
});
