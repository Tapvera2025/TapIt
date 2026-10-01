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
