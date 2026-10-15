import { randomUUID } from 'node:crypto';
import { installAuthz } from '../../../platform/authz-adapter.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal } from '@tapcrm/contracts';
import { createJobContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { createDeal } from '../deals/service.js';
import { createDraft, updateDraft } from '../proposals/service.js';
import type { CreateDraftInput } from '../proposals/validators.js';
import {
  ApprovalAlreadyOpenError,
  ApprovalNotRequiredError,
  ApprovalSelfApprovalError,
  decide,
  escalateIfBreached,
  getRequest,
  invalidateForDeal,
  listPending,
  requestApproval,
} from './service.js';

/**
 * Sales v1.1 R2 — Approvals service end-to-end (R2 step 2.11).
 */

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
// Digits only: RUN is embedded in E.164 phone numbers (contact_primary_phone_check).
const RUN = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const ORG = randomUUID();
const DEPARTMENT = randomUUID();
const SUPERVISOR_POSITION = randomUUID();
const AGENT_POSITION = randomUUID();
const POOL_TEAM = randomUUID();
const AGENT = randomUUID();
const SUPERVISOR = randomUUID();
const HOD_POSITION = randomUUID();
const HOD = randomUUID();
const SUPER_ADMIN = randomUUID();
const CONTACT = randomUUID();

const asOwner = (reason: string, fragment: ReturnType<typeof sql>) =>
  platformDb.query('migration', reason, fragment);

const employee = (userId: string, positionId: string): Principal => ({
  id: userId,
  organizationId: ORG,
  sessionVersion: 0,
  accountType: 'employee',
  teamId: POOL_TEAM,
  departmentId: DEPARTMENT,
  positionId,
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
    jobName: 'sales.approvals.test',
    runId: RUN,
  });

// Body generates a total of 100000 paise (₹1000) + 18% GST = 118000 paise.
const sampleBody: CreateDraftInput = {
  items: [
    {
      serviceName: 'Website redesign',
      quantity: '1',
      unitPriceMinor: 100_000n,
      itemDiscountMinor: 0n,
      taxCategory: 'standard',
      taxRateBps: 1800,
      sortOrder: 0,
    },
  ],
  documentDiscount: { kind: 'none' },
  currency: 'INR',
  advanceMinor: 0n,
};

// A body that will exceed the agent's ₹500 limit — ₹10,000 total.
const exceedingBody: CreateDraftInput = {
  items: [
    {
      serviceName: 'Website redesign',
      quantity: '1',
      unitPriceMinor: 1_000_000n,
      itemDiscountMinor: 0n,
      taxCategory: 'standard',
      taxRateBps: 0,
      sortOrder: 0,
    },
  ],
  documentDiscount: { kind: 'none' },
  currency: 'INR',
  advanceMinor: 0n,
};

async function createOpenDealAsAgent(): Promise<string> {
  const deal = await createDeal(ctxFor(employee(AGENT, AGENT_POSITION)), {
    directEntryReason: 'Approvals integration test',
    title: 'Approval scenario',
    contactId: CONTACT,
    currency: 'INR',
  });
  return deal.id;
}

describe.skipIf(!enabled)('sales approvals service (PostgreSQL)', () => {
  beforeAll(async () => {
    installAuthz();
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`SA${RUN}`}, 'Sales Approvals Test', 'Asia/Kolkata')`,
    );
    await asOwner(
      'create department',
      sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPARTMENT}, ${ORG}, 'SALES', 'Sales', 'sales')`,
    );
    // Agent position: ₹500 cap, 10% max discount, no custom terms.
    await asOwner(
      'create agent position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level, max_deal_value, max_discount_percent, allows_custom_terms)
          VALUES (${AGENT_POSITION}, ${ORG}, ${DEPARTMENT}, 'SALES_AGENT', 'Sales Agent', 1, 500, 10, false)`,
    );
    // Supervisor position: ₹5000 cap, 20% max discount, no custom terms.
    await asOwner(
      'create supervisor position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level, max_deal_value, max_discount_percent, allows_custom_terms)
          VALUES (${SUPERVISOR_POSITION}, ${ORG}, ${DEPARTMENT}, 'SALES_SUPERVISOR', 'Sales Supervisor', 2, 5000, 20, false)`,
    );
    // HOD position: unlimited.
    await asOwner(
      'create hod position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level, max_deal_value, max_discount_percent, allows_custom_terms)
          VALUES (${HOD_POSITION}, ${ORG}, ${DEPARTMENT}, 'SALES_HOD', 'Sales HOD', 3, NULL, NULL, true)`,
    );
    await asOwner(
      'create pool team',
      sql`INSERT INTO team (id, organization_id, department_id, kind, name) VALUES (${POOL_TEAM}, ${ORG}, ${DEPARTMENT}, 'sales-pool', 'Pool A')`,
    );
    await asOwner(
      'create super admin',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status) VALUES (${SUPER_ADMIN}, ${ORG}, 'super-admin', 'Super Admin', 'active')`,
    );
    await asOwner(
      'create HOD',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, employee_id)
          VALUES (${HOD}, ${ORG}, 'employee', 'HOD', 'active', ${HOD_POSITION}, ${DEPARTMENT}, ${POOL_TEAM}, 'E-' || upper(left(replace(${HOD}::text, '-', ''), 12)))`,
    );
    await asOwner(
      'create supervisor',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, reports_to, employee_id)
          VALUES (${SUPERVISOR}, ${ORG}, 'employee', 'Supervisor', 'active', ${SUPERVISOR_POSITION}, ${DEPARTMENT}, ${POOL_TEAM}, ${HOD}, 'E-' || upper(left(replace(${SUPERVISOR}::text, '-', ''), 12)))`,
    );
    await asOwner(
      'create agent',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, reports_to, employee_id)
          VALUES (${AGENT}, ${ORG}, 'employee', 'Agent', 'active', ${AGENT_POSITION}, ${DEPARTMENT}, ${POOL_TEAM}, ${SUPERVISOR}, 'E-' || upper(left(replace(${AGENT}::text, '-', ''), 12)))`,
    );
    await asOwner(
      'create contact',
      sql`INSERT INTO contact (id, organization_id, full_name, primary_phone, preferred_timezone, created_by)
          VALUES (${CONTACT}, ${ORG}, 'Rahul Shah', ${'+91980' + RUN}, 'Asia/Kolkata', ${AGENT})`,
    );
  });

  afterAll(async () => {
    await asOwner('cleanup audit outbox',       sql`DELETE FROM audit_outbox        WHERE organization_id = ${ORG}`);
    await asOwner('cleanup approval decisions', sql`DELETE FROM approval_decision   WHERE organization_id = ${ORG}`);
    await asOwner('cleanup approvals',          sql`DELETE FROM approval_request    WHERE organization_id = ${ORG}`);
    await asOwner('cleanup items',              sql`DELETE FROM commercials_item    WHERE organization_id = ${ORG}`);
    await asOwner('clear deal commercials',     sql`UPDATE deal SET commercials_id = NULL WHERE organization_id = ${ORG}`);
    await asOwner('cleanup commercials',        sql`DELETE FROM commercials         WHERE organization_id = ${ORG}`);
    await asOwner('cleanup deals',              sql`DELETE FROM deal                WHERE organization_id = ${ORG}`);
    await asOwner('cleanup contacts',           sql`DELETE FROM contact             WHERE organization_id = ${ORG}`);
    await asOwner('cleanup users',              sql`DELETE FROM app_user            WHERE organization_id = ${ORG}`);
    await asOwner('cleanup pool',               sql`DELETE FROM team                WHERE organization_id = ${ORG}`);
    await asOwner('cleanup positions',          sql`DELETE FROM position            WHERE organization_id = ${ORG}`);
    await asOwner('cleanup department',         sql`DELETE FROM department          WHERE organization_id = ${ORG}`);
    await asOwner('cleanup org',                sql`DELETE FROM organization        WHERE id              = ${ORG}`);
    await closePools();
  });

  it('requestApproval refuses when dimensions do not require approval', async () => {
    const dealId = await createOpenDealAsAgent();
    const draft = await createDraft(ctxFor(employee(AGENT, AGENT_POSITION)), dealId, sampleBody);
    await expect(requestApproval(ctxFor(employee(AGENT, AGENT_POSITION)), draft.id))
      .rejects.toBeInstanceOf(ApprovalNotRequiredError);
  });

  it('requestApproval routes to the supervisor when agent cannot cover the value', async () => {
    const dealId = await createOpenDealAsAgent();
    const draft = await createDraft(ctxFor(employee(AGENT, AGENT_POSITION)), dealId, exceedingBody);

    const request = await requestApproval(ctxFor(employee(AGENT, AGENT_POSITION)), draft.id);
    expect(request.state).toBe('pending');
    expect(request.requestedBy).toBe(AGENT);
    expect(request.currentApproverId).toBe(SUPERVISOR);
    expect(request.blockedReason).toBeNull();
    expect(request.dimensions.some((d) => d.kind === 'value' && d.status === 'exceeds')).toBe(true);

    const dealRow = await asOwner(
      'read deal approval status',
      sql`SELECT approval_status AS "approvalStatus" FROM deal WHERE organization_id = ${ORG} AND id = ${dealId}`,
    );
    expect((dealRow[0] as { approvalStatus: string }).approvalStatus).toBe('pending');
  });

  it('requestApproval blocks when nobody up the chain can cover (no_eligible_approver)', async () => {
    // Build a body that exceeds HOD's unlimited cap by… well, no cap exceeds unlimited.
    // Instead point the HOD position to limits so none of agent/supervisor/HOD covers.
    const limitedHodPosition = randomUUID();
    const limitedHod = randomUUID();
    const limitedAgent = randomUUID();
    const limitedAgentPosition = randomUUID();
    await asOwner(
      'create limited hod position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level, max_deal_value, max_discount_percent, allows_custom_terms)
          VALUES (${limitedHodPosition}, ${ORG}, ${DEPARTMENT}, 'LIMITED_HOD', 'Limited HOD', 4, 100, 0, false)`,
    );
    await asOwner(
      'create limited agent position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level, max_deal_value, max_discount_percent, allows_custom_terms)
          VALUES (${limitedAgentPosition}, ${ORG}, ${DEPARTMENT}, 'LIMITED_AGENT', 'Limited Agent', 1, 50, 0, false)`,
    );
    await asOwner(
      'create limited hod user',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, employee_id)
          VALUES (${limitedHod}, ${ORG}, 'employee', 'Limited HOD', 'active', ${limitedHodPosition}, ${DEPARTMENT}, ${POOL_TEAM}, 'E-' || upper(left(replace(${limitedHod}::text, '-', ''), 12)))`,
    );
    await asOwner(
      'create limited agent',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, reports_to, employee_id)
          VALUES (${limitedAgent}, ${ORG}, 'employee', 'Limited Agent', 'active', ${limitedAgentPosition}, ${DEPARTMENT}, ${POOL_TEAM}, ${limitedHod}, 'E-' || upper(left(replace(${limitedAgent}::text, '-', ''), 12)))`,
    );

    const deal = await createDeal(ctxFor(employee(limitedAgent, limitedAgentPosition)), {
      directEntryReason: 'no-eligible-approver scenario',
      title: 'Giant deal',
      contactId: CONTACT,
      currency: 'INR',
    });
    const draft = await createDraft(ctxFor(employee(limitedAgent, limitedAgentPosition)), deal.id, exceedingBody);
    const request = await requestApproval(ctxFor(employee(limitedAgent, limitedAgentPosition)), draft.id);
    expect(request.state).toBe('pending');
    expect(request.currentApproverId).toBeNull();
    expect(request.blockedReason).toBe('no_eligible_approver');
  });

  it('a second pending request on the same deal is refused', async () => {
    const dealId = await createOpenDealAsAgent();
    const draft = await createDraft(ctxFor(employee(AGENT, AGENT_POSITION)), dealId, exceedingBody);
    await requestApproval(ctxFor(employee(AGENT, AGENT_POSITION)), draft.id);
    await expect(requestApproval(ctxFor(employee(AGENT, AGENT_POSITION)), draft.id))
      .rejects.toBeInstanceOf(ApprovalAlreadyOpenError);
  });

  it('decide approves and flips deal.approval_status', async () => {
    const dealId = await createOpenDealAsAgent();
    const draft = await createDraft(ctxFor(employee(AGENT, AGENT_POSITION)), dealId, exceedingBody);
    const request = await requestApproval(ctxFor(employee(AGENT, AGENT_POSITION)), draft.id);

    const updated = await decide(ctxFor(employee(SUPERVISOR, SUPERVISOR_POSITION)), request.id, {
      verdict: 'approve',
      comment: 'looks fine',
    });
    expect(updated.state).toBe('approved');
    expect(updated.decidedBy).toBe(SUPERVISOR);

    const dealRow = await asOwner(
      'read deal approval status',
      sql`SELECT approval_status AS "approvalStatus" FROM deal WHERE organization_id = ${ORG} AND id = ${dealId}`,
    );
    expect((dealRow[0] as { approvalStatus: string }).approvalStatus).toBe('approved');
  });

  it('decide refuses self-approval (A-1) even if misrouted', async () => {
    const dealId = await createOpenDealAsAgent();
    const draft = await createDraft(ctxFor(employee(AGENT, AGENT_POSITION)), dealId, exceedingBody);
    const request = await requestApproval(ctxFor(employee(AGENT, AGENT_POSITION)), draft.id);
    // force-assign the request back to the requester for the test
    await asOwner(
      'misroute to requester',
      sql`UPDATE approval_request SET current_approver_id = ${AGENT} WHERE id = ${request.id}`,
    );
    await expect(
      decide(ctxFor(employee(AGENT, AGENT_POSITION)), request.id, { verdict: 'approve' }),
    ).rejects.toBeInstanceOf(ApprovalSelfApprovalError);
  });

  it('decide refuses a user who is not the current approver', async () => {
    const dealId = await createOpenDealAsAgent();
    const draft = await createDraft(ctxFor(employee(AGENT, AGENT_POSITION)), dealId, exceedingBody);
    const request = await requestApproval(ctxFor(employee(AGENT, AGENT_POSITION)), draft.id);
    await expect(
      decide(ctxFor(employee(HOD, HOD_POSITION)), request.id, { verdict: 'approve' }),
    ).rejects.toMatchObject({ name: 'ApprovalNotYoursError', code: 'APPROVAL_NOT_YOURS' });
  });

  it('invalidateForDeal flips every pending request to invalidated', async () => {
    const dealId = await createOpenDealAsAgent();
    const draft = await createDraft(ctxFor(employee(AGENT, AGENT_POSITION)), dealId, exceedingBody);
    const request = await requestApproval(ctxFor(employee(AGENT, AGENT_POSITION)), draft.id);

    const ids = await invalidateForDeal(ctxFor(employee(AGENT, AGENT_POSITION)), dealId);
    expect(ids).toContain(request.id);

    const refetched = await getRequest(ctxFor(superAdmin(SUPER_ADMIN)), request.id);
    expect(refetched.state).toBe('invalidated');
    expect(refetched.blockedReason).toBe('commercials_changed');
  });

  it('material updateDraft change invalidates pending approvals automatically', async () => {
    const dealId = await createOpenDealAsAgent();
    const draft = await createDraft(ctxFor(employee(AGENT, AGENT_POSITION)), dealId, exceedingBody);
    const request = await requestApproval(ctxFor(employee(AGENT, AGENT_POSITION)), draft.id);

    // Change the unit price — material change.
    const after = await updateDraft(ctxFor(employee(AGENT, AGENT_POSITION)), draft.id, {
      expectedUpdatedAt: draft.updatedAt,
      body: { ...exceedingBody, items: [{ ...exceedingBody.items[0]!, unitPriceMinor: 2_000_000n }] },
    });
    expect(after.totalMinor).not.toBe(draft.totalMinor);

    const refetched = await getRequest(ctxFor(superAdmin(SUPER_ADMIN)), request.id);
    expect(refetched.state).toBe('invalidated');
  });

  it('escalateIfBreached escalates once past SLA, no second escalation', async () => {
    const dealId = await createOpenDealAsAgent();
    const draft = await createDraft(ctxFor(employee(AGENT, AGENT_POSITION)), dealId, exceedingBody);
    const request = await requestApproval(ctxFor(employee(AGENT, AGENT_POSITION)), draft.id);
    // Force the SLA into the past.
    await asOwner(
      'force sla past',
      sql`UPDATE approval_request SET sla_due_at = now() - interval '1 hour' WHERE id = ${request.id}`,
    );

    const after = await escalateIfBreached(ctxFor(superAdmin(SUPER_ADMIN)), request.id);
    expect(after.state).toBe('escalated');
    expect(after.escalationCount).toBe(1);
    expect(after.currentApproverId).toBe(HOD);

    // Push past the new SLA — second attempt must not escalate again.
    await asOwner(
      'force sla past again',
      sql`UPDATE approval_request SET sla_due_at = now() - interval '1 hour' WHERE id = ${request.id}`,
    );
    const retry = await escalateIfBreached(ctxFor(superAdmin(SUPER_ADMIN)), request.id);
    expect(retry.escalationCount).toBe(1);
  });

  it('listPending returns the queue for a supervisor', async () => {
    const dealId = await createOpenDealAsAgent();
    const draft = await createDraft(ctxFor(employee(AGENT, AGENT_POSITION)), dealId, exceedingBody);
    const request = await requestApproval(ctxFor(employee(AGENT, AGENT_POSITION)), draft.id);

    const queue = await listPending(ctxFor(employee(SUPERVISOR, SUPERVISOR_POSITION)));
    expect(queue.map((r) => r.id)).toContain(request.id);
  });
});
