/**
 * Sales v1.1 R2 — Contract input validators (R2 plan step 2.12).
 */

import { z } from 'zod';

export const createDraftSchema = z.object({
  commercialsId: z.string().uuid(),
  draftFileId: z.string().uuid().nullish(),
});
export type CreateDraftInput = z.infer<typeof createDraftSchema>;

export const markSentSchema = z.object({
  signerName: z.string().min(1).max(200),
  signerEmail: z.string().email().max(320),
  draftFileId: z.string().uuid().nullish(),
});
export type MarkSentInput = z.infer<typeof markSentSchema>;

export const recordSignatureSchema = z.object({
  signedFileId: z.string().uuid(),
  checksum: z.string().min(32).max(128),
  signerEvidence: z
    .object({
      ip: z.string().nullish(),
      userAgent: z.string().nullish(),
      signedAt: z.string().nullish(),
      method: z.string().nullish(),
      fileChecksum: z.string().nullish(),
    })
    .passthrough()
    .default({}),
});
export type RecordSignatureInput = z.infer<typeof recordSignatureSchema>;

export const voidContractSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type VoidContractInput = z.infer<typeof voidContractSchema>;

export const amendContractSchema = z.object({
  commercialsId: z.string().uuid(),
  draftFileId: z.string().uuid().nullish(),
});
export type AmendContractInput = z.infer<typeof amendContractSchema>;
