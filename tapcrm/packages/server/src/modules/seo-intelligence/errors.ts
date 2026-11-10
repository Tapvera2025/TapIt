import { ApplicationError } from '../../errors.js';

export class SeoSiteNotFoundError extends Error {
  constructor() { super('SEO site not found or not accessible.'); }
}
export class SeoScanNotFoundError extends Error {
  constructor() { super('Scan run not found or not accessible.'); }
}
export class SeoFindingNotFoundError extends Error {
  constructor() { super('SEO finding not found.'); }
}
export class SeoSiteValidationError extends ApplicationError {
  constructor(message: string) { super(message, 422, 'SEO_SITE_VALIDATION_FAILED'); }
}
export class SeoScanValidationError extends Error {
  constructor(message: string) { super(message); }
}
export class SeoProviderQuotaError extends Error {
  constructor(provider: string) { super(`Provider "${provider}" quota exhausted.`); }
}
export class SeoScopeError extends Error {
  constructor(message: string) { super(message); }
}
