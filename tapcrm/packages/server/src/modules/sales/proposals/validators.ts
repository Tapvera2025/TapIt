/**
 * Sales v1.1 R2 — Proposal (Commercials) input validators (R2 plan step 2.9).
 *
 * Re-exports the commercials body schema and adds the optimistic-lock
 * envelope used by updateDraft. The service runs `recompute()` against
 * the body and only persists after the server-side math is authoritative.
 */

import { z } from 'zod';
import { commercialsBodySchema } from '../commercials/validators.js';

export { commercialsBodySchema } from '../commercials/validators.js';
export type { CommercialsBodyInput } from '../commercials/validators.js';

export const createDraftSchema = commercialsBodySchema;
export type CreateDraftInput = z.infer<typeof createDraftSchema>;

/**
 * Optimistic lock: client echoes the `updatedAt` it last saw. The service
 * compares inside a transactional lock and rejects with 409 on drift,
 * returning the server copy in the error details.
 */
export const updateDraftSchema = z.object({
  expectedUpdatedAt: z.coerce.date(),
  body: commercialsBodySchema,
});
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;
