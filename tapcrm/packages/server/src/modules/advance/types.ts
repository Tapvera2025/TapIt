export type AdvanceStatus = 'pending' | 'approved' | 'rejected';
export type AdvanceSource = 'employee_request' | 'manual';
export type DeductionStatus = 'pending' | 'partial' | 'completed' | 'cancelled';

export interface AdvanceRow {
  id: string;
  organizationId: string;
  employeeId: string;
  employeeCode: string | null;
  employeeName: string;
  departmentName: string | null;
  teamName: string | null;
  positionName: string | null;
  requestedAmountPaise: string;
  approvedAmountPaise: string | null;
  requestedForPeriod: string;
  requestedAt: string;
  status: AdvanceStatus;
  source: AdvanceSource;
  reason: string;
  approvedAt: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectedByName: string | null;
  rejectionReason: string | null;
  approvalNote: string | null;
  recoveredAmountPaise: string;
  outstandingAmountPaise: string;
}

export interface DeductionRow {
  id: string;
  advanceId: string;
  employeeId: string;
  employeeCode: string | null;
  employeeName: string;
  departmentName: string | null;
  teamName: string | null;
  positionName: string | null;
  requestedAmountPaise: string;
  approvedAmountPaise: string;
  approvedAt: string | null;
  requestedForPeriod: string;
  payrollPeriod: string;
  scheduledAmountPaise: string;
  deductedAmountPaise: string;
  outstandingAmountPaise: string;
  status: DeductionStatus;
}
