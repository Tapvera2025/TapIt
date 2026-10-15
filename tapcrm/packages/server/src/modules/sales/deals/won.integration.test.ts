import { randomUUID } from 'node:crypto';
import { installAuthz } from '../../../platform/authz-adapter.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Principal } from '@tapcrm/contracts';
import { createJobContext } from '../../../platform/dal/context.js';
import { platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { PlatformForbiddenError } from '../../../platform/errors.js';
import { sql } from '../../../platform/dal/sql.js';
import { createDraft as createContractDraft, markSent as sendContract, recordSignature } from '../contracts/service.js';
import { startBrief } from '../delivery/service.js';
import { createDraft as createCommercialsDraft, publishVersion } from '../proposals/service.js';
import type { CreateDraftInput as CommercialsDraftInput } from '../proposals/validators.js';
import { createDeal } from './service.js';
import {
  DealAlreadyWonError,
  DealCloseReadinessUnmetError,
  listReadyToClose,
  readinessForClose,
  recordWin,
} from './won.js';

/**
 * Sales v1.1 R2 — Won recorder end-to-end (R2 step 2.14).
 */

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
// Digits only: RUN is embedded in E.164 phone numbers (contact_primary_phone_check).
const RUN = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const ORG = randomUUID();
const DEPARTMENT = randomUUID();
const POSITION = randomUUID();
const HOD_POSITION = randomUUID();
const POOL_TEAM = randomUUID();
const AGENT = randomUUID();
const HOD = randomUUID();
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
    jobName: 'sales.won.test',
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

async function createOpenDeal(): Promise<string> {
  const deal = await createDeal(ctxFor(employee(AGENT, POSITION)), {
    directEntryReason: 'Won recorder integration test',
    title: 'Won scenario',
    contactId: CONTACT,
    currency: 'INR',
  });
  return deal.id;
}

async function prepareSignedContract(dealId: string): Promise<string> {
  const draft = await createCommercialsDraft(ctxFor(employee(AGENT, POSITION)), dealId, standardBody);
  const published = await publishVersion(ctxFor(employee(AGENT, POSITION)), draft.id);
  const contractDraft = await createContractDraft(ctxFor(employee(AGENT, POSITION)), dealId, {
    commercialsId: published.id,
  });
  await sendContract(ctxFor(employee(AGENT, POSITION)), contractDraft.id, {
    signerName: 'Priya Won',
    signerEmail: 'priya-won@example.com',
  });
  await recordSignature(ctxFor(superAdmin(HOD)), contractDraft.id, {
    signedFileId: randomUUID(),
    checksum: 'f'.repeat(64),
    signerEvidence: {},
  });
  return published.id;
}

async function prepareDeliveryBrief(dealId: string, commercialsId: string): Promise<void> {
  await startBrief(ctxFor(employee(AGENT, POSITION)), dealId, { commercialsId });
}

describe.skipIf(!enabled)('sales won recorder (PostgreSQL)', () => {
  beforeAll(async () => {
    installAuthz();
    await asOwner(
      'create organization',
      sql`INSERT INTO organization (id, code, name, timezone)
          VALUES (${ORG}, ${`WR${RUN}`}, 'Sales Won Test', 'Asia/Kolkata')`,
    );
    await asOwner(
      'create department',
      sql`INSERT INTO department (id, organization_id, code, name, kind) VALUES (${DEPARTMENT}, ${ORG}, 'SALES', 'Sales', 'sales')`,
    );
    await asOwner(
      'create agent position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level, max_deal_value, max_discount_percent, allows_custom_terms)
          VALUES (${POSITION}, ${ORG}, ${DEPARTMENT}, 'SALES_AGENT', 'Sales Agent', 1, 50000, 20, false)`,
    );
    await asOwner(
      'create hod position',
      sql`INSERT INTO position (id, organization_id, department_id, code, name, organizational_level, max_deal_value, max_discount_percent, allows_custom_terms)
          VALUES (${HOD_POSITION}, ${ORG}, ${DEPARTMENT}, 'SALES_HOD', 'Sales HOD', 3, NULL, NULL, true)`,
    );
    await asOwner(
      'create pool team',
      sql`INSERT INTO team (id, organization_id, department_id, kind, name)
          VALUES (${POOL_TEAM}, ${ORG}, ${DEPARTMENT}, 'sales-pool', 'Won Pool')`,
    );
    await asOwner(
      'create hod',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, employee_id)
          VALUES (${HOD}, ${ORG}, 'employee', 'Won HOD', 'active', ${HOD_POSITION}, ${DEPARTMENT}, ${POOL_TEAM}, 'E-' || upper(left(replace(${HOD}::text, '-', ''), 12)))`,
    );
    await asOwner(
      'create agent',
      sql`INSERT INTO app_user (id, organization_id, account_type, full_name, status, position_id, department_id, team_id, reports_to, employee_id)
          VALUES (${AGENT}, ${ORG}, 'employee', 'Won Agent', 'active', ${POSITION}, ${DEPARTMENT}, ${POOL_TEAM}, ${HOD}, 'E-' || upper(left(replace(${AGENT}::text, '-', ''), 12)))`,
    );
    await asOwner(
      'create contact',
      sql`INSERT INTO contact (id, organization_id, full_name, primary_phone, preferred_timezone, created_by)
          VALUES (${CONTACT}, ${ORG}, 'Priya Won', ${'+91983' + RUN}, 'Asia/Kolkata', ${AGENT})`,
    );
  });

  afterAll(async () => {
    await asOwner('cleanup audit outbox', sql`DELETE FROM audit_outbox      WHERE organization_id = ${ORG}`);
    await asOwner('cleanup briefs',       sql`DELETE FROM delivery_brief    WHERE organization_id = ${ORG}`);
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

  it('readinessForClose lists missing delivery_brief for a bare deal (contract_status=not_required default)', async () => {
    const dealId = await createOpenDeal();
    const report = await readinessForClose(ctxFor(superAdmin(HOD)), dealId);
    expect(report.canClose).toBe(false);
    const conditions = report.unmet.map((u) => u.condition);
    expect(conditions).toContain('delivery_brief');
    expect(conditions).not.toContain('approval');
    expect(conditions).not.toContain('contract');
  });

  it('after signing a contract and starting a brief, readiness is clear and recordWin closes the deal atomically', async () => {
    const dealId = await createOpenDeal();
    const commercialsId = await prepareSignedContract(dealId);
    await prepareDeliveryBrief(dealId, commercialsId);

    const beforeReport = await readinessForClose(ctxFor(superAdmin(HOD)), dealId);
    expect(beforeReport.canClose).toBe(true);
    expect(beforeReport.unmet).toHaveLength(0);

    const won = await recordWin(ctxFor(superAdmin(HOD)), dealId);
    expect(won.lifecycleStatus).toBe('won');
    expect(won.dealStage).toBe('closed');
    expect(won.closedById).toBe(HOD);
    expect(won.wonAt).not.toBeNull();

    const afterReport = await readinessForClose(ctxFor(superAdmin(HOD)), dealId);
    expect(afterReport.canClose).toBe(false);
    expect(afterReport.unmet.map((u) => u.condition)).toContain('already_closed');
  });

  it('a second recordWin on the same deal is rejected with DEAL_ALREADY_WON', async () => {
    const dealId = await createOpenDeal();
    const commercialsId = await prepareSignedContract(dealId);
    await prepareDeliveryBrief(dealId, commercialsId);
    await recordWin(ctxFor(superAdmin(HOD)), dealId);

    await expect(
      recordWin(ctxFor(superAdmin(HOD)), dealId),
    ).rejects.toBeInstanceOf(DealAlreadyWonError);
  });

  it('recordWin without deals:record-win is 403', async () => {
    const dealId = await createOpenDeal();
    const commercialsId = await prepareSignedContract(dealId);
    await prepareDeliveryBrief(dealId, commercialsId);

    await expect(
      recordWin(ctxFor(employee(AGENT, POSITION)), dealId),
    ).rejects.toBeInstanceOf(PlatformForbiddenError);
  });

  it('recordWin on an unready deal returns WIN_READINESS_UNMET with unmet conditions', async () => {
    const dealId = await createOpenDeal();
    // No contract, no brief → should be blocked by delivery_brief at least.
    await expect(
      recordWin(ctxFor(superAdmin(HOD)), dealId),
    ).rejects.toBeInstanceOf(DealCloseReadinessUnmetError);
  });

  it('listReadyToClose surfaces deals the HOD can close', async () => {
    const dealId = await createOpenDeal();
    const commercialsId = await prepareSignedContract(dealId);
    await prepareDeliveryBrief(dealId, commercialsId);

    const rows = await listReadyToClose(ctxFor(superAdmin(HOD)));
    expect(rows.some((r) => r.id === dealId)).toBe(true);
  });
});
