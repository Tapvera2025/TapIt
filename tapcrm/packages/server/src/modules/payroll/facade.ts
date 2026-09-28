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

export {
  listConfigs,
  acceptConfig,
  resolveConfig,
  type AcceptConfigInput,
  type PayrollConfigRow,
  type ConfigSource,
} from './config.js';

export {
  listStructures,
  createStructure,
  resolveStructureForDate,
  type CreateStructureInput,
  type SalaryStructureRow,
  type StructureLineRow,
} from './structure.js';

export {
  insertManualInput,
  revokeManualInput,
  listActiveInputsForPeriod,
  type ManualInputKind,
  type ManualInputInsert,
  type PayrollInputRow,
} from './input.js';

export {
  PAYROLL_EVENTS,
  type InputChanged,
  type StructureChanged,
  type ConfigChanged,
} from './events.js';

export {
  createRun,
  getRunById,
  getRunEmployees,
  transitionRun,
  periodEndFor,
  fingerprint,
  type CreateRunInput,
  type CreateRunResult,
  type PayrollRunRow,
  type RunEmployeeRow,
  type RunBlocker,
  type RunStatus,
} from './run.js';

export {
  computeAndWriteDraftSlip,
  type FrozenEmployeeInputs,
} from './snapshot.js';

export {
  registerPayrollJobs,
  type PayrollJobs,
} from './jobs.js';

export {
  publishRun,
  PublishBlockedError,
  type PublishBlocker,
  type PublishResult,
} from './publish.js';
