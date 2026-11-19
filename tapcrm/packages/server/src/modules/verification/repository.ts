import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type {
  DocumentStatus,
  EmployeeVerificationDocumentRecord,
  EmployeeVerificationRecord,
  VerificationDocumentType,
  VerificationStatus,
} from './types.js';

interface RawVerificationRow {
  id: string;
  organizationId: string;
  employeeId: string;
  status: VerificationStatus;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawDocumentRow {
  id: string;
  verificationId: string;
  organizationId: string;
  employeeId: string;
  documentType: VerificationDocumentType;
  objectKey: string;
  fileName: string;
  fileSize: string | number;
  mimeType: string;
  status: DocumentStatus;
  rejectionReason: string | null;
  uploadedAt: Date;
  uploadedBy: string;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  isCurrent: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function mapDocumentRow(r: RawDocumentRow): EmployeeVerificationDocumentRecord {
  return {
    ...r,
    fileSize: typeof r.fileSize === 'string' ? parseInt(r.fileSize, 10) : r.fileSize,
  };
}

export async function getVerificationByEmployee(
  tx: Tx,
  orgId: string,
  employeeId: string,
): Promise<EmployeeVerificationRecord | null> {
  return tx.maybeOne<RawVerificationRow>(sql`
    SELECT
      id,
      organization_id AS "organizationId",
      employee_id AS "employeeId",
      status,
      verified_at AS "verifiedAt",
      verified_by AS "verifiedBy",
      rejection_reason AS "rejectionReason",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM employee_verification
    WHERE organization_id = ${orgId} AND employee_id = ${employeeId}
  `);
}

export async function getVerificationById(
  tx: Tx,
  orgId: string,
  verificationId: string,
): Promise<EmployeeVerificationRecord | null> {
  return tx.maybeOne<RawVerificationRow>(sql`
    SELECT
      id,
      organization_id AS "organizationId",
      employee_id AS "employeeId",
      status,
      verified_at AS "verifiedAt",
      verified_by AS "verifiedBy",
      rejection_reason AS "rejectionReason",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM employee_verification
    WHERE organization_id = ${orgId} AND id = ${verificationId}
  `);
}

export async function getOrCreateVerification(
  tx: Tx,
  orgId: string,
  employeeId: string,
): Promise<EmployeeVerificationRecord> {
  const existing = await getVerificationByEmployee(tx, orgId, employeeId);
  if (existing) {
    return existing;
  }

  return tx.one<RawVerificationRow>(sql`
    INSERT INTO employee_verification (
      organization_id, employee_id, status
    )
    VALUES (
      ${orgId}, ${employeeId}, 'PENDING'
    )
    ON CONFLICT (organization_id, employee_id) DO UPDATE
      SET updated_at = now()
    RETURNING
      id,
      organization_id AS "organizationId",
      employee_id AS "employeeId",
      status,
      verified_at AS "verifiedAt",
      verified_by AS "verifiedBy",
      rejection_reason AS "rejectionReason",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `);
}

export async function updateVerificationStatus(
  tx: Tx,
  orgId: string,
  verificationId: string,
  status: VerificationStatus,
  verifiedBy?: string | null,
  rejectionReason?: string | null,
): Promise<EmployeeVerificationRecord> {
  const verifiedAt = status === 'VERIFIED' ? new Date() : null;

  return tx.one<RawVerificationRow>(sql`
    UPDATE employee_verification
    SET
      status = ${status},
      verified_at = ${verifiedAt},
      verified_by = ${verifiedBy ?? null},
      rejection_reason = ${rejectionReason ?? null},
      updated_at = now()
    WHERE organization_id = ${orgId} AND id = ${verificationId}
    RETURNING
      id,
      organization_id AS "organizationId",
      employee_id AS "employeeId",
      status,
      verified_at AS "verifiedAt",
      verified_by AS "verifiedBy",
      rejection_reason AS "rejectionReason",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `);
}

export async function listDocumentsByVerification(
  tx: Tx,
  orgId: string,
  verificationId: string,
): Promise<EmployeeVerificationDocumentRecord[]> {
  const rows = await tx.query<RawDocumentRow>(sql`
    SELECT
      id,
      verification_id AS "verificationId",
      organization_id AS "organizationId",
      employee_id AS "employeeId",
      document_type AS "documentType",
      object_key AS "objectKey",
      file_name AS "fileName",
      file_size AS "fileSize",
      mime_type AS "mimeType",
      status,
      rejection_reason AS "rejectionReason",
      uploaded_at AS "uploadedAt",
      uploaded_by AS "uploadedBy",
      reviewed_at AS "reviewedAt",
      reviewed_by AS "reviewedBy",
      is_current AS "isCurrent",
      version,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM employee_verification_document
    WHERE organization_id = ${orgId} AND verification_id = ${verificationId}
    ORDER BY uploaded_at ASC, version ASC
  `);

  return rows.map(mapDocumentRow);
}

export async function findDocumentById(
  tx: Tx,
  orgId: string,
  documentId: string,
): Promise<EmployeeVerificationDocumentRecord | null> {
  const row = await tx.maybeOne<RawDocumentRow>(sql`
    SELECT
      id,
      verification_id AS "verificationId",
      organization_id AS "organizationId",
      employee_id AS "employeeId",
      document_type AS "documentType",
      object_key AS "objectKey",
      file_name AS "fileName",
      file_size AS "fileSize",
      mime_type AS "mimeType",
      status,
      rejection_reason AS "rejectionReason",
      uploaded_at AS "uploadedAt",
      uploaded_by AS "uploadedBy",
      reviewed_at AS "reviewedAt",
      reviewed_by AS "reviewedBy",
      is_current AS "isCurrent",
      version,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM employee_verification_document
    WHERE organization_id = ${orgId} AND id = ${documentId}
  `);

  return row ? mapDocumentRow(row) : null;
}

export async function archiveCurrentDocument(
  tx: Tx,
  orgId: string,
  verificationId: string,
  documentType: VerificationDocumentType,
): Promise<{ previousVersion: number }> {
  const current = await tx.maybeOne<{ version: number }>(sql`
    SELECT version
    FROM employee_verification_document
    WHERE organization_id = ${orgId}
      AND verification_id = ${verificationId}
      AND document_type = ${documentType}
      AND is_current = true
    LIMIT 1
  `);

  if (current) {
    await tx.query(sql`
      UPDATE employee_verification_document
      SET is_current = false, updated_at = now()
      WHERE organization_id = ${orgId}
        AND verification_id = ${verificationId}
        AND document_type = ${documentType}
        AND is_current = true
    `);
    return { previousVersion: current.version };
  }

  return { previousVersion: 0 };
}

export async function insertDocument(
  tx: Tx,
  input: {
    verificationId: string;
    organizationId: string;
    employeeId: string;
    documentType: VerificationDocumentType;
    objectKey: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    status: DocumentStatus;
    uploadedBy: string;
    isCurrent: boolean;
    version: number;
  },
): Promise<EmployeeVerificationDocumentRecord> {
  const row = await tx.one<RawDocumentRow>(sql`
    INSERT INTO employee_verification_document (
      verification_id,
      organization_id,
      employee_id,
      document_type,
      object_key,
      file_name,
      file_size,
      mime_type,
      status,
      uploaded_by,
      is_current,
      version
    )
    VALUES (
      ${input.verificationId},
      ${input.organizationId},
      ${input.employeeId},
      ${input.documentType},
      ${input.objectKey},
      ${input.fileName},
      ${input.fileSize},
      ${input.mimeType},
      ${input.status},
      ${input.uploadedBy},
      ${input.isCurrent},
      ${input.version}
    )
    RETURNING
      id,
      verification_id AS "verificationId",
      organization_id AS "organizationId",
      employee_id AS "employeeId",
      document_type AS "documentType",
      object_key AS "objectKey",
      file_name AS "fileName",
      file_size AS "fileSize",
      mime_type AS "mimeType",
      status,
      rejection_reason AS "rejectionReason",
      uploaded_at AS "uploadedAt",
      uploaded_by AS "uploadedBy",
      reviewed_at AS "reviewedAt",
      reviewed_by AS "reviewedBy",
      is_current AS "isCurrent",
      version,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `);

  return mapDocumentRow(row);
}

export async function updateDocumentReview(
  tx: Tx,
  orgId: string,
  documentId: string,
  status: DocumentStatus,
  reviewedBy: string,
  rejectionReason?: string | null,
): Promise<EmployeeVerificationDocumentRecord> {
  const row = await tx.one<RawDocumentRow>(sql`
    UPDATE employee_verification_document
    SET
      status = ${status},
      reviewed_by = ${reviewedBy},
      reviewed_at = now(),
      rejection_reason = ${rejectionReason ?? null},
      updated_at = now()
    WHERE organization_id = ${orgId} AND id = ${documentId}
    RETURNING
      id,
      verification_id AS "verificationId",
      organization_id AS "organizationId",
      employee_id AS "employeeId",
      document_type AS "documentType",
      object_key AS "objectKey",
      file_name AS "fileName",
      file_size AS "fileSize",
      mime_type AS "mimeType",
      status,
      rejection_reason AS "rejectionReason",
      uploaded_at AS "uploadedAt",
      uploaded_by AS "uploadedBy",
      reviewed_at AS "reviewedAt",
      reviewed_by AS "reviewedBy",
      is_current AS "isCurrent",
      version,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `);

  return mapDocumentRow(row);
}

export async function recordVerificationAudit(
  tx: Tx,
  orgId: string,
  payload: {
    action: string;
    actorId: string;
    actorType: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
    before?: unknown;
    after?: unknown;
    requestId?: string;
    sourceIp?: string | null;
  },
): Promise<void> {
  const eventData = {
    ...payload,
    timestamp: new Date().toISOString(),
  };

  await tx.query(sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${orgId}, 'activity', ${JSON.stringify(eventData)}::jsonb)
  `);
}

/**
 * The employee's own answer to "is this your first job?" (employee_profile,
 * written by the employee module). No profile row yet means they have not
 * said, which keeps the full document list.
 */
export async function findNoPriorExperience(
  tx: Tx,
  orgId: string,
  employeeId: string,
): Promise<boolean> {
  const row = await tx.maybeOne<{ hasNoPriorExperience: boolean }>(sql`
    SELECT has_no_prior_experience AS "hasNoPriorExperience"
    FROM employee_profile
    WHERE organization_id = ${orgId} AND user_id = ${employeeId}
  `);
  return row?.hasNoPriorExperience ?? false;
}

/** Current (not archived) documents of several employees, for profile completion. */
export async function listCurrentDocumentsForEmployees(
  tx: Tx,
  orgId: string,
  employeeIds: readonly string[],
): Promise<EmployeeVerificationDocumentRecord[]> {
  if (employeeIds.length === 0) return [];
  const rows = await tx.query<RawDocumentRow>(sql`
    SELECT
      id,
      verification_id AS "verificationId",
      organization_id AS "organizationId",
      employee_id AS "employeeId",
      document_type AS "documentType",
      object_key AS "objectKey",
      file_name AS "fileName",
      file_size AS "fileSize",
      mime_type AS "mimeType",
      status,
      rejection_reason AS "rejectionReason",
      uploaded_at AS "uploadedAt",
      uploaded_by AS "uploadedBy",
      reviewed_at AS "reviewedAt",
      reviewed_by AS "reviewedBy",
      is_current AS "isCurrent",
      version,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM employee_verification_document
    WHERE organization_id = ${orgId}
      AND employee_id = ANY(${[...employeeIds]}::uuid[])
      AND is_current = true
    ORDER BY uploaded_at ASC
  `);
  return rows.map(mapDocumentRow);
}

/**
 * Takes a document out of the current set while it still waits for review,
 * e.g. the employee uploaded the wrong file. The row stays (no hard delete)
 * as history. False when it was already reviewed or replaced.
 */
export async function withdrawPendingDocument(
  tx: Tx,
  orgId: string,
  documentId: string,
): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    UPDATE employee_verification_document
    SET is_current = false, updated_at = now()
    WHERE organization_id = ${orgId}
      AND id = ${documentId}
      AND is_current = true
      AND status = 'PENDING'
    RETURNING id
  `);
  return rows.length > 0;
}
