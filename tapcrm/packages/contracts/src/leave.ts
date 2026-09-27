// packages/contracts/src/leave.ts
import type { DateOnly } from './people.js';

export type LeaveKind = 'absence' | 'attendance-mode';
export type LeaveStatus = 'pending' | 'acknowledged' | 'approved' | 'rejected' | 'cancelled';
export type LeaveHalf = 'full' | 'first' | 'second';
export type LeaveBalanceEntryKind = 'opening' | 'accrual' | 'consumption' | 'reversal';

export interface LeaveTypeDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: LeaveKind;
  readonly accrualDays: number;
  readonly enforcement: boolean;
  readonly paidLeave: boolean;
  readonly isActive: boolean;
}

export interface LeaveRequestSummary {
  readonly id: string;
  readonly userId: string;
  readonly userFullName: string;
  readonly leaveTypeId: string;
  readonly leaveTypeName: string;
  readonly kind: LeaveKind;
  readonly fromDate: DateOnly;
  readonly toDate: DateOnly;
  readonly fromHalf: LeaveHalf;
  readonly toHalf: LeaveHalf;
  readonly daysConsumed: number;
  readonly reason: string;
  readonly status: LeaveStatus;
  readonly requestedBy: string;
  readonly acknowledgedAt: string | null;
  readonly decidedAt: string | null;
  readonly decisionNote: string | null;
  readonly revokedAt: string | null;
  readonly recurrenceType: 'daily' | null;
  readonly recurrenceEnd: DateOnly | null;
  readonly createdAt: string;
}

export interface LeaveBalanceDto {
  readonly leaveTypeId: string;
  readonly leaveTypeName: string;
  readonly opening: number;
  readonly accrued: number;
  readonly consumed: number;
  readonly available: number;
}

export interface LeaveCalendarEvent {
  readonly date: DateOnly;
  readonly kind: LeaveKind;
  readonly status: LeaveStatus;
  readonly leaveTypeName: string;
  readonly requestId: string;
}
