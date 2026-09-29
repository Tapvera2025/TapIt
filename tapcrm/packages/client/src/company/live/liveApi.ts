import type { DateOnly, PresenceState } from '@tapcrm/contracts';
import { identityRequest } from '../../identity/api/authApi.js';

export type LiveGroup =
  | 'working'
  | 'possiblyFinished'
  | 'onBreak'
  | 'finished'
  | 'notInDue'
  | 'notInNotYetDue'
  | 'onLeave'
  | 'onHoliday';

export interface LiveRow {
  id: string;
  userId: string;
  fullName: string;
  departmentId: string | null;
  departmentName: string | null;
  teamId: string | null;
  teamName: string | null;
  workDate: DateOnly;
  state: PresenceState;
  displayGroup: LiveGroup;
  since: string | null;
  lastEventAt: string | null;
  workedMinutes: number;
  breakMinutes: number;
  presenceConfidence: 'confirmed' | 'assumed';
  lastScanAt: string | null;
  likelyFinishedAt: string | null;
  isWfh: boolean;
  dayGroup: 'leave' | 'holiday' | null;
  shiftStartAt: string | null;
  shiftEndAt: string | null;
  updatedAt: string;
}

export interface LiveBoard {
  rows: LiveRow[];
  groups: Record<LiveGroup, number>;
  asOf?: string;
}

export interface TodayStatus {
  row: LiveRow | null;
  allowedMoves: readonly string[];
}

export function loadLiveBoard(signal?: AbortSignal): Promise<LiveBoard> {
  return identityRequest<LiveBoard>('/api/attendance/live', { signal: signal ?? null });
}

export function loadTodayStatus(signal?: AbortSignal): Promise<TodayStatus> {
  return identityRequest<TodayStatus>('/api/attendance/live?self=true', { signal: signal ?? null });
}
