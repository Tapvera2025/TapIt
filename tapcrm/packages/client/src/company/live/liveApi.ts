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
  graceMinutes?: number | null;
  arrivalAt?: string | null;
  departureAt?: string | null;
  lateMinutes?: number | null;
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

export type PunchKind = 'in' | 'out' | 'break-start' | 'break-end';

export interface PunchResult {
  eventId: string;
  workDate: DateOnly;
  replayed: boolean;
}

/** Best-effort browser location for a punch; never blocks the punch itself. */
function currentLocation(): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: Math.round(position.coords.accuracy),
        });
      },
      () => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 3500 },
    );
  });
}

/** POST /api/status/punch — the server stamps the time; ours is evidence only. */
export async function punch(kind: PunchKind): Promise<PunchResult> {
  const location = await currentLocation();
  return identityRequest<PunchResult>('/api/status/punch', {
    method: 'POST',
    body: JSON.stringify({
      kind,
      clientEventId: crypto.randomUUID(),
      clientTime: new Date().toISOString(),
      ...(location ? { location } : {}),
    }),
  });
}
