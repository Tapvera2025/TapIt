export {
  getEmployeeVerification,
  initializeEmployeeVerification,
  uploadVerificationDocument,
  getVerificationDocumentDownloadUrl,
  withdrawPendingVerificationDocument,
  approveVerificationDocument,
  rejectVerificationDocument,
  completeEmployeeVerification,
  rejectEmployeeVerification,
} from './service.js';

export { registerVerificationRoutes } from './routes.js';

/** Employee profile completion (employee module) reads the current documents of many people at once. */
export { listCurrentDocumentsForEmployees } from './repository.js';

export {
  REQUIRED_VERIFICATION_DOCUMENTS,
  PREVIOUS_EMPLOYMENT_DOCUMENTS,
  requiredVerificationDocuments,
  VERIFICATION_DOCUMENT_TYPES,
  VERIFICATION_STATUSES,
  DOCUMENT_STATUSES,
  type VerificationDocumentType,
  type VerificationStatus,
  type DocumentStatus,
  type EmployeeVerificationRecord,
  type EmployeeVerificationDocumentRecord,
  type VerificationDetailsResponse,
  type VerificationDocumentSummary,
} from './types.js';

export {
  VerificationNotFoundError,
  VerificationValidationError,
} from './errors.js';
