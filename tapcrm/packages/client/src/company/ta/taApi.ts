import { peopleDownload, peopleMutation, peopleRead } from '../api/client.js';

export interface TaAssignment {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  departmentId: string;
  departmentName: string;
  taMonth: string;
  dailyAmountPaise: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'active' | 'inactive';
  remarks: string | null;
}
export interface TaReportRow {
  assignmentId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  departmentId: string;
  departmentName: string;
  teamName: string | null;
  positionName: string | null;
  taMonth: string;
  dailyAmountPaise: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  assignmentStatus: 'active' | 'inactive';
  statementId: string | null;
  status: 'draft' | 'sent';
  presentDays: string;
  halfDays: string;
  absentDays: string;
  leaveDays: string;
  holidayDays: string;
  eligibleDays: string;
  calculatedAmountPaise: string;
  recalculatedAt: string | null;
  sentAt: string | null;
  sentByName: string | null;
}

const query = (input: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return params.toString();
};

export function listAssignments(): Promise<{ assignments: TaAssignment[] }> {
  return peopleRead('/api/ta/assignments');
}
export function createAssignment(input: Record<string, unknown>): Promise<TaAssignment> {
  return peopleMutation(
    '/api/ta/assignments',
    { method: 'POST', body: JSON.stringify(input) },
    ['/api/ta'],
  );
}
export function setAssignmentStatus(
  id: string,
  status: 'active' | 'inactive',
): Promise<null> {
  return peopleMutation(
    `/api/ta/assignments/${id}/${status === 'active' ? 'reactivate' : 'deactivate'}`,
    { method: 'POST' },
    ['/api/ta'],
  );
}
export function listTaReport(
  params: Record<string, string | number | undefined>,
): Promise<{ rows: TaReportRow[]; total: number; page: number; pageSize: number }> {
  return peopleRead(`/api/ta/report?${query(params)}`);
}
export function recalculateTa(
  taMonth: string,
  assignmentIds: string[],
): Promise<{ recalculated: number }> {
  return peopleMutation(
    '/api/ta/statements/recalculate',
    { method: 'POST', body: JSON.stringify({ taMonth, assignmentIds }) },
    ['/api/ta'],
  );
}
export function sendTaStatements(statementIds: string[]): Promise<{ sent: number }> {
  return peopleMutation(
    '/api/ta/statements/send',
    { method: 'POST', body: JSON.stringify({ statementIds }) },
    ['/api/ta'],
  );
}
export function listMyTa(taMonth: string): Promise<{
  statements: Array<Record<string, string | null>>;
  days: Array<{
    workDate: string;
    status: string | null;
    presentUnits: number;
    eligibleUnits: string;
    dailyAmountPaise: string | null;
  }>;
}> {
  return peopleRead(`/api/ta/my?${query({ taMonth })}`);
}
export function downloadTaReport(
  params: Record<string, string | number | undefined>,
  format: 'csv' | 'xlsx',
): Promise<Blob> {
  return peopleDownload(`/api/ta/export?${query({ ...params, format })}`);
}
