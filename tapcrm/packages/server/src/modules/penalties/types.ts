export const PENALTY_TYPES = [
  'late_arrival',
  'early_departure',
  'unapproved_absence',
  'attendance_violation',
  'policy_violation',
  'misconduct',
  'asset_damage_or_loss',
  'other',
] as const;

export type PenaltyType = (typeof PENALTY_TYPES)[number];
export type PenaltyStatus = 'active' | 'cancelled';
export type PayrollStatus = 'pending' | 'processed' | 'recovered';

export interface PenaltySummary {
  activeCount: number;
  activeAmountPaise: string;
  pendingAmountPaise: string;
}

export interface PenaltyRow {
  id: string;
  organizationId: string;
  employeeId: string;
  employeeCode: string | null;
  employeeName: string;
  departmentName: string | null;
  teamName: string | null;
  positionName: string | null;
  penaltyType: PenaltyType;
  amountPaise: string;
  penaltyDate: string;
  payrollPeriod: string;
  remarks: string;
  status: PenaltyStatus;
  payrollStatus: PayrollStatus;
  cancellationReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  createdBy: string;
}
