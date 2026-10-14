import { peopleDownload, peopleMutation, peopleRead } from '../../api/client.js';
import type { Decimal } from '@tapcrm/contracts';
import type { Penalty, PenaltyPage, PenaltyType, PayrollStatus } from '../types/index.js';

const query = (input: Record<string, string | number | undefined>): string => {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return params.toString();
};

export function listPenalties(
  params: Record<string, string | number | undefined> = {},
): Promise<PenaltyPage> {
  return peopleRead<PenaltyPage>(`/api/penalties?${query(params)}`);
}

export function listMyPenalties(
  params: Record<string, string | number | undefined> = {},
): Promise<PenaltyPage> {
  return peopleRead<PenaltyPage>(`/api/penalties/mine?${query(params)}`);
}

export function getPenalty(id: string): Promise<Penalty> {
  return peopleRead<Penalty>(`/api/penalties/${encodeURIComponent(id)}`);
}

export function getMyPenalty(id: string): Promise<Penalty> {
  return peopleRead<Penalty>(`/api/penalties/mine/${encodeURIComponent(id)}`);
}

export function createPenalty(input: {
  employeeId: string;
  penaltyType: PenaltyType;
  amountPaise: Decimal;
  penaltyDate: string;
  payrollPeriod: string;
  remarks: string;
}): Promise<Penalty> {
  return peopleMutation<Penalty>(
    '/api/penalties',
    { method: 'POST', body: JSON.stringify(input) },
    ['/api/penalties'],
  );
}

export function cancelPenalty(id: string, cancellationReason: string): Promise<null> {
  return peopleMutation<null>(
    `/api/penalties/${encodeURIComponent(id)}/cancel`,
    { method: 'POST', body: JSON.stringify({ cancellationReason }) },
    ['/api/penalties'],
  );
}

export function downloadPenalties(
  params: Record<string, string | number | undefined>,
  format: 'csv' | 'xlsx',
): Promise<Blob> {
  const values = query({ ...params, format });
  return peopleDownload(`/api/penalties/export?${values}`);
}

export type PenaltyPayrollFilter = PayrollStatus | 'all';
