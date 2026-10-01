import { ApplicationError } from '../../../errors.js';
export const LEAD_ERROR_CODES = { NOT_FOUND: 'LEAD_NOT_FOUND', VALIDATION: 'LEAD_VALIDATION_ERROR', SOURCE_INVALID: 'LEAD_SOURCE_INVALID', CAMPAIGN_INVALID: 'LEAD_CAMPAIGN_INVALID', OWNER_INVALID: 'LEAD_OWNER_INVALID', HANDOVER_NOT_FOUND: 'HANDOVER_NOT_FOUND', HANDOVER_INVALID: 'HANDOVER_INVALID', HANDOVER_UNAVAILABLE: 'HANDOVER_TARGET_UNAVAILABLE', HANDOVER_FINALIZED: 'HANDOVER_FINALIZED' } as const;
export class LeadNotFoundError extends ApplicationError { constructor() { super('Lead not found', 404, LEAD_ERROR_CODES.NOT_FOUND); } }
export class LeadValidationError extends ApplicationError { constructor(code: string, message: string, details?: unknown) { super(message, 422, code, details); } }
export class HandoverNotFoundError extends ApplicationError { constructor() { super('Handover not found', 404, LEAD_ERROR_CODES.HANDOVER_NOT_FOUND); } }
export class HandoverConflictError extends ApplicationError { constructor(code: string, message: string) { super(message, 409, code); } }
