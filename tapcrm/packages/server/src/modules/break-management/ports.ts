import type { Tx } from '../../platform/dal/db.js';
import type { DateOnly, Decimal } from '@tapcrm/contracts';

/**
 * Payroll's break deduction writer port (§13, §14.1, BM design).
 * Registered by payroll at boot; called by break-management on deduct-amount confirm.
 */
export interface BreakDeductionInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly periodStart: DateOnly;   // first day of local month
  readonly amount: Decimal;           // positive
  readonly label: string;
  readonly breakBreachId: string;
}

export interface BreakDeductionWriter {
  writeDeduction(tx: Tx, input: BreakDeductionInput): Promise<{ payrollInputId: string }>;
  revokeDeduction(tx: Tx, breakBreachId: string): Promise<void>;
}

let deductionWriter: BreakDeductionWriter | null = null;

export function registerBreakDeductionWriter(w: BreakDeductionWriter): void {
  if (deductionWriter !== null) throw new Error('A BreakDeductionWriter is already registered');
  deductionWriter = w;
}

export function breakDeductionWriter(): BreakDeductionWriter {
  if (deductionWriter === null) throw new Error('BreakDeductionWriter not registered');
  return deductionWriter;
}

export function __resetBreakDeductionWriter(): void {
  deductionWriter = null;
}
