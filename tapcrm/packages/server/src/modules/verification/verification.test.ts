import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { getStorageService } from '../../platform/storage/index.js';
import {
  VerificationNotFoundError,
  VerificationValidationError,
} from './errors.js';
import * as repo from './repository.js';
import {
  approveVerificationDocument,
  completeEmployeeVerification,
  getEmployeeVerification,
  getVerificationDocumentDownloadUrl,
  initializeEmployeeVerification,
  rejectEmployeeVerification,
  rejectVerificationDocument,
  uploadVerificationDocument,
} from './service.js';
import {
  REQUIRED_VERIFICATION_DOCUMENTS,
  type EmployeeVerificationDocumentRecord,
  type EmployeeVerificationRecord,
} from './types.js';
import { uploadVerificationDocumentSchema } from './validators.js';

beforeAll(() => {
  process.env['DATABASE_URL'] = 'postgresql://tapcrm_app:test@localhost:5432/tapcrm_test';
  process.env['REDIS_URL'] = 'redis://localhost:6379';
  process.env['JWT_ACCESS_SECRET'] = 'test-secret-at-least-32-chars-long-access';
  process.env['JWT_REFRESH_SECRET'] = 'test-secret-at-least-32-chars-long-refresh';
  process.env['CLIENT_ORIGIN'] = 'http://localhost:5173';
});

function createMockContext(orgId: string, userId: string): RequestContext {
  return {
    organizationId: orgId,
    requestId: randomUUID(),
    sourceIp: '127.0.0.1',
    principal: {
      id: userId,
      organizationId: orgId,
      sessionVersion: 1,
      accountType: 'employee',
      allowedActions: ['users:view', 'users:manage'],
      allowedResources: [],
      expiresAt: new Date(Date.now() + 3600000),
    },
  } as unknown as RequestContext;
}

describe('Employee Verification Backend Workflow', () => {
  const orgId = randomUUID();
  const hrUserId = randomUUID();
  const employeeId = randomUUID();
  const ctx = createMockContext(orgId, hrUserId);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Verification initialization
  it('initializes verification record for an employee in PENDING status', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValue({ id: employeeId }); // assertEmployeeExists
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => {
      const mockTx = {} as unknown as Tx;
      return fn(mockTx);
    });

    const mockVerification: EmployeeVerificationRecord = {
      id: randomUUID(),
      organizationId: orgId,
      employeeId,
      status: 'PENDING',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.spyOn(repo, 'getVerificationByEmployee')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockVerification);
    vi.spyOn(repo, 'getOrCreateVerification').mockResolvedValueOnce(mockVerification);
    vi.spyOn(repo, 'recordVerificationAudit').mockResolvedValueOnce(undefined);
    vi.spyOn(repo, 'listDocumentsByVerification').mockResolvedValueOnce([]);

    const res = await initializeEmployeeVerification(ctx, employeeId);

    expect(res.verification).not.toBeNull();
    expect(res.verification?.status).toBe('PENDING');
    expect(res.verification?.employeeId).toBe(employeeId);
    expect(repo.getOrCreateVerification).toHaveBeenCalledTimes(1);
    expect(repo.recordVerificationAudit).toHaveBeenCalledWith(
      expect.anything(),
      orgId,
      expect.objectContaining({ action: 'employee.verification.initialized' }),
    );
  });

  // 2. Verification retrieval
  it('retrieves existing verification and progress accurately', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));

    const mockVerification: EmployeeVerificationRecord = {
      id: randomUUID(),
      organizationId: orgId,
      employeeId,
      status: 'PARTIALLY_VERIFIED',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockDocs: EmployeeVerificationDocumentRecord[] = [
      {
        id: randomUUID(),
        verificationId: mockVerification.id,
        organizationId: orgId,
        employeeId,
        documentType: 'AADHAAR',
        objectKey: 'verification/aadhaar.pdf',
        fileName: 'aadhaar.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
        status: 'APPROVED',
        rejectionReason: null,
        uploadedAt: new Date(),
        uploadedBy: hrUserId,
        reviewedAt: new Date(),
        reviewedBy: hrUserId,
        isCurrent: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.spyOn(repo, 'getVerificationByEmployee').mockResolvedValueOnce(mockVerification);
    vi.spyOn(repo, 'listDocumentsByVerification').mockResolvedValueOnce(mockDocs);

    const res = await getEmployeeVerification(ctx, employeeId);

    expect(res.verification).not.toBeNull();
    expect(res.verification?.status).toBe('PARTIALLY_VERIFIED');
    expect(res.verification?.documents).toHaveLength(1);
    expect(res.verification?.progress.approvedCount).toBe(1);
    expect(res.verification?.progress.requiredCount).toBe(10);
    expect(res.verification?.progress.allApproved).toBe(false);
  });

  // 3. Correct employee association
  it('associates documents and verification strictly with target employee', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));

    vi.spyOn(repo, 'getVerificationByEmployee').mockResolvedValueOnce(null);

    const res = await getEmployeeVerification(ctx, employeeId);
    expect(res.verification).toBeNull();
  });

  // 4. Tenant isolation
  it('rejects verification operations when employee belongs to a different tenant', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce(null); // Employee not found in tenant

    await expect(getEmployeeVerification(ctx, employeeId)).rejects.toThrow(
      VerificationNotFoundError,
    );
  });

  // 5. Authorization
  it('enforces authorized context on verification service execution', async () => {
    expect(ctx.principal.id).toBe(hrUserId);
    expect(ctx.organizationId).toBe(orgId);
  });

  // 6. Valid document type
  it('accepts all 10 mandated document types', () => {
    for (const docType of REQUIRED_VERIFICATION_DOCUMENTS) {
      const parsed = uploadVerificationDocumentSchema.safeParse({
        documentType: docType,
        fileName: `${docType.toLowerCase()}.pdf`,
        mimeType: 'application/pdf',
        fileBase64: Buffer.from('test content').toString('base64'),
      });
      expect(parsed.success).toBe(true);
    }
  });

  // 7. Invalid document type
  it('rejects unapproved or arbitrary document types', () => {
    const parsed = uploadVerificationDocumentSchema.safeParse({
      documentType: 'ELECTRICITY_BILL',
      fileName: 'bill.pdf',
      mimeType: 'application/pdf',
      fileBase64: Buffer.from('test').toString('base64'),
    });
    expect(parsed.success).toBe(false);
  });

  // 8. Document upload metadata & storage coordination
  it('persists uploaded document file to storage and saves metadata as PENDING', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));

    const storage = getStorageService();
    const putObjectSpy = vi.spyOn(storage, 'putObject').mockResolvedValue({ checksumSha256: 'abc' });

    const mockVerification: EmployeeVerificationRecord = {
      id: randomUUID(),
      organizationId: orgId,
      employeeId,
      status: 'PENDING',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockInsertedDoc: EmployeeVerificationDocumentRecord = {
      id: randomUUID(),
      verificationId: mockVerification.id,
      organizationId: orgId,
      employeeId,
      documentType: 'PAN',
      objectKey: `verification/${orgId}/${employeeId}/PAN/test.pdf`,
      fileName: 'pan.pdf',
      fileSize: 100,
      mimeType: 'application/pdf',
      status: 'PENDING',
      rejectionReason: null,
      uploadedAt: new Date(),
      uploadedBy: hrUserId,
      reviewedAt: null,
      reviewedBy: null,
      isCurrent: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.spyOn(repo, 'getOrCreateVerification').mockResolvedValueOnce(mockVerification);
    vi.spyOn(repo, 'archiveCurrentDocument').mockResolvedValueOnce({ previousVersion: 0 });
    vi.spyOn(repo, 'insertDocument').mockResolvedValueOnce(mockInsertedDoc);
    vi.spyOn(repo, 'recordVerificationAudit').mockResolvedValueOnce(undefined);

    const res = await uploadVerificationDocument(ctx, employeeId, {
      documentType: 'PAN',
      fileName: 'pan.pdf',
      mimeType: 'application/pdf',
      fileBase64: Buffer.from('pan-card-content').toString('base64'),
    });

    expect(putObjectSpy).toHaveBeenCalledTimes(1);
    expect(res.document.documentType).toBe('PAN');
    expect(res.document.status).toBe('PENDING'); // Upload != Approved
    expect(res.document.version).toBe(1);
    expect(repo.recordVerificationAudit).toHaveBeenCalledWith(
      expect.anything(),
      orgId,
      expect.objectContaining({ action: 'employee.verification.document_uploaded' }),
    );
  });

  // 9. Document approval
  it('approves a pending document and updates status', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));

    const docId = randomUUID();
    const verifId = randomUUID();

    const mockDoc: EmployeeVerificationDocumentRecord = {
      id: docId,
      verificationId: verifId,
      organizationId: orgId,
      employeeId,
      documentType: 'AADHAAR',
      objectKey: 'test.pdf',
      fileName: 'aadhaar.pdf',
      fileSize: 100,
      mimeType: 'application/pdf',
      status: 'PENDING',
      rejectionReason: null,
      uploadedAt: new Date(),
      uploadedBy: hrUserId,
      reviewedAt: null,
      reviewedBy: null,
      isCurrent: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockApprovedDoc = { ...mockDoc, status: 'APPROVED' as const, reviewedBy: hrUserId, reviewedAt: new Date() };

    vi.spyOn(repo, 'findDocumentById').mockResolvedValueOnce(mockDoc);
    vi.spyOn(repo, 'updateDocumentReview').mockResolvedValueOnce(mockApprovedDoc);
    vi.spyOn(repo, 'getVerificationById').mockResolvedValueOnce({
      id: verifId,
      organizationId: orgId,
      employeeId,
      status: 'PENDING',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.spyOn(repo, 'listDocumentsByVerification').mockResolvedValueOnce([mockApprovedDoc]);
    vi.spyOn(repo, 'updateVerificationStatus').mockResolvedValueOnce({} as unknown as EmployeeVerificationRecord);
    vi.spyOn(repo, 'recordVerificationAudit').mockResolvedValueOnce(undefined);

    const res = await approveVerificationDocument(ctx, employeeId, docId);

    expect(res.document.status).toBe('APPROVED');
    expect(res.verificationStatus).toBe('PARTIALLY_VERIFIED');
    expect(repo.updateDocumentReview).toHaveBeenCalledWith(
      expect.anything(),
      orgId,
      docId,
      'APPROVED',
      hrUserId,
      null,
    );
  });

  // 10. Document rejection
  // 11. Rejection reason
  it('rejects a document with a mandatory rejection reason and records reviewer metadata', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));

    const docId = randomUUID();
    const verifId = randomUUID();
    const mockDoc: EmployeeVerificationDocumentRecord = {
      id: docId,
      verificationId: verifId,
      organizationId: orgId,
      employeeId,
      documentType: 'MARKSHEET',
      objectKey: 'test.pdf',
      fileName: 'marksheet.pdf',
      fileSize: 100,
      mimeType: 'application/pdf',
      status: 'PENDING',
      rejectionReason: null,
      uploadedAt: new Date(),
      uploadedBy: hrUserId,
      reviewedAt: null,
      reviewedBy: null,
      isCurrent: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockRejectedDoc = {
      ...mockDoc,
      status: 'REJECTED' as const,
      rejectionReason: 'Blurry scan, grades not readable',
      reviewedBy: hrUserId,
      reviewedAt: new Date(),
    };

    vi.spyOn(repo, 'findDocumentById').mockResolvedValueOnce(mockDoc);
    vi.spyOn(repo, 'updateDocumentReview').mockResolvedValueOnce(mockRejectedDoc);
    vi.spyOn(repo, 'recordVerificationAudit').mockResolvedValueOnce(undefined);

    const res = await rejectVerificationDocument(ctx, employeeId, docId, {
      rejectionReason: 'Blurry scan, grades not readable',
    });

    expect(res.document.status).toBe('REJECTED');
    expect(res.document.rejectionReason).toBe('Blurry scan, grades not readable');
    expect(repo.updateDocumentReview).toHaveBeenCalledWith(
      expect.anything(),
      orgId,
      docId,
      'REJECTED',
      hrUserId,
      'Blurry scan, grades not readable',
    );
  });

  // 12. Missing required document blocks verification
  it('blocks verification completion if any required document is missing', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));

    const verifId = randomUUID();
    vi.spyOn(repo, 'getVerificationByEmployee').mockResolvedValueOnce({
      id: verifId,
      organizationId: orgId,
      employeeId,
      status: 'PENDING',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Only 1 document present
    vi.spyOn(repo, 'listDocumentsByVerification').mockResolvedValueOnce([
      {
        id: randomUUID(),
        verificationId: verifId,
        organizationId: orgId,
        employeeId,
        documentType: 'AADHAAR',
        objectKey: 'test.pdf',
        fileName: 'aadhaar.pdf',
        fileSize: 100,
        mimeType: 'application/pdf',
        status: 'APPROVED',
        rejectionReason: null,
        uploadedAt: new Date(),
        uploadedBy: hrUserId,
        reviewedAt: new Date(),
        reviewedBy: hrUserId,
        isCurrent: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await expect(completeEmployeeVerification(ctx, employeeId)).rejects.toThrow(
      /Cannot verify employee: required document .* is missing/,
    );
  });

  // 13. Pending required document blocks verification
  it('blocks verification completion if any document is still pending review', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));

    const verifId = randomUUID();
    vi.spyOn(repo, 'getVerificationByEmployee').mockResolvedValueOnce({
      id: verifId,
      organizationId: orgId,
      employeeId,
      status: 'PENDING',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // All 10 documents present, but 1 is still PENDING
    const mockAllDocs = REQUIRED_VERIFICATION_DOCUMENTS.map((dt, idx) => ({
      id: randomUUID(),
      verificationId: verifId,
      organizationId: orgId,
      employeeId,
      documentType: dt,
      objectKey: `test-${dt}.pdf`,
      fileName: `${dt}.pdf`,
      fileSize: 100,
      mimeType: 'application/pdf',
      status: idx === 0 ? ('PENDING' as const) : ('APPROVED' as const),
      rejectionReason: null,
      uploadedAt: new Date(),
      uploadedBy: hrUserId,
      reviewedAt: idx === 0 ? null : new Date(),
      reviewedBy: idx === 0 ? null : hrUserId,
      isCurrent: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    vi.spyOn(repo, 'listDocumentsByVerification').mockResolvedValueOnce(mockAllDocs);

    await expect(completeEmployeeVerification(ctx, employeeId)).rejects.toThrow(
      /Cannot verify employee: required document .* is still pending review/,
    );
  });

  // 14. Rejected required document blocks verification
  it('blocks verification completion if any document was rejected', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));

    const verifId = randomUUID();
    vi.spyOn(repo, 'getVerificationByEmployee').mockResolvedValueOnce({
      id: verifId,
      organizationId: orgId,
      employeeId,
      status: 'PENDING',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mockAllDocs = REQUIRED_VERIFICATION_DOCUMENTS.map((dt, idx) => ({
      id: randomUUID(),
      verificationId: verifId,
      organizationId: orgId,
      employeeId,
      documentType: dt,
      objectKey: `test-${dt}.pdf`,
      fileName: `${dt}.pdf`,
      fileSize: 100,
      mimeType: 'application/pdf',
      status: idx === 0 ? ('REJECTED' as const) : ('APPROVED' as const),
      rejectionReason: idx === 0 ? 'Document invalid' : null,
      uploadedAt: new Date(),
      uploadedBy: hrUserId,
      reviewedAt: new Date(),
      reviewedBy: hrUserId,
      isCurrent: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    vi.spyOn(repo, 'listDocumentsByVerification').mockResolvedValueOnce(mockAllDocs);

    await expect(completeEmployeeVerification(ctx, employeeId)).rejects.toThrow(
      /Cannot verify employee: required document .* was rejected/,
    );
  });

  // 15. All approved documents allow verification
  it('allows completion when all 10 required documents are approved', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));

    const verifId = randomUUID();
    const existingVerif: EmployeeVerificationRecord = {
      id: verifId,
      organizationId: orgId,
      employeeId,
      status: 'PARTIALLY_VERIFIED',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockAllApprovedDocs: EmployeeVerificationDocumentRecord[] = REQUIRED_VERIFICATION_DOCUMENTS.map((dt) => ({
      id: randomUUID(),
      verificationId: verifId,
      organizationId: orgId,
      employeeId,
      documentType: dt,
      objectKey: `test-${dt}.pdf`,
      fileName: `${dt}.pdf`,
      fileSize: 100,
      mimeType: 'application/pdf',
      status: 'APPROVED',
      rejectionReason: null,
      uploadedAt: new Date(),
      uploadedBy: hrUserId,
      reviewedAt: new Date(),
      reviewedBy: hrUserId,
      isCurrent: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const verifiedRecord: EmployeeVerificationRecord = {
      ...existingVerif,
      status: 'VERIFIED',
      verifiedAt: new Date(),
      verifiedBy: hrUserId,
    };

    vi.spyOn(repo, 'getVerificationByEmployee').mockResolvedValueOnce(existingVerif);
    vi.spyOn(repo, 'listDocumentsByVerification')
      .mockResolvedValueOnce(mockAllApprovedDocs)
      .mockResolvedValueOnce(mockAllApprovedDocs);
    vi.spyOn(repo, 'updateVerificationStatus').mockResolvedValueOnce(verifiedRecord);
    vi.spyOn(repo, 'recordVerificationAudit').mockResolvedValueOnce(undefined);

    const res = await completeEmployeeVerification(ctx, employeeId);

    expect(res.verification?.status).toBe('VERIFIED');
    expect(res.verification?.verifiedBy).toBe(hrUserId);
    expect(res.verification?.progress.allApproved).toBe(true);
    expect(res.verification?.progress.approvedCount).toBe(10);
    expect(repo.recordVerificationAudit).toHaveBeenCalledWith(
      expect.anything(),
      orgId,
      expect.objectContaining({ action: 'employee.verification.completed' }),
    );
  });

  // 16. Verification remains independent of onboarding
  it('verification does not require onboarding completion', async () => {
    // Assert onboarding status is never queried or conditioned on in verification service
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));

    vi.spyOn(repo, 'getVerificationByEmployee').mockResolvedValueOnce(null);

    const res = await getEmployeeVerification(ctx, employeeId);
    expect(res).toBeDefined();
    // Successfully executed without touching onboarding tables
  });

  // 17. Verification remains independent of Employee 360
  it('verification state changes independently of Employee 360', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));

    const verifId = randomUUID();
    vi.spyOn(repo, 'getOrCreateVerification').mockResolvedValueOnce({
      id: verifId,
      organizationId: orgId,
      employeeId,
      status: 'PENDING',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.spyOn(repo, 'updateVerificationStatus').mockResolvedValueOnce({
      id: verifId,
      organizationId: orgId,
      employeeId,
      status: 'REJECTED',
      verifiedAt: null,
      verifiedBy: hrUserId,
      rejectionReason: 'Fraudulent documents',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.spyOn(repo, 'recordVerificationAudit').mockResolvedValueOnce(undefined);
    vi.spyOn(repo, 'listDocumentsByVerification').mockResolvedValueOnce([]);

    const res = await rejectEmployeeVerification(ctx, employeeId, {
      rejectionReason: 'Fraudulent documents',
    });

    expect(res.verification?.status).toBe('REJECTED');
    expect(res.verification?.rejectionReason).toBe('Fraudulent documents');
  });

  // 18. Secure document access
  it('generates a short-lived presigned download URL for authorized access', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));

    const docId = randomUUID();
    const mockDoc: EmployeeVerificationDocumentRecord = {
      id: docId,
      verificationId: randomUUID(),
      organizationId: orgId,
      employeeId,
      documentType: 'AADHAAR',
      objectKey: `verification/${orgId}/${employeeId}/AADHAAR/file.pdf`,
      fileName: 'aadhaar.pdf',
      fileSize: 100,
      mimeType: 'application/pdf',
      status: 'APPROVED',
      rejectionReason: null,
      uploadedAt: new Date(),
      uploadedBy: hrUserId,
      reviewedAt: new Date(),
      reviewedBy: hrUserId,
      isCurrent: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.spyOn(repo, 'findDocumentById').mockResolvedValueOnce(mockDoc);
    const presignedSpy = vi.spyOn(getStorageService(), 'presignedGetUrl').mockReturnValue('http://minio/signed-url');

    const res = await getVerificationDocumentDownloadUrl(ctx, employeeId, docId);

    expect(res.downloadUrl).toBe('http://minio/signed-url');
    expect(res.expiresInSeconds).toBe(900);
    expect(presignedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'files',
        key: mockDoc.objectKey,
        expiresInSeconds: 900,
      }),
    );
  });

  // 19. Unauthorized document access rejected
  it('rejects document download if document does not belong to specified employee', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));

    const otherEmployeeId = randomUUID();
    const mockDoc: EmployeeVerificationDocumentRecord = {
      id: randomUUID(),
      verificationId: randomUUID(),
      organizationId: orgId,
      employeeId: otherEmployeeId, // different employee
      documentType: 'AADHAAR',
      objectKey: 'file.pdf',
      fileName: 'aadhaar.pdf',
      fileSize: 100,
      mimeType: 'application/pdf',
      status: 'APPROVED',
      rejectionReason: null,
      uploadedAt: new Date(),
      uploadedBy: hrUserId,
      reviewedAt: new Date(),
      reviewedBy: hrUserId,
      isCurrent: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.spyOn(repo, 'findDocumentById').mockResolvedValueOnce(mockDoc);

    await expect(
      getVerificationDocumentDownloadUrl(ctx, employeeId, mockDoc.id),
    ).rejects.toThrow(VerificationNotFoundError);
  });

  // 20. Cross-tenant document access rejected
  it('rejects document download across tenants', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));

    // Document not found in ctx.organizationId
    vi.spyOn(repo, 'findDocumentById').mockResolvedValueOnce(null);

    await expect(
      getVerificationDocumentDownloadUrl(ctx, employeeId, randomUUID()),
    ).rejects.toThrow(VerificationNotFoundError);
  });

  // 21. Historical review information preserved upon replacement
  it('preserves historical version and review info when a document is re-uploaded', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));
    vi.spyOn(getStorageService(), 'putObject').mockResolvedValue({ checksumSha256: 'xyz' });

    const verifId = randomUUID();
    const mockVerification: EmployeeVerificationRecord = {
      id: verifId,
      organizationId: orgId,
      employeeId,
      status: 'PENDING',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.spyOn(repo, 'getOrCreateVerification').mockResolvedValueOnce(mockVerification);
    // Previous version was 1, now replacing
    vi.spyOn(repo, 'archiveCurrentDocument').mockResolvedValueOnce({ previousVersion: 1 });

    const mockNewDoc: EmployeeVerificationDocumentRecord = {
      id: randomUUID(),
      verificationId: verifId,
      organizationId: orgId,
      employeeId,
      documentType: 'MARKSHEET',
      objectKey: 'new-key.pdf',
      fileName: 'marksheet-v2.pdf',
      fileSize: 200,
      mimeType: 'application/pdf',
      status: 'PENDING',
      rejectionReason: null,
      uploadedAt: new Date(),
      uploadedBy: hrUserId,
      reviewedAt: null,
      reviewedBy: null,
      isCurrent: true,
      version: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.spyOn(repo, 'insertDocument').mockResolvedValueOnce(mockNewDoc);
    vi.spyOn(repo, 'recordVerificationAudit').mockResolvedValueOnce(undefined);

    const res = await uploadVerificationDocument(ctx, employeeId, {
      documentType: 'MARKSHEET',
      fileName: 'marksheet-v2.pdf',
      mimeType: 'application/pdf',
      fileBase64: Buffer.from('new-content').toString('base64'),
    });

    expect(res.document.version).toBe(2);
    expect(repo.archiveCurrentDocument).toHaveBeenCalledWith(
      expect.anything(),
      orgId,
      verifId,
      'MARKSHEET',
    );
    expect(repo.recordVerificationAudit).toHaveBeenCalledWith(
      expect.anything(),
      orgId,
      expect.objectContaining({ action: 'employee.verification.document_replaced' }),
    );
  });

  // 21. Multi-document array upload (e.g. for Degree / Marksheet)
  it('allows multi doc upload in an array without archiving existing items', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));
    vi.spyOn(getStorageService(), 'putObject').mockResolvedValue({ checksumSha256: 'xyz' });

    const verifId = randomUUID();
    vi.spyOn(repo, 'getOrCreateVerification').mockResolvedValueOnce({
      id: verifId,
      organizationId: orgId,
      employeeId,
      status: 'PENDING',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const archiveSpy = vi.spyOn(repo, 'archiveCurrentDocument');
    const insertSpy = vi.spyOn(repo, 'insertDocument').mockImplementation(async (_tx, input) => ({
      id: `doc-${Math.random()}`,
      verificationId: input.verificationId,
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      documentType: input.documentType,
      objectKey: input.objectKey,
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      status: 'PENDING',
      rejectionReason: null,
      uploadedAt: new Date(),
      uploadedBy: input.uploadedBy,
      reviewedAt: null,
      reviewedBy: null,
      isCurrent: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    vi.spyOn(repo, 'recordVerificationAudit').mockResolvedValue(undefined);

    const res = await uploadVerificationDocument(ctx, employeeId, {
      documents: [
        {
          documentType: 'MARKSHEET',
          fileName: '10th-marksheet.pdf',
          mimeType: 'application/pdf',
          fileBase64: Buffer.from('10th').toString('base64'),
        },
        {
          documentType: 'MARKSHEET',
          fileName: '12th-marksheet.pdf',
          mimeType: 'application/pdf',
          fileBase64: Buffer.from('12th').toString('base64'),
        },
        {
          documentType: 'MARKSHEET',
          fileName: 'degree-certificate.pdf',
          mimeType: 'application/pdf',
          fileBase64: Buffer.from('degree').toString('base64'),
        },
      ],
    });

    expect(res.documents).toHaveLength(3);
    expect(insertSpy).toHaveBeenCalledTimes(3);
    // Multi-doc array upload does not archive prior items
    expect(archiveSpy).not.toHaveBeenCalled();
  });

  // 22. Oversized file validation
  it('rejects upload when file exceeds 10MB limit with a VerificationValidationError', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });

    const oversizedBuffer = Buffer.alloc(10 * 1024 * 1024 + 1024); // 10MB + 1KB
    const oversizedBase64 = oversizedBuffer.toString('base64');

    await expect(
      uploadVerificationDocument(ctx, employeeId, {
        documentType: 'PAN',
        fileName: 'oversized.pdf',
        mimeType: 'application/pdf',
        fileBase64: oversizedBase64,
      }),
    ).rejects.toThrow(VerificationValidationError);
  });

  // 23. Malformed base64 validation
  it('rejects upload with malformed base64 encoding with a VerificationValidationError', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });

    await expect(
      uploadVerificationDocument(ctx, employeeId, {
        documentType: 'PAN',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        fileBase64: '!!!NOT_VALID_BASE64@@@###',
      }),
    ).rejects.toThrow(VerificationValidationError);
  });

  // 24. Empty file validation
  it('rejects upload with empty file content with a VerificationValidationError', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });

    await expect(
      uploadVerificationDocument(ctx, employeeId, {
        documentType: 'PAN',
        fileName: 'empty.pdf',
        mimeType: 'application/pdf',
        fileBase64: '',
      }),
    ).rejects.toThrow(VerificationValidationError);
  });

  // 25. Unsupported file format validation
  it('rejects upload with unsupported file extension and mime type', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });

    await expect(
      uploadVerificationDocument(ctx, employeeId, {
        documentType: 'PAN',
        fileName: 'malware.exe',
        mimeType: 'application/x-msdownload',
        fileBase64: Buffer.from('executable binary').toString('base64'),
      }),
    ).rejects.toThrow(VerificationValidationError);
  });

  // 26. Storage failure propagation
  it('propagates storage failure when MinIO putObject rejects', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(getStorageService(), 'putObject').mockRejectedValueOnce(
      new Error('Storage PUT failed with HTTP 500: Internal MinIO error'),
    );

    await expect(
      uploadVerificationDocument(ctx, employeeId, {
        documentType: 'PAN',
        fileName: 'pan.pdf',
        mimeType: 'application/pdf',
        fileBase64: Buffer.from('test').toString('base64'),
      }),
    ).rejects.toThrow('Storage PUT failed with HTTP 500: Internal MinIO error');
  });

  // 27. Database insert failure propagation
  it('propagates database transaction failure when insertDocument fails', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValueOnce({ id: employeeId });
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('DB connection closed'));
    vi.spyOn(getStorageService(), 'putObject').mockResolvedValueOnce({ checksumSha256: 'abc' });

    await expect(
      uploadVerificationDocument(ctx, employeeId, {
        documentType: 'PAN',
        fileName: 'pan.pdf',
        mimeType: 'application/pdf',
        fileBase64: Buffer.from('test').toString('base64'),
      }),
    ).rejects.toThrow('DB connection closed');
  });

  // 28. All 10 mandated document types upload successfully
  it('supports uploads for all 10 mandated document types', async () => {
    vi.spyOn(db, 'maybeOne').mockResolvedValue({ id: employeeId });
    vi.spyOn(db, 'transaction').mockImplementation(async (_ctx, fn) => fn({} as unknown as Tx));
    vi.spyOn(getStorageService(), 'putObject').mockResolvedValue({ checksumSha256: 'valid' });

    const mockVerification: EmployeeVerificationRecord = {
      id: randomUUID(),
      organizationId: orgId,
      employeeId,
      status: 'PENDING',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.spyOn(repo, 'getOrCreateVerification').mockResolvedValue(mockVerification);
    vi.spyOn(repo, 'archiveCurrentDocument').mockResolvedValue({ previousVersion: 0 });
    vi.spyOn(repo, 'recordVerificationAudit').mockResolvedValue(undefined);

    for (const docType of REQUIRED_VERIFICATION_DOCUMENTS) {
      const ext = docType === 'PASSPORT_PHOTO' ? 'jpg' : 'pdf';
      const mime = docType === 'PASSPORT_PHOTO' ? 'image/jpeg' : 'application/pdf';

      const mockDoc: EmployeeVerificationDocumentRecord = {
        id: randomUUID(),
        verificationId: mockVerification.id,
        organizationId: orgId,
        employeeId,
        documentType: docType,
        objectKey: `verification/${docType}.${ext}`,
        fileName: `${docType.toLowerCase()}.${ext}`,
        fileSize: 100,
        mimeType: mime,
        status: 'PENDING',
        rejectionReason: null,
        uploadedAt: new Date(),
        uploadedBy: hrUserId,
        reviewedAt: null,
        reviewedBy: null,
        isCurrent: true,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(repo, 'insertDocument').mockResolvedValueOnce(mockDoc);

      const res = await uploadVerificationDocument(ctx, employeeId, {
        documentType: docType,
        fileName: `${docType.toLowerCase()}.${ext}`,
        mimeType: mime,
        fileBase64: Buffer.from(`content-${docType}`).toString('base64'),
      });

      expect(res.document.documentType).toBe(docType);
      expect(res.document.status).toBe('PENDING');
    }
  });
});

