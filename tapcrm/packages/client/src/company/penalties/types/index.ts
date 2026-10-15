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

export const PENALTY_LABELS: Record<PenaltyType, string> = {
  late_arrival: 'Late Arrival',
  early_departure: 'Early Departure',
  unapproved_absence: 'Unapproved Absence',
  attendance_violation: 'Attendance Violation',
  policy_violation: 'Policy Violation',
  misconduct: 'Misconduct',
  asset_damage_or_loss: 'Asset Damage / Loss',
  other: 'Other',
};

export interface Penalty {
  id: string;
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

export interface PenaltyPage {
  rows: Penalty[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: {
    activeCount: number;
    activeAmountPaise: string;
    pendingAmountPaise: string;
  };
}
