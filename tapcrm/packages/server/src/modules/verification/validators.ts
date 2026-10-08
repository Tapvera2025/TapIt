import { z } from 'zod';
import { VERIFICATION_DOCUMENT_TYPES } from './types.js';

export const documentTypeSchema = z.enum(VERIFICATION_DOCUMENT_TYPES);

export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'doc',
  'docx',
]);

export function validateDocumentFile(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): { valid: boolean; error?: string } {
  if (buffer.length === 0) {
    return { valid: false, error: 'Document file cannot be empty' };
  }
  if (buffer.length > MAX_DOCUMENT_SIZE_BYTES) {
    return {
      valid: false,
      error: `Document exceeds maximum allowed size of 10MB (${(buffer.length / (1024 * 1024)).toFixed(1)}MB)`,
    };
  }

  const normalizedMime = mimeType.toLowerCase().trim();
  const ext = fileName.toLowerCase().split('.').pop() ?? '';

  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(normalizedMime) && !ALLOWED_DOCUMENT_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: 'Invalid file type. Allowed formats: PDF, JPEG, PNG, WEBP, DOC, DOCX',
    };
  }

  return { valid: true };
}

export const singleDocumentUploadSchema = z.object({
  documentType: documentTypeSchema,
  fileName: z.string().trim().min(1, 'File name is required').max(255),
  mimeType: z.string().trim().min(1, 'MIME type is required').max(100).default('application/pdf'),
  fileBase64: z.string().min(1, 'File content is required'),
  replace: z.boolean().optional(),
});

export const uploadVerificationDocumentSchema = z.union([
  singleDocumentUploadSchema,
  z.object({
    documents: z.array(singleDocumentUploadSchema).min(1, 'At least one document is required'),
  }),
  z.array(singleDocumentUploadSchema).min(1, 'At least one document is required'),
]);

export type SingleDocumentUploadInput = z.infer<typeof singleDocumentUploadSchema>;
export type UploadVerificationDocumentInput = z.infer<typeof uploadVerificationDocumentSchema>;

export const rejectDocumentSchema = z.object({
  rejectionReason: z.string().trim().min(1, 'Rejection reason is required').max(2000),
});

export type RejectDocumentInput = z.infer<typeof rejectDocumentSchema>;

export const rejectVerificationSchema = z.object({
  rejectionReason: z.string().trim().min(1, 'Rejection reason is required').max(2000),
});

export type RejectVerificationInput = z.infer<typeof rejectVerificationSchema>;
