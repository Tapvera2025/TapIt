/**
 * Payroll façade — the only file other modules may import (MB-1).
 *
 * Registers the BreakDeductionWriter port into break-management at boot
 * (§14.1 of the BM design). Called by modules/index.ts `initializePorts()`.
 */
import { registerBreakDeductionWriter } from '../break-management/facade.js';
import { writeBreakDeduction, revokeBreakDeduction } from './input.js';

export function registerPayrollPorts(): void {
  registerBreakDeductionWriter({
    writeDeduction: writeBreakDeduction,
    revokeDeduction: revokeBreakDeduction,
  });
}
