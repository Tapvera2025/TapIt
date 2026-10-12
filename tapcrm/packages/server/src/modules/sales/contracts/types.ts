/**
 * Sales v1.1 R2 — Contract row types (R2 plan step 2.12).
 *
 * Materialised from migrations/0082_sales_contracts.sql. A contract pins
 * the exact commercials version it approves (R-CON-02). Signed rows are
 * read-only — material revisions after signing require an amendment that
 * supersedes the original via `supersedes_id`.
 */

export const CONTRACT_STATES = [
  'draft',
  'sent',
  'signed',
  'voided',
  'amended',
  'replaced',
] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];

export interface SignerEvidence {
  readonly ip?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly signedAt?: string | null | undefined;
  readonly method?: string | null | undefined;
  readonly fileChecksum?: string | null | undefined;
  readonly [key: string]: unknown;
}

export interface Contract {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly commercialsId: string;
  readonly state: ContractState;
  readonly draftFileId: string | null;
  readonly signedFileId: string | null;
  readonly checksum: string | null;
  readonly signerName: string | null;
  readonly signerEmail: string | null;
  readonly signerEvidence: SignerEvidence | null;
  readonly sentAt: Date | null;
  readonly signedAt: Date | null;
  readonly voidedAt: Date | null;
  readonly voidReason: string | null;
  readonly supersedesId: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
