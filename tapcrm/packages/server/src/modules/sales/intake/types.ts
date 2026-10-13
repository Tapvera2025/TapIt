/**
 * Sales v1.1 — canonical intake types (PRD §6.2).
 *
 * Every external adapter normalises its provider payload into an
 * `IntakePayload` and calls `ingest()`. The service never looks at
 * provider-specific shapes.
 */

export type ConnectorKind = 'website' | 'meta' | 'email' | 'whatsapp' | 'gbp' | 'import' | 'partner';

export type EntryMethod = 'manual' | 'website' | 'provider_webhook' | 'provider_poll' | 'import' | 'partner_api';

export type SubmissionOutcome =
  | 'pending'
  | 'created'
  | 'linked_existing'
  | 'duplicate_delivery'
  | 'quarantined'
  | 'rejected'
  | 'failed_retryable';

export type QuarantineReason =
  | 'missing_contact'            // no phone and no email
  | 'ambiguous_phone'            // phone without country context and no default on connector
  | 'invalid_phone_format'
  | 'invalid_email_format'
  | 'missing_service'            // service_requested absent for a connector that requires it
  | 'unknown_mapping'            // mappedFields missing required canonical fields
  | 'opted_out'                  // contact exists and has opted out of all channels
  ;

export type RejectReason =
  | 'connector_not_found'
  | 'connector_inactive'
  | 'connector_tenant_mismatch'
  | 'test_lead_in_production';

export interface IntakeMappedFields {
  readonly contactName?: string | null;
  readonly phoneRaw?: string | null;
  readonly emailRaw?: string | null;
  readonly companyName?: string | null;
  readonly serviceRequested?: string | null;
  readonly location?: string | null;
  readonly budgetBracket?: string | null;
  readonly timeline?: string | null;
  readonly languagePreference?: string | null;
  readonly message?: string | null;
  readonly utm?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

export interface IntakePayload {
  readonly connectorId: string;
  readonly externalLeadId?: string | null;
  readonly externalFormId?: string | null;
  readonly providerSubmittedAt?: Date | null;
  readonly sourceReceivedAt?: Date;              // defaults to now()
  /**
   * Raw provider bytes (the exact webhook body). Stored encrypted on the
   * lead_submission row for 30 days (PRD R-INT-05). May be omitted for
   * sources where no raw bytes exist (manual entry).
   */
  readonly rawPayload?: Buffer | null;
  readonly mappedFields: IntakeMappedFields;
  readonly mappingVersion?: string;
  /** When true, the submission is marked and will not flow into production KPIs. */
  readonly isTest?: boolean;
}

export interface IngestResult {
  readonly outcome: SubmissionOutcome;
  readonly submissionId: string;
  readonly leadId?: string;
  readonly reason?: string;
}
