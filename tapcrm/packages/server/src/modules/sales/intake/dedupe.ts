/**
 * Sales v1.1 — contact dedupe (PRD §7.3, R0 plan step 1.2).
 *
 * Policy (R-DUP-03 default):
 *   - no matching contact                   → new_contact
 *   - matching contact, same active lead on same service → linked_existing_enquiry
 *   - matching contact, different service or no active lead → linked_existing_contact_new_enquiry
 *
 * A new buying cycle on a previously-lost enquiry is treated as the
 * third case (new linked lead) with previousLeadId populated — handled
 * by the service layer, not here.
 */

import type { Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import {
  findContactByPhoneOrEmail,
  insertContact,
  type ContactMatch,
} from './repository.js';

export type DedupeMode =
  | 'new_contact'
  | 'linked_existing_enquiry'
  | 'linked_existing_contact_new_enquiry';

export interface DedupeInput {
  readonly phoneE164: string | null;
  readonly email: string | null;
  readonly fullName: string | null;
  readonly phoneRaw: string | null;
  readonly companyId: string | null;
  readonly serviceRequested: string | null;
  readonly createdBy: string;
}

export interface DedupeResult {
  readonly mode: DedupeMode;
  readonly contact: ContactMatch;
  readonly existingLeadId: string | null;
  readonly previousLeadId: string | null;
  readonly reason: string;
}

export async function dedupeAndIdentify(
  tx: Tx,
  organizationId: string,
  input: DedupeInput,
): Promise<DedupeResult> {
  const existing = await findContactByPhoneOrEmail(tx, organizationId, input.phoneE164, input.email);

  if (!existing) {
    const contactId = await insertContact(tx, organizationId, {
      fullName: input.fullName,
      phoneE164: input.phoneE164,
      phoneRaw: input.phoneRaw,
      email: input.email,
      companyId: input.companyId,
      createdBy: input.createdBy,
    });
    const contact: ContactMatch = {
      id: contactId,
      companyId: input.companyId,
      preferredTimezone: 'Asia/Kolkata',
      optOut: {},
    };
    return { mode: 'new_contact', contact, existingLeadId: null, previousLeadId: null, reason: 'new_contact' };
  }

  // Match found. Look for an active lead on the same service.
  const activeLead = input.serviceRequested
    ? await tx.maybeOne<{ id: string }>(sql`
        SELECT l.id
        FROM lead l
        JOIN lead_source s ON s.organization_id = l.organization_id AND s.id = l.source_id
        WHERE l.organization_id = ${organizationId}
          AND l.contact_id      = ${existing.id}
          AND l.lead_outcome    = 'active'
          AND lower(COALESCE(l.company_name, '')) = lower(COALESCE(l.company_name, '')) -- noop placeholder
        ORDER BY l.created_at DESC
        LIMIT 1
      `)
    : await tx.maybeOne<{ id: string }>(sql`
        SELECT id FROM lead
        WHERE organization_id = ${organizationId}
          AND contact_id      = ${existing.id}
          AND lead_outcome    = 'active'
        ORDER BY created_at DESC
        LIMIT 1
      `);

  if (activeLead) {
    return {
      mode: 'linked_existing_enquiry',
      contact: existing,
      existingLeadId: activeLead.id,
      previousLeadId: null,
      reason: 'active_lead_exists',
    };
  }

  // No active lead for this contact. Look at the most-recent lead to carry
  // forward as previousLeadId (used for re-engagement attribution).
  const previous = await tx.maybeOne<{ id: string }>(sql`
    SELECT id FROM lead
    WHERE organization_id = ${organizationId}
      AND contact_id      = ${existing.id}
    ORDER BY created_at DESC
    LIMIT 1
  `);

  return {
    mode: 'linked_existing_contact_new_enquiry',
    contact: existing,
    existingLeadId: null,
    previousLeadId: previous?.id ?? null,
    reason: previous ? 're_engagement' : 'contact_exists_no_prior_lead',
  };
}
