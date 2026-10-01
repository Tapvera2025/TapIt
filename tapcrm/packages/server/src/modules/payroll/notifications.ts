import type { RequestContext } from '../../platform/dal/context.js';
import type { Tx } from '../../platform/dal/db.js';
import { NOTIFICATION_TYPES, formatMonth, inBatches, notify } from '../notifications/facade.js';

/**
 * Payroll notifications — the Tasks pattern (modules/tasks/notifications.ts).
 *
 *   event                    who                                 type                        priority
 *   ───────────────────────  ──────────────────────────────────  ──────────────────────────  ─────────────
 *   a run is published       every employee with a payslip in it  payroll.payslip_published   informational
 *   a payslip is revised     that employee                       payroll.payslip_revised     informational
 *
 * The message never carries amounts: pay is read on the payslip itself, behind
 * its own permission check (P2), not in a toast that anyone near the screen
 * can see.
 */

const MY_PAYSLIPS_LINK = '/company/payroll/my-payslips';

export async function notifyPayslipsPublished(
  tx: Tx,
  ctx: RequestContext,
  run: { readonly id: string; readonly periodStart: string },
  userIds: readonly string[],
): Promise<void> {
  const recipients = [...new Set(userIds)].filter((id) => id !== ctx.principal.id);
  const month = formatMonth(run.periodStart);
  for (const batch of inBatches(recipients)) {
    await notify(tx, ctx, {
      type: NOTIFICATION_TYPES.PAYSLIP_PUBLISHED,
      audience: { users: batch },
      title: `Your payslip for ${month} is ready`,
      body: 'Open My Payslips to view or save it.',
      link: MY_PAYSLIPS_LINK,
      metadata: { runId: run.id, periodStart: run.periodStart },
    });
  }
}

export async function notifyPayslipRevised(
  tx: Tx,
  ctx: RequestContext,
  slip: { readonly id: string; readonly userId: string; readonly periodStart: string; readonly revisionNumber: number },
): Promise<void> {
  if (slip.userId === ctx.principal.id) return;
  await notify(tx, ctx, {
    type: NOTIFICATION_TYPES.PAYSLIP_REVISED,
    audience: { users: [slip.userId] },
    title: `Your payslip for ${formatMonth(slip.periodStart)} was revised`,
    body: `A corrected payslip (revision ${slip.revisionNumber}) replaces the earlier one.`,
    link: MY_PAYSLIPS_LINK,
    metadata: { payslipId: slip.id, periodStart: slip.periodStart, revisionNumber: slip.revisionNumber },
  });
}
