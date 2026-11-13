/**
 * The advances façade — what other modules may import (MB-1). Payroll plans
 * and schedules advance recoveries through the ports registered here; its
 * tests call the same entry points.
 */
export { planDefaultRecovery, scheduleRecovery, registerAdvancePayrollPorts } from './payroll.js';
