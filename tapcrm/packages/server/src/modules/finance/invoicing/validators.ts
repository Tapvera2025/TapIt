import { z } from 'zod';
const uuid=z.string().uuid(); const date=z.string().date(); const money=z.string().regex(/^\d+(\.\d{1,2})?$/); const reason=z.string().trim().min(3).max(1000);
const source=z.object({sourceType:z.enum(['retainer','milestone','timesheet','billable_event','manual']),sourceId:uuid,description:z.string().trim().min(1).max(500),quantity:money,unitPrice:money,taxRate:z.string().regex(/^\d+(\.\d{1,2})?$/).default('0'),discount:money.default('0')});
export const draftSchema=z.object({clientId:uuid,legalEntityId:uuid,contractId:uuid.nullable().optional(),periodStart:date,periodEnd:date,currency:z.string().regex(/^[A-Z]{3}$/),purchaseOrderNumber:z.string().trim().max(100).nullable().optional(),sources:z.array(source).min(1).max(500),reason}).superRefine((value,ctx)=>{const ids=value.sources.map((item)=>item.sourceId);if(new Set(ids).size!==ids.length)ctx.addIssue({code:z.ZodIssueCode.custom,path:['sources'],message:'A source may appear only once in an invoice draft.'});});
export const reviewSchema=z.object({reason});
export const confirmSchema=z.object({reviewToken:z.string().min(32).max(200),manifestFingerprint:z.string().length(64),reason});
export const batchReviewSchema=z.object({draftIds:z.array(uuid).min(1).max(100),reason});
export const batchConfirmSchema=z.object({batchToken:z.string().min(32).max(200),manifestFingerprint:z.string().length(64),reason});
export type DraftInput=z.infer<typeof draftSchema>; export type ReviewInput=z.infer<typeof reviewSchema>; export type ConfirmInput=z.infer<typeof confirmSchema>; export type BatchReviewInput=z.infer<typeof batchReviewSchema>; export type BatchConfirmInput=z.infer<typeof batchConfirmSchema>;
