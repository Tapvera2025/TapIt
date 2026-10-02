/**
 * Narrow accounting façade — Step 9 (G6).
 * Stores a balanced ledger_posting_intent in the running transaction.
 * Full accounting is deferred to P6; this facade is the G6 contract.
 */
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';

export interface PostingLine {
  readonly role: string;
  readonly amountPaise: bigint;
  readonly side: 'debit' | 'credit';
}

export interface LedgerPostInput {
  readonly organizationId: string;
  readonly runId: string;
  readonly payslipId: string | null;   // null = run-level posting
  readonly kind: 'posting' | 'zero-delta-revision';
  readonly lines: PostingLine[];
  readonly debitTotalPaise: bigint;
  readonly creditTotalPaise: bigint;
}

/**
 * Write one balanced posting intent in the caller's transaction.
 * Validates balance and uniqueness; does not post a journal yet.
 */
export async function post(tx: Tx, input: LedgerPostInput): Promise<{ intentId: string }> {
  // Validate
  if (input.debitTotalPaise !== input.creditTotalPaise) {
    throw new Error(`LEDGER_UNBALANCED: debit ${input.debitTotalPaise} ≠ credit ${input.creditTotalPaise}`);
  }
  if (input.kind === 'posting' && input.lines.length === 0) {
    throw new Error('LEDGER_EMPTY_POSTING: posting intent must have lines');
  }
  if (input.kind === 'zero-delta-revision' && input.lines.length > 0) {
    throw new Error('LEDGER_ZERO_WITH_LINES: zero-delta-revision must have no lines');
  }
  for (const line of input.lines) {
    if (line.amountPaise <= 0n) throw new Error(`LEDGER_NONPOSITIVE_LINE: ${line.role} amount must be positive`);
  }

  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO ledger_posting_intent
      (organization_id, kind, run_id, payslip_id, debit_total_paise, credit_total_paise, lines)
    VALUES (
      ${input.organizationId},
      ${input.kind},
      ${input.runId}::uuid,
      ${input.payslipId ?? null}::uuid,
      ${input.debitTotalPaise.toString()},
      ${input.creditTotalPaise.toString()},
      ${JSON.stringify(input.lines.map(l => ({ ...l, amountPaise: l.amountPaise.toString() })))}::jsonb
    )
    RETURNING id
  `);
  return { intentId: row.id };
}
