import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal } from '@tapcrm/contracts';
import { installAuthz } from '../../../platform/authz-adapter.js';
import { createJobContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { getHandover, getHandoverTargets } from '../handover/service.js';
import { listLeadCallbacks } from './callback-service.js';

/**
 * The lists on the Callbacks and Handovers pages.
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 */

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
// Digits only: RUN is embedded in E.164 phone numbers (contact_primary_phone_check).
const RUN = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const ORG = randomUUID();
const DEPARTMENT = randomUUID();
const POSITION = randomUUID();
const POOL_TEAM = randomUUID();
const AGENT = randomUUID();
const OTHER_AGENT = randomUUID();
const SUPER_ADMIN = randomUUID();
const SOURCE = randomUUID();
let PHONE_SEQ = 0;

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

const superAdmin = (): Principal => ({
  id: SUPER_ADMIN,
  organizationId: ORG,
  sessionVersion: 0,
  accountType: 'super-admin',
});

const ctx = () =>
  createJobContext({
    organizationId: ORG,
    principal: superAdmin(),
    jobName: 'sales.lead-lists.test',
    runId: RUN,
  });

async function insertLead(name: string): Promise<{ id: string; leadNumber: string }> {
  const leadId = randomUUID();
  const contactId = randomUUID();
  await asOwner(
    'create contact',
    sql`
      INSERT INTO contact (id, organization_id, full_name, primary_phone, preferred_timezone, created_by)
      VALUES (${contactId}, ${ORG}, ${name},
              ${'+9198004' + String(++PHONE_SEQ).padStart(5, '0')}, 'Asia/Kolkata', ${AGENT})
    `,
  );
  const rows = await asOwner(
    'create lead',
    sql`
      INSERT INTO lead (
        id, organization_id, source_id, contact_id, contact_name, status, routing_status,
        sales_pool_id, sales_team_id, owner_id, current_holder_id, originating_agent_id,
        created_by, entry_method, direction, bid_state, claimed_at, lead_stage, lead_outcome
      ) VALUES (
        ${leadId}, ${ORG}, ${SOURCE}, ${contactId}, ${name},
        'contacted', 'assigned', ${POOL_TEAM}, ${POOL_TEAM}, ${AGENT}, ${AGENT}, ${AGENT},
        ${AGENT}, 'manual', 'inbound', 'claimed', now(), 'contacted', 'active'
      )
      RETURNING lead_number::text AS "leadNumber"
    `,
  );
  return { id: leadId, leadNumber: (rows[0] as { leadNumber: string }).leadNumber };
}

describe.skipIf(!enabled)('callback and handover lists (PostgreSQL)', () => {
  beforeAll(async () => {
    installAuthz();
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`LL${RUN}`}, 'Lead Lists Test', 'Asia/Kolkata')`,
    );
    await asOwner(
      'create department',
      sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPARTMENT}, ${ORG}, 'sales', 'Sales', 'sales')`,
    );
    await asOwner(
      'create position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level) VALUES (${POSITION}, ${ORG}, ${DEPARTMENT}, 'sales-agent', 'Sales Agent', 1)`,
    );
    await asOwner(
      'let sales agents receive handovers',
      sql`INSERT INTO position_policy (organization_id, position_id, action, allowed, scope) VALUES (${ORG}, ${POSITION}, 'handovers:receive', true, 'own')`,
    );
    await asOwner(
      'create sales pool team',
      sql`INSERT INTO team (id, organization_id, department_id, kind, name) VALUES (${POOL_TEAM}, ${ORG}, ${DEPARTMENT}, 'sales-pool', 'Pool A')`,
    );
    await asOwner(
      'create agent',
      sql`
        INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, employee_id)
        VALUES (${AGENT}, ${ORG}, 'employee', 'Agent A', 'active', ${POSITION}, ${DEPARTMENT}, ${POOL_TEAM}, 'E-' || upper(left(replace(${AGENT}::text, '-', ''), 12))),
               (${OTHER_AGENT}, ${ORG}, 'employee', 'Agent B', 'active', ${POSITION}, ${DEPARTMENT}, ${POOL_TEAM}, 'E-' || upper(left(replace(${OTHER_AGENT}::text, '-', ''), 12)))
      `,
    );
    await asOwner(
      'create super admin',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status) VALUES (${SUPER_ADMIN}, ${ORG}, 'super-admin', 'Admin', 'active')`,
    );
    await asOwner(
      'create lead source',
      sql`INSERT INTO lead_source (id, organization_id, name, direction, status) VALUES (${SOURCE}, ${ORG}, ${`Website ${RUN}`}, 'inbound', 'active')`,
    );
  });

  afterAll(async () => {
    await asOwner(
      'cleanup notifications',
      sql`DELETE FROM notification_outbox WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'cleanup audit',
      sql`DELETE FROM audit_outbox WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'cleanup handovers',
      sql`DELETE FROM lead_handover WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'cleanup callbacks',
      sql`DELETE FROM lead_callback WHERE organization_id = ${ORG}`,
    );
    await asOwner('cleanup leads', sql`DELETE FROM lead WHERE organization_id = ${ORG}`);
    await asOwner(
      'cleanup contacts',
      sql`DELETE FROM contact WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'cleanup policies',
      sql`DELETE FROM position_policy WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'cleanup users',
      sql`DELETE FROM app_user WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'cleanup sources',
      sql`DELETE FROM lead_source WHERE organization_id = ${ORG}`,
    );
    await asOwner('cleanup pool', sql`DELETE FROM team WHERE organization_id = ${ORG}`);
    await asOwner(
      'cleanup position',
      sql`DELETE FROM position WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'cleanup department',
      sql`DELETE FROM department WHERE organization_id = ${ORG}`,
    );
    await asOwner('cleanup org', sql`DELETE FROM organization WHERE id = ${ORG}`);
    await closePools();
  });

  it('shows only the callbacks with the chosen status', async () => {
    const lead = await insertLead('Lists Callback');
    await asOwner(
      'create a finished callback and a booked one',
      sql`
        INSERT INTO lead_callback (organization_id, lead_id, owner_id, scheduled_at, status, created_by)
        VALUES (${ORG}, ${lead.id}, ${AGENT}, ${new Date(Date.now() - 60 * 60_000)}, 'completed', ${AGENT}),
               (${ORG}, ${lead.id}, ${AGENT}, ${new Date(Date.now() + 60 * 60_000)}, 'pending', ${AGENT})
      `,
    );

    const pending = await listLeadCallbacks(ctx(), {
      status: 'pending',
      leadId: lead.id,
    });
    expect(pending.map((callback) => callback.status)).toEqual(['pending']);
    const all = await listLeadCallbacks(ctx(), { status: 'all', leadId: lead.id });
    expect(all.map((callback) => callback.status)).toEqual(['completed', 'pending']);
  });

  it('names the lead on a handover', async () => {
    const lead = await insertLead('Lists Handover');
    const rows = await asOwner(
      'offer a handover',
      sql`
        INSERT INTO lead_handover (organization_id, lead_id, from_user_id, to_user_id)
        VALUES (${ORG}, ${lead.id}, ${AGENT}, ${SUPER_ADMIN})
        RETURNING id
      `,
    );
    const handover = await getHandover(ctx(), (rows[0] as { id: string }).id);
    expect(handover).toMatchObject({
      leadId: lead.id,
      leadNumber: lead.leadNumber,
      leadContactName: 'Lists Handover',
    });
  });

  it('leaves the person holding the lead out of the receiver list', async () => {
    const lead = await insertLead('Lists Receivers');
    const receivers = await getHandoverTargets(ctx(), lead.id);
    expect(receivers.map((receiver) => receiver.id)).toEqual([OTHER_AGENT]);
  });
});
