import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal } from '@tapcrm/contracts';
import { createJobContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { createDeal } from '../deals/service.js';
import { createDraft as createCommercialsDraft, publishVersion } from '../proposals/service.js';
import type { CreateDraftInput as CommercialsDraftInput } from '../proposals/validators.js';
import {
  DeliveryBriefAlreadyExistsError,
  DeliveryBriefProjectLinkExistsError,
  DeliveryBriefWrongStateError,
  getBrief,
  reviewDecision,
  startBrief,
  submit,
  updateBrief,
} from './service.js';

/**
 * Sales v1.1 R2 — Delivery brief end-to-end (R2 step 2.15).
 */

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const RUN = randomUUID().slice(0, 8);
const ORG = randomUUID();
const DEPARTMENT = randomUUID();
const POSITION = randomUUID();
const HOD_POSITION = randomUUID();
const POOL_TEAM = randomUUID();
const AGENT = randomUUID();
const HOD = randomUUID();
const CONTACT = randomUUID();
const CLIENT = randomUUID();

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

const superAdmin = (): Principal => ({
  id: HOD,
  organizationId: ORG,
  sessionVersion: 0,
  accountType: 'super-admin',
});

const ctxFor = (principal: Principal) =>
  createJobContext({
    organizationId: ORG,
    principal,
    jobName: 'sales.delivery.test',
    runId: RUN,
  });

const standardBody: CommercialsDraftInput = {
  items: [
    {
      serviceName: 'Website build',
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

async function createDealOwned(): Promise<string> {
  const deal = await createDeal(ctxFor(employee(AGENT, POSITION)), {
    directEntryReason: 'Delivery brief integration test',
    title: 'Delivery scenario',
    contactId: CONTACT,
    currency: 'INR',
  });
  return deal.id;
}

async function createPublishedCommercials(dealId: string): Promise<string> {
  const draft = await createCommercialsDraft(ctxFor(employee(AGENT, POSITION)), dealId, standardBody);
  const published = await publishVersion(ctxFor(employee(AGENT, POSITION)), draft.id);
  return published.id;
}

async function seedProject(): Promise<string> {
  const projectId = randomUUID();
  await asOwner(
    'seed project for brief acceptance',
    sql`INSERT INTO project (id, organization_id, client_id, name, priority, start_date, currency, created_by)
        VALUES (${projectId}, ${ORG}, ${CLIENT}, 'Fixture Project ' || ${projectId.slice(0, 8)}, 'medium', now()::date, 'INR', ${AGENT})`,
  );
  return projectId;
}

async function markDealWon(dealId: string): Promise<void> {
  await asOwner(
    'force-mark deal won for cancellation test',
    sql`UPDATE deal
           SET lifecycle_status = 'won',
               deal_stage       = 'closed',
               won_at           = now(),
               closed_by_id     = ${HOD}
         WHERE organization_id = ${ORG}
           AND id              = ${dealId}`,
  );
}

describe.skipIf(!enabled)('sales delivery brief service (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone)
          VALUES (${ORG}, ${`DB${RUN}`}, 'Sales Delivery Test', 'Asia/Kolkata')`,
    );
    await asOwner(
      'create department',
      sql`INSERT INTO department (id, organization_id, name) VALUES (${DEPARTMENT}, ${ORG}, 'Sales')`,
    );
    await asOwner(
      'create agent position',
      sql`INSERT INTO position (id, organization_id, department_id, name, level, max_deal_value, max_discount_percent, allows_custom_terms)
          VALUES (${POSITION}, ${ORG}, ${DEPARTMENT}, 'Sales Agent', 1, 50000, 20, false)`,
    );
    await asOwner(
      'create hod position',
      sql`INSERT INTO position (id, organization_id, department_id, name, level, max_deal_value, max_discount_percent, allows_custom_terms)
          VALUES (${HOD_POSITION}, ${ORG}, ${DEPARTMENT}, 'Sales HOD', 3, NULL, NULL, true)`,
    );
    await asOwner(
      'create pool team',
      sql`INSERT INTO team (id, organization_id, department_id, kind, name)
          VALUES (${POOL_TEAM}, ${ORG}, ${DEPARTMENT}, 'sales-pool', 'Delivery Pool')`,
    );
    await asOwner(
      'create hod user',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id)
          VALUES (${HOD}, ${ORG}, 'super-admin', 'Delivery HOD', 'active', ${HOD_POSITION}, ${DEPARTMENT}, ${POOL_TEAM})`,
    );
    await asOwner(
      'create agent user',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, reports_to)
          VALUES (${AGENT}, ${ORG}, 'employee', 'Delivery Agent', 'active', ${POSITION}, ${DEPARTMENT}, ${POOL_TEAM}, ${HOD})`,
    );
    await asOwner(
      'create contact',
      sql`INSERT INTO contact (id, organization_id, full_name, primary_phone, preferred_timezone)
          VALUES (${CONTACT}, ${ORG}, 'Priya Delivery', ${'+91982' + RUN}, 'Asia/Kolkata')`,
    );
    await asOwner(
      'create client',
      sql`INSERT INTO client (id, organization_id, client_name, business_name, email, region, currency, timezone, created_by)
          VALUES (${CLIENT}, ${ORG}, 'Delivery Client', 'Delivery Co', ${'delivery' + RUN + '@test.invalid'}, 'in', 'INR', 'Asia/Kolkata', ${HOD})`,
    );
  });

  afterAll(async () => {
    await asOwner('cleanup audit outbox', sql`DELETE FROM audit_outbox      WHERE organization_id = ${ORG}`);
    await asOwner('cleanup briefs',       sql`DELETE FROM delivery_brief    WHERE organization_id = ${ORG}`);
    await asOwner('cleanup project assignees', sql`DELETE FROM project_assignee WHERE organization_id = ${ORG}`);
    await asOwner('cleanup project services',  sql`DELETE FROM project_service  WHERE organization_id = ${ORG}`);
    await asOwner('cleanup projects',     sql`DELETE FROM project           WHERE organization_id = ${ORG}`);
    await asOwner('cleanup items',        sql`DELETE FROM commercials_item  WHERE organization_id = ${ORG}`);
    await asOwner('clear deal commercials', sql`UPDATE deal SET commercials_id = NULL WHERE organization_id = ${ORG}`);
    await asOwner('cleanup commercials',  sql`DELETE FROM commercials       WHERE organization_id = ${ORG}`);
    await asOwner('cleanup deals',        sql`DELETE FROM deal              WHERE organization_id = ${ORG}`);
    await asOwner('cleanup clients',      sql`DELETE FROM client            WHERE organization_id = ${ORG}`);
    await asOwner('cleanup contacts',     sql`DELETE FROM contact           WHERE organization_id = ${ORG}`);
    await asOwner('cleanup users',        sql`DELETE FROM app_user          WHERE organization_id = ${ORG}`);
    await asOwner('cleanup pool',         sql`DELETE FROM team              WHERE organization_id = ${ORG}`);
    await asOwner('cleanup positions',    sql`DELETE FROM position          WHERE organization_id = ${ORG}`);
    await asOwner('cleanup department',   sql`DELETE FROM department        WHERE organization_id = ${ORG}`);
    await asOwner('cleanup org',          sql`DELETE FROM organization      WHERE id              = ${ORG}`);
    await closePools();
  });

  it('draft → submit → accept links a project exactly once (idempotent)', async () => {
    const dealId = await createDealOwned();
    const commercialsId = await createPublishedCommercials(dealId);
    const projectId = await seedProject();

    const brief = await startBrief(ctxFor(employee(AGENT, POSITION)), dealId, {
      commercialsId,
      content: { deliverables: ['Site design', 'Hosting setup'] },
    });
    expect(brief.state).toBe('draft');

    const submitted = await submit(ctxFor(employee(AGENT, POSITION)), brief.id);
    expect(submitted.state).toBe('submitted');
    expect(submitted.submittedAt).not.toBeNull();

    const accepted = await reviewDecision(ctxFor(superAdmin()), brief.id, {
      decision: 'accept',
      projectId,
    });
    expect(accepted.state).toBe('accepted');
    expect(accepted.projectId).toBe(projectId);
    expect(accepted.acceptedBy).toBe(HOD);
    expect(accepted.acceptedAt).not.toBeNull();

    // Repeat accept with same projectId is idempotent — same row returned.
    const accepted2 = await reviewDecision(ctxFor(superAdmin()), brief.id, {
      decision: 'accept',
      projectId,
    });
    expect(accepted2.projectId).toBe(projectId);
    expect(accepted2.acceptedAt?.getTime()).toBe(accepted.acceptedAt?.getTime());

    // A different projectId on an already-accepted brief is rejected.
    const otherProjectId = await seedProject();
    await expect(
      reviewDecision(ctxFor(superAdmin()), brief.id, { decision: 'accept', projectId: otherProjectId }),
    ).rejects.toBeInstanceOf(DeliveryBriefProjectLinkExistsError);
  });

  it('request_changes puts the brief back for revision and clears on resubmit', async () => {
    const dealId = await createDealOwned();
    const commercialsId = await createPublishedCommercials(dealId);
    const brief = await startBrief(ctxFor(employee(AGENT, POSITION)), dealId, { commercialsId });
    await submit(ctxFor(employee(AGENT, POSITION)), brief.id);

    const changes = await reviewDecision(ctxFor(superAdmin()), brief.id, {
      decision: 'request_changes',
      changeNotes: 'Please add the Phase 2 scope',
    });
    expect(changes.state).toBe('changes_requested');
    expect(changes.changeNotes).toBe('Please add the Phase 2 scope');
    expect(changes.projectId).toBeNull();

    const current = await getBrief(ctxFor(employee(AGENT, POSITION)), brief.id);
    const updated = await updateBrief(ctxFor(employee(AGENT, POSITION)), brief.id, {
      content: { deliverables: ['Phase 1', 'Phase 2'] },
      expectedUpdatedAt: current.updatedAt,
    });
    expect(updated.state).toBe('changes_requested');

    const resubmitted = await submit(ctxFor(employee(AGENT, POSITION)), brief.id);
    expect(resubmitted.state).toBe('submitted');
    expect(resubmitted.changeNotes).toBeNull();
  });

  it('a second startBrief on the same deal is rejected', async () => {
    const dealId = await createDealOwned();
    const commercialsId = await createPublishedCommercials(dealId);
    await startBrief(ctxFor(employee(AGENT, POSITION)), dealId, { commercialsId });
    await expect(
      startBrief(ctxFor(employee(AGENT, POSITION)), dealId, { commercialsId }),
    ).rejects.toBeInstanceOf(DeliveryBriefAlreadyExistsError);
  });

  it('cannot submit a non-draft brief', async () => {
    const dealId = await createDealOwned();
    const commercialsId = await createPublishedCommercials(dealId);
    const projectId = await seedProject();
    const brief = await startBrief(ctxFor(employee(AGENT, POSITION)), dealId, { commercialsId });
    await submit(ctxFor(employee(AGENT, POSITION)), brief.id);
    await reviewDecision(ctxFor(superAdmin()), brief.id, { decision: 'accept', projectId });

    await expect(
      submit(ctxFor(employee(AGENT, POSITION)), brief.id),
    ).rejects.toBeInstanceOf(DeliveryBriefWrongStateError);
  });

  it('cancelling a brief after the deal is Won requires deals:approve (super admin OK)', async () => {
    const dealId = await createDealOwned();
    const commercialsId = await createPublishedCommercials(dealId);
    const brief = await startBrief(ctxFor(employee(AGENT, POSITION)), dealId, { commercialsId });
    await submit(ctxFor(employee(AGENT, POSITION)), brief.id);
    await markDealWon(dealId);

    const cancelled = await reviewDecision(ctxFor(superAdmin()), brief.id, {
      decision: 'cancel',
      reason: 'Customer withdrew post-signature',
    });
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.cancelledReason).toBe('Customer withdrew post-signature');
    expect(cancelled.projectId).toBeNull();
  });
});
