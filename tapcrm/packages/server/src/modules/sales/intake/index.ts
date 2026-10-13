export { registerSalesIntakeJobs, intakeIngestJob, bidPoolExpireJob, metaReconcileJob, payloadCleanupJob } from './jobs.js';
export {
  ingest,
  IntakeConnectorInactiveError,
  IntakeConnectorNotFoundError,
} from './service.js';
export { validateIntake, type NormalizedContact, type ValidationResult } from './validator.js';
export {
  dedupeAndIdentify,
  type DedupeMode,
  type DedupeResult,
} from './dedupe.js';
export type {
  ConnectorKind,
  EntryMethod,
  IngestResult,
  IntakeMappedFields,
  IntakePayload,
  QuarantineReason,
  RejectReason,
  SubmissionOutcome,
} from './types.js';
