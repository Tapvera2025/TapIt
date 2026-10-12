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
  amend,
  ContractActiveExistsError,
  ContractCommercialsNotPublishedError,
  ContractWrongStateError,
  createDraft,
  getContract,
  listForDeal,
  markSent,
  recordSignature,
  voidContract,
} from './service.js';

/**
 * Sales v1.1 R2 — Contracts service end-to-end (R2 step 2.12).
 */

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const RUN = randomUUID().slice(0, 8);
const ORG = randomUUID();
const DEPARTMENT = randomUUID();
const POSITION = randomUUID();
const POOL_TEAM = randomUUID();
const AGENT = randomUUID();
const HOD = randomUUID();
const HOD_POSITION = randomUUID();
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

const ctxFor = (principal: Principal) =>
  createJobContext({
    organizationId: ORG,
    principal,
    jobName: 'sales.contracts.test',
    runId: RUN,
  });

// ₹1000 + 18% GST = 118000 paise — picked so the request never touches
// the approvals ladder (the agent position covers it).
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
    directEntryReason: 'Contracts integration test',
    title: 'Contract scenario',
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

describe.skipIf(!enabled)('sales contracts service (PostgreSQL)', () => {
  beforeAll(async () => {
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone)
          VALUES (${ORG}, ${`CT${RUN}`}, 'Sales Contracts Test', 'Asia/Kolkata')`,
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
          VALUES (${POOL_TEAM}, ${ORG}, ${DEPARTMENT}, 'sales-pool', 'Contracts Pool')`,
    );
    await asOwner(
      'create hod',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id)
          VALUES (${HOD}, ${ORG}, 'employee', 'Contracts HOD', 'active', ${HOD_POSITION}, ${DEPARTMENT}, ${POOL_TEAM})`,
    );
    await asOwner(
      'create agent',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, reports_to)
          VALUES (${AGENT}, ${ORG}, 'employee', 'Contracts Agent', 'active', ${POSITION}, ${DEPARTMENT}, ${POOL_TEAM}, ${HOD})`,
    );
    await asOwner(
      'create contact',
      sql`INSERT INTO contact (id, organization_id, full_name, primary_phone, preferred_timezone)
          VALUES (${CONTACT}, ${ORG}, 'Priya Kumar', ${'+91981' + RUN}, 'Asia/Kolkata')`,
    );
  });

  afterAll(async () => {
    await asOwner('cleanup audit outbox', sql`DELETE FROM audit_outbox      WHERE organization_id = ${ORG}`);
    await asOwner('cleanup contracts',    sql`DELETE FROM contract          WHERE organization_id = ${ORG}`);
    await asOwner('cleanup items',        sql`DELETE FROM commercials_item  WHERE organization_id = ${ORG}`);
    await asOwner('clear deal commercials', sql`UPDATE deal SET commercials_id = NULL WHERE organization_id = ${ORG}`);
    await asOwner('cleanup commercials',  sql`DELETE FROM commercials       WHERE organization_id = ${ORG}`);
    await asOwner('cleanup deals',        sql`DELETE FROM deal              WHERE organization_id = ${ORG}`);
    await asOwner('cleanup contacts',     sql`DELETE FROM contact           WHERE organization_id = ${ORG}`);
    await asOwner('cleanup users',        sql`DELETE FROM app_user          WHERE organization_id = ${ORG}`);
    await asOwner('cleanup pool',         sql`DELETE FROM team              WHERE organization_id = ${ORG}`);
    await asOwner('cleanup positions',    sql`DELETE FROM position          WHERE organization_id = ${ORG}`);
    await asOwner('cleanup department',   sql`DELETE FROM department        WHERE organization_id = ${ORG}`);
    await asOwner('cleanup org',          sql`DELETE FROM organization      WHERE id              = ${ORG}`);
    await closePools();
  });

  it('draft → sent → signed walks the deal.contract_status column', async () => {
    const dealId = await createDealOwned();
    const commercialsId = await createPublishedCommercials(dealId);

    const draft = await createDraft(ctxFor(employee(AGENT, POSITION)), dealId, {
      commercialsId,
      draftFileId: randomUUID(),
    });
    expect(draft.state).toBe('draft');
    let [row] = await asOwner(
      'read deal contract status after draft',
      sql`SELECT contract_status AS "contractStatus" FROM deal WHERE organization_id = ${ORG} AND id = ${dealId}`,
    );
    expect((row as { contractStatus: string }).contractStatus).toBe('draft');

    const sent = await markSent(ctxFor(employee(AGENT, POSITION)), draft.id, {
      signerName: 'Priya Kumar',
      signerEmail: 'priya@example.com',
    });
    expect(sent.state).toBe('sent');
    expect(sent.signerName).toBe('Priya Kumar');
    [row] = await asOwner(
      'read deal contract status after send',
      sql`SELECT contract_status AS "contractStatus" FROM deal WHERE organization_id = ${ORG} AND id = ${dealId}`,
    );
    expect((row as { contractStatus: string }).contractStatus).toBe('sent');

    const signed = await recordSignature(ctxFor(employee(HOD, HOD_POSITION)), draft.id, {
      signedFileId: randomUUID(),
      checksum: 'a'.repeat(64),
      signerEvidence: { method: 'wet-signature-scanned' },
    });
    expect(signed.state).toBe('signed');
    expect(signed.checksum).toBe('a'.repeat(64));
    expect(signed.signerEvidence?.method).toBe('wet-signature-scanned');
    [row] = await asOwner(
      'read deal contract status after sign',
      sql`SELECT contract_status AS "contractStatus" FROM deal WHERE organization_id = ${ORG} AND id = ${dealId}`,
    );
    expect((row as { contractStatus: string }).contractStatus).toBe('signed');
  });

  it('signed contract rejects re-sending and re-signing', async () => {
    const dealId = await createDealOwned();
    const commercialsId = await createPublishedCommercials(dealId);
    const draft = await createDraft(ctxFor(employee(AGENT, POSITION)), dealId, { commercialsId });
    await markSent(ctxFor(employee(AGENT, POSITION)), draft.id, {
      signerName: 'Priya',
      signerEmail: 'priya@example.com',
    });
    await recordSignature(ctxFor(employee(HOD, HOD_POSITION)), draft.id, {
      signedFileId: randomUUID(),
      checksum: 'b'.repeat(64),
      signerEvidence: {},
    });

    await expect(
      markSent(ctxFor(employee(AGENT, POSITION)), draft.id, {
        signerName: 'Priya',
        signerEmail: 'priya@example.com',
      }),
    ).rejects.toBeInstanceOf(ContractWrongStateError);
    await expect(
      recordSignature(ctxFor(employee(HOD, HOD_POSITION)), draft.id, {
        signedFileId: randomUUID(),
        checksum: 'c'.repeat(64),
        signerEvidence: {},
      }),
    ).rejects.toBeInstanceOf(ContractWrongStateError);
  });

  it('amendment creates a new draft and marks the signed contract as amended', async () => {
    const dealId = await createDealOwned();
    const originalCommercials = await createPublishedCommercials(dealId);
    const amendedCommercials = await createPublishedCommercials(dealId);
    const draft = await createDraft(ctxFor(employee(AGENT, POSITION)), dealId, { commercialsId: originalCommercials });
    await markSent(ctxFor(employee(AGENT, POSITION)), draft.id, {
      signerName: 'Priya',
      signerEmail: 'priya@example.com',
    });
    const signed = await recordSignature(ctxFor(employee(HOD, HOD_POSITION)), draft.id, {
      signedFileId: randomUUID(),
      checksum: 'd'.repeat(64),
      signerEvidence: {},
    });

    const amendment = await amend(ctxFor(employee(HOD, HOD_POSITION)), signed.id, {
      commercialsId: amendedCommercials,
      draftFileId: randomUUID(),
    });
    expect(amendment.state).toBe('draft');
    expect(amendment.supersedesId).toBe(signed.id);
    expect(amendment.commercialsId).toBe(amendedCommercials);

    const previous = await getContract(ctxFor(employee(AGENT, POSITION)), signed.id);
    expect(previous.state).toBe('amended');
    expect(previous.signedAt).not.toBeNull();
    expect(previous.checksum).toBe('d'.repeat(64));

    const [dealRow] = await asOwner(
      'read deal contract status after amendment',
      sql`SELECT contract_status AS "contractStatus" FROM deal WHERE organization_id = ${ORG} AND id = ${dealId}`,
    );
    expect((dealRow as { contractStatus: string }).contractStatus).toBe('draft');

    const all = await listForDeal(ctxFor(employee(AGENT, POSITION)), dealId);
    expect(all.map((c) => c.state).sort()).toEqual(['amended', 'draft']);
  });

  it('createDraft refuses when another active contract exists on the deal', async () => {
    const dealId = await createDealOwned();
    const commercialsId = await createPublishedCommercials(dealId);
    await createDraft(ctxFor(employee(AGENT, POSITION)), dealId, { commercialsId });
    await expect(
      createDraft(ctxFor(employee(AGENT, POSITION)), dealId, { commercialsId }),
    ).rejects.toBeInstanceOf(ContractActiveExistsError);
  });

  it('createDraft refuses an unpublished commercials version', async () => {
    const dealId = await createDealOwned();
    const draftOnly = await createCommercialsDraft(ctxFor(employee(AGENT, POSITION)), dealId, standardBody);
    await expect(
      createDraft(ctxFor(employee(AGENT, POSITION)), dealId, { commercialsId: draftOnly.id }),
    ).rejects.toBeInstanceOf(ContractCommercialsNotPublishedError);
  });

  it('voiding a draft frees the deal to create a new contract', async () => {
    const dealId = await createDealOwned();
    const commercialsId = await createPublishedCommercials(dealId);
    const draft = await createDraft(ctxFor(employee(AGENT, POSITION)), dealId, { commercialsId });
    const voided = await voidContract(ctxFor(employee(AGENT, POSITION)), draft.id, { reason: 'wrong recipient' });
    expect(voided.state).toBe('voided');
    expect(voided.voidReason).toBe('wrong recipient');

    const [dealRow] = await asOwner(
      'read deal contract status after void',
      sql`SELECT contract_status AS "contractStatus" FROM deal WHERE organization_id = ${ORG} AND id = ${dealId}`,
    );
    expect((dealRow as { contractStatus: string }).contractStatus).toBe('voided');

    // Fresh draft now allowed because no active contract remains.
    const replacement = await createDraft(ctxFor(employee(AGENT, POSITION)), dealId, { commercialsId });
    expect(replacement.state).toBe('draft');
  });
});
