import type { RequestContext } from '../../../platform/dal/context.js';
import { db, type Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { postSourceJournalTx } from '../accounting/facade.js';
import { ReceivablesNotFoundError, ReceivablesValidationError } from './errors.js';
import type {
  CollectionTaskInput,
  DisputeInput,
  DisputeResolutionInput,
  DunningScheduleInput,
  PromiseInput,
  PromiseResolutionInput,
  TaskStatusInput,
  WriteOffInput,
} from './validators.js';

function cents(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

async function audit(
  ctx: RequestContext,
  action: string,
  targetId: string,
  before: unknown,
  after: unknown,
  reason: string,
  tx: Tx,
) {
  await tx.query(sql`INSERT INTO audit_outbox (organization_id,stream,payload)
    VALUES (${ctx.organizationId},'activity',${JSON.stringify({
      action,
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'receivable',
      targetId,
      before,
      after,
      reason,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    })}::jsonb)`);
}

export async function settlePromiseOutcomes(
  ctx: RequestContext,
  tx: Tx,
  now: Date,
): Promise<number> {
  const rows = await tx.query<{
    id: string;
    invoiceId: string;
    status: string;
    outstanding: string;
  }>(sql`SELECT p.id,p.invoice_id AS "invoiceId",p.status,
    GREATEST(round(i.total*100)::bigint-COALESCE(SUM(pa.amount_minor),0),0)::text AS outstanding
    FROM finance_receivable_promise p
    JOIN finance_invoice i ON i.organization_id=p.organization_id AND i.id=p.invoice_id
    LEFT JOIN payment_allocation pa ON pa.organization_id=i.organization_id AND pa.invoice_id=i.id
    WHERE p.organization_id=${ctx.organizationId} AND p.status='open'
    GROUP BY p.id,i.id`);
  let changed = 0;
  for (const row of rows) {
    const nextStatus =
      BigInt(row.outstanding) === 0n
        ? 'kept'
        : (
              await tx.maybeOne<{ due: boolean }>(
                sql`SELECT ${now} > promised_for AS due FROM finance_receivable_promise WHERE organization_id=${ctx.organizationId} AND id=${row.id}`,
              )
            )?.due
          ? 'broken'
          : null;
    if (!nextStatus) continue;
    await tx.query(
      sql`UPDATE finance_receivable_promise SET status=${nextStatus},resolved_by=${ctx.principal.id},resolved_at=${now},updated_at=${now} WHERE organization_id=${ctx.organizationId} AND id=${row.id} AND status='open'`,
    );
    await audit(
      ctx,
      `receivables.promise.${nextStatus}`,
      row.id,
      { status: row.status },
      { status: nextStatus, invoiceId: row.invoiceId },
      `Automatically marked ${nextStatus} by receivables reconciliation.`,
      tx,
    );
    changed += 1;
  }
  return changed;
}

async function refreshInvoiceStatus(
  tx: Tx,
  organizationId: string,
  invoiceId: string,
  preserveDispute = true,
) {
  await tx.query(sql`UPDATE finance_invoice i SET receivable_status = CASE
    WHEN i.receivable_status = 'written_off' THEN i.receivable_status
    WHEN ${preserveDispute} AND i.receivable_status = 'disputed' THEN i.receivable_status
    WHEN COALESCE((SELECT SUM(pa.amount_minor) FROM payment_allocation pa WHERE pa.organization_id=i.organization_id AND pa.invoice_id=i.id),0) >= round(i.total * 100)::bigint THEN 'paid'
    WHEN COALESCE((SELECT SUM(pa.amount_minor) FROM payment_allocation pa WHERE pa.organization_id=i.organization_id AND pa.invoice_id=i.id),0) > 0 THEN 'partially_paid'
    WHEN i.due_date < CURRENT_DATE THEN 'overdue'
    ELSE 'open' END
    WHERE i.organization_id=${organizationId} AND i.id=${invoiceId}`);
}

export async function listAging(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT i.id,i.invoice_number AS "invoiceNumber",i.client_id AS "clientId",
    i.invoice_date AS "invoiceDate",i.due_date AS "dueDate",i.currency,
    i.total::text AS total,i.receivable_status AS status,
    COALESCE(SUM(pa.amount_minor),0)::text AS "paidMinor",
    GREATEST(round(i.total * 100)::bigint-COALESCE(SUM(pa.amount_minor),0),0)::text AS "outstandingMinor",
    CASE WHEN i.due_date < CURRENT_DATE THEN CURRENT_DATE-i.due_date ELSE 0 END AS "daysOverdue"
    FROM finance_invoice i LEFT JOIN payment_allocation pa
      ON pa.organization_id=i.organization_id AND pa.invoice_id=i.id
    WHERE i.organization_id=${ctx.organizationId} AND i.status='issued'
    GROUP BY i.id ORDER BY i.due_date,i.invoice_number`,
  );
}

export async function listAgingBuckets(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`WITH balances AS (
    SELECT i.currency, GREATEST(round(i.total * 100)::bigint-COALESCE(SUM(pa.amount_minor),0),0) AS outstanding,
      CASE WHEN i.due_date >= CURRENT_DATE THEN 'current' WHEN CURRENT_DATE-i.due_date BETWEEN 1 AND 30 THEN '1-30' WHEN CURRENT_DATE-i.due_date BETWEEN 31 AND 60 THEN '31-60' WHEN CURRENT_DATE-i.due_date BETWEEN 61 AND 90 THEN '61-90' ELSE '90+' END AS bucket
    FROM finance_invoice i LEFT JOIN payment_allocation pa ON pa.organization_id=i.organization_id AND pa.invoice_id=i.id
    WHERE i.organization_id=${ctx.organizationId} AND i.status='issued' AND i.receivable_status NOT IN ('paid','written_off') GROUP BY i.id)
    SELECT currency,bucket,count(*)::int AS "invoiceCount",SUM(outstanding)::text AS "outstandingMinor" FROM balances GROUP BY currency,bucket ORDER BY currency,bucket`,
  );
}

export async function listStatementClients(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT c.id,c.client_name AS "clientName",c.business_name AS "businessName",c.currency,
      COUNT(i.id)::int AS "invoiceCount",
      COALESCE(SUM(GREATEST(round(i.total*100)::bigint-COALESCE(pa.paid_minor,0),0)),0)::text AS "outstandingMinor"
      FROM client c
      JOIN finance_invoice i ON i.organization_id=c.organization_id AND i.client_id=c.id AND i.status='issued'
      LEFT JOIN LATERAL (SELECT SUM(amount_minor)::bigint AS paid_minor FROM payment_allocation WHERE organization_id=i.organization_id AND invoice_id=i.id) pa ON true
      WHERE c.organization_id=${ctx.organizationId}
      GROUP BY c.id ORDER BY c.business_name,c.client_name`,
  );
}

export async function getStatement(ctx: RequestContext, clientId: string) {
  return db.query(
    ctx,
    sql`SELECT i.id,i.invoice_number AS "invoiceNumber",i.invoice_date AS "invoiceDate",
    i.due_date AS "dueDate",i.currency,i.total::text AS total,i.receivable_status AS status,
    COALESCE(SUM(pa.amount_minor),0)::text AS "paidMinor",
    GREATEST(round(i.total * 100)::bigint-COALESCE(SUM(pa.amount_minor),0),0)::text AS "outstandingMinor"
    FROM finance_invoice i LEFT JOIN payment_allocation pa
      ON pa.organization_id=i.organization_id AND pa.invoice_id=i.id
    WHERE i.organization_id=${ctx.organizationId} AND i.client_id=${clientId} AND i.status='issued'
    GROUP BY i.id ORDER BY i.invoice_date DESC,i.invoice_number DESC`,
  );
}

export async function listCollections(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT a.id,a.client_id AS "clientId",a.invoice_id AS "invoiceId",
    a.activity_type AS "activityType",a.channel,a.status,a.scheduled_for AS "scheduledFor",
    a.reason,a.notes,a.created_at AS "createdAt",i.invoice_number AS "invoiceNumber"
    FROM finance_receivable_collection_activity a LEFT JOIN finance_invoice i
      ON i.organization_id=a.organization_id AND i.id=a.invoice_id
    WHERE a.organization_id=${ctx.organizationId} ORDER BY a.created_at DESC`,
  );
}

export async function listTasks(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT t.id,t.client_id AS "clientId",t.invoice_id AS "invoiceId",t.assigned_to AS "assignedTo",t.task_type AS "taskType",t.status,t.due_at AS "dueAt",t.title,t.reason,t.created_at AS "createdAt",i.invoice_number AS "invoiceNumber" FROM finance_receivable_collection_task t LEFT JOIN finance_invoice i ON i.organization_id=t.organization_id AND i.id=t.invoice_id WHERE t.organization_id=${ctx.organizationId} ORDER BY t.due_at,t.created_at`,
  );
}
export async function listDisputes(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT d.id,d.invoice_id AS "invoiceId",i.invoice_number AS "invoiceNumber",d.status,d.hold_collections AS "holdCollections",d.reason,d.resolution,d.created_at AS "createdAt" FROM finance_receivable_dispute d JOIN finance_invoice i ON i.organization_id=d.organization_id AND i.id=d.invoice_id WHERE d.organization_id=${ctx.organizationId} ORDER BY d.created_at DESC`,
  );
}
export async function listPromises(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT p.id,p.invoice_id AS "invoiceId",i.invoice_number AS "invoiceNumber",p.promised_amount::text AS "promisedAmount",p.promised_for AS "promisedFor",p.status,p.reason,p.created_at AS "createdAt" FROM finance_receivable_promise p JOIN finance_invoice i ON i.organization_id=p.organization_id AND i.id=p.invoice_id WHERE p.organization_id=${ctx.organizationId} ORDER BY p.promised_for DESC`,
  );
}
export async function listWriteOffs(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT w.id,w.invoice_id AS "invoiceId",i.invoice_number AS "invoiceNumber",w.amount::text,w.reason,w.status,w.proposed_by AS "proposedBy",w.approved_by AS "approvedBy",w.journal_id AS "journalId",w.created_at AS "createdAt"
      FROM finance_receivable_write_off w JOIN finance_invoice i ON i.organization_id=w.organization_id AND i.id=w.invoice_id
      WHERE w.organization_id=${ctx.organizationId} ORDER BY w.created_at DESC`,
  );
}
export async function listReminders(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT r.id,r.invoice_id AS "invoiceId",i.invoice_number AS "invoiceNumber",r.reminder_date AS "reminderDate",r.local_timezone AS "localTimezone",r.status,r.created_at AS "createdAt"
      FROM finance_receivable_reminder r JOIN finance_invoice i ON i.organization_id=r.organization_id AND i.id=r.invoice_id
      WHERE r.organization_id=${ctx.organizationId} ORDER BY r.reminder_date DESC,r.created_at DESC`,
  );
}

export async function dunInvoice(ctx: RequestContext, invoiceId: string, reason: string) {
  return db.transaction(ctx, async (tx) => {
    const invoice = await tx.maybeOne<{
      clientId: string;
      dueDate: string;
    }>(sql`SELECT client_id AS "clientId",due_date AS "dueDate"
      FROM finance_invoice WHERE organization_id=${ctx.organizationId} AND id=${invoiceId} AND status='issued' FOR SHARE`);
    if (!invoice) throw new ReceivablesNotFoundError('Issued invoice not found.');
    const row = await tx.one<{
      id: string;
    }>(sql`INSERT INTO finance_receivable_collection_activity
      (organization_id,client_id,invoice_id,activity_type,channel,status,reason,created_by)
      VALUES (${ctx.organizationId},${invoice.clientId},${invoiceId},'dunning','manual','open',${reason},${ctx.principal.id}) RETURNING id`);
    await audit(
      ctx,
      'receivables.dunning.created',
      row.id,
      null,
      { invoiceId },
      reason,
      tx,
    );
    return row;
  });
}

export async function setDunningSchedule(
  ctx: RequestContext,
  input: DunningScheduleInput,
) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{
      id: string;
    }>(sql`INSERT INTO finance_receivable_dunning_schedule
      (organization_id,client_id,enabled,cadence_days,next_run_at,reason,updated_by)
      VALUES (${ctx.organizationId},${input.clientId},${input.enabled},${input.cadenceDays},${input.nextRunAt},${input.reason},${ctx.principal.id})
      ON CONFLICT (organization_id,client_id) DO UPDATE SET enabled=EXCLUDED.enabled,cadence_days=EXCLUDED.cadence_days,next_run_at=EXCLUDED.next_run_at,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=now()
      RETURNING id`);
    await audit(
      ctx,
      'receivables.dunning_schedule.updated',
      row.id,
      null,
      input,
      input.reason,
      tx,
    );
    return row;
  });
}

export async function createDispute(
  ctx: RequestContext,
  invoiceId: string,
  input: DisputeInput,
) {
  return db.transaction(ctx, async (tx) => {
    const invoice = await tx.maybeOne<{ clientId: string }>(
      sql`SELECT client_id AS "clientId" FROM finance_invoice WHERE organization_id=${ctx.organizationId} AND id=${invoiceId} AND status='issued' FOR SHARE`,
    );
    if (!invoice) throw new ReceivablesNotFoundError('Issued invoice not found.');
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_receivable_dispute (organization_id,invoice_id,hold_collections,reason,created_by) VALUES (${ctx.organizationId},${invoiceId},${input.holdCollections},${input.reason},${ctx.principal.id}) RETURNING id`,
    );
    if (input.holdCollections)
      await tx.query(
        sql`UPDATE finance_invoice SET receivable_status='disputed' WHERE organization_id=${ctx.organizationId} AND id=${invoiceId}`,
      );
    await audit(
      ctx,
      'receivables.dispute.created',
      row.id,
      null,
      input,
      input.reason,
      tx,
    );
    return row;
  });
}
export async function resolveDispute(
  ctx: RequestContext,
  disputeId: string,
  input: DisputeResolutionInput,
) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ invoiceId: string; status: string }>(
      sql`SELECT invoice_id AS "invoiceId",status FROM finance_receivable_dispute WHERE organization_id=${ctx.organizationId} AND id=${disputeId} FOR UPDATE`,
    );
    await tx.query(
      sql`UPDATE finance_receivable_dispute SET status=${input.status},resolution=${input.resolution},resolved_by=${ctx.principal.id},resolved_at=now(),hold_collections=${input.status !== 'resolved'} WHERE organization_id=${ctx.organizationId} AND id=${disputeId}`,
    );
    if (input.status === 'resolved' || input.status === 'rejected')
      await refreshInvoiceStatus(tx, ctx.organizationId, row.invoiceId, false);
    await audit(
      ctx,
      'receivables.dispute.resolved',
      disputeId,
      { status: row.status },
      input,
      input.resolution,
      tx,
    );
    return { id: disputeId, status: input.status };
  });
}
export async function createPromise(
  ctx: RequestContext,
  invoiceId: string,
  input: PromiseInput,
) {
  return db.transaction(ctx, async (tx) => {
    const invoice = await tx.maybeOne<{ outstanding: string }>(
      sql`SELECT GREATEST(round(i.total*100)::bigint-COALESCE((SELECT SUM(amount_minor) FROM payment_allocation WHERE organization_id=i.organization_id AND invoice_id=i.id),0),0)::text AS outstanding FROM finance_invoice i WHERE i.organization_id=${ctx.organizationId} AND i.id=${invoiceId} AND i.status='issued' FOR SHARE`,
    );
    if (!invoice) throw new ReceivablesNotFoundError('Issued invoice not found.');
    if (cents(input.promisedAmount) > BigInt(invoice.outstanding))
      throw new ReceivablesValidationError(
        'Promise amount cannot exceed the outstanding balance.',
      );
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_receivable_promise (organization_id,invoice_id,promised_amount,promised_for,reason,created_by) VALUES (${ctx.organizationId},${invoiceId},${input.promisedAmount},${input.promisedFor},${input.reason},${ctx.principal.id}) RETURNING id`,
    );
    await audit(
      ctx,
      'receivables.promise.created',
      row.id,
      null,
      input,
      input.reason,
      tx,
    );
    return row;
  });
}
export async function resolvePromise(
  ctx: RequestContext,
  promiseId: string,
  input: PromiseResolutionInput,
) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ status: string }>(
      sql`SELECT status FROM finance_receivable_promise WHERE organization_id=${ctx.organizationId} AND id=${promiseId} FOR UPDATE`,
    );
    await tx.query(
      sql`UPDATE finance_receivable_promise SET status=${input.status},resolved_by=${ctx.principal.id},resolved_at=now(),updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${promiseId}`,
    );
    await audit(
      ctx,
      'receivables.promise.resolved',
      promiseId,
      { status: row.status },
      input,
      input.reason,
      tx,
    );
    return { id: promiseId, status: input.status };
  });
}
export async function createTask(ctx: RequestContext, input: CollectionTaskInput) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ id: string }>(
      sql`INSERT INTO finance_receivable_collection_task (organization_id,client_id,invoice_id,assigned_to,task_type,due_at,title,reason,created_by) VALUES (${ctx.organizationId},${input.clientId},${input.invoiceId ?? null},${input.assignedTo ?? null},${input.taskType},${input.dueAt},${input.title},${input.reason},${ctx.principal.id}) RETURNING id`,
    );
    await audit(
      ctx,
      'receivables.collection_task.created',
      row.id,
      null,
      input,
      input.reason,
      tx,
    );
    return row;
  });
}
export async function updateTask(
  ctx: RequestContext,
  taskId: string,
  input: TaskStatusInput,
) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ status: string }>(
      sql`SELECT status FROM finance_receivable_collection_task WHERE organization_id=${ctx.organizationId} AND id=${taskId} FOR UPDATE`,
    );
    await tx.query(
      sql`UPDATE finance_receivable_collection_task SET status=${input.status},completed_by=${input.status === 'completed' ? ctx.principal.id : null},completed_at=${input.status === 'completed' ? sql`now()` : null},updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${taskId}`,
    );
    await audit(
      ctx,
      'receivables.collection_task.updated',
      taskId,
      { status: row.status },
      input,
      input.reason,
      tx,
    );
    return { id: taskId, status: input.status };
  });
}
export async function approveWriteOff(
  ctx: RequestContext,
  writeOffId: string,
  reason: string,
) {
  return db.transaction(ctx, async (tx) => {
    const row = await tx.one<{ invoiceId: string; amount: string; status: string }>(
      sql`SELECT invoice_id AS "invoiceId",amount::text,status FROM finance_receivable_write_off WHERE organization_id=${ctx.organizationId} AND id=${writeOffId} FOR UPDATE`,
    );
    if (row.status !== 'proposed')
      throw new ReceivablesValidationError('Only proposed write-offs can be approved.');
    const journal = await postSourceJournalTx(tx, {
      organizationId: ctx.organizationId,
      postedBy: ctx.principal.id,
      entryDate: new Date().toISOString().slice(0, 10),
      sourceType: 'receivable_write_off',
      sourceId: writeOffId,
      description: `Receivable write-off ${writeOffId}`,
      reason,
      lines: [
        { accountKey: 'bad-debt', amountPaise: cents(row.amount), side: 'debit' },
        {
          accountKey: 'accounts-receivable',
          amountPaise: cents(row.amount),
          side: 'credit',
        },
      ],
    });
    await tx.query(
      sql`UPDATE finance_receivable_write_off SET status='posted',approved_by=${ctx.principal.id},journal_id=${journal.journalId},updated_at=now() WHERE organization_id=${ctx.organizationId} AND id=${writeOffId}`,
    );
    await tx.query(
      sql`UPDATE finance_invoice SET receivable_status='written_off' WHERE organization_id=${ctx.organizationId} AND id=${row.invoiceId}`,
    );
    await audit(
      ctx,
      'receivables.write_off.posted',
      writeOffId,
      { status: row.status },
      { journalId: journal.journalId },
      reason,
      tx,
    );
    return { id: writeOffId, journalId: journal.journalId };
  });
}

export async function proposeWriteOff(
  ctx: RequestContext,
  invoiceId: string,
  input: WriteOffInput,
) {
  return db.transaction(ctx, async (tx) => {
    const invoice = await tx.maybeOne<{
      clientId: string;
      outstanding: string;
    }>(sql`SELECT i.client_id AS "clientId",
      GREATEST(round(i.total * 100)::bigint-COALESCE((SELECT SUM(pa.amount_minor) FROM payment_allocation pa WHERE pa.organization_id=i.organization_id AND pa.invoice_id=i.id),0),0)::text AS outstanding
      FROM finance_invoice i WHERE i.organization_id=${ctx.organizationId} AND i.id=${invoiceId} AND i.status='issued' FOR SHARE`);
    if (!invoice) throw new ReceivablesNotFoundError('Issued invoice not found.');
    if (cents(input.amount) > BigInt(invoice.outstanding))
      throw new ReceivablesValidationError(
        'Write-off cannot exceed the outstanding invoice balance.',
      );
    const row = await tx.one<{ id: string }>(sql`INSERT INTO finance_receivable_write_off
      (organization_id,invoice_id,amount,reason,proposed_by) VALUES (${ctx.organizationId},${invoiceId},${input.amount},${input.reason},${ctx.principal.id}) RETURNING id`);
    await audit(
      ctx,
      'receivables.write_off.proposed',
      row.id,
      null,
      { invoiceId, amount: input.amount },
      input.reason,
      tx,
    );
    return row;
  });
}

export async function listTds(ctx: RequestContext) {
  return db.query(
    ctx,
    sql`SELECT COALESCE(SUM(ab.balance),0)::text AS "receivableBalance"
    FROM account_balance ab JOIN ledger_account la ON la.organization_id=ab.organization_id AND la.id=ab.ledger_account_id
    WHERE ab.organization_id=${ctx.organizationId} AND la.system_key='tds-receivable'`,
  );
}

export { refreshInvoiceStatus };
