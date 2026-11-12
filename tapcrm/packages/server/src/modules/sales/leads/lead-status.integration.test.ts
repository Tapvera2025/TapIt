import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal } from '@tapcrm/contracts';
import { installAuthz } from '../../../platform/authz-adapter.js';
import { createJobContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { completeCallback, createCallback, updateCallback } from './callback-service.js';
import { closeLeadAsLost, getLead, updateLead } from './service.js';

/**
 * Lead status from the lead page: "Mark as lost", moving a lead by hand, and
 * moving it off "callback scheduled" when its callback ends.
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
    jobName: 'sales.lead-status.test',
    runId: RUN,
  });

async function insertLead(status: string): Promise<string> {
  const leadId = randomUUID();
  const contactId = randomUUID();
  await asOwner(
    'create contact',
    sql`
      INSERT INTO contact (id, organization_id, full_name, primary_phone, preferred_timezone, created_by)
      VALUES (${contactId}, ${ORG}, ${'Status ' + leadId.slice(0, 4)},
              ${'+9198003' + String(++PHONE_SEQ).padStart(5, '0')}, 'Asia/Kolkata', ${AGENT})
    `,
  );
  await asOwner(
    'create lead',
    sql`
      INSERT INTO lead (
        id, organization_id, source_id, contact_id, contact_name, status, routing_status,
        sales_pool_id, sales_team_id, owner_id, current_holder_id, originating_agent_id,
        created_by, entry_method, direction, bid_state, claimed_at, lead_stage, lead_outcome
      ) VALUES (
        ${leadId}, ${ORG}, ${SOURCE}, ${contactId}, ${'Status ' + leadId.slice(0, 4)},
        ${status}, 'assigned', ${POOL_TEAM}, ${POOL_TEAM}, ${AGENT}, ${AGENT}, ${AGENT},
        ${AGENT}, 'manual', 'inbound', 'claimed', now(), 'contacted', 'active'
      )
    `,
  );
  return leadId;
}

async function insertPendingCallback(leadId: string): Promise<string> {
  const callbackId = randomUUID();
  await asOwner(
    'create pending callback',
    sql`
      INSERT INTO lead_callback (id, organization_id, lead_id, owner_id, scheduled_at, status, created_by)
      VALUES (${callbackId}, ${ORG}, ${leadId}, ${AGENT}, ${new Date(Date.now() + 60 * 60_000)}, 'pending', ${AGENT})
    `,
  );
  return callbackId;
}

async function readLead(leadId: string): Promise<Record<string, unknown>> {
  const rows = await asOwner(
    'read lead',
    sql`SELECT status, lead_outcome, loss_reason, lost_at FROM lead WHERE id = ${leadId}`,
  );
  return rows[0] as Record<string, unknown>;
}

async function activity(leadId: string, eventName: string): Promise<unknown[]> {
  const rows = await asOwner(
    'read activity',
    sql`SELECT metadata FROM lead_activity WHERE organization_id = ${ORG} AND lead_id = ${leadId} AND event_name = ${eventName}`,
  );
  return rows.map((row) => (row as { metadata: unknown }).metadata);
}

describe.skipIf(!enabled)('lead status changes (PostgreSQL)', () => {
  beforeAll(async () => {
    installAuthz();
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`LS${RUN}`}, 'Lead Status Test', 'Asia/Kolkata')`,
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
      'create agent',
      sql`
        INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, employee_id)
        VALUES (${AGENT}, ${ORG}, 'employee', 'Agent A', 'active', ${POSITION}, ${DEPARTMENT}, ${POOL_TEAM}, 'E-' || upper(left(replace(${AGENT}::text, '-', ''), 12)))
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
      'cleanup callbacks',
      sql`DELETE FROM lead_callback WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'cleanup submissions',
      sql`DELETE FROM lead_submission WHERE organization_id = ${ORG}`,
    );
    await asOwner('cleanup leads', sql`DELETE FROM lead WHERE organization_id = ${ORG}`);
    await asOwner(
      'cleanup companies',
      sql`DELETE FROM company WHERE organization_id = ${ORG}`,
    );
    await asOwner(
      'cleanup contacts',
      sql`DELETE FROM contact WHERE organization_id = ${ORG}`,
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

  it('marks a lead lost with its reason, cancels its callback and keeps the note', async () => {
    const leadId = await insertLead('callback_scheduled');
    const callbackId = await insertPendingCallback(leadId);

    const lead = await closeLeadAsLost(ctx(), leadId, {
      lossReason: 'other',
      note: 'Moved the project in-house',
    });

    expect(lead.status).toBe('closed_lost');
    expect(await readLead(leadId)).toMatchObject({
      status: 'closed_lost',
      leadOutcome: 'closed_lost',
      lossReason: 'other',
    });
    expect((await readLead(leadId))['lostAt']).not.toBeNull();
    const callbacks = await asOwner(
      'read callback',
      sql`SELECT status FROM lead_callback WHERE id = ${callbackId}`,
    );
    expect(callbacks[0]).toMatchObject({ status: 'cancelled' });
    expect(await activity(leadId, 'lead.closed_lost')).toEqual([
      {
        from: 'callback_scheduled',
        lossReason: 'other',
        note: 'Moved the project in-house',
      },
    ]);
  });

  it('refuses to mark a closed lead lost again', async () => {
    const leadId = await insertLead('contacted');
    await closeLeadAsLost(ctx(), leadId, { lossReason: 'no_budget' });
    await expect(
      closeLeadAsLost(ctx(), leadId, { lossReason: 'timing' }),
    ).rejects.toMatchObject({ message: 'This lead is already converted or closed' });
  });

  it('keeps the outcome in step when a lead is moved to nurture and back', async () => {
    const leadId = await insertLead('follow_up');
    await updateLead(ctx(), leadId, { status: 'nurture' });
    expect(await readLead(leadId)).toMatchObject({
      status: 'nurture',
      leadOutcome: 'nurture',
    });
    await updateLead(ctx(), leadId, { status: 'contacted' });
    expect(await readLead(leadId)).toMatchObject({
      status: 'contacted',
      leadOutcome: 'active',
    });
  });

  it('points the lead at the right company when its company name is edited', async () => {
    const leadId = await insertLead('contacted');
    const renamed = await updateLead(ctx(), leadId, { companyName: `Initech ${RUN}` });
    expect(renamed.companyId).not.toBeNull();
    const companies = await asOwner(
      'read linked company',
      sql`SELECT name FROM company WHERE id = ${renamed.companyId}`,
    );
    expect(companies).toEqual([{ name: `Initech ${RUN}` }]);

    const again = await updateLead(ctx(), leadId, { companyName: `INITECH ${RUN}` });
    expect(again.companyId).toBe(renamed.companyId);
    const cleared = await updateLead(ctx(), leadId, { companyName: null });
    expect(cleared.companyId).toBeNull();
  });

  it('shows the enquiry details from the Add Lead form or the website form', async () => {
    const manual = await insertLead('contacted');
    await asOwner(
      'add the Add Lead details',
      sql`
        UPDATE lead
           SET requirement = 'Website redesign', location = 'Pune',
               language_preference = 'Marathi', intake_notes = 'Call after 6pm'
         WHERE id = ${manual}
      `,
    );
    expect(await getLead(ctx(), manual)).toMatchObject({
      requirement: 'Website redesign',
      location: 'Pune',
      languagePreference: 'Marathi',
      intakeNotes: 'Call after 6pm',
    });

    const web = await insertLead('assigned');
    const form = {
      serviceRequested: 'SEO audit',
      location: 'Nagpur',
      languagePreference: 'Hindi',
      message: 'Need it this month',
    };
    await asOwner(
      'add the website form the lead came from',
      sql`
        INSERT INTO lead_submission (organization_id, lead_id, outcome, normalized_payload)
        VALUES (${ORG}, ${web}, 'created', ${JSON.stringify(form)}::jsonb)
      `,
    );
    expect(await getLead(ctx(), web)).toMatchObject({
      requirement: 'SEO audit',
      location: 'Nagpur',
      languagePreference: 'Hindi',
      intakeNotes: 'Need it this month',
    });

    const bare = await insertLead('assigned');
    expect(await getLead(ctx(), bare)).toMatchObject({
      requirement: null,
      location: null,
      languagePreference: null,
      intakeNotes: null,
    });
  });

  it('moves a lead to contacted when its callback got through', async () => {
    const leadId = await insertLead('callback_scheduled');
    const callbackId = await insertPendingCallback(leadId);

    await completeCallback(ctx(), callbackId, {
      status: 'completed',
      outcome: 'connected',
    });

    expect(await readLead(leadId)).toMatchObject({ status: 'contacted' });
    expect(await activity(leadId, 'lead.status_changed')).toEqual([
      { from: 'callback_scheduled', to: 'contacted', reason: 'callback_completed' },
    ]);
  });

  it('moves a lead to follow-up when nobody answered', async () => {
    const leadId = await insertLead('callback_scheduled');
    const callbackId = await insertPendingCallback(leadId);

    await completeCallback(ctx(), callbackId, { status: 'not_reachable' });

    expect(await readLead(leadId)).toMatchObject({ status: 'follow_up' });
  });

  it('leaves a lead alone when someone already moved it on', async () => {
    const leadId = await insertLead('discovery');
    const callbackId = await insertPendingCallback(leadId);

    await completeCallback(ctx(), callbackId, {
      status: 'completed',
      outcome: 'connected',
    });

    expect(await readLead(leadId)).toMatchObject({ status: 'discovery' });
    expect(await activity(leadId, 'lead.status_changed')).toEqual([]);
  });

  it('refuses to book or move a callback to a time that has passed', async () => {
    const leadId = await insertLead('contacted');
    const yesterday = new Date(Date.now() - 24 * 60 * 60_000);
    await expect(
      createCallback(ctx(), { leadId, scheduledAt: yesterday }),
    ).rejects.toMatchObject({ message: 'Pick a time in the future for the callback.' });

    const callbackId = await insertPendingCallback(leadId);
    await expect(
      updateCallback(ctx(), callbackId, { scheduledAt: yesterday }),
    ).rejects.toMatchObject({ message: 'Pick a time in the future for the callback.' });
  });

  it('explains that a lead already has a callback instead of failing with a database error', async () => {
    const leadId = await insertLead('contacted');
    await insertPendingCallback(leadId);
    await expect(
      createCallback(ctx(), {
        leadId,
        scheduledAt: new Date(Date.now() + 2 * 60 * 60_000),
      }),
    ).rejects.toMatchObject({
      message:
        'This lead already has a callback booked. Reschedule or finish that one first.',
    });
  });

  it('explains that a closed lead cannot get a callback', async () => {
    const leadId = await insertLead('contacted');
    await closeLeadAsLost(ctx(), leadId, { lossReason: 'no_need' });
    await expect(
      createCallback(ctx(), {
        leadId,
        scheduledAt: new Date(Date.now() + 2 * 60 * 60_000),
      }),
    ).rejects.toMatchObject({
      message: 'This lead is closed, so no callback can be booked.',
    });
  });
});
