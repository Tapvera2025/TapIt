import { peopleRead, peopleMutation } from './client.js';

export interface LeaveTypeDto {
  id: string;
  code: string;
  name: string;
  kind: 'absence' | 'attendance-mode';
  accrualDays: number;
  enforcement: boolean;
  paidLeave: boolean;
  isActive: boolean;
}

export interface LeaveRequestSummary {
  id: string;
  userId: string;
  userFullName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  kind: 'absence' | 'attendance-mode';
  fromDate: string;
  toDate: string;
  fromHalf: 'full' | 'first' | 'second';
  toHalf: 'full' | 'first' | 'second';
  daysConsumed: number;
  reason: string;
  status: 'pending' | 'acknowledged' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string;
  acknowledgedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface LeaveBalanceDto {
  leaveTypeId: string;
  leaveTypeName: string;
  opening: number;
  accrued: number;
  consumed: number;
  available: number;
}

export function listLeaveTypes(): Promise<LeaveTypeDto[]> {
  return peopleRead<LeaveTypeDto[]>('/api/leaves/types', { staleMs: 120_000 });
}

export function listLeaves(params?: {
  userId?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<LeaveRequestSummary[]> {
  const q = new URLSearchParams();
  if (params?.userId) q.set('userId', params.userId);
  if (params?.status) q.set('status', params.status);
  if (params?.fromDate) q.set('fromDate', params.fromDate);
  if (params?.toDate) q.set('toDate', params.toDate);
  const qs = q.toString();
  return peopleRead<LeaveRequestSummary[]>(`/api/leaves${qs ? `?${qs}` : ''}`, { staleMs: 30_000 });
}

export function getLeaveBalances(userId: string, year: number): Promise<LeaveBalanceDto[]> {
  return peopleRead<LeaveBalanceDto[]>(`/api/leaves/balances/${encodeURIComponent(userId)}?year=${year}`, { staleMs: 60_000 });
}

export function submitLeave(body: {
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  fromHalf: 'full' | 'first' | 'second';
  toHalf: 'full' | 'first' | 'second';
  reason: string;
}): Promise<LeaveRequestSummary> {
  return peopleMutation('/api/leaves', { method: 'POST', body: JSON.stringify(body) }, ['/api/leaves']);
}

export function cancelLeave(id: string): Promise<void> {
  return peopleMutation(`/api/leaves/${encodeURIComponent(id)}`, { method: 'DELETE' }, ['/api/leaves']);
}

export function decideLeave(id: string, body: {
  decision: 'approved' | 'rejected' | 'revoked';
  decisionNote?: string;
}): Promise<void> {
  return peopleMutation(
    `/api/leaves/${encodeURIComponent(id)}/decide`,
    { method: 'POST', body: JSON.stringify(body) },
    ['/api/leaves'],
  );
}

export function acknowledgeLeave(id: string): Promise<void> {
  return peopleMutation(
    `/api/leaves/${encodeURIComponent(id)}/acknowledge`,
    { method: 'POST', body: '{}' },
    ['/api/leaves'],
  );
}

export interface LeaveCalendarEvent {
  date: string;
  kind: 'absence' | 'attendance-mode';
  status: 'pending' | 'acknowledged' | 'approved' | 'rejected' | 'cancelled';
  leaveTypeName: string;
  requestId: string;
}

export function getLeaveCalendar(year: number, month: number): Promise<LeaveCalendarEvent[]> {
  return peopleRead<LeaveCalendarEvent[]>(`/api/leaves/calendar?year=${year}&month=${month}`, { staleMs: 60_000 });
}
