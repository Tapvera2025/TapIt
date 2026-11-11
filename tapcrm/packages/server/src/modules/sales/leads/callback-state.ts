import type { CallbackStatus } from './types.js';

const TRANSITIONS: Record<CallbackStatus, readonly CallbackStatus[]> = {
  pending: ['completed', 'rescheduled', 'not_reachable', 'missed', 'cancelled'],
  completed: [],
  rescheduled: [],
  not_reachable: [],
  missed: [],
  cancelled: [],
};

export function isValidCallbackTransition(from: CallbackStatus, to: CallbackStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** A minute of slack lets someone book the current minute. */
const PAST_GRACE_MS = 60_000;

/** A callback can only be booked or moved to a time that has not passed. */
export function isBookableCallbackTime(scheduledAt: Date, now: Date = new Date()): boolean {
  return scheduledAt.getTime() >= now.getTime() - PAST_GRACE_MS;
}
