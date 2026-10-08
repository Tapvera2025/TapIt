import { identityDownload, identityRequest, IdentityApiError } from '../../identity/api/authApi.js';

export function attendanceErrorMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof IdentityApiError)) return cause instanceof Error ? cause.message : fallback;
  if (cause.status >= 500) return `${fallback} Please try again. If the problem continues, contact your administrator.`;
  if (cause.status === 422 || cause.status === 400) return cause.message;
  if (cause.status === 403) return 'You do not have permission to view this attendance data.';
  if (cause.status === 404) return 'The requested attendance data was not found.';
  return cause.message || fallback;
}

export interface AttendanceReportEmployee {
  id: string;
  employeeId: string | null;
  fullName: string;
  email: string | null;
  departmentName: string | null;
  teamName: string | null;
  positionName: string | null;
  departmentId?: string | null;
  teamId?: string | null;
  positionId?: string | null;
  designationName?: string | null;
  specialization?: string | null;
}

export interface EmployeeWiseDay {
  date: string;
  status: string | null;
  dayType: string;
  units: { present: number; paidLeave: number; unpaidLeave: number; absent: number; holiday: number };
  minutes: { worked: number; break: number; late: number; overtime: number };
  arrivalAt: string | null;
  departureAt: string | null;
  isWfh: boolean;
  flags: string[];
  shift: { kind: string | null; start: string | null; end: string | null; source: string };
  recalculating: boolean;
}

export interface EmployeeWiseSummary {
  days: number;
  presentUnits: number;
  paidLeaveUnits: number;
  unpaidLeaveUnits: number;
  absentUnits: number;
  holidayUnits: number;
  workedMinutes: number;
  breakMinutes: number;
  lateDays: number;
  lateMinutes: number;
  overtimeMinutes: number;
  wfhDays: number;
  halfDays: number;
  staleDays: number;
}

export interface EmployeeWiseReport {
  employee: AttendanceReportEmployee;
  month: string;
  summary: EmployeeWiseSummary | null;
  records: EmployeeWiseDay[];
}

export function searchAttendanceReportEmployees(search: string, signal?: AbortSignal): Promise<AttendanceReportEmployee[]> {
  const params = new URLSearchParams({ search, limit: '25' });
  return identityRequest(`/api/attendance/reports/employees?${params}`, { signal: signal ?? null });
}

export function getEmployeeWiseReport(userId: string, month: string, year: number, signal?: AbortSignal): Promise<EmployeeWiseReport> {
  const params = new URLSearchParams({ month, year: String(year) });
  return identityRequest(`/api/attendance/reports/employee/${encodeURIComponent(userId)}?${params}`, { signal: signal ?? null });
}

export interface MonthlyAttendanceRow {
  id: string;
  employeeId: string | null;
  fullName: string;
  email: string | null;
  departmentName: string | null;
  teamName: string | null;
  positionName: string | null;
  designationName: string | null;
  shift: { kind: string | null; start: string | null; end: string | null; source: string } | null;
  presentUnits: number;
  paidLeaveUnits: number;
  unpaidLeaveUnits: number;
  absentUnits: number;
  holidayUnits: number;
  workedMinutes: number;
  breakMinutes: number;
  lateDays: number;
  lateMinutes: number;
  overtimeMinutes: number;
  wfhDays: number;
  records: Array<{
    date: string;
    status: string | null;
    dayType: string;
    isWfh: boolean;
    arrivalAt: string | null;
    departureAt: string | null;
    workedMinutes: number;
    breakMinutes: number;
    lateMinutes: number;
    overtimeMinutes: number;
    shift: unknown;
    shiftSource: string;
    flags: string[];
  }>;
}

export function getMonthlyAttendanceReport(query: Record<string, string>, signal?: AbortSignal): Promise<{ month: string; rows: MonthlyAttendanceRow[]; page: number; pageSize: number; total: number; totalPages: number }> {
  const params = new URLSearchParams(query);
  return identityRequest(`/api/attendance/reports/monthly?${params}`, { signal: signal ?? null });
}

export interface DailyAttendanceRow {
  id: string;
  employeeId: string | null;
  fullName: string;
  departmentName: string | null;
  teamName: string | null;
  positionName: string | null;
  designationName: string | null;
  status: string | null;
  dayType: string | null;
  arrivalAt: string | null;
  departureAt: string | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  isWfh: boolean;
  flags: string[];
  shift: { kind: string | null; start: string | null; end: string | null; graceMinutes: number | null; source: string } | null;
}

export function getDailyAttendanceReport(query: Record<string, string>, signal?: AbortSignal): Promise<{ date: string; rows: DailyAttendanceRow[]; page: number; pageSize: number; total: number; totalPages: number }> {
  const params = new URLSearchParams(query);
  return identityRequest(`/api/attendance/reports/daily?${params}`, { signal: signal ?? null });
}

export function requestDailyAttendanceExport(query: Record<string, string>): Promise<Blob> {
  const params = new URLSearchParams(query);
  return identityDownload(`/api/attendance/reports/daily/export?${params}`, { method: 'POST' });
}

export function requestMonthlyAttendanceExport(query: Record<string, string>): Promise<Blob> {
  const params = new URLSearchParams(query);
  return identityDownload(`/api/attendance/reports/monthly/export?${params}`, { method: 'POST' });
}

export interface DailyLateRow {
  id: string;
  employeeId: string | null;
  fullName: string;
  departmentName: string | null;
  teamName: string | null;
  positionName: string | null;
  designationName: string | null;
  shift: { kind: string | null; start: string | null; end: string | null; graceMinutes: number | null; source: string };
  arrivalAt: string | null;
  lateMinutes: number;
  isWfh: boolean;
  flags: string[];
}

export function getDailyLateReport(query: Record<string, string>, signal?: AbortSignal): Promise<{ date: string; rows: DailyLateRow[]; page: number; pageSize: number; total: number; totalPages: number }> {
  const params = new URLSearchParams(query);
  return identityRequest(`/api/attendance/reports/late/daily?${params}`, { signal: signal ?? null });
}

export interface MonthlyLateRow {
  id: string;
  employeeId: string | null;
  fullName: string;
  departmentName: string | null;
  teamName: string | null;
  positionName: string | null;
  designationName: string | null;
  lateDays: number;
  lateMinutes: number;
  averageLateMinutes: number;
  maximumLateMinutes: number;
}

export function getMonthlyLateReport(query: Record<string, string>, signal?: AbortSignal): Promise<{ month: string; rows: MonthlyLateRow[]; page: number; pageSize: number; total: number; totalPages: number }> {
  const params = new URLSearchParams(query);
  return identityRequest(`/api/attendance/reports/late/monthly?${params}`, { signal: signal ?? null });
}

export function requestDailyLateExport(query: Record<string, string>): Promise<Blob> {
  const params = new URLSearchParams(query);
  return identityDownload(`/api/attendance/reports/late/daily/export?${params}`, { method: 'POST' });
}

export function requestMonthlyLateExport(query: Record<string, string>): Promise<Blob> {
  const params = new URLSearchParams(query);
  return identityDownload(`/api/attendance/reports/late/monthly/export?${params}`, { method: 'POST' });
}

/** Shapes returned by the registered attendance routes. Status and minutes are stored server answers. */
export interface AttendanceDayView {
  userId: string;
  employeeId: string | null;
  workDate: string;
  state: 'open' | 'closed';
  status: string | null;
  dayType: string;
  units: { present: number; paidLeave: number; unpaidLeave: number; absent: number; holiday: number };
  minutes: { worked: number; break: number; late: number; earlyExit: number; overtime: number; night: number };
  arrivalAt: string | null;
  departureAt: string | null;
  isWfh: boolean;
  flags: string[];
  shift: { shiftId: string | null; source: string; kind: string | null; start: string | null; end: string | null };
  recalculating: boolean;
}

export interface AttendanceEventView {
  id: string;
  kind: string;
  at?: string;
  occurredAt?: string;
  source: string;
  evidence?: string;
  assignmentReason?: string;
  isVoid?: boolean;
  supersededBy?: string | null;
}

export interface AttendanceOverlayView {
  id: string;
  kind: string;
  paid: boolean | null;
  consequence: string | null;
  minutes: number | null;
  sourceKind: string;
  sourceId: string;
}

export interface AttendanceDayDetail {
  date: string;
  userId: string;
  record: {
    id: string;
    state: 'open' | 'closed';
    status: string | null;
    dayType: string;
    shift: {
      kind?: string;
      source?: string;
      start?: string | null;
      end?: string | null;
      isOvernight?: boolean;
      timezone?: string;
    } | null;
    shiftSource: string;
    placement: { departmentId: string | null; teamId: string | null; positionId: string | null };
    window: { start: string; end: string; closeDueAt: string };
    minutes: AttendanceDayView['minutes'];
    units: AttendanceDayView['units'];
    arrivalAt: string | null;
    departureAt: string | null;
    isWfh: boolean;
    flags: string[];
    attributionFlags: string[];
    inputVersion: number;
    calculationVersion: number;
    calculatedAt: string | null;
    closedAt: string | null;
    closedBy: string | null;
  };
  events: { effective: AttendanceEventView[]; superseded: AttendanceEventView[] };
  overlays: AttendanceOverlayView[];
  corrections: unknown[];
  /** Decorated by the server after subject visibility and A1 checks. */
  allowedActions?: { requestCorrection?: boolean };
}

export type CorrectionRequest =
  | { workDate: string; reason: string; kind: 'add-event'; payload: { kind: 'in' | 'out' | 'break-start' | 'break-end'; at: string } }
  | { workDate: string; reason: string; kind: 'replace-event'; payload: { targetEventId: string; kind: 'in' | 'out' | 'break-start' | 'break-end'; at: string } }
  | { workDate: string; reason: string; kind: 'void-event'; payload: { targetEventId: string } };

export interface AttendanceExportStatus {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  from: string;
  to: string;
  rowCount: number | null;
  errorMessage: string | null;
  downloadUrl: string | null;
}

export async function getAttendanceDays(
  from: string,
  to: string,
  userId: string,
  signal?: AbortSignal,
): Promise<AttendanceDayView[]> {
  const query = new URLSearchParams({ from, to, userId });
  const result = await identityRequest<{ records: AttendanceDayView[] }>(`/api/attendance?${query}`, { signal: signal ?? null });
  return result.records;
}

export function getAttendanceDayDetail(userId: string, date: string, signal?: AbortSignal): Promise<AttendanceDayDetail> {
  return identityRequest<AttendanceDayDetail>(
    `/api/attendance/${encodeURIComponent(userId)}/${encodeURIComponent(date)}`,
    { signal: signal ?? null },
  );
}

export function requestAttendanceCorrection(body: CorrectionRequest): Promise<{ correctionId: string }> {
  return identityRequest('/api/attendance/corrections/request', {
    method: 'POST', body: JSON.stringify(body),
  });
}

export function requestAttendanceExport(from: string, to: string, userId: string): Promise<{ jobId: string; status: 'queued' }> {
  return identityRequest('/api/attendance/export', {
    method: 'POST', body: JSON.stringify({ from, to, userIds: [userId] }),
  });
}

export function getAttendanceExportStatus(jobId: string): Promise<AttendanceExportStatus> {
  return identityRequest(`/api/attendance/exports/${encodeURIComponent(jobId)}`);
}

export interface CorrectionListItem {
  id: string;
  userId: string;
  userName: string;
  workDate: string;
  kind: 'add-event' | 'replace-event' | 'void-event' | 'confirm-as-is';
  payload: { kind?: string; at?: string; targetEventId?: string; reviewItemId?: string };
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  canDecide: boolean;
}

export function listCorrections(query: {
  status?: 'pending' | 'approved' | 'rejected' | 'all';
  mine?: boolean;
} = {}): Promise<{ corrections: CorrectionListItem[] }> {
  const params = new URLSearchParams();
  params.set('status', query.status ?? 'pending');
  if (query.mine) params.set('mine', 'true');
  return identityRequest(`/api/attendance/corrections?${params.toString()}`);
}

export function approveCorrection(id: string, decisionNote?: string): Promise<{ correctionId: string }> {
  return identityRequest(`/api/attendance/corrections/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: JSON.stringify(decisionNote ? { decisionNote } : {}),
  });
}

export function rejectCorrection(id: string, decisionNote?: string): Promise<{ correctionId: string }> {
  return identityRequest(`/api/attendance/corrections/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify(decisionNote ? { decisionNote } : {}),
  });
}
