import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestContext } from '../../../platform/dal/context.js';
import { db, platformDb } from '../../../platform/dal/db.js';
import { closePools } from '../../../platform/dal/pool.js';
import { sql } from '../../../platform/dal/sql.js';
import {
  getStatement,
  listAging,
  listAgingBuckets,
  proposeWriteOff,
  settlePromiseOutcomes,
} from './service.js';

const enabled = process.env['TAPCRM_INTEGRATION_DB'] === '1';
const organizationId = randomUUID();
const userId = randomUUID();
const clientId = randomUUID();
const legalEntityId = randomUUID();
const draftId = randomUUID();
const invoiceId = randomUUID();
const receiptId = randomUUID();
const promiseId = randomUUID();

beforeAll(async () => {
  if (!enabled) return;
  await platformDb.transaction('seed', 'receivables foundation phase 5', async (tx) => {
    await tx.query(
      sql`INSERT INTO organization (id,code,name) VALUES (${organizationId},${`AR${organizationId.slice(0, 6)}`},'Receivables Test Org')`,
    );
    await tx.query(
      sql`INSERT INTO app_user (id,organization_id,account_type,email,full_name) VALUES (${userId},${organizationId},'service',${`receivables-${organizationId}@test.local`},'Receivables Test Service')`,
    );
    await tx.query(
      sql`INSERT INTO client (id,organization_id,client_name,business_name,email,region,currency,timezone,created_by) VALUES (${clientId},${organizationId},'Receivables Client','Receivables Client',${`receivables-${organizationId}@test.local`},'in','INR','Asia/Kolkata',${userId})`,
    );
    await tx.query(
      sql`INSERT INTO finance_legal_entity (id,organization_id,legal_name,country_code,functional_currency,timezone,created_by,status) VALUES (${legalEntityId},${organizationId},'Receivables Test Entity','IN','INR','Asia/Kolkata',${userId},'active')`,
    );
    await tx.query(
      sql`INSERT INTO finance_invoice_draft (id,organization_id,client_id,legal_entity_id,period_start,period_end,currency,subtotal,tax_total,discount_total,total,manifest,manifest_fingerprint,created_by,status) VALUES (${draftId},${organizationId},${clientId},${legalEntityId},'2026-01-01','2026-01-31','INR',100,0,0,100,'{}'::jsonb,${'a'.repeat(64)},${userId},'issued')`,
    );
    await tx.query(
      sql`INSERT INTO finance_invoice (id,organization_id,draft_id,invoice_number,client_id,legal_entity_id,invoice_date,due_date,currency,subtotal,tax_total,discount_total,total,manifest,manifest_fingerprint,issued_by) VALUES (${invoiceId},${organizationId},${draftId},'INV-2026-000001',${clientId},${legalEntityId},'2026-01-01','2026-01-31','INR',100,0,0,100,'{}'::jsonb,${'b'.repeat(64)},${userId})`,
    );
  });
});

afterAll(async () => closePools());

function context() {
  return createRequestContext({
    organizationId,
    principal: {
      id: userId,
      organizationId,
      sessionVersion: 1,
      accountType: 'super-admin',
    },
    requestId: randomUUID(),
  });
}

describe.skipIf(!enabled)('receivables foundation (PostgreSQL)', () => {
  it('reports invoice balances and client statements in minor units', async () => {
    const ctx = context();
    const aging = (await listAging(ctx)) as Array<{ outstandingMinor: string }>;
    expect(aging[0]?.outstandingMinor).toBe('10000');
    const statement = (await getStatement(ctx, clientId)) as Array<{
      outstandingMinor: string;
    }>;
    expect(statement[0]?.outstandingMinor).toBe('10000');
  });

  it('reports aging buckets and settles overdue promises automatically', async () => {
    const ctx = context();
    const buckets = (await listAgingBuckets(ctx)) as Array<{
      bucket: string;
      outstandingMinor: string;
    }>;
    expect(
      buckets.some((row) => row.bucket === '90+' && row.outstandingMinor === '10000'),
    ).toBe(true);

    await platformDb.transaction('seed', 'receivables promise outcome', async (tx) => {
      await tx.query(
        sql`INSERT INTO finance_receivable_promise (id,organization_id,invoice_id,promised_amount,promised_for,reason,created_by) VALUES (${promiseId},${organizationId},${invoiceId},100,now()-interval '1 day','Promise outcome test',${userId})`,
      );
    });
    const settled = await db.transaction(ctx, (tx) =>
      settlePromiseOutcomes(ctx, tx, new Date()),
    );
    expect(settled).toBe(1);
    const promise = await db.one<{ status: string }>(
      ctx,
      sql`SELECT status FROM finance_receivable_promise WHERE organization_id=${organizationId} AND id=${promiseId}`,
    );
    expect(promise.status).toBe('broken');
  });

  it('rejects a write-off larger than the outstanding balance', async () => {
    await expect(
      proposeWriteOff(context(), invoiceId, {
        amount: '100.01',
        reason: 'Over limit test',
      }),
    ).rejects.toMatchObject({
      code: 'RECEIVABLES_VALIDATION_ERROR',
    });
  });

  it('keeps payment allocations immutable', async () => {
    await platformDb.transaction(
      'seed',
      'receivables allocation immutability',
      async (tx) => {
        await tx.query(
          sql`INSERT INTO payment_receipt (id,organization_id,provider,amount_minor,currency,received_at,reported_by,state,idempotency_key) VALUES (${receiptId},${organizationId},'manual',10000,'INR',now(),${userId},'verified',${`receivables:${receiptId}`})`,
        );
        await tx.query(
          sql`INSERT INTO payment_allocation (organization_id,receipt_id,invoice_id,amount_minor,allocated_by) VALUES (${organizationId},${receiptId},${invoiceId},10000,${userId})`,
        );
      },
    );
    await expect(
      db.transaction(context(), (tx) =>
        tx.query(
          sql`DELETE FROM payment_allocation WHERE organization_id=${organizationId} AND receipt_id=${receiptId}`,
        ),
      ),
    ).rejects.toThrow(/payment_allocation rows are immutable|permission denied/);
  });
});
