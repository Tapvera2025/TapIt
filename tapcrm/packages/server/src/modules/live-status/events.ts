/**
 * Live-status outbox events (LS-8, RT-4, RT-5).
 *
 * The projector writes `live-status.status-changed` inside the business
 * transaction; the drainer picks it up after commit and the registered
 * handler (in this module's boot) calls `emitAboutPerson` on the
 * Socket.IO adapter.
 *
 * The row carries only the person. The handler looks up the person's
 * placement when it delivers, not when the row was written, so a transfer
 * in between still reaches the new team's viewers (RT-5). The socket
 * receives exactly `{ userId }` (RT-4).
 */
export const LIVE_STATUS_EVENTS = {
  STATUS_CHANGED: 'live-status.status-changed',
} as const;

export interface StatusChanged {
  readonly userId: string;
}
