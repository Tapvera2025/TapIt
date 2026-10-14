import { identityRequest } from '../../identity/api/authApi.js';
import { peopleRead, peopleMutation } from './client.js';

export interface ShiftTemplate {
  id: string;
  code: string;
  name: string;
  kind: 'fixed' | 'flexible';
  status: 'active' | 'inactive';
  versionId: string | null;
  effectiveFrom: string | null;
  startTime: string | null;
  endTime: string | null;
  graceMinutes: number | null;
  fullDayMinutes: number | null;
  halfDayMinutes: number | null;
}

export interface ShiftAssignment {
  userId: string;
  shiftId: string | null;
  shiftCode: string | null;
  shiftName: string | null;
  source: string;
  effectiveFrom: string | null;
}

export function listShifts(): Promise<ShiftTemplate[]> {
  return peopleRead<ShiftTemplate[]>('/api/shifts', { staleMs: 60_000 });
}

export function createShift(body: {
  code: string;
  name: string;
  kind: 'fixed' | 'flexible';
  version: {
    effectiveFrom?: string;
    startTime?: string;
    endTime?: string;
    graceMinutes?: number;
    fullDayMinutes?: number;
    halfDayMinutes?: number;
  };
}): Promise<{ id: string; effectiveFrom: string }> {
  return peopleMutation('/api/shifts', { method: 'POST', body: JSON.stringify(body) }, ['/api/shifts']);
}

export function getMyShiftAssignment(signal?: AbortSignal): Promise<ShiftAssignment[]> {
  return identityRequest<ShiftAssignment[]>('/api/shifts/assignments', { signal: signal ?? null });
}

export interface EmployeeShiftDay {
  date: string;
  shiftId: string | null;
  kind: 'fixed' | 'flexible' | 'none';
  source: string;
}

export function getEmployeeShift(userId: string): Promise<{ userId: string; days: EmployeeShiftDay[] }> {
  return peopleRead(`/api/shifts/assignments?userId=${encodeURIComponent(userId)}`, { staleMs: 0 });
}

export function assignShiftToEmployee(body: {
  kind: 'template';
  userId: string;
  shiftId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}): Promise<{ id: string; rotationId: string | null }> {
  return peopleMutation('/api/shifts/assignments', { method: 'POST', body: JSON.stringify(body) }, [
    '/api/shifts/assignments',
  ]);
}

export interface WeekdaySchedule {
  id: string;
  name: string;
  workingWeekdays: number[];
  status: 'active' | 'inactive';
  createdAt: string;
}

export function listWeekdaySchedules(): Promise<WeekdaySchedule[]> {
  return peopleRead<WeekdaySchedule[]>('/api/shifts/weekday-schedules', { staleMs: 0 });
}

export interface WeekdayScheduleAssignment {
  scheduleId: string;
  scheduleName: string;
  workingWeekdays: number[];
  effectiveFrom: string;
  effectiveTo: string | null;
}

export function getEmployeeWeekdaySchedule(userId: string): Promise<WeekdayScheduleAssignment | null> {
  return peopleRead<WeekdayScheduleAssignment | null>(
    `/api/shifts/weekday-schedules/assignments?userId=${encodeURIComponent(userId)}`,
    { staleMs: 0 },
  );
}

export function createWeekdaySchedule(body: {
  name: string;
  workingWeekdays: number[];
}): Promise<WeekdaySchedule> {
  return peopleMutation<WeekdaySchedule>(
    '/api/shifts/weekday-schedules',
    { method: 'POST', body: JSON.stringify(body) },
    ['/api/shifts/weekday-schedules'],
  );
}

export function setWeekdayScheduleStatus(
  id: string,
  status: WeekdaySchedule['status'],
): Promise<WeekdaySchedule> {
  return peopleMutation<WeekdaySchedule>(
    `/api/shifts/weekday-schedules/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
    ['/api/shifts/weekday-schedules'],
  );
}

export interface WorkingDayException {
  id: string;
  exceptionDate: string;
  reason: string;
  status: 'active' | 'inactive';
  createdAt: string;
  departmentIds: string[];
  departmentNames: string[];
}

export interface WorkingDayExceptionPage {
  items: WorkingDayException[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function listWorkingDayExceptions(page = 1, pageSize = 10): Promise<WorkingDayExceptionPage> {
  return peopleRead<WorkingDayExceptionPage>(
    `/api/shifts/weekday-schedules/exceptions?page=${page}&pageSize=${pageSize}`,
    { staleMs: 0 },
  );
}

export function createWorkingDayException(body: {
  exceptionDate: string;
  reason: string;
  scope: { type: 'organization'; departmentIds: [] } | { type: 'departments'; departmentIds: string[] };
}): Promise<{ id: string }> {
  return peopleMutation<WorkingDayException>(
    '/api/shifts/weekday-schedules/exceptions',
    { method: 'POST', body: JSON.stringify(body) },
    ['/api/shifts/weekday-schedules/exceptions'],
  );
}

export function setWorkingDayExceptionStatus(
  id: string,
  status: WorkingDayException['status'],
): Promise<{ id: string; status: WorkingDayException['status'] }> {
  return peopleMutation(
    `/api/shifts/weekday-schedules/exceptions/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
    ['/api/shifts/weekday-schedules/exceptions'],
  );
}
