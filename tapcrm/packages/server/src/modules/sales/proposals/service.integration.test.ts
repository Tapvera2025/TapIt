import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal } from '@tapcrm/contracts';
import { createJobContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import { createDeal } from '../deals/service.js';
import {
  CommercialsPublishBlockedError,
  CommercialsVersionLockedError,
  createDraft,
  getCommercials,
  publishVersion,
  updateDraft,
} from './service.js';
import type { CreateDraftInput } from './validators.js';

/**
 * Sales v1.1 R2 — proposals service end-to-end against PostgreSQL (R2 step 2.9).
 *
 *   TAPCRM_INTEGRATION_DB=1 MIGRATION_DATABASE_URL=… DATABASE_URL=… npx vitest run <file>
 *
 * The three assertions the plan calls out plus the invariants:
 *   - updateDraft under drift: one succeeds, the other sees
 *     COMMERCIALS_STALE_WRITE with the server copy.
 *   - publishVersion is blocked when the deal is approval_status='pending'.
 *   - publish produces a stable PDF checksum, republish is a no-op.
 *   - the published version becomes the deal's active commercials_id and
 *     any prior published version is marked `superseded`.
 */

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const RUN = randomUUID().slice(0, 8);
const ORG = randomUUID();
const DEPARTMENT = randomUUID();
const POSITION = randomUUID();
const POOL_TEAM = randomUUID();
const AGENT = randomUUID();
const SUPER_ADMIN = randomUUID();
const CONTACT = randomUUID();

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
    jobName: 'sales.proposals.test',
    runId: RUN,
  });

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

async function createOpenDeal(): Promise<string> {
  const deal = await createDeal(ctxFor(employee(AGENT)), {
    directEntryReason: 'Integration test — direct entry',
    title: 'Proposal versioning scenario',
    contactId: CONTACT,
    currency: 'INR',
  });
  return deal.id;
}

async function setDealApprovalStatus(dealId: string, status: string): Promise<void> {
  await asOwner(
    'set deal approval status',
    sql`UPDATE deal SET approval_status = ${status} WHERE organization_id = ${ORG} AND id = ${dealId}`,
  );
}

describe.skipIf(!enabled)('sales proposals service (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`SP${RUN}`}, 'Sales Proposals Test', 'Asia/Kolkata')`,
    );
    await asOwner(
      'create department',
      sql`INSERT INTO department (id, organization_id, name) VALUES (${DEPARTMENT}, ${ORG}, 'Sales')`,
    );
    await asOwner(
      'create position',
      sql`INSERT INTO position (id, organization_id, department_id, name, level) VALUES (${POSITION}, ${ORG}, ${DEPARTMENT}, 'Sales Agent', 1)`,
    );
    await asOwner(
      'create sales pool team',
      sql`INSERT INTO team (id, organization_id, department_id, kind, name) VALUES (${POOL_TEAM}, ${ORG}, ${DEPARTMENT}, 'sales-pool', 'Pool A')`,
    );
    await asOwner(
      'create agent',
      sql`
        INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id)
        VALUES (${AGENT}, ${ORG}, 'employee', 'Agent A', 'active', ${POSITION}, ${DEPARTMENT}, ${POOL_TEAM})
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
      'create contact',
      sql`
        INSERT INTO contact (id, organization_id, full_name, primary_phone, preferred_timezone)
        VALUES (${CONTACT}, ${ORG}, 'Rahul Shah', ${'+9198000' + RUN}, 'Asia/Kolkata')
      `,
    );
  });

  afterAll(async () => {
    await asOwner('cleanup audit outbox',   sql`DELETE FROM audit_outbox          WHERE organization_id = ${ORG}`);
    await asOwner('cleanup items',          sql`DELETE FROM commercials_item      WHERE organization_id = ${ORG}`);
    await asOwner('clear deal commercials', sql`UPDATE deal SET commercials_id = NULL WHERE organization_id = ${ORG}`);
    await asOwner('cleanup commercials',    sql`DELETE FROM commercials           WHERE organization_id = ${ORG}`);
    await asOwner('cleanup deals',          sql`DELETE FROM deal                  WHERE organization_id = ${ORG}`);
    await asOwner('cleanup contacts',       sql`DELETE FROM contact               WHERE organization_id = ${ORG}`);
    await asOwner('cleanup users',          sql`DELETE FROM app_user              WHERE organization_id = ${ORG}`);
    await asOwner('cleanup pool',           sql`DELETE FROM team                  WHERE organization_id = ${ORG}`);
    await asOwner('cleanup position',       sql`DELETE FROM position              WHERE organization_id = ${ORG}`);
    await asOwner('cleanup department',     sql`DELETE FROM department            WHERE organization_id = ${ORG}`);
    await asOwner('cleanup org',            sql`DELETE FROM organization          WHERE id              = ${ORG}`);
    await closePools();
  });

  it('createDraft inserts version 1 with server-computed totals', async () => {
    const dealId = await createOpenDeal();
    const draft = await createDraft(ctxFor(employee(AGENT)), dealId, sampleBody);

    expect(draft.version).toBe(1);
    expect(draft.state).toBe('draft');
    expect(draft.subtotalMinor).toBe(100_000n);
    expect(draft.taxMinor).toBe(18_000n);
    expect(draft.totalMinor).toBe(118_000n);
    expect(draft.items.length).toBe(1);
    expect(draft.items[0]!.lineTotalMinor).toBe(100_000n);
  });

  it('createDraft increments version for subsequent drafts on the same deal', async () => {
    const dealId = await createOpenDeal();
    const v1 = await createDraft(ctxFor(employee(AGENT)), dealId, sampleBody);
    const v2 = await createDraft(ctxFor(employee(AGENT)), dealId, sampleBody);
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v1.id).not.toBe(v2.id);
  });

  it('updateDraft rejects a stale write with the server copy', async () => {
    const dealId = await createOpenDeal();
    const draft = await createDraft(ctxFor(employee(AGENT)), dealId, sampleBody);

    const first = await updateDraft(ctxFor(employee(AGENT)), draft.id, {
      expectedUpdatedAt: draft.updatedAt,
      body: {
        ...sampleBody,
        scope: 'First revision',
      },
    });
    expect(first.scope).toBe('First revision');

    await expect(
      updateDraft(ctxFor(employee(AGENT)), draft.id, {
        expectedUpdatedAt: draft.updatedAt,          // stale
        body: {
          ...sampleBody,
          scope: 'Second revision (racing)',
        },
      }),
    ).rejects.toMatchObject({
      name: 'CommercialsOptimisticLockError',
      code: 'COMMERCIALS_STALE_WRITE',
    });

    const refetched = await getCommercials(ctxFor(employee(AGENT)), draft.id);
    expect(refetched.scope).toBe('First revision');
  });

  it('publishVersion is blocked when approval_status = pending', async () => {
    const dealId = await createOpenDeal();
    const draft = await createDraft(ctxFor(employee(AGENT)), dealId, sampleBody);
    await setDealApprovalStatus(dealId, 'pending');

    await expect(publishVersion(ctxFor(superAdmin(SUPER_ADMIN)), draft.id)).rejects.toMatchObject({
      name: 'CommercialsPublishBlockedError',
      code: 'COMMERCIALS_PUBLISH_BLOCKED',
      details: { reason: 'approval_pending' },
    });
  });

  it('publishVersion is blocked when approval_status = rejected', async () => {
    const dealId = await createOpenDeal();
    const draft = await createDraft(ctxFor(employee(AGENT)), dealId, sampleBody);
    await setDealApprovalStatus(dealId, 'rejected');

    await expect(publishVersion(ctxFor(superAdmin(SUPER_ADMIN)), draft.id)).rejects.toBeInstanceOf(
      CommercialsPublishBlockedError,
    );
  });

  it('publishVersion freezes the row and sets the deal active commercials', async () => {
    const dealId = await createOpenDeal();
    const draft = await createDraft(ctxFor(employee(AGENT)), dealId, sampleBody);

    const published = await publishVersion(ctxFor(superAdmin(SUPER_ADMIN)), draft.id);
    expect(published.state).toBe('published');
    expect(published.pdfChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(published.publishedAt).toBeInstanceOf(Date);
    expect(published.publishedBy).toBe(SUPER_ADMIN);

    const dealRow = await asOwner(
      'read deal active commercials',
      sql`SELECT commercials_id AS "commercialsId" FROM deal WHERE organization_id = ${ORG} AND id = ${dealId}`,
    );
    expect((dealRow[0] as { commercialsId: string }).commercialsId).toBe(published.id);
  });

  it('republish of an already-published version is a no-op (same checksum)', async () => {
    const dealId = await createOpenDeal();
    const draft = await createDraft(ctxFor(employee(AGENT)), dealId, sampleBody);
    const first = await publishVersion(ctxFor(superAdmin(SUPER_ADMIN)), draft.id);
    const second = await publishVersion(ctxFor(superAdmin(SUPER_ADMIN)), draft.id);
    expect(second.pdfChecksum).toBe(first.pdfChecksum);
    expect(second.publishedAt).toEqual(first.publishedAt);          // unchanged
  });

  it('publishing v2 supersedes v1 and flips the deal pointer', async () => {
    const dealId = await createOpenDeal();
    const v1 = await createDraft(ctxFor(employee(AGENT)), dealId, sampleBody);
    const v1Published = await publishVersion(ctxFor(superAdmin(SUPER_ADMIN)), v1.id);
    expect(v1Published.state).toBe('published');

    const v2 = await createDraft(ctxFor(employee(AGENT)), dealId, {
      ...sampleBody,
      scope: 'v2 scope',
    });
    const v2Published = await publishVersion(ctxFor(superAdmin(SUPER_ADMIN)), v2.id);
    expect(v2Published.state).toBe('published');

    const v1Refetched = await getCommercials(ctxFor(employee(AGENT)), v1.id);
    expect(v1Refetched.state).toBe('superseded');

    const dealRow = await asOwner(
      'read deal active commercials',
      sql`SELECT commercials_id AS "commercialsId" FROM deal WHERE organization_id = ${ORG} AND id = ${dealId}`,
    );
    expect((dealRow[0] as { commercialsId: string }).commercialsId).toBe(v2Published.id);
  });

  it('updateDraft refuses a published version', async () => {
    const dealId = await createOpenDeal();
    const draft = await createDraft(ctxFor(employee(AGENT)), dealId, sampleBody);
    const published = await publishVersion(ctxFor(superAdmin(SUPER_ADMIN)), draft.id);

    await expect(
      updateDraft(ctxFor(employee(AGENT)), published.id, {
        expectedUpdatedAt: published.updatedAt,
        body: { ...sampleBody, scope: 'post-publish edit' },
      }),
    ).rejects.toBeInstanceOf(CommercialsVersionLockedError);
  });
});
