import { z } from 'zod';
import { LEAD_LOSS_REASONS } from '../leads/types.js';

export const handoverTargetQuerySchema = z.object({ leadId: z.string().uuid() });
export const createHandoverSchema = z.object({ leadId: z.string().uuid(), toUserId: z.string().uuid().optional(), handoverMode: z.enum(['direct', 'team_queue']).optional().default('direct'), reason: z.string().trim().min(1).max(1000).optional(), annotations: z.record(z.string(), z.unknown()).optional() }).superRefine((value, ctx) => { if (value.handoverMode === 'direct' && !value.toUserId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A direct handover target is required', path: ['toUserId'] }); if (value.handoverMode === 'team_queue' && value.toUserId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A queued handover cannot specify a direct target', path: ['toUserId'] }); });
export const declineHandoverSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
export const handoverDispositionSchema = z.object({ disposition: z.enum(['accepted', 'rejected', 'callback']), reason: z.string().trim().max(1000).optional(), lossReason: z.enum(LEAD_LOSS_REASONS).optional(), scheduledAt: z.coerce.date().optional(), annotations: z.record(z.string(), z.unknown()).optional() }).superRefine((value, ctx) => { if (value.disposition === 'rejected' && !value.lossReason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A structured loss reason is required', path: ['lossReason'] }); if (value.disposition === 'callback' && !value.scheduledAt) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A callback time is required', path: ['scheduledAt'] }); });
export const handoverListQuerySchema = z.object({ leadId: z.string().uuid().optional(), status: z.enum(['pending', 'accepted', 'declined', 'expired', 'all']).optional().default('all') });
export const handoverAnnotationSchema = z.object({ annotation: z.string().trim().min(1).max(2000) });

export type CreateHandoverInput = z.infer<typeof createHandoverSchema>;
export type DeclineHandoverInput = z.infer<typeof declineHandoverSchema>;
export type HandoverDispositionInput = z.infer<typeof handoverDispositionSchema>;
export type HandoverListQuery = z.infer<typeof handoverListQuerySchema>;
export type HandoverAnnotationInput = z.infer<typeof handoverAnnotationSchema>;
