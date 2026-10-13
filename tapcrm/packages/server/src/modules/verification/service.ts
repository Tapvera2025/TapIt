import crypto from 'node:crypto';
import { loadConfig } from '../../config.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { getStorageService } from '../../platform/storage/index.js';
import { VerificationNotFoundError, VerificationValidationError } from './errors.js';
import * as repo from './repository.js';
import {
  REQUIRED_VERIFICATION_DOCUMENTS,
  type EmployeeVerificationDocumentRecord,
  type VerificationDetailsResponse,
  type VerificationDocumentSummary,
  type VerificationDocumentType,
  type VerificationStatus,
} from './types.js';
import {
  validateDocumentFile,
  type RejectDocumentInput,
  type RejectVerificationInput,
  type SingleDocumentUploadInput,
  type UploadVerificationDocumentInput,
} from './validators.js';

function toDocumentSummary(doc: EmployeeVerificationDocumentRecord): VerificationDocumentSummary {
  return {
    id: doc.id,
    documentType: doc.documentType,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    mimeType: doc.mimeType,
    status: doc.status,
    rejectionReason: doc.rejectionReason,
    uploadedAt: doc.uploadedAt.toISOString(),
    uploadedBy: doc.uploadedBy,
    reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
    reviewedBy: doc.reviewedBy,
    isCurrent: doc.isCurrent,
    version: doc.version,
  };
}

function calculateProgress(docs: EmployeeVerificationDocumentRecord[]) {
  const currentDocs = docs.filter((d) => d.isCurrent);
  const currentByType = new Map<VerificationDocumentType, EmployeeVerificationDocumentRecord[]>();
  for (const doc of currentDocs) {
    const list = currentByType.get(doc.documentType) ?? [];
    list.push(doc);
    currentByType.set(doc.documentType, list);
  }

  let approvedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;

  for (const reqType of REQUIRED_VERIFICATION_DOCUMENTS) {
    const typeDocs = currentByType.get(reqType);
    if (!typeDocs || typeDocs.length === 0) continue;
    if (typeDocs.some((d) => d.status === 'REJECTED')) {
      rejectedCount++;
    } else if (typeDocs.some((d) => d.status === 'PENDING')) {
      pendingCount++;
    } else if (typeDocs.every((d) => d.status === 'APPROVED')) {
      approvedCount++;
    }
  }

  const missingCount = REQUIRED_VERIFICATION_DOCUMENTS.length - currentByType.size;

  return {
    requiredCount: REQUIRED_VERIFICATION_DOCUMENTS.length,
    approvedCount,
    pendingCount,
    rejectedCount,
    missingCount: Math.max(0, missingCount),
    allApproved: approvedCount === REQUIRED_VERIFICATION_DOCUMENTS.length,
  };
}

async function assertEmployeeExists(ctx: RequestContext, employeeId: string): Promise<void> {
  const exists = await db.maybeOne<{ id: string }>(
    ctx,
    sql`SELECT id FROM app_user WHERE organization_id = ${ctx.organizationId} AND id = ${employeeId}`,
  );
  if (!exists) {
    throw new VerificationNotFoundError(`Employee ${employeeId} not found in this organization.`);
  }
}

export async function getEmployeeVerification(
  ctx: RequestContext,
  employeeId: string,
): Promise<VerificationDetailsResponse> {
  await assertEmployeeExists(ctx, employeeId);

  const verification = await db.transaction(ctx, async (tx) => {
    return repo.getVerificationByEmployee(tx, ctx.organizationId, employeeId);
  });

  if (!verification) {
    return { verification: null };
  }

  const docs = await db.transaction(ctx, async (tx) => {
    return repo.listDocumentsByVerification(tx, ctx.organizationId, verification.id);
  });

  const currentDocs = docs.filter((d) => d.isCurrent).map(toDocumentSummary);
  const historyDocs = docs.filter((d) => !d.isCurrent).map(toDocumentSummary);
  const progress = calculateProgress(docs);

  return {
    verification: {
      id: verification.id,
      employeeId: verification.employeeId,
      status: verification.status,
      verifiedAt: verification.verifiedAt ? verification.verifiedAt.toISOString() : null,
      verifiedBy: verification.verifiedBy,
      rejectionReason: verification.rejectionReason,
      documents: currentDocs,
      history: historyDocs,
      progress,
    },
  };
}

export async function initializeEmployeeVerification(
  ctx: RequestContext,
  employeeId: string,
): Promise<VerificationDetailsResponse> {
  await assertEmployeeExists(ctx, employeeId);

  await db.transaction(ctx, async (tx) => {
    const existing = await repo.getVerificationByEmployee(tx, ctx.organizationId, employeeId);
    if (existing) {
      return existing;
    }
    const created = await repo.getOrCreateVerification(tx, ctx.organizationId, employeeId);

    await repo.recordVerificationAudit(tx, ctx.organizationId, {
      action: 'employee.verification.initialized',
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'employee_verification',
      targetId: created.id,
      metadata: { employeeId },
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    });

    return created;
  });

  return getEmployeeVerification(ctx, employeeId);
}

export async function uploadVerificationDocument(
  ctx: RequestContext,
  employeeId: string,
  input: UploadVerificationDocumentInput,
): Promise<{ document: VerificationDocumentSummary; documents?: VerificationDocumentSummary[] }> {
  await assertEmployeeExists(ctx, employeeId);

  const items: SingleDocumentUploadInput[] = Array.isArray(input)
    ? input
    : 'documents' in input
    ? input.documents
    : [input];

  const prepared: Array<{
    item: SingleDocumentUploadInput;
    buffer: Buffer;
    objectKey: string;
  }> = [];

  for (const item of items) {
    let cleanBase64 = item.fileBase64.trim();
    const commaIdx = cleanBase64.indexOf(',');
    if (commaIdx !== -1) {
      cleanBase64 = cleanBase64.slice(commaIdx + 1).trim();
    }

    if (!cleanBase64) {
      throw new VerificationValidationError('Document file cannot be empty.');
    }

    if (!/^[A-Za-z0-9+/=\s]+$/.test(cleanBase64)) {
      throw new VerificationValidationError('Invalid fileBase64 encoding: malformed base64 characters.');
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(cleanBase64, 'base64');
    } catch {
      throw new VerificationValidationError('Invalid fileBase64 encoding.');
    }

    const validation = validateDocumentFile(buffer, item.fileName, item.mimeType);
    if (!validation.valid) {
      throw new VerificationValidationError(validation.error ?? 'Invalid document file.');
    }

    const ext = (item.fileName.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '');
    const randomSuffix = crypto.randomUUID();
    const objectKey = `verification/${ctx.organizationId}/${employeeId}/${item.documentType}/${randomSuffix}.${ext}`;

    // Upload object to storage provider (bucket: 'files')
    await getStorageService().putObject({
      bucket: 'files',
      key: objectKey,
      body: buffer,
      contentType: item.mimeType,
    });

    prepared.push({ item, buffer, objectKey });
  }

  const insertedRecords = await db.transaction(ctx, async (tx) => {
    const verification = await repo.getOrCreateVerification(tx, ctx.organizationId, employeeId);
    const results: EmployeeVerificationDocumentRecord[] = [];

    const isMultiDoc = Array.isArray(input) || 'documents' in input;

    for (const { item, buffer, objectKey } of prepared) {
      let previousVersion = 0;
      const shouldArchive = item.replace !== undefined ? item.replace : !isMultiDoc;
      if (shouldArchive) {
        const archiveRes = await repo.archiveCurrentDocument(
          tx,
          ctx.organizationId,
          verification.id,
          item.documentType,
        );
        previousVersion = archiveRes.previousVersion;
      }

      const newVersion = previousVersion + 1;

      const inserted = await repo.insertDocument(tx, {
        verificationId: verification.id,
        organizationId: ctx.organizationId,
        employeeId,
        documentType: item.documentType,
        objectKey,
        fileName: item.fileName,
        fileSize: buffer.length,
        mimeType: item.mimeType,
        status: 'PENDING',
        uploadedBy: ctx.principal.id,
        isCurrent: true,
        version: newVersion,
      });

      await repo.recordVerificationAudit(tx, ctx.organizationId, {
        action: previousVersion > 0
          ? 'employee.verification.document_replaced'
          : 'employee.verification.document_uploaded',
        actorId: ctx.principal.id,
        actorType: ctx.principal.accountType,
        targetType: 'employee_verification_document',
        targetId: inserted.id,
        metadata: {
          employeeId,
          verificationId: verification.id,
          documentType: item.documentType,
          fileName: item.fileName,
          version: newVersion,
        },
        requestId: ctx.requestId,
        sourceIp: ctx.sourceIp,
      });

      results.push(inserted);
    }

    return results;
  });

  const summaries = insertedRecords.map(toDocumentSummary);
  return {
    document: summaries[0]!,
    documents: summaries,
  };
}

export async function getVerificationDocumentDownloadUrl(
  ctx: RequestContext,
  employeeId: string,
  documentId: string,
): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
  await assertEmployeeExists(ctx, employeeId);

  const document = await db.transaction(ctx, async (tx) => {
    return repo.findDocumentById(tx, ctx.organizationId, documentId);
  });

  if (!document || document.employeeId !== employeeId) {
    throw new VerificationNotFoundError('Verification document not found.');
  }

  const expiresInSeconds = 900; // 15 minutes

  try {
    const file = await getStorageService().getObject({
      bucket: 'files',
      key: document.objectKey,
    });
    const config = loadConfig();
    const s3Endpoint = config.S3_ENDPOINT ?? '';
    const isLocalOrDockerMinio =
      !config.S3_PUBLIC_ENDPOINT ||
      s3Endpoint.includes('minio:9000') ||
      s3Endpoint.includes('localhost:9000') ||
      s3Endpoint.includes('127.0.0.1:9000');
    if (isLocalOrDockerMinio && file?.body) {
      const base64 = file.body.toString('base64');
      const downloadUrl = `data:${document.mimeType || file.contentType};base64,${base64}`;
      return { downloadUrl, expiresInSeconds };
    }
  } catch {
    // fallback to presigned URL
  }

  const downloadUrl = getStorageService().presignedGetUrl({
    bucket: 'files',
    key: document.objectKey,
    expiresInSeconds,
  });

  return { downloadUrl, expiresInSeconds };
}

export async function approveVerificationDocument(
  ctx: RequestContext,
  employeeId: string,
  documentId: string,
): Promise<{ document: VerificationDocumentSummary; verificationStatus: VerificationStatus }> {
  await assertEmployeeExists(ctx, employeeId);

  return db.transaction(ctx, async (tx) => {
    const document = await repo.findDocumentById(tx, ctx.organizationId, documentId);
    if (!document || document.employeeId !== employeeId) {
      throw new VerificationNotFoundError('Verification document not found.');
    }

    const updatedDoc = await repo.updateDocumentReview(
      tx,
      ctx.organizationId,
      documentId,
      'APPROVED',
      ctx.principal.id,
      null,
    );

    const verification = await repo.getVerificationById(
      tx,
      ctx.organizationId,
      document.verificationId,
    );

    let nextVerificationStatus: VerificationStatus = verification ? verification.status : 'PENDING';

    if (verification && verification.status !== 'VERIFIED') {
      const allDocs = await repo.listDocumentsByVerification(
        tx,
        ctx.organizationId,
        verification.id,
      );
      const progress = calculateProgress(allDocs);
      if (progress.approvedCount > 0 && progress.approvedCount < REQUIRED_VERIFICATION_DOCUMENTS.length) {
        nextVerificationStatus = 'PARTIALLY_VERIFIED';
        await repo.updateVerificationStatus(
          tx,
          ctx.organizationId,
          verification.id,
          'PARTIALLY_VERIFIED',
        );
      }
    }

    await repo.recordVerificationAudit(tx, ctx.organizationId, {
      action: 'employee.verification.document_approved',
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'employee_verification_document',
      targetId: document.id,
      metadata: {
        employeeId,
        documentType: document.documentType,
        verificationId: document.verificationId,
      },
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    });

    return {
      document: toDocumentSummary(updatedDoc),
      verificationStatus: nextVerificationStatus,
    };
  });
}

export async function rejectVerificationDocument(
  ctx: RequestContext,
  employeeId: string,
  documentId: string,
  input: RejectDocumentInput,
): Promise<{ document: VerificationDocumentSummary }> {
  await assertEmployeeExists(ctx, employeeId);

  return db.transaction(ctx, async (tx) => {
    const document = await repo.findDocumentById(tx, ctx.organizationId, documentId);
    if (!document || document.employeeId !== employeeId) {
      throw new VerificationNotFoundError('Verification document not found.');
    }

    const updatedDoc = await repo.updateDocumentReview(
      tx,
      ctx.organizationId,
      documentId,
      'REJECTED',
      ctx.principal.id,
      input.rejectionReason,
    );

    await repo.recordVerificationAudit(tx, ctx.organizationId, {
      action: 'employee.verification.document_rejected',
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'employee_verification_document',
      targetId: document.id,
      metadata: {
        employeeId,
        documentType: document.documentType,
        verificationId: document.verificationId,
        rejectionReason: input.rejectionReason,
      },
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    });

    return {
      document: toDocumentSummary(updatedDoc),
    };
  });
}

export async function completeEmployeeVerification(
  ctx: RequestContext,
  employeeId: string,
): Promise<VerificationDetailsResponse> {
  await assertEmployeeExists(ctx, employeeId);

  return db.transaction(ctx, async (tx) => {
    const verification = await repo.getVerificationByEmployee(tx, ctx.organizationId, employeeId);
    if (!verification) {
      throw new VerificationValidationError('Verification has not been initialized for this employee.');
    }

    const allDocs = await repo.listDocumentsByVerification(tx, ctx.organizationId, verification.id);
    const currentDocs = allDocs.filter((d) => d.isCurrent);
    const currentByType = new Map<VerificationDocumentType, EmployeeVerificationDocumentRecord[]>();
    for (const d of currentDocs) {
      const list = currentByType.get(d.documentType) ?? [];
      list.push(d);
      currentByType.set(d.documentType, list);
    }

    for (const reqType of REQUIRED_VERIFICATION_DOCUMENTS) {
      const typeDocs = currentByType.get(reqType);
      if (!typeDocs || typeDocs.length === 0) {
        throw new VerificationValidationError(
          `Cannot verify employee: required document ${reqType} is missing.`,
        );
      }
      const pending = typeDocs.find((d) => d.status === 'PENDING');
      if (pending) {
        throw new VerificationValidationError(
          `Cannot verify employee: required document ${reqType} (${pending.fileName}) is still pending review.`,
        );
      }
      const rejected = typeDocs.find((d) => d.status === 'REJECTED');
      if (rejected) {
        throw new VerificationValidationError(
          `Cannot verify employee: required document ${reqType} (${rejected.fileName}) was rejected. A valid approved document is required.`,
        );
      }
    }

    const updated = await repo.updateVerificationStatus(
      tx,
      ctx.organizationId,
      verification.id,
      'VERIFIED',
      ctx.principal.id,
      null,
    );

    await repo.recordVerificationAudit(tx, ctx.organizationId, {
      action: 'employee.verification.completed',
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'employee_verification',
      targetId: updated.id,
      metadata: {
        employeeId,
        documentCount: currentDocs.length,
      },
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    });

    const refreshedDocs = await repo.listDocumentsByVerification(
      tx,
      ctx.organizationId,
      verification.id,
    );
    const curSummary = refreshedDocs.filter((d) => d.isCurrent).map(toDocumentSummary);
    const histSummary = refreshedDocs.filter((d) => !d.isCurrent).map(toDocumentSummary);
    const progress = calculateProgress(refreshedDocs);

    return {
      verification: {
        id: updated.id,
        employeeId: updated.employeeId,
        status: updated.status,
        verifiedAt: updated.verifiedAt ? updated.verifiedAt.toISOString() : null,
        verifiedBy: updated.verifiedBy,
        rejectionReason: updated.rejectionReason,
        documents: curSummary,
        history: histSummary,
        progress,
      },
    };
  });
}

export async function rejectEmployeeVerification(
  ctx: RequestContext,
  employeeId: string,
  input: RejectVerificationInput,
): Promise<VerificationDetailsResponse> {
  await assertEmployeeExists(ctx, employeeId);

  return db.transaction(ctx, async (tx) => {
    const verification = await repo.getOrCreateVerification(tx, ctx.organizationId, employeeId);

    const updated = await repo.updateVerificationStatus(
      tx,
      ctx.organizationId,
      verification.id,
      'REJECTED',
      ctx.principal.id,
      input.rejectionReason,
    );

    await repo.recordVerificationAudit(tx, ctx.organizationId, {
      action: 'employee.verification.rejected',
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'employee_verification',
      targetId: updated.id,
      metadata: {
        employeeId,
        rejectionReason: input.rejectionReason,
      },
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    });

    const refreshedDocs = await repo.listDocumentsByVerification(
      tx,
      ctx.organizationId,
      verification.id,
    );
    const curSummary = refreshedDocs.filter((d) => d.isCurrent).map(toDocumentSummary);
    const histSummary = refreshedDocs.filter((d) => !d.isCurrent).map(toDocumentSummary);
    const progress = calculateProgress(refreshedDocs);

    return {
      verification: {
        id: updated.id,
        employeeId: updated.employeeId,
        status: updated.status,
        verifiedAt: updated.verifiedAt ? updated.verifiedAt.toISOString() : null,
        verifiedBy: updated.verifiedBy,
        rejectionReason: updated.rejectionReason,
        documents: curSummary,
        history: histSummary,
        progress,
      },
    };
  });
}
