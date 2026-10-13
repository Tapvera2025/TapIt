import { z } from 'zod';
import { APPROVAL_VERDICTS } from './types.js';

export const requestApprovalSchema = z.object({
  commercialsId: z.string().uuid(),
});
export type RequestApprovalInput = z.infer<typeof requestApprovalSchema>;

export const decideSchema = z.object({
  verdict: z.enum(APPROVAL_VERDICTS),
  comment: z.string().trim().min(1).max(2000).optional(),
});
export type DecideSchemaInput = z.infer<typeof decideSchema>;
