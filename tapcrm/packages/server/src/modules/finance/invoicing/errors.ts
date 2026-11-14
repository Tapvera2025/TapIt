import { ApplicationError } from '../../../errors.js';
export class InvoicingValidationError extends ApplicationError { constructor(message:string, code='INVOICING_VALIDATION_FAILED'){super(message,422,code);this.name='InvoicingValidationError';} }
export class InvoicingNotFoundError extends ApplicationError { constructor(message='Invoice record not found.'){super(message,404,'INVOICING_NOT_FOUND');this.name='InvoicingNotFoundError';} }
export class InvoicingConflictError extends ApplicationError { constructor(message:string, code='INVOICING_REVIEW_REQUIRED'){super(message,409,code);this.name='InvoicingConflictError';} }
