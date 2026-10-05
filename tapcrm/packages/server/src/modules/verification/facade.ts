export {
  getEmployeeVerification,
  initializeEmployeeVerification,
  uploadVerificationDocument,
  getVerificationDocumentDownloadUrl,
  approveVerificationDocument,
  rejectVerificationDocument,
  completeEmployeeVerification,
  rejectEmployeeVerification,
} from './service.js';

export { registerVerificationRoutes } from './routes.js';

export {
  REQUIRED_VERIFICATION_DOCUMENTS,
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
