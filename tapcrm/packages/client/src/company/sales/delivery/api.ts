import { identityRequest, IdentityApiError } from '../../../identity/api/authApi.js';

export const DELIVERY_BRIEF_STATES = [
  'draft',
  'submitted',
  'changes_requested',
  'accepted',
  'cancelled',
] as const;
export type DeliveryBriefState = (typeof DELIVERY_BRIEF_STATES)[number];

/**
 * Free-form content jsonb (R2 scope). The brief UI treats each named
 * section as a string; the server only requires it be a jsonb object.
 */
export type DeliveryBriefContent = Record<string, unknown>;

export interface DeliveryBrief {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly commercialsId: string;
  readonly state: DeliveryBriefState;
  readonly content: DeliveryBriefContent;
  readonly projectId: string | null;
  readonly submittedAt: string | null;
  readonly reviewedAt: string | null;
  readonly reviewedBy: string | null;
  readonly acceptedAt: string | null;
  readonly acceptedBy: string | null;
  readonly cancelledAt: string | null;
  readonly cancelledReason: string | null;
  readonly changeNotes: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ReviewDecisionInput =
  | { readonly decision: 'accept'; readonly projectId: string }
  | { readonly decision: 'request_changes'; readonly changeNotes: string }
  | { readonly decision: 'cancel'; readonly reason: string };

export async function getBriefForDeal(dealId: string): Promise<DeliveryBrief | null> {
  // The server's `GET /api/deals/:dealId/delivery-brief` returns `null`
  // when no brief exists yet; the envelope treats that as a successful
  // response carrying `null`.
  try {
    return await identityRequest<DeliveryBrief | null>(
      `/api/deals/${encodeURIComponent(dealId)}/delivery-brief`,
    );
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) return null;
    throw cause;
  }
}

export function startBrief(dealId: string, commercialsId: string): Promise<DeliveryBrief> {
  return identityRequest(`/api/deals/${encodeURIComponent(dealId)}/delivery-brief`, {
    method: 'POST',
    body: JSON.stringify({ commercialsId, content: {} }),
  });
}

export interface UpdateBriefResult {
  readonly brief?: DeliveryBrief;
  readonly stale?: { readonly serverCopy: DeliveryBrief; readonly actualUpdatedAt: string };
}

export async function patchBrief(
  id: string,
  input: { expectedUpdatedAt: string; content: DeliveryBriefContent },
): Promise<UpdateBriefResult> {
  try {
    const next = await identityRequest<DeliveryBrief>(
      `/api/delivery-briefs/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          expectedUpdatedAt: input.expectedUpdatedAt,
          content: input.content,
        }),
      },
    );
    return { brief: next };
  } catch (cause) {
    const stale = extractStaleWrite(cause);
    if (stale) return { stale };
    throw cause;
  }
}

function extractStaleWrite(
  cause: unknown,
): { serverCopy: DeliveryBrief; actualUpdatedAt: string } | null {
  if (!(cause instanceof IdentityApiError)) return null;
  if (cause.code !== 'DELIVERY_BRIEF_STALE_WRITE') return null;
  const details = cause.details;
  if (!details || typeof details !== 'object') return null;
  const serverCopy = (details as { serverCopy?: unknown }).serverCopy;
  const actualUpdatedAt = (details as { actualUpdatedAt?: unknown }).actualUpdatedAt;
  if (!serverCopy || typeof serverCopy !== 'object' || typeof actualUpdatedAt !== 'string') {
    return null;
  }
  return { serverCopy: serverCopy as DeliveryBrief, actualUpdatedAt };
}

export function submitBrief(id: string): Promise<DeliveryBrief> {
  return identityRequest(`/api/delivery-briefs/${encodeURIComponent(id)}/submit`, {
    method: 'POST',
  });
}

export function reviewBrief(id: string, input: ReviewDecisionInput): Promise<DeliveryBrief> {
  return identityRequest(`/api/delivery-briefs/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
