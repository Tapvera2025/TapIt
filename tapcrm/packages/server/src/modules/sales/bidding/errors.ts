import { ApplicationError } from '../../../errors.js';

export const BID_POOL_ERROR_CODES = {
  ALREADY_CLAIMED: 'ALREADY_CLAIMED',
  INVALID_STATE: 'BID_POOL_INVALID_STATE',
  LEAD_NOT_FOUND: 'BID_POOL_LEAD_NOT_FOUND',
} as const;

export class BidPoolAlreadyClaimedError extends ApplicationError {
  constructor(
    public readonly leadId: string,
    public readonly claimedByUserId: string | null,
  ) {
    super(`bid pool: lead ${leadId} already claimed`, 409, BID_POOL_ERROR_CODES.ALREADY_CLAIMED, {
      leadId,
      claimedByUserId,
    });
    this.name = 'BidPoolAlreadyClaimedError';
  }
}

export class BidPoolInvalidStateError extends ApplicationError {
  constructor(
    public readonly leadId: string,
    public readonly state: string,
  ) {
    super(
      `bid pool: lead ${leadId} is in state '${state}', expected 'pool_open'`,
      409,
      BID_POOL_ERROR_CODES.INVALID_STATE,
      { leadId, state },
    );
    this.name = 'BidPoolInvalidStateError';
  }
}

export class BidPoolLeadNotFoundError extends ApplicationError {
  constructor(public readonly leadId: string) {
    super(`bid pool: lead ${leadId} not found`, 404, BID_POOL_ERROR_CODES.LEAD_NOT_FOUND, {
      leadId,
    });
    this.name = 'BidPoolLeadNotFoundError';
  }
}
