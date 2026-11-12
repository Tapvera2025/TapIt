import type { Tx } from '../../platform/dal/db.js';
import { settledSources } from './input.js';

/**
 * Advance recoveries and penalties are payroll inputs their own modules write
 * (`writeSourcedInput`). When a payslip that froze one is published, the
 * owning module marks it paid. Each module registers its settler at boot; a
 * module that is not loaded simply has nothing to settle.
 */
export type SourceSettler = (tx: Tx, ids: readonly string[]) => Promise<void>;

let advanceDeductionSettler: SourceSettler | null = null;
let penaltySettler: SourceSettler | null = null;

export function registerPayrollSourceSettlers(settlers: {
  readonly advanceDeductions?: SourceSettler;
  readonly penalties?: SourceSettler;
}): void {
  if (settlers.advanceDeductions !== undefined) advanceDeductionSettler = settlers.advanceDeductions;
  if (settlers.penalties !== undefined) penaltySettler = settlers.penalties;
}

/** Marks what these just-published payslips recovered, in the publishing transaction. */
export async function settlePaidSources(
  tx: Tx,
  organizationId: string,
  payslipIds: readonly string[],
): Promise<void> {
  const { advanceDeductionIds, penaltyIds } = await settledSources(tx, organizationId, payslipIds);
  if (advanceDeductionIds.length > 0 && advanceDeductionSettler !== null)
    await advanceDeductionSettler(tx, advanceDeductionIds);
  if (penaltyIds.length > 0 && penaltySettler !== null) await penaltySettler(tx, penaltyIds);
}
