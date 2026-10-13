import { peopleMutation, peopleRead } from './client.js';

export const VERIFICATION_DOCUMENT_TYPES = [
  'AADHAAR',
  'PAN',
  'VOTER_ID',
  'OFFER_LETTER',
  'PAYSLIP_1',
  'PAYSLIP_2',
  'PAYSLIP_3',
  'EXPERIENCE_LETTER',
  'MARKSHEET',
  'PASSPORT_PHOTO',
] as const;

export type VerificationDocumentType = (typeof VERIFICATION_DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<VerificationDocumentType, { label: string; description: string }> = {
  AADHAAR: {
    label: 'Aadhaar Card',
    description: 'Government issued unique identity card (front and back)',
  },
  PAN: {
    label: 'PAN Card',
    description: 'Permanent Account Number card issued by Income Tax Department',
  },
  VOTER_ID: {
    label: 'Voter ID Card',
    description: 'Election Commission voter identification card or equivalent',
  },
  OFFER_LETTER: {
    label: 'Offer Letter',
    description: 'Signed copy of company employment offer or appointment letter',
  },
  PAYSLIP_1: {
    label: 'Payslip (Month 1)',
    description: 'Salary slip of most recent previous employment month',
  },
  PAYSLIP_2: {
    label: 'Payslip (Month 2)',
    description: 'Salary slip of second most recent previous employment month',
  },
  PAYSLIP_3: {
    label: 'Payslip (Month 3)',
    description: 'Salary slip of third most recent previous employment month',
  },
  EXPERIENCE_LETTER: {
    label: 'Experience Letter',
    description: 'Relieving / experience certificate from previous employer',
  },
  MARKSHEET: {
    label: 'Degree / Marksheet',
    description: 'Highest qualification degree certificate or mark sheet',
  },
  PASSPORT_PHOTO: {
    label: 'Passport Photograph',
    description: 'Recent passport-sized formal photograph',
  },
};

export type VerificationStatus = 'PENDING' | 'PARTIALLY_VERIFIED' | 'VERIFIED' | 'REJECTED';
export type DocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface VerificationDocumentSummary {
  id: string;
  documentType: VerificationDocumentType;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: DocumentStatus;
  rejectionReason: string | null;
  uploadedAt: string;
  uploadedBy: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  isCurrent: boolean;
  version: number;
}

export interface VerificationDetailsResponse {
  verification: {
    id: string;
    employeeId: string;
    status: VerificationStatus;
    verifiedAt: string | null;
    verifiedBy: string | null;
    rejectionReason: string | null;
    documents: VerificationDocumentSummary[];
    history: VerificationDocumentSummary[];
    progress: {
      requiredCount: number;
      approvedCount: number;
      pendingCount: number;
      rejectedCount: number;
      missingCount: number;
      allApproved: boolean;
    };
  } | null;
}

export function getEmployeeVerification(employeeId: string): Promise<VerificationDetailsResponse> {
  return peopleRead<VerificationDetailsResponse>(`/api/users/${encodeURIComponent(employeeId)}/verification`, {
    staleMs: 0,
  });
}

export function initializeEmployeeVerification(employeeId: string): Promise<VerificationDetailsResponse> {
  return peopleMutation<VerificationDetailsResponse>(
    `/api/users/${encodeURIComponent(employeeId)}/verification`,
    { method: 'POST' },
    [`/api/users/${encodeURIComponent(employeeId)}/verification`],
  );
}

export function uploadVerificationDocument(
  employeeId: string,
  payload:
    | {
        documentType: VerificationDocumentType;
        fileName: string;
        mimeType: string;
        fileBase64: string;
      }
    | {
        documents: Array<{
          documentType: VerificationDocumentType;
          fileName: string;
          mimeType: string;
          fileBase64: string;
        }>;
      }
    | Array<{
        documentType: VerificationDocumentType;
        fileName: string;
        mimeType: string;
        fileBase64: string;
      }>,
): Promise<{ document: VerificationDocumentSummary; documents?: VerificationDocumentSummary[] }> {
  return peopleMutation<{ document: VerificationDocumentSummary; documents?: VerificationDocumentSummary[] }>(
    `/api/users/${encodeURIComponent(employeeId)}/verification/documents`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    [`/api/users/${encodeURIComponent(employeeId)}/verification`],
  );
}

export function getVerificationDocumentDownloadUrl(
  employeeId: string,
  docId: string,
): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
  return peopleRead<{ downloadUrl: string; expiresInSeconds: number }>(
    `/api/users/${encodeURIComponent(employeeId)}/verification/documents/${encodeURIComponent(docId)}/download`,
    { staleMs: 0 },
  );
}

export function approveVerificationDocument(
  employeeId: string,
  docId: string,
): Promise<{ document: VerificationDocumentSummary; verificationStatus: VerificationStatus }> {
  return peopleMutation<{ document: VerificationDocumentSummary; verificationStatus: VerificationStatus }>(
    `/api/users/${encodeURIComponent(employeeId)}/verification/documents/${encodeURIComponent(docId)}/approve`,
    { method: 'POST' },
    [`/api/users/${encodeURIComponent(employeeId)}/verification`],
  );
}

export function rejectVerificationDocument(
  employeeId: string,
  docId: string,
  rejectionReason: string,
): Promise<{ document: VerificationDocumentSummary }> {
  return peopleMutation<{ document: VerificationDocumentSummary }>(
    `/api/users/${encodeURIComponent(employeeId)}/verification/documents/${encodeURIComponent(docId)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ rejectionReason }),
    },
    [`/api/users/${encodeURIComponent(employeeId)}/verification`],
  );
}

export function completeEmployeeVerification(employeeId: string): Promise<VerificationDetailsResponse> {
  return peopleMutation<VerificationDetailsResponse>(
    `/api/users/${encodeURIComponent(employeeId)}/verification/complete`,
    { method: 'POST' },
    [`/api/users/${encodeURIComponent(employeeId)}/verification`],
  );
}

export function rejectEmployeeVerification(
  employeeId: string,
  rejectionReason: string,
): Promise<VerificationDetailsResponse> {
  return peopleMutation<VerificationDetailsResponse>(
    `/api/users/${encodeURIComponent(employeeId)}/verification/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ rejectionReason }),
    },
    [`/api/users/${encodeURIComponent(employeeId)}/verification`],
  );
}
