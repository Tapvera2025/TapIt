import { ApplicationError } from '../../errors.js';

export const LIVE_STATUS_ERROR_CODES = {
  PUNCH_NOT_ALLOWED: 'STATUS_PUNCH_NOT_ALLOWED',
} as const;

/** 422: the punch is well formed but not a move the person can make now. */
export class PunchNotAllowedError extends ApplicationError {
  constructor(message: string, details: { kind: string; allowedMoves: readonly string[] }) {
    super(message, 422, LIVE_STATUS_ERROR_CODES.PUNCH_NOT_ALLOWED, details);
    this.name = 'PunchNotAllowedError';
  }
}
