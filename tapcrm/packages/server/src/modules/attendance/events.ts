/**
 * Outbox events from attendance (design §4).
 *
 * `attendance.recalc-requested` is written for every record whose inputs
 * changed, in the transaction that changed them; its handler (jobs.ts) queues
 * the recalculation job keyed by record and input version, so duplicates
 * collapse (AT-I4).
 */
export const ATTENDANCE_EVENTS = {
  RECALC_REQUESTED: 'attendance.recalc-requested',
  /** An export was requested; its handler queues the export job (§8.7, TX-2). */
  EXPORT_REQUESTED: 'attendance.export-requested',
  /** A correction was approved or rejected (§12). */
  CORRECTION_DECIDED: 'attendance.correction-decided',
  /** A day's calculation version changed (payroll watermark, §14). */
  DAY_CHANGED: 'attendance.day-changed',
  /** A payroll blocker (correction/review-item) was opened or resolved. */
  PAYROLL_BLOCKER_CHANGED: 'attendance.payroll-blocker-changed',
} as const;

export interface RecalcRequested {
  readonly recordId: string;
  readonly userId: string;
  readonly workDate: string;
  readonly inputVersion: number;
}

export interface ExportRequested {
  readonly requestId: string;
}

export interface CorrectionDecided {
  readonly correctionId: string;
  readonly userId: string;
  readonly workDate: string;
  readonly kind: string;
  readonly status: 'approved' | 'rejected';
  readonly requestedBy: string;
  readonly decidedBy: string;
}

export interface DayChanged {
  readonly recordId: string;
  readonly userId: string;
  readonly workDate: string;
  readonly organizationId: string;
  readonly calculationVersion: number;
}

export interface PayrollBlockerChanged {
  readonly userId: string;
  readonly workDate: string;
  readonly sourceType: 'correction' | 'review-item';
  readonly sourceId: string;
  readonly transition: 'opened' | 'resolved';
}
