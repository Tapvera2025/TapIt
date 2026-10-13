import { peopleDownload, peopleMutation, peopleRead } from '../../api/client.js';

export type AdvanceStatus = 'pending' | 'approved' | 'rejected';
export interface Advance {
  id: string;
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
  source: string;
  reason: string;
  approvedAt: string | null;
  approvedByName: string | null;
  rejectionReason: string | null;
  approvalNote: string | null;
  recoveredAmountPaise: string;
  outstandingAmountPaise: string;
}
export interface Deduction {
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
  status: string;
}
export interface Page<T> {
  rows: T[];
  total: number;
}
const query = (input: Record<string, string | number | undefined>): string => {
  const p = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined && value !== '') p.set(key, String(value));
  });
  return p.toString();
};
export const listMyAdvances = (
  params: Record<string, string | number | undefined> = {},
) => peopleRead<Page<Advance>>(`/api/advances/mine?${query(params)}`);
export const listAdvances = (params: Record<string, string | number | undefined> = {}) =>
  peopleRead<Page<Advance>>(`/api/advances?${query(params)}`);
export const listDeductions = (
  params: Record<string, string | number | undefined> = {},
) => peopleRead<Page<Deduction>>(`/api/advances/deductions?${query(params)}`);
export const requestAdvance = (body: {
  amountPaise: number;
  requestedForPeriod: string;
  reason: string;
}) =>
  peopleMutation(
    '/api/advances',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    ['/api/advances'],
  );
export const approveAdvance = (
  id: string,
  body: { approvedAmountPaise: number; approvalNote?: string },
) =>
  peopleMutation(
    `/api/advances/${id}/approve`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    ['/api/advances'],
  );
export const rejectAdvance = (id: string, rejectionReason: string) =>
  peopleMutation(
    `/api/advances/${id}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ rejectionReason }),
    },
    ['/api/advances'],
  );
export const createManualAdvance = (body: {
  employeeId: string;
  amountPaise: number;
  requestedForPeriod: string;
  reason: string;
}) =>
  peopleMutation(
    '/api/advances/manual',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    ['/api/advances'],
  );
export const createDeduction = (
  id: string,
  body: { payrollPeriod: string; scheduledAmountPaise: number },
) =>
  peopleMutation(
    `/api/advances/${id}/deductions`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    ['/api/advances/deductions'],
  );
export const downloadApprovedAdvances = (
  params: Record<string, string | number | undefined>,
  format: 'csv' | 'xlsx',
) =>
  peopleDownload(
    `/api/advances/deductions/export?${query({ ...params, status: 'approved', view: 'approved', format })}`,
  );

export const downloadDeductions = (
  params: Record<string, string | number | undefined>,
  format: 'csv' | 'xlsx',
) => peopleDownload(`/api/advances/deductions/export?${query({ ...params, format })}`);
