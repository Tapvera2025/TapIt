/**
 * Sales v1.1 R2 — Delivery brief row types (R2 plan step 2.15).
 *
 * Materialised from migrations/0087_sales_delivery.sql. One brief per
 * deal (UNIQUE org/deal_id). The brief is the handoff artefact Sales
 * passes to Delivery; accepting the brief links it to a project via an
 * idempotent `project_id` write (R-DEL-04).
 */

export const DELIVERY_BRIEF_STATES = [
  'draft',
  'submitted',
  'changes_requested',
  'accepted',
  'cancelled',
] as const;
export type DeliveryBriefState = (typeof DELIVERY_BRIEF_STATES)[number];

/**
 * Free-form jsonb (R2 scope — a stricter schema per service type is a
 * R3 nice-to-have). Clients should populate the sections they care
 * about; nothing here is enforced at the DB layer.
 */
export interface DeliveryBriefContent {
  readonly customerContacts?: unknown;
  readonly agreedServices?: unknown;
  readonly deliverables?: unknown;
  readonly exclusions?: unknown;
  readonly promisedDates?: unknown;
  readonly dependencies?: unknown;
  readonly customerAssets?: unknown;
  readonly accessReadiness?: unknown;
  readonly outstandingQuestions?: unknown;
  readonly paymentReadiness?: unknown;
  readonly notes?: unknown;
  readonly [key: string]: unknown;
}

export interface DeliveryBrief {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly commercialsId: string;
  readonly state: DeliveryBriefState;
  readonly content: DeliveryBriefContent;
  readonly projectId: string | null;
  readonly submittedAt: Date | null;
  readonly reviewedAt: Date | null;
  readonly reviewedBy: string | null;
  readonly acceptedAt: Date | null;
  readonly acceptedBy: string | null;
  readonly cancelledAt: Date | null;
  readonly cancelledReason: string | null;
  readonly changeNotes: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
