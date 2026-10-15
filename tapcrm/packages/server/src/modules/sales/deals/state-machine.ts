/**
 * Sales v1.1 R2 — deal state transitions (R2 plan step 2.7).
 *
 * Pure predicates. The service layer calls `assertStageTransition` before
 * writing a stage change and `assertLifecycleTransition` before writing
 * a terminal state. Backwards stage transitions are permitted on
 * authority — the service checks the actor's `deals:edit` scope — but
 * the terminal `closed` stage is only reachable via the Won recorder
 * (step 2.14), which bypasses this helper.
 */

import { ApplicationError } from '../../../errors.js';
import {
  DEAL_LIFECYCLE_STATUSES,
  DEAL_STAGES,
  type DealLifecycleStatus,
  type DealStage,
} from './types.js';

export const DEAL_ERROR_CODES = {
  INVALID_STAGE_TRANSITION: 'DEAL_INVALID_STAGE_TRANSITION',
  INVALID_LIFECYCLE_TRANSITION: 'DEAL_INVALID_LIFECYCLE_TRANSITION',
  ALREADY_TERMINAL: 'DEAL_ALREADY_TERMINAL',
  CLOSED_STAGE_RESERVED: 'DEAL_CLOSED_STAGE_RESERVED',
  LOSS_REASON_REQUIRED: 'DEAL_LOSS_REASON_REQUIRED',
  CANCEL_REQUIRES_WON: 'DEAL_CANCEL_REQUIRES_WON',
} as const;

export class DealStateError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 409, code, details);
    this.name = 'DealStateError';
  }
}

const FORWARD_STAGE_ORDER: readonly DealStage[] = ['discovery', 'proposal', 'negotiation', 'closing'];

/**
 * Legal stage transitions, excluding the terminal `closed` stage which
 * the Won recorder owns.
 *
 *   - forward moves one stage at a time (discovery → proposal etc.)
 *   - backwards moves to any earlier non-closed stage are allowed; the
 *     service enforces authority before calling us
 *   - the same stage is a no-op and allowed
 */
export function isLegalStageTransition(from: DealStage, to: DealStage): boolean {
  if (to === 'closed') return false;
  if (from === 'closed') return false;
  if (from === to) return true;
  const fromIdx = FORWARD_STAGE_ORDER.indexOf(from);
  const toIdx = FORWARD_STAGE_ORDER.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return false;
  if (toIdx === fromIdx + 1) return true;              // natural forward step
  if (toIdx < fromIdx) return true;                    // backwards (authorised)
  return false;                                        // forward skip
}

export function assertStageTransition(from: DealStage, to: DealStage): void {
  if (!DEAL_STAGES.includes(to)) {
    throw new DealStateError(DEAL_ERROR_CODES.INVALID_STAGE_TRANSITION, `Unknown stage: ${to}`);
  }
  if (to === 'closed') {
    throw new DealStateError(
      DEAL_ERROR_CODES.CLOSED_STAGE_RESERVED,
      'The "closed" stage is set by the Win Recorder only; call recordWin() instead.',
    );
  }
  if (!isLegalStageTransition(from, to)) {
    throw new DealStateError(
      DEAL_ERROR_CODES.INVALID_STAGE_TRANSITION,
      `Illegal stage transition: ${from} → ${to}`,
      { from, to },
    );
  }
}

/**
 * Lifecycle moves are terminal and mutually exclusive. open → won is
 * owned by the Won recorder; open → lost and open → cancelled land in
 * this module.
 */
export function assertLifecycleTransition(from: DealLifecycleStatus, to: DealLifecycleStatus): void {
  if (!DEAL_LIFECYCLE_STATUSES.includes(to)) {
    throw new DealStateError(DEAL_ERROR_CODES.INVALID_LIFECYCLE_TRANSITION, `Unknown lifecycle: ${to}`);
  }
  if (from !== 'open' && !(from === 'won' && to === 'cancelled')) {
    throw new DealStateError(
      DEAL_ERROR_CODES.ALREADY_TERMINAL,
      `Deal is already ${from}; terminal states are mutually exclusive.`,
      { from, to },
    );
  }
}
