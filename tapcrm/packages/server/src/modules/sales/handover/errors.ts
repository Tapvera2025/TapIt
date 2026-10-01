import { ApplicationError } from '../../../errors.js';

export const HANDOVER_ERROR_CODES = { NOT_FOUND: 'HANDOVER_NOT_FOUND', INVALID: 'HANDOVER_INVALID', UNAVAILABLE: 'HANDOVER_TARGET_UNAVAILABLE', FINALIZED: 'HANDOVER_FINALIZED' } as const;
export class HandoverNotFoundError extends ApplicationError { constructor() { super('Handover not found', 404, HANDOVER_ERROR_CODES.NOT_FOUND); } }
export class HandoverConflictError extends ApplicationError { constructor(code: string, message: string) { super(message, 409, code); } }
