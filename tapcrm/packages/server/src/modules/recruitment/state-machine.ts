import { PlatformValidationError } from '../../platform/errors.js';
import type {
  Candidate,
  CandidateStatus,
  Interview,
  InterviewStatus,
  JoiningStatus,
  OfferStatus,
  RequisitionStatus,
} from './types.js';

export const VALID_INTERVIEW_TRANSITIONS: Record<InterviewStatus, readonly InterviewStatus[]> = {
  scheduled: ['completed', 'cancelled', 'rescheduled', 'no_show'],
  completed: [],
  cancelled: [],
  rescheduled: [],
  no_show: [],
};

export const VALID_CANDIDATE_TRANSITIONS: Record<CandidateStatus, readonly CandidateStatus[]> = {
  applied: ['screening', 'interview', 'rejected', 'withdrawn'],
  screening: ['interview', 'rejected', 'withdrawn'],
  interview: ['selected', 'rejected', 'withdrawn'],
  selected: ['rejected', 'withdrawn'],
  rejected: [],
  withdrawn: [],
};

export const VALID_REQUISITION_TRANSITIONS: Record<RequisitionStatus, readonly RequisitionStatus[]> = {
  draft: ['open', 'cancelled'],
  open: ['on_hold', 'filled', 'closed', 'cancelled'],
  on_hold: ['open', 'closed', 'cancelled'],
  filled: [],
  closed: [],
  cancelled: [],
};

export const VALID_OFFER_TRANSITIONS: Record<OfferStatus, readonly OfferStatus[]> = {
  draft: ['sent', 'withdrawn'],
  sent: ['accepted', 'rejected', 'expired', 'withdrawn'],
  accepted: [],
  rejected: [],
  expired: [],
  withdrawn: [],
};

export const VALID_JOINING_TRANSITIONS: Record<JoiningStatus, readonly JoiningStatus[]> = {
  pending: ['confirmed', 'joined', 'cancelled'],
  confirmed: ['joined', 'cancelled'],
  joined: [],
  cancelled: [],
};

export const ELIGIBLE_INTERVIEW_DECISION_STATES: readonly InterviewStatus[] = ['completed'];

export function assertValidInterviewTransition(
  current: InterviewStatus,
  target: InterviewStatus,
): void {
  if (current === target) return;
  const allowed = VALID_INTERVIEW_TRANSITIONS[current] ?? [];
  if (!allowed.includes(target)) {
    throw new PlatformValidationError(
      `Invalid interview status transition (${current} -> ${target}). Allowed transitions: [${allowed.join(', ')}]`,
    );
  }
}

export function assertValidCandidateTransition(
  current: CandidateStatus,
  target: CandidateStatus,
): void {
  if (current === target) return;
  const allowed = VALID_CANDIDATE_TRANSITIONS[current] ?? [];
  if (!allowed.includes(target)) {
    throw new PlatformValidationError(
      `Invalid candidate status transition (${current} -> ${target}). Allowed transitions: [${allowed.join(', ')}]`,
    );
  }
}

export function assertValidRequisitionTransition(
  current: RequisitionStatus,
  target: RequisitionStatus,
): void {
  if (current === target) return;
  const allowed = VALID_REQUISITION_TRANSITIONS[current] ?? [];
  if (!allowed.includes(target)) {
    throw new PlatformValidationError(
      `Invalid requisition status transition (${current} -> ${target}). Allowed transitions: [${allowed.join(', ')}]`,
    );
  }
}

export function assertValidOfferTransition(
  current: OfferStatus,
  target: OfferStatus,
): void {
  if (current === target) return;
  const allowed = VALID_OFFER_TRANSITIONS[current] ?? [];
  if (!allowed.includes(target)) {
    throw new PlatformValidationError(
      `Invalid offer status transition (${current} -> ${target}). Allowed transitions: [${allowed.join(', ')}]`,
    );
  }
}

export function assertValidJoiningTransition(
  current: JoiningStatus,
  target: JoiningStatus,
): void {
  if (current === target) return;
  const allowed = VALID_JOINING_TRANSITIONS[current] ?? [];
  if (!allowed.includes(target)) {
    throw new PlatformValidationError(
      `Invalid candidate joining status transition (${current} -> ${target}). Allowed transitions: [${allowed.join(', ')}]`,
    );
  }
}

export function assertInterviewDecisionEligible(
  interview: Interview,
  candidate: Candidate,
): void {
  if (!ELIGIBLE_INTERVIEW_DECISION_STATES.includes(interview.status)) {
    throw new PlatformValidationError(
      `Cannot record interview decision: interview is in '${interview.status}' state (must be completed)`,
    );
  }

  if (candidate.status === 'selected' || candidate.status === 'rejected') {
    throw new PlatformValidationError(
      `Cannot record interview decision: decision has already been recorded for this candidate (current status: '${candidate.status}')`,
    );
  }

  if (candidate.status !== 'interview') {
    throw new PlatformValidationError(
      `Cannot record interview decision: candidate is in '${candidate.status}' state (must be in interview stage)`,
    );
  }
}
