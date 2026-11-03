import { ApplicationError } from '../../../errors.js';
export class BillingTermsValidationError extends ApplicationError { constructor(message:string){super(message,422,'BILLING_TERMS_VALIDATION_FAILED');this.name='BillingTermsValidationError';} }
export class BillingTermsNotFoundError extends ApplicationError { constructor(message='Commercial record not found.'){super(message,404,'BILLING_TERMS_NOT_FOUND');this.name='BillingTermsNotFoundError';} }
