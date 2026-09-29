import { definePeopleChannel } from '../../platform/realtime/server.js';

/**
 * The `status` people channel (LS-8, RT-5). Rooms are computed by
 * `rooms.ts` from the caller's scope on `attendance:view-live`; the
 * projector's routing subject (current `app_user` placement) picks the
 * rooms the emit lands in. The client payload is minimal: `{ userId }`
 * (RT-4). A viewer that wants the row refetches `/api/attendance/live`.
 */
export const STATUS_CHANNEL = 'status';

export function registerStatusChannel(): void {
  definePeopleChannel({
    name: STATUS_CHANNEL,
    action: 'attendance:view-live',
  });
}
