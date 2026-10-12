import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Principal } from '@tapcrm/contracts';
import { createJobContext } from '../../../../platform/dal/context.js';
import { platformDb } from '../../../../platform/dal/db.js';
import { closePools } from '../../../../platform/dal/pool.js';
import { sql } from '../../../../platform/dal/sql.js';
import { __resetRateLimits } from '../../../../platform/security/rate-limit.js';
import { createDeal } from '../../deals/service.js';
import {
  createDraft,
  createShareLink,
  publishVersion,
  supersede,
} from '../service.js';
import type { CreateDraftInput } from '../validators.js';
import {
  acceptProposal,
  PortalGoneError,
  PortalNotFoundError,
  PortalRateLimitedError,
  viewProposal,
} from './service.js';

/**
 * Sales v1.1 R2 — public proposal portal end-to-end (R2 step 2.10).
 *
 * Covers the four plan assertions:
 *   - Expired/revoked/superseded → 410, no acceptance.
 *   - Replay of accept is idempotent (same acceptedAt, same evidence).
 *   - Rate-limit breach → 429 with no DB write.
 *   - Supersede after share → old link becomes 410.
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
    jobName: 'sales.portal.test',
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

const META = { ip: '203.0.113.9', userAgent: 'portal-test/1.0' };

async function createPublishedCommercials(): Promise<{ dealId: string; commercialsId: string }> {
  const deal = await createDeal(ctxFor(employee(AGENT)), {
    directEntryReason: 'Portal integration test',
    title: 'Portal scenario',
    contactId: CONTACT,
    currency: 'INR',
  });
  const draft = await createDraft(ctxFor(employee(AGENT)), deal.id, sampleBody);
  await publishVersion(ctxFor(superAdmin(SUPER_ADMIN)), draft.id);
  return { dealId: deal.id, commercialsId: draft.id };
}

async function issueLink(commercialsId: string): Promise<{ rawToken: string; tokenId: string }> {
  const share = await createShareLink(ctxFor(superAdmin(SUPER_ADMIN)), commercialsId);
  return { rawToken: share.rawToken, tokenId: share.tokenId };
}

describe.skipIf(!enabled)('sales proposals portal (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone) VALUES (${ORG}, ${`SPP${RUN}`}, 'Sales Portal Test', 'Asia/Kolkata')`,
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
        VALUES (${CONTACT}, ${ORG}, 'Rahul Shah', ${'+9198001' + RUN}, 'Asia/Kolkata')
      `,
    );
  });

  afterAll(async () => {
    await asOwner('cleanup audit outbox',   sql`DELETE FROM audit_outbox            WHERE organization_id = ${ORG}`);
    await asOwner('cleanup tokens',         sql`DELETE FROM proposal_portal_token   WHERE organization_id = ${ORG}`);
    await asOwner('cleanup items',          sql`DELETE FROM commercials_item        WHERE organization_id = ${ORG}`);
    await asOwner('clear deal commercials', sql`UPDATE deal SET commercials_id = NULL WHERE organization_id = ${ORG}`);
    await asOwner('cleanup commercials',    sql`DELETE FROM commercials             WHERE organization_id = ${ORG}`);
    await asOwner('cleanup deals',          sql`DELETE FROM deal                    WHERE organization_id = ${ORG}`);
    await asOwner('cleanup contacts',       sql`DELETE FROM contact                 WHERE organization_id = ${ORG}`);
    await asOwner('cleanup users',          sql`DELETE FROM app_user                WHERE organization_id = ${ORG}`);
    await asOwner('cleanup pool',           sql`DELETE FROM team                    WHERE organization_id = ${ORG}`);
    await asOwner('cleanup position',       sql`DELETE FROM position                WHERE organization_id = ${ORG}`);
    await asOwner('cleanup department',     sql`DELETE FROM department              WHERE organization_id = ${ORG}`);
    await asOwner('cleanup org',            sql`DELETE FROM organization            WHERE id              = ${ORG}`);
    await closePools();
  });

  beforeEach(() => {
    __resetRateLimits();
  });

  it('viewProposal returns the masked card for a valid token', async () => {
    const { commercialsId } = await createPublishedCommercials();
    const { rawToken } = await issueLink(commercialsId);

    const card = await viewProposal(rawToken, META);
    expect(card.state).toBe('published');
    expect(card.currency).toBe('INR');
    expect(card.subtotalMinor).toBe('100000');
    expect(card.taxMinor).toBe('18000');
    expect(card.totalMinor).toBe('118000');
    expect(card.items.length).toBe(1);
    expect(card.items[0]!.serviceName).toBe('Website redesign');
    expect(card.pdfChecksum).toMatch(/^[0-9a-f]{64}$/);
    // The card never exposes any internal id or deal reference.
    expect(JSON.stringify(card)).not.toContain(commercialsId);
  });

  it('viewProposal with an unknown token returns NOT_FOUND', async () => {
    await expect(viewProposal('this-is-not-a-real-token', META)).rejects.toBeInstanceOf(
      PortalNotFoundError,
    );
  });

  it('viewProposal with an expired token returns 410 Gone', async () => {
    const { commercialsId } = await createPublishedCommercials();
    const { rawToken, tokenId } = await issueLink(commercialsId);
    await asOwner(
      'force expiry in the past',
      sql`UPDATE proposal_portal_token SET expires_at = now() - interval '1 minute' WHERE id = ${tokenId}`,
    );

    await expect(viewProposal(rawToken, META)).rejects.toMatchObject({
      name: 'PortalGoneError',
      code: 'PORTAL_GONE',
      details: { reason: 'expired' },
    });
  });

  it('viewProposal with a revoked token returns 410 Gone', async () => {
    const { commercialsId } = await createPublishedCommercials();
    const { rawToken, tokenId } = await issueLink(commercialsId);
    await asOwner(
      'revoke token',
      sql`UPDATE proposal_portal_token SET revoked_at = now() WHERE id = ${tokenId}`,
    );

    await expect(viewProposal(rawToken, META)).rejects.toMatchObject({
      name: 'PortalGoneError',
      details: { reason: 'revoked' },
    });
  });

  it('viewProposal after supersede returns 410 — share-link outlives its version', async () => {
    const { dealId, commercialsId } = await createPublishedCommercials();
    const { rawToken } = await issueLink(commercialsId);

    // Publishing a new version supersedes the first automatically.
    const v2Draft = await createDraft(ctxFor(employee(AGENT)), dealId, {
      ...sampleBody,
      scope: 'Revised scope',
    });
    await publishVersion(ctxFor(superAdmin(SUPER_ADMIN)), v2Draft.id);

    await expect(viewProposal(rawToken, META)).rejects.toMatchObject({
      name: 'PortalGoneError',
      details: { reason: 'superseded' },
    });
  });

  it('acceptProposal records evidence; replay returns the same acceptedAt (idempotent)', async () => {
    const { commercialsId } = await createPublishedCommercials();
    const { rawToken } = await issueLink(commercialsId);

    const first = await acceptProposal(rawToken, {}, META);
    expect(first.alreadyAccepted).toBe(false);
    expect(first.acceptedAt).toBeInstanceOf(Date);
    expect(first.pdfChecksum).toMatch(/^[0-9a-f]{64}$/);

    const replay = await acceptProposal(rawToken, {}, META);
    expect(replay.alreadyAccepted).toBe(true);
    expect(replay.acceptedAt.getTime()).toBe(first.acceptedAt.getTime());
    expect(replay.pdfChecksum).toBe(first.pdfChecksum);

    const stored = await asOwner(
      'read accepted row',
      sql`SELECT state, accepted_at AS "acceptedAt", accepted_evidence AS "acceptedEvidence"
            FROM commercials WHERE organization_id = ${ORG} AND id = ${commercialsId}`,
    );
    expect(stored[0]).toMatchObject({ state: 'accepted' });
    expect((stored[0] as { acceptedEvidence: Record<string, unknown> }).acceptedEvidence).toMatchObject({
      ip: META.ip,
      userAgent: META.userAgent,
    });
  });

  it('acceptProposal with a different token on an already-accepted version returns 410', async () => {
    const { commercialsId } = await createPublishedCommercials();
    const { rawToken: first } = await issueLink(commercialsId);
    const { rawToken: second } = await issueLink(commercialsId);

    await acceptProposal(first, {}, META);
    await expect(acceptProposal(second, {}, META)).rejects.toMatchObject({
      name: 'PortalGoneError',
      details: { reason: 'rejected' },
    });
  });

  it('rate limit per token breaks at 31st request; no DB write for the overflow', async () => {
    const { commercialsId } = await createPublishedCommercials();
    const { rawToken } = await issueLink(commercialsId);

    // 30 views are allowed; the 31st breaks the per-token limit.
    for (let i = 0; i < 30; i++) {
      await viewProposal(rawToken, META);
    }
    await expect(viewProposal(rawToken, META)).rejects.toBeInstanceOf(PortalRateLimitedError);

    const stillPublished = await asOwner(
      'confirm no mutation',
      sql`SELECT state FROM commercials WHERE organization_id = ${ORG} AND id = ${commercialsId}`,
    );
    expect(stillPublished[0]).toMatchObject({ state: 'published' });
  });

  it('rate limit per IP breaks at 11th request from one IP', async () => {
    const { commercialsId } = await createPublishedCommercials();
    const { rawToken } = await issueLink(commercialsId);

    for (let i = 0; i < 10; i++) {
      await viewProposal(rawToken, META);
    }
    await expect(viewProposal(rawToken, META)).rejects.toBeInstanceOf(PortalRateLimitedError);
  });

  it('supersede after a successful share returns 410 on next view (ex-plan)', async () => {
    const { commercialsId } = await createPublishedCommercials();
    const { rawToken } = await issueLink(commercialsId);

    // One successful view first — proves the link worked.
    await viewProposal(rawToken, META);

    await supersede(ctxFor(superAdmin(SUPER_ADMIN)), commercialsId);
    await expect(viewProposal(rawToken, META)).rejects.toMatchObject({
      name: 'PortalGoneError',
      details: { reason: 'superseded' },
    });
  });
});
