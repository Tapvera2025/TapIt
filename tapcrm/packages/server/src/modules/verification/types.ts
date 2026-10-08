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

export const REQUIRED_VERIFICATION_DOCUMENTS: readonly VerificationDocumentType[] = [
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
];

export const VERIFICATION_STATUSES = [
  'PENDING',
  'PARTIALLY_VERIFIED',
  'VERIFIED',
  'REJECTED',
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const DOCUMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface EmployeeVerificationRecord {
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

export interface EmployeeVerificationDocumentRecord {
  id: string;
  verificationId: string;
  organizationId: string;
  employeeId: string;
  documentType: VerificationDocumentType;
  objectKey: string;
  fileName: string;
  fileSize: number;
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
