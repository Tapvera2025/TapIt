/**
 * The penalties façade — what other modules may import (MB-1). Payroll charges
 * and releases recorded penalties through the ports registered here; its tests
 * call the same entry points.
 */
export { chargePenalty, releasePenalty, registerPenaltyPayrollPorts } from './payroll.js';
