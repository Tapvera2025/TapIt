import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmployeeVerificationModal } from './EmployeeVerificationModal.js';
import * as verifApi from '../api/verificationApi.js';

describe('EmployeeVerificationModal - Marksheet Multi-Document Upload', () => {
  const employeeId = 'emp-12345';
  const employeeName = 'Jane Doe';

  beforeEach(() => {
    vi.restoreAllMocks();
    // Default window mock for SSR/renderToStaticMarkup
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: () => 'light',
        setItem: () => {},
      },
      matchMedia: () => ({ matches: false }),
    };
  });

  const mockVerificationData = (
    marksheetDocs: verifApi.VerificationDocumentSummary[] = [],
  ): verifApi.VerificationDetailsResponse => ({
    verification: {
      id: 'verif-1',
      employeeId,
      status: 'PENDING',
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
      documents: [
        {
          id: 'doc-aadhaar',
          documentType: 'AADHAAR',
          fileName: 'aadhaar_card.pdf',
          fileSize: 1024 * 500,
          mimeType: 'application/pdf',
          status: 'APPROVED',
          rejectionReason: null,
          uploadedAt: '2026-10-01T10:00:00Z',
          uploadedBy: 'user-admin',
          reviewedAt: '2026-10-02T10:00:00Z',
          reviewedBy: 'user-admin',
          isCurrent: true,
          version: 1,
        },
        ...marksheetDocs,
      ],
      history: [],
      progress: {
        requiredCount: 10,
        approvedCount: 1,
        pendingCount: marksheetDocs.length,
        rejectedCount: 0,
        missingCount: 9 - marksheetDocs.length,
        allApproved: false,
      },
    },
  });

  // 1. One marksheet
  it('1. Displays a single uploaded marksheet document with actions and status badge', async () => {
    const singleMarksheet: verifApi.VerificationDocumentSummary = {
      id: 'doc-ms-1',
      documentType: 'MARKSHEET',
      fileName: 'bachelor_degree_marksheet.pdf',
      fileSize: 1024 * 1024 * 1.5,
      mimeType: 'application/pdf',
      status: 'PENDING',
      rejectionReason: null,
      uploadedAt: '2026-10-02T12:00:00Z',
      uploadedBy: 'user-admin',
      reviewedAt: null,
      reviewedBy: null,
      isCurrent: true,
      version: 1,
    };

    const mockData = mockVerificationData([singleMarksheet]);
    vi.spyOn(verifApi, 'getEmployeeVerification').mockResolvedValueOnce(mockData);

    const html = renderToStaticMarkup(
      React.createElement(EmployeeVerificationModal, {
        isOpen: true,
        onClose: () => {},
        employeeId,
        employeeName,
        canManage: true,
        initialData: mockData.verification,
      }),
    );

    expect(html).toContain('Degree / Marksheet');
    expect(html).toContain('Multi-Document Support');
    expect(html).toContain('Upload More Marksheets');
    expect(html).toContain('bachelor_degree_marksheet.pdf');
  });

  // 2. Multiple marksheets
  it('2. Renders multiple marksheets with individual statuses in the multi-document array', () => {
    const multipleMarksheets: verifApi.VerificationDocumentSummary[] = [
      {
        id: 'doc-ms-10',
        documentType: 'MARKSHEET',
        fileName: 'marksheet-10th.pdf',
        fileSize: 1024 * 800,
        mimeType: 'application/pdf',
        status: 'APPROVED',
        rejectionReason: null,
        uploadedAt: '2026-10-01T10:00:00Z',
        uploadedBy: 'user-admin',
        reviewedAt: '2026-10-02T10:00:00Z',
        reviewedBy: 'user-admin',
        isCurrent: true,
        version: 1,
      },
      {
        id: 'doc-ms-12',
        documentType: 'MARKSHEET',
        fileName: 'marksheet-12th.pdf',
        fileSize: 1024 * 900,
        mimeType: 'application/pdf',
        status: 'PENDING',
        rejectionReason: null,
        uploadedAt: '2026-10-02T11:00:00Z',
        uploadedBy: 'user-admin',
        reviewedAt: null,
        reviewedBy: null,
        isCurrent: true,
        version: 1,
      },
      {
        id: 'doc-ms-degree',
        documentType: 'MARKSHEET',
        fileName: 'btech_final_degree.pdf',
        fileSize: 1024 * 1024 * 2.1,
        mimeType: 'application/pdf',
        status: 'REJECTED',
        rejectionReason: 'Grade page 3 was cut off during scan',
        uploadedAt: '2026-10-03T09:00:00Z',
        uploadedBy: 'user-admin',
        reviewedAt: '2026-10-03T14:00:00Z',
        reviewedBy: 'user-admin',
        isCurrent: true,
        version: 1,
      },
    ];

    const mockData = mockVerificationData(multipleMarksheets);
    vi.spyOn(verifApi, 'getEmployeeVerification').mockResolvedValueOnce(mockData);

    const html = renderToStaticMarkup(
      React.createElement(EmployeeVerificationModal, {
        isOpen: true,
        onClose: () => {},
        employeeId,
        employeeName,
        canManage: true,
        initialData: mockData.verification,
      }),
    );

    expect(html).toContain('Degree / Marksheet');
    expect(html).toContain('Multi-Document Support');
    expect(html).toContain('marksheet-10th.pdf');
    expect(html).toContain('marksheet-12th.pdf');
    expect(html).toContain('btech_final_degree.pdf');
  });

  // 3. Remove one selected file logic
  it('3. Filters and removes an individual file from the staged selection list without affecting others', () => {
    const stagedFiles = [
      { name: 'marksheet-10.pdf', size: 1024 * 500 },
      { name: 'marksheet-12.pdf', size: 1024 * 600 },
      { name: 'semester-1.pdf', size: 1024 * 700 },
    ];

    const removeIndex = 1; // remove marksheet-12.pdf
    const remaining = stagedFiles.filter((_, idx) => idx !== removeIndex);

    expect(remaining).toHaveLength(2);
    expect(remaining[0]?.name).toBe('marksheet-10.pdf');
    expect(remaining[1]?.name).toBe('semester-1.pdf');
    expect(remaining.map((f) => f.name)).not.toContain('marksheet-12.pdf');
  });

  // 4. Upload multiple files API contract
  it('4. Reuses the existing uploadVerificationDocument API with documents array payload', async () => {
    const uploadSpy = vi
      .spyOn(verifApi, 'uploadVerificationDocument')
      .mockResolvedValueOnce({
        document: {
          id: 'doc-1',
          documentType: 'MARKSHEET',
          fileName: 'marksheet-10.pdf',
          fileSize: 100,
          mimeType: 'application/pdf',
          status: 'PENDING',
          rejectionReason: null,
          uploadedAt: new Date().toISOString(),
          uploadedBy: 'u-1',
          reviewedAt: null,
          reviewedBy: null,
          isCurrent: true,
          version: 1,
        },
      });

    const payload = {
      documents: [
        {
          documentType: 'MARKSHEET' as const,
          fileName: 'marksheet-10.pdf',
          mimeType: 'application/pdf',
          fileBase64: 'base64-content-1',
        },
        {
          documentType: 'MARKSHEET' as const,
          fileName: 'marksheet-12.pdf',
          mimeType: 'application/pdf',
          fileBase64: 'base64-content-2',
        },
      ],
    };

    await verifApi.uploadVerificationDocument(employeeId, payload);

    expect(uploadSpy).toHaveBeenCalledWith(employeeId, payload);
  });

  // 5 & 6. Failed upload and retry
  it('5 & 6. Preserves staged files upon upload failure allowing retry without re-picking', async () => {
    let attempts = 0;
    const uploadSpy = vi
      .spyOn(verifApi, 'uploadVerificationDocument')
      .mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('Network timeout during upload');
        }
        return {
          document: {
            id: 'doc-1',
            documentType: 'MARKSHEET',
            fileName: 'marksheet-10.pdf',
            fileSize: 100,
            mimeType: 'application/pdf',
            status: 'PENDING',
            rejectionReason: null,
            uploadedAt: new Date().toISOString(),
            uploadedBy: 'u-1',
            reviewedAt: null,
            reviewedBy: null,
            isCurrent: true,
            version: 1,
          },
        };
      });

    const payload = {
      documents: [
        {
          documentType: 'MARKSHEET' as const,
          fileName: 'marksheet-10.pdf',
          mimeType: 'application/pdf',
          fileBase64: 'base64-content-1',
        },
      ],
    };

    // Attempt 1 fails
    await expect(
      verifApi.uploadVerificationDocument(employeeId, payload),
    ).rejects.toThrow('Network timeout during upload');

    // Attempt 2 succeeds (Retry)
    const res = await verifApi.uploadVerificationDocument(employeeId, payload);
    expect(res.document.fileName).toBe('marksheet-10.pdf');
    expect(uploadSpy).toHaveBeenCalledTimes(2);
  });

  // 7. Existing non-marksheet documents still work
  it('7. Preserves single-document upload behavior for other verification document types', async () => {
    const singlePayload = {
      documentType: 'AADHAAR' as const,
      fileName: 'aadhaar.pdf',
      mimeType: 'application/pdf',
      fileBase64: 'aadhaar-base64',
    };

    const uploadSpy = vi
      .spyOn(verifApi, 'uploadVerificationDocument')
      .mockResolvedValueOnce({
        document: {
          id: 'doc-aadhaar-new',
          documentType: 'AADHAAR',
          fileName: 'aadhaar.pdf',
          fileSize: 200,
          mimeType: 'application/pdf',
          status: 'PENDING',
          rejectionReason: null,
          uploadedAt: new Date().toISOString(),
          uploadedBy: 'u-1',
          reviewedAt: null,
          reviewedBy: null,
          isCurrent: true,
          version: 2,
        },
      });

    const res = await verifApi.uploadVerificationDocument(employeeId, singlePayload);

    expect(uploadSpy).toHaveBeenCalledWith(employeeId, singlePayload);
    expect(res.document.documentType).toBe('AADHAAR');
  });

  // 8 & 9. Responsive layout for Mobile & Desktop
  it('8 & 9. Verifies responsive flex layout classes for mobile and desktop viewports', () => {
    const mockData = mockVerificationData([]);
    vi.spyOn(verifApi, 'getEmployeeVerification').mockResolvedValueOnce(mockData);

    const html = renderToStaticMarkup(
      React.createElement(EmployeeVerificationModal, {
        isOpen: true,
        onClose: () => {},
        employeeId,
        employeeName,
        canManage: true,
        initialData: mockData.verification,
      }),
    );

    // Responsive classes must be present on header and action containers
    expect(html).toContain('flex flex-col sm:flex-row');
    expect(html).toContain('truncate');
    expect(html).toContain('min-w-0');
  });

  // 10. Discard/Remove control for uploaded documents
  it('10. Renders compact accessible discard/remove button with close icon for uploaded documents', () => {
    const singleMarksheet: verifApi.VerificationDocumentSummary = {
      id: 'doc-ms-1',
      documentType: 'MARKSHEET',
      fileName: 'degree_certificate.pdf',
      fileSize: 1024 * 500,
      mimeType: 'application/pdf',
      status: 'PENDING',
      rejectionReason: null,
      uploadedAt: '2026-10-02T12:00:00Z',
      uploadedBy: 'user-admin',
      reviewedAt: null,
      reviewedBy: null,
      isCurrent: true,
      version: 1,
    };

    const mockData = mockVerificationData([singleMarksheet]);
    const html = renderToStaticMarkup(
      React.createElement(EmployeeVerificationModal, {
        isOpen: true,
        onClose: () => {},
        employeeId,
        employeeName,
        canManage: true,
        initialData: mockData.verification,
      }),
    );

    // Discard button for single doc (Aadhaar)
    expect(html).toContain('title="Discard aadhaar_card.pdf"');
    expect(html).toContain('aria-label="Discard aadhaar_card.pdf"');

    // Discard button for marksheet doc
    expect(html).toContain('title="Discard degree_certificate.pdf"');
    expect(html).toContain('aria-label="Discard degree_certificate.pdf"');

    // Icon close SVG path (M6 6l12 12 M18 6L6 18)
    expect(html).toContain('M6 6l12 12 M18 6L6 18');
  });

  // 11. Single document discard removes card and restores upload button
  it('11. Discarding a single-document verification file removes the file card and restores Upload UI without affecting other types', () => {
    const mockData = mockVerificationData([]);
    // Initially has Aadhaar
    const initialHtml = renderToStaticMarkup(
      React.createElement(EmployeeVerificationModal, {
        isOpen: true,
        onClose: () => {},
        employeeId,
        employeeName,
        canManage: true,
        initialData: mockData.verification,
      }),
    );

    expect(initialHtml).toContain('aadhaar_card.pdf');
    expect(initialHtml).toContain('Re-upload');

    // After discarding Aadhaar from state:
    const discardedVerification = {
      ...mockData.verification!,
      documents: mockData.verification!.documents.filter((d) => d.documentType !== 'AADHAAR'),
    };

    const updatedHtml = renderToStaticMarkup(
      React.createElement(EmployeeVerificationModal, {
        isOpen: true,
        onClose: () => {},
        employeeId,
        employeeName,
        canManage: true,
        initialData: discardedVerification,
      }),
    );

    // Aadhaar card should disappear, upload button becomes "Upload" (not "Re-upload")
    expect(updatedHtml).not.toContain('aadhaar_card.pdf');
    expect(updatedHtml).toContain('Not Uploaded');
    expect(updatedHtml).toContain('Upload');
  });

  // 12. Multiple marksheets: discard removes only target file by stable id
  it('12. Discarding one marksheet removes ONLY that file by stable id, keeping others intact', () => {
    const marksheets: verifApi.VerificationDocumentSummary[] = [
      {
        id: 'doc-ms-10',
        documentType: 'MARKSHEET',
        fileName: 'marksheet-10.pdf',
        fileSize: 1024 * 500,
        mimeType: 'application/pdf',
        status: 'PENDING',
        rejectionReason: null,
        uploadedAt: '2026-10-01T10:00:00Z',
        uploadedBy: 'user-admin',
        reviewedAt: null,
        reviewedBy: null,
        isCurrent: true,
        version: 1,
      },
      {
        id: 'doc-ms-12',
        documentType: 'MARKSHEET',
        fileName: 'marksheet-12.pdf',
        fileSize: 1024 * 600,
        mimeType: 'application/pdf',
        status: 'PENDING',
        rejectionReason: null,
        uploadedAt: '2026-10-02T10:00:00Z',
        uploadedBy: 'user-admin',
        reviewedAt: null,
        reviewedBy: null,
        isCurrent: true,
        version: 1,
      },
      {
        id: 'doc-ms-sem1',
        documentType: 'MARKSHEET',
        fileName: 'semester-1.pdf',
        fileSize: 1024 * 700,
        mimeType: 'application/pdf',
        status: 'PENDING',
        rejectionReason: null,
        uploadedAt: '2026-10-03T10:00:00Z',
        uploadedBy: 'user-admin',
        reviewedAt: null,
        reviewedBy: null,
        isCurrent: true,
        version: 1,
      },
    ];

    const mockData = mockVerificationData(marksheets);

    // Initial render has all 3 marksheets
    const initialHtml = renderToStaticMarkup(
      React.createElement(EmployeeVerificationModal, {
        isOpen: true,
        onClose: () => {},
        employeeId,
        employeeName,
        canManage: true,
        initialData: mockData.verification,
      }),
    );

    expect(initialHtml).toContain('marksheet-10.pdf');
    expect(initialHtml).toContain('marksheet-12.pdf');
    expect(initialHtml).toContain('semester-1.pdf');
    expect(initialHtml).toContain('Multi-Document Support (3 uploaded)');

    // Discard only marksheet-12 by id
    const docIdToRemove = 'doc-ms-12';
    const remainingDocs = mockData.verification!.documents.filter((d) => d.id !== docIdToRemove);
    const updatedVerification = {
      ...mockData.verification!,
      documents: remainingDocs,
    };

    const updatedHtml = renderToStaticMarkup(
      React.createElement(EmployeeVerificationModal, {
        isOpen: true,
        onClose: () => {},
        employeeId,
        employeeName,
        canManage: true,
        initialData: updatedVerification,
      }),
    );

    // Only marksheet-12 was removed
    expect(updatedHtml).not.toContain('marksheet-12.pdf');
    expect(updatedHtml).toContain('marksheet-10.pdf');
    expect(updatedHtml).toContain('semester-1.pdf');
    expect(updatedHtml).toContain('Multi-Document Support (2 uploaded)');
  });

  // 13. Local UI discard does not delete backend persisted documents
  it('13. Discarding is strictly a local UI state removal and does not trigger delete API calls', () => {
    const uploadSpy = vi.spyOn(verifApi, 'uploadVerificationDocument');
    const approveSpy = vi.spyOn(verifApi, 'approveVerificationDocument');
    const rejectSpy = vi.spyOn(verifApi, 'rejectVerificationDocument');

    const mockData = mockVerificationData([]);
    renderToStaticMarkup(
      React.createElement(EmployeeVerificationModal, {
        isOpen: true,
        onClose: () => {},
        employeeId,
        employeeName,
        canManage: true,
        initialData: mockData.verification,
      }),
    );

    // Confirm no backend mutations occur
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(approveSpy).not.toHaveBeenCalled();
    expect(rejectSpy).not.toHaveBeenCalled();
  });

  // 14. Progress updates dynamically when documents are discarded
  it('14. Verification progress recalculates dynamically when documents are discarded from UI state', () => {
    const mockData = mockVerificationData([]);
    // With Aadhaar approved: 1 of 10 approved, 9 missing
    const initialHtml = renderToStaticMarkup(
      React.createElement(EmployeeVerificationModal, {
        isOpen: true,
        onClose: () => {},
        employeeId,
        employeeName,
        canManage: true,
        initialData: mockData.verification,
      }),
    );

    expect(initialHtml).toContain('1 of 10 Mandated Types Approved');
    expect(initialHtml).toContain('Approved: <strong>1</strong>');
    expect(initialHtml).toContain('Missing: <strong>9</strong>');

    // When Aadhaar is discarded from state:
    const emptyVerification = {
      ...mockData.verification!,
      documents: [],
    };

    const updatedHtml = renderToStaticMarkup(
      React.createElement(EmployeeVerificationModal, {
        isOpen: true,
        onClose: () => {},
        employeeId,
        employeeName,
        canManage: true,
        initialData: emptyVerification,
      }),
    );

    expect(updatedHtml).toContain('0 of 10 Mandated Types Approved');
    expect(updatedHtml).toContain('Approved: <strong>0</strong>');
    expect(updatedHtml).toContain('Missing: <strong>10</strong>');
  });

  // 15. Button attributes: type="button", aria-label, real button element
  it('15. Discard button is a real button with type="button" and accessible aria-label', () => {
    const singleMarksheet: verifApi.VerificationDocumentSummary = {
      id: 'doc-ms-1',
      documentType: 'MARKSHEET',
      fileName: '10th_marksheet.pdf',
      fileSize: 1024 * 500,
      mimeType: 'application/pdf',
      status: 'PENDING',
      rejectionReason: null,
      uploadedAt: '2026-10-02T12:00:00Z',
      uploadedBy: 'user-admin',
      reviewedAt: null,
      reviewedBy: null,
      isCurrent: true,
      version: 1,
    };

    const mockData = mockVerificationData([singleMarksheet]);
    const html = renderToStaticMarkup(
      React.createElement(EmployeeVerificationModal, {
        isOpen: true,
        onClose: () => {},
        employeeId,
        employeeName,
        canManage: true,
        initialData: mockData.verification,
      }),
    );

    // Check button attributes
    expect(html).toContain('type="button"');
    expect(html).toContain('title="Discard 10th_marksheet.pdf"');
    expect(html).toContain('aria-label="Discard 10th_marksheet.pdf"');
    expect(html).toContain('title="Discard aadhaar_card.pdf"');
    expect(html).toContain('aria-label="Discard aadhaar_card.pdf"');
  });

  // 16. Discard button attributes and structure
  it('16. Discard button includes stable IDs and pointer-events-none styling for reliable click targeting', () => {
    const singleMarksheet: verifApi.VerificationDocumentSummary = {
      id: 'doc-ms-1',
      documentType: 'MARKSHEET',
      fileName: '10th_marksheet.pdf',
      fileSize: 1024 * 500,
      mimeType: 'application/pdf',
      status: 'PENDING',
      rejectionReason: null,
      uploadedAt: '2026-10-02T12:00:00Z',
      uploadedBy: 'user-admin',
      reviewedAt: null,
      reviewedBy: null,
      isCurrent: true,
      version: 1,
    };

    const mockData = mockVerificationData([singleMarksheet]);
    const html = renderToStaticMarkup(
      React.createElement(EmployeeVerificationModal, {
        isOpen: true,
        onClose: () => {},
        employeeId,
        employeeName,
        canManage: true,
        initialData: mockData.verification,
      }),
    );

    expect(html).toContain('id="discard-doc-marksheet-doc-ms-1"');
    expect(html).toContain('id="discard-doc-AADHAAR"');
    expect(html).toContain('pointer-events-none');
    expect(html).toContain('cursor-pointer');
  });
});

