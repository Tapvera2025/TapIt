export const BREAK_EVENTS = {
  PAYROLL_BLOCKER_CHANGED: 'breaks.payroll-blocker-changed',
} as const;

export interface BreakPayrollBlockerChanged {
  readonly breachId: string;
  readonly userId: string;
  readonly workDate: string;
  readonly transition: 'opened' | 'resolved';
}
