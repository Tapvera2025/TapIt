import { randomUUID } from 'node:crypto';
import { installAuthz } from '../../../platform/authz-adapter.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal } from '@tapcrm/contracts';
import { createJobContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { PlatformForbiddenError } from '../../../platform/errors.js';
import {
  cancelAfterWin,
  createDeal,
  getDeal,
  markLost,
  overrideProbability,
  updateDealStage,
} from './service.js';
import { createLead } from '../leads/service.js';
import { DEAL_ERROR_CODES, DealStateError } from './state-machine.js';

/**
 * Sales v1.1 R2 — deals service end-to-end against PostgreSQL (R2 plan step 2.7).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 *
 * Covers the four assertions the plan calls out plus the Win Recorder
 * invariant:
 *   - createDeal from a claimed lead copies the lead's originating_agent_id
 *   - createDeal with directEntryReason sets the caller as originating agent
 *   - updateDealStage rejects a 'closed' transition via the public path
 *   - overrideProbability without deals:forecast returns 403 (PlatformForbiddenError)
 *   - overrideProbability with super-admin globalAccess bypasses the policy check
 *   - markLost persists lifecycle='lost', loss_reason, lost_at
 *   - cancelAfterWin refuses an open deal — the Won Recorder (step 2.14) is
 *     the only writer of `(dealStage='closed', lifecycleStatus='won')`, and
 *     this gate makes sure cancel can't synthesize that state either
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
const CONTACT = randomUUID();
const SOURCE = randomUUID();
const OUTBOUND_SOURCE = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

const employee = (userId: string): Principal => ({
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

const superAdmin = (userId: string): Principal => ({
  id: userId,
  organizationId: ORG,
  sessionVersion: 0,
  accountType: 'super-admin',
});

const ctxFor = (principal: Principal) =>
  createJobContext({
    organizationId: ORG,
    principal,
    jobName: 'sales.deals.test',
    runId: RUN,
  });

async function insertClaimedLead(
  originatingAgentId: string,
  companyName: string | null = null,
): Promise<string> {
  const leadId = randomUUID();
  await asOwner(
    'create lead in claimed state',
    sql`
      INSERT INTO lead (
        id, organization_id, source_id, contact_id, contact_name, company_name,
        status, routing_status,
        sales_pool_id, sales_team_id, created_by,
        owner_id, current_holder_id, originating_agent_id,
        entry_method, direction, bid_state, claimed_at,
        lead_stage, lead_outcome
      ) VALUES (
        ${leadId}, ${ORG}, ${SOURCE}, ${CONTACT}, ${'Lead ' + leadId.slice(0, 4)}, ${companyName},
        'contacted', 'assigned',
        ${POOL_TEAM}, ${POOL_TEAM}, ${originatingAgentId},
        ${originatingAgentId}, ${originatingAgentId}, ${originatingAgentId},
        'manual', 'inbound', 'claimed', now(),
        'contacted', 'active'
      )
    `,
  );
  return leadId;
}

async function createOpenDeal(ctx = ctxFor(employee(AGENT))): Promise<string> {
  const leadId = await insertClaimedLead(AGENT);
  const deal = await createDeal(ctx, {
    originatingLeadId: leadId,
    title: 'Website redesign',
    contactId: CONTACT,
    currency: 'INR',
  });
  return deal.id;
}

describe.skipIf(!enabled)('sales deals service (PostgreSQL)', () => {
  beforeAll(async () => {
    installAuthz();
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`SD${RUN}`}, 'Sales Deals Test', 'Asia/Kolkata')`,
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
      sql`
        INSERT INTO app_user (id, organization_id, account_type, full_name, status)
        VALUES (${SUPER_ADMIN}, ${ORG}, 'super-admin', 'Super Admin', 'active')
      `,
    );
    await asOwner(
      'create lead source',
      sql`INSERT INTO lead_source (id, organization_id, name, direction, status) VALUES (${SOURCE}, ${ORG}, ${`Website ${RUN}`}, 'inbound', 'active')`,
    );
    await asOwner(
      'create outbound lead source',
      sql`INSERT INTO lead_source (id, organization_id, name, direction, status) VALUES (${OUTBOUND_SOURCE}, ${ORG}, ${`Cold call ${RUN}`}, 'outbound', 'active')`,
    );
    await asOwner(
      'create contact',
      sql`
        INSERT INTO contact (id, organization_id, full_name, primary_phone, preferred_timezone, created_by)
        VALUES (${CONTACT}, ${ORG}, 'Rahul Shah', ${'+9198000' + RUN}, 'Asia/Kolkata', ${AGENT})
      `,
    );
  });

  afterAll(async () => {
    await asOwner('cleanup audit outbox',  sql`DELETE FROM audit_outbox WHERE organization_id = ${ORG}`);
    await asOwner('cleanup deal contacts', sql`DELETE FROM deal_contact WHERE organization_id = ${ORG}`);
    await asOwner('cleanup deals',         sql`DELETE FROM deal         WHERE organization_id = ${ORG}`);
    await asOwner('cleanup callbacks',     sql`DELETE FROM lead_callback WHERE organization_id = ${ORG}`);
    await asOwner('cleanup leads',         sql`DELETE FROM lead         WHERE organization_id = ${ORG}`);
    await asOwner('cleanup companies',     sql`DELETE FROM company      WHERE organization_id = ${ORG}`);
    await asOwner('cleanup contacts',      sql`DELETE FROM contact      WHERE organization_id = ${ORG}`);
    await asOwner('cleanup sources',       sql`DELETE FROM lead_source  WHERE organization_id = ${ORG}`);
    await asOwner('cleanup users',         sql`DELETE FROM app_user     WHERE organization_id = ${ORG}`);
    await asOwner('cleanup pool',          sql`DELETE FROM team         WHERE organization_id = ${ORG}`);
    await asOwner('cleanup position',      sql`DELETE FROM position     WHERE organization_id = ${ORG}`);
    await asOwner('cleanup department',    sql`DELETE FROM department   WHERE organization_id = ${ORG}`);
    await asOwner('cleanup org',           sql`DELETE FROM organization WHERE id              = ${ORG}`);
    await closePools();
  });

  it('createDeal from a claimed lead copies the lead originating_agent_id', async () => {
    const leadId = await insertClaimedLead(AGENT);
    const deal = await createDeal(ctxFor(employee(AGENT)), {
      originatingLeadId: leadId,
      title: 'Pune website build',
      contactId: CONTACT,
      currency: 'INR',
    });

    expect(deal.originatingAgentId).toBe(AGENT);
    expect(deal.responsibleCloserId).toBe(AGENT);
    expect(deal.dealStage).toBe('discovery');
    expect(deal.lifecycleStatus).toBe('open');
    expect(deal.approvalStatus).toBe('not_required');
    expect(deal.contractStatus).toBe('not_required');
    expect(deal.paymentStatus).toBe('unpaid');
    expect(deal.originatingLeadId).toBe(leadId);
  });

  it('converting a lead cancels its open callback and leaves finished ones alone', async () => {
    const leadId = await insertClaimedLead(AGENT);
    const rescheduledId = randomUUID();
    const pendingId = randomUUID();
    await asOwner(
      'create a rescheduled callback and its pending replacement',
      sql`
        INSERT INTO lead_callback (id, organization_id, lead_id, owner_id, scheduled_at, status, parent_callback_id, created_by)
        VALUES (${rescheduledId}, ${ORG}, ${leadId}, ${AGENT}, ${new Date(Date.now() + 60 * 60_000)}, 'rescheduled', NULL, ${AGENT}),
               (${pendingId}, ${ORG}, ${leadId}, ${AGENT}, ${new Date(Date.now() + 2 * 60 * 60_000)}, 'pending', ${rescheduledId}, ${AGENT})
      `,
    );

    await createDeal(ctxFor(employee(AGENT)), {
      originatingLeadId: leadId,
      title: 'Converted while a callback was booked',
      contactId: CONTACT,
      currency: 'INR',
    });

    const callbacks = await asOwner(
      'read callbacks after conversion',
      sql`SELECT id, status, cancelled_at FROM lead_callback WHERE lead_id = ${leadId} ORDER BY scheduled_at`,
    );
    expect(callbacks).toMatchObject([
      { id: rescheduledId, status: 'rescheduled', cancelledAt: null },
      { id: pendingId, status: 'cancelled' },
    ]);
    expect((callbacks[1] as { cancelledAt: Date | null }).cancelledAt).not.toBeNull();

    const activity = await asOwner(
      'read callback activity',
      sql`SELECT metadata FROM lead_activity WHERE organization_id = ${ORG} AND lead_id = ${leadId} AND event_name = 'callback.cancelled'`,
    );
    expect(activity).toHaveLength(1);
    expect((activity[0] as { metadata: unknown }).metadata).toMatchObject({
      callbackId: pendingId,
      reason: 'lead_converted',
    });
  });

  it('keeps the company of a lead added by hand and records the conversion on the lead', async () => {
    const admin = ctxFor(superAdmin(SUPER_ADMIN));
    const { lead } = await createLead(admin, {
      contactName: 'Priya Nair',
      companyName: `Acme Interiors ${RUN}`,
      phone: '+9198001' + RUN,
      sourceId: OUTBOUND_SOURCE,
      status: 'new',
    });
    expect(lead.companyId).not.toBeNull();

    const deal = await createDeal(admin, {
      originatingLeadId: lead.id,
      title: 'Showroom fit-out',
      currency: 'INR',
    });
    expect(deal.companyId).toBe(lead.companyId);
    expect(deal.companyName).toBe(`Acme Interiors ${RUN}`);

    const converted = await asOwner(
      'read conversion activity',
      sql`SELECT actor_id, metadata FROM lead_activity WHERE organization_id = ${ORG} AND lead_id = ${lead.id} AND event_name = 'lead.converted'`,
    );
    expect(converted).toEqual([
      {
        actorId: SUPER_ADMIN,
        metadata: {
          from: 'assigned',
          dealId: deal.id,
          dealNumber: deal.dealNumber,
          title: 'Showroom fit-out',
        },
      },
    ]);
  });

  it('links a company on conversion when the lead holds only a company name', async () => {
    const existingCompany = randomUUID();
    await asOwner(
      'create a company the lead names in different case',
      sql`INSERT INTO company (id, organization_id, name, created_by) VALUES (${existingCompany}, ${ORG}, ${`globex ${RUN}`}, ${AGENT})`,
    );
    const knownName = await insertClaimedLead(AGENT, `Globex ${RUN}`);
    const newName = await insertClaimedLead(AGENT, `Hooli ${RUN}`);
    const noName = await insertClaimedLead(AGENT);

    const agent = ctxFor(employee(AGENT));
    const known = await createDeal(agent, {
      originatingLeadId: knownName,
      title: 'Globex rebrand',
      contactId: CONTACT,
      currency: 'INR',
    });
    const created = await createDeal(agent, {
      originatingLeadId: newName,
      title: 'Hooli app',
      contactId: CONTACT,
      currency: 'INR',
    });
    const none = await createDeal(agent, {
      originatingLeadId: noName,
      title: 'No company',
      contactId: CONTACT,
      currency: 'INR',
    });

    expect(known.companyId).toBe(existingCompany);
    expect(created.companyName).toBe(`Hooli ${RUN}`);
    expect(none.companyId).toBeNull();
    const leads = await asOwner(
      'read lead company links',
      sql`SELECT id, company_id FROM lead WHERE id IN (${knownName}, ${newName}, ${noName})`,
    );
    expect(
      Object.fromEntries(
        leads.map((row) => {
          const { id, companyId } = row as { id: string; companyId: string | null };
          return [id, companyId];
        }),
      ),
    ).toEqual({
      [knownName]: existingCompany,
      [newName]: created.companyId,
      [noName]: null,
    });
  });

  it('createDeal with directEntryReason sets the caller as originating agent', async () => {
    const deal = await createDeal(ctxFor(employee(AGENT)), {
      directEntryReason: 'Walked in off the street — no prior lead',
      title: 'Walk-in SEO retainer',
      contactId: CONTACT,
      currency: 'INR',
    });

    expect(deal.originatingAgentId).toBe(AGENT);
    expect(deal.responsibleCloserId).toBe(AGENT);
    expect(deal.originatingLeadId).toBeNull();
    expect(deal.directEntryReason).toBe('Walked in off the street — no prior lead');
  });

  it('updateDealStage rejects "closed" — the Win Recorder is the sole writer', async () => {
    const dealId = await createOpenDeal();

    await expect(
      updateDealStage(ctxFor(employee(AGENT)), dealId, { dealStage: 'closed' }),
    ).rejects.toMatchObject({
      name: 'DealStateError',
      code: DEAL_ERROR_CODES.CLOSED_STAGE_RESERVED,
    });

    const stillOpen = await getDeal(ctxFor(employee(AGENT)), dealId);
    expect(stillOpen.dealStage).toBe('discovery');
    expect(stillOpen.lifecycleStatus).toBe('open');
  });

  it('updateDealStage walks forward through legal transitions', async () => {
    const dealId = await createOpenDeal();
    await updateDealStage(ctxFor(employee(AGENT)), dealId, { dealStage: 'proposal' });
    await updateDealStage(ctxFor(employee(AGENT)), dealId, { dealStage: 'negotiation' });
    await updateDealStage(ctxFor(employee(AGENT)), dealId, { dealStage: 'closing' });

    const updated = await getDeal(ctxFor(employee(AGENT)), dealId);
    expect(updated.dealStage).toBe('closing');
    expect(updated.lifecycleStatus).toBe('open');
  });

  it('overrideProbability without deals:forecast returns 403', async () => {
    const dealId = await createOpenDeal();

    await expect(
      overrideProbability(ctxFor(employee(AGENT)), dealId, {
        probability: 75,
        reason: 'late-stage hot lead',
      }),
    ).rejects.toBeInstanceOf(PlatformForbiddenError);

    const unchanged = await getDeal(ctxFor(employee(AGENT)), dealId);
    expect(unchanged.probabilityOverride).toBeNull();
  });

  it('overrideProbability bypasses the forecast policy for super-admin globalAccess', async () => {
    const dealId = await createOpenDeal();

    const updated = await overrideProbability(ctxFor(superAdmin(SUPER_ADMIN)), dealId, {
      probability: 75,
      reason: 'late-stage hot lead',
    });

    expect(updated.probabilityOverride).toBe(75);
  });

  it('markLost persists lifecycle=lost, loss_reason, lost_at', async () => {
    const dealId = await createOpenDeal();
    const updated = await markLost(ctxFor(employee(AGENT)), dealId, {
      reason: 'no_budget',
      note: 'Procurement cycle slipped to next quarter',
    });

    expect(updated.lifecycleStatus).toBe('lost');
    expect(updated.lossReason).toBe('no_budget');
    expect(updated.lostAt).toBeInstanceOf(Date);
    expect(updated.dealStage).toBe('discovery');     // never rewound
  });

  it('cancelAfterWin refuses an open deal — enforces Won Recorder-only path to (closed, won)', async () => {
    const dealId = await createOpenDeal();

    await expect(
      cancelAfterWin(ctxFor(superAdmin(SUPER_ADMIN)), dealId, {
        reason: 'Client backed out before advance payment',
      }),
    ).rejects.toMatchObject({
      name: 'DealStateError',
      code: DEAL_ERROR_CODES.CANCEL_REQUIRES_WON,
    });

    const stillOpen = await getDeal(ctxFor(employee(AGENT)), dealId);
    expect(stillOpen.lifecycleStatus).toBe('open');
  });

  it('markLost blocks a second lifecycle transition — terminals are mutually exclusive', async () => {
    const dealId = await createOpenDeal();
    await markLost(ctxFor(employee(AGENT)), dealId, { reason: 'competitor' });

    await expect(
      markLost(ctxFor(employee(AGENT)), dealId, { reason: 'other' }),
    ).rejects.toBeInstanceOf(DealStateError);
  });
});
