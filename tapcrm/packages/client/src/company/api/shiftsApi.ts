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
