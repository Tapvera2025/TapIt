/**
 * Sales v1.1 R2 — Delivery brief input validators (R2 plan step 2.15).
 */

import { z } from 'zod';

const contentSchema = z.record(z.unknown()).default({});

export const startBriefSchema = z.object({
  commercialsId: z.string().uuid(),
  content: contentSchema.optional(),
});
export type StartBriefInput = z.infer<typeof startBriefSchema>;

export const updateBriefSchema = z.object({
  content: contentSchema,
  expectedUpdatedAt: z.coerce.date(),
});
export type UpdateBriefInput = z.infer<typeof updateBriefSchema>;

/**
 * Review verdicts (R-DEL-02):
 *   - `accept` must supply a `projectId` the brief should link to. The
 *     caller is expected to have created the project through the
 *     projects module beforehand; linking is idempotent on the brief.
 *   - `request_changes` captures notes the Sales owner must address.
 *   - `cancel` closes the brief with a reason. Cancellation after a
 *     deal is already `won` requires `deals:approve` (enforced in the
 *     service), reflecting R-DEL-02's "cancellation after Win is a
 *     separate event".
 */
export const reviewDecisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('accept'),
    projectId: z.string().uuid(),
  }),
  z.object({
    decision: z.literal('request_changes'),
    changeNotes: z.string().min(3).max(2000),
  }),
  z.object({
    decision: z.literal('cancel'),
    reason: z.string().min(3).max(500),
  }),
]);
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;
