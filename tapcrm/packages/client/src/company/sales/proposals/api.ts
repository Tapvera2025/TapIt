import { identityRequest } from '../../../identity/api/authApi.js';

export type CommercialsState =
  | 'draft'
  | 'published'
  | 'superseded'
  | 'expired'
  | 'accepted'
  | 'rejected';

export interface CommercialsItemWire {
  readonly id: string;
  readonly commercialsId: string;
  readonly serviceName: string;
  readonly description: string | null;
  readonly quantity: string;
  readonly unitPriceMinor: string;
  readonly itemDiscountMinor: string;
  readonly taxCategory: string;
  readonly taxRateBps: number;
  readonly lineTotalMinor: string;
  readonly milestone: string | null;
  readonly sortOrder: number;
}

export interface CommercialsWire {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly version: number;
  readonly state: CommercialsState;
  readonly currency: string;
  readonly subtotalMinor: string;
  readonly discountMinor: string;
  readonly taxMinor: string;
  readonly totalMinor: string;
  readonly advanceMinor: string;
  readonly validityAt: string | null;
  readonly scope: string | null;
  readonly exclusions: string | null;
  readonly timeline: string | null;
  readonly terms: string | null;
  readonly pdfChecksum: string | null;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  readonly acceptedAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly items: readonly CommercialsItemWire[];
}

/** Decoded commercials with bigint minor-unit fields for arithmetic-free display. */
export interface Commercials {
  readonly id: string;
  readonly organizationId: string;
  readonly dealId: string;
  readonly version: number;
  readonly state: CommercialsState;
  readonly currency: string;
  readonly subtotalMinor: bigint;
  readonly discountMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
  readonly advanceMinor: bigint;
  readonly validityAt: string | null;
  readonly scope: string | null;
  readonly exclusions: string | null;
  readonly timeline: string | null;
  readonly terms: string | null;
  readonly pdfChecksum: string | null;
  readonly publishedAt: string | null;
  readonly publishedBy: string | null;
  readonly acceptedAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly items: readonly CommercialsItem[];
}

export interface CommercialsItem {
  readonly id: string;
  readonly commercialsId: string;
  readonly serviceName: string;
  readonly description: string | null;
  readonly quantity: string;
  readonly unitPriceMinor: bigint;
  readonly itemDiscountMinor: bigint;
  readonly taxCategory: string;
  readonly taxRateBps: number;
  readonly lineTotalMinor: bigint;
  readonly milestone: string | null;
  readonly sortOrder: number;
}

export type DocumentDiscountInput =
  | { readonly kind: 'none' }
  | { readonly kind: 'absolute'; readonly amountMinor: bigint }
  | { readonly kind: 'percent'; readonly bps: number };

export interface CommercialsItemInput {
  readonly serviceName: string;
  readonly description?: string | null;
  readonly quantity: string;
  readonly unitPriceMinor: bigint;
  readonly itemDiscountMinor: bigint;
  readonly taxCategory: string;
  readonly taxRateBps: number;
  readonly milestone?: string | null;
  readonly sortOrder: number;
}

export interface CommercialsBodyInput {
  readonly items: readonly CommercialsItemInput[];
  readonly documentDiscount: DocumentDiscountInput;
  readonly currency: string;
  readonly advanceMinor: bigint;
  readonly validityAt?: string | null;
  readonly scope?: string | null;
  readonly exclusions?: string | null;
  readonly timeline?: string | null;
  readonly terms?: string | null;
}

export interface ShareLinkResponse {
  readonly rawToken: string;
  readonly tokenId: string;
  readonly expiresAt: string;
  readonly portalPath: string;
  readonly portalApiPath?: string;
}

export function fromWire(wire: CommercialsWire): Commercials {
  return {
    ...wire,
    subtotalMinor: BigInt(wire.subtotalMinor),
    discountMinor: BigInt(wire.discountMinor),
    taxMinor: BigInt(wire.taxMinor),
    totalMinor: BigInt(wire.totalMinor),
    advanceMinor: BigInt(wire.advanceMinor),
    items: wire.items.map(itemFromWire),
  };
}

function itemFromWire(w: CommercialsItemWire): CommercialsItem {
  return {
    ...w,
    unitPriceMinor: BigInt(w.unitPriceMinor),
    itemDiscountMinor: BigInt(w.itemDiscountMinor),
    lineTotalMinor: BigInt(w.lineTotalMinor),
  };
}

function bodyToWire(body: CommercialsBodyInput): unknown {
  return {
    ...body,
    advanceMinor: body.advanceMinor.toString(),
    documentDiscount:
      body.documentDiscount.kind === 'absolute'
        ? { kind: 'absolute', amountMinor: body.documentDiscount.amountMinor.toString() }
        : body.documentDiscount,
    items: body.items.map((item) => ({
      ...item,
      unitPriceMinor: item.unitPriceMinor.toString(),
      itemDiscountMinor: item.itemDiscountMinor.toString(),
    })),
  };
}

export async function listCommercials(dealId: string): Promise<readonly Commercials[]> {
  const wire = await identityRequest<readonly CommercialsWire[]>(
    `/api/deals/${encodeURIComponent(dealId)}/commercials`,
  );
  return wire.map(fromWire);
}

export async function getCommercials(id: string): Promise<Commercials> {
  const wire = await identityRequest<CommercialsWire>(`/api/commercials/${encodeURIComponent(id)}`);
  return fromWire(wire);
}

export async function createDraftCommercials(
  dealId: string,
  body: CommercialsBodyInput,
): Promise<Commercials> {
  const wire = await identityRequest<CommercialsWire>(
    `/api/deals/${encodeURIComponent(dealId)}/commercials`,
    {
      method: 'POST',
      body: JSON.stringify(bodyToWire(body)),
    },
  );
  return fromWire(wire);
}

export interface UpdateDraftResult {
  readonly commercials?: Commercials;
  readonly stale?: { readonly serverCopy: Commercials; readonly actualUpdatedAt: string };
}

export async function updateDraftCommercials(
  id: string,
  input: { expectedUpdatedAt: string; body: CommercialsBodyInput },
): Promise<UpdateDraftResult> {
  try {
    const wire = await identityRequest<CommercialsWire>(`/api/commercials/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        expectedUpdatedAt: input.expectedUpdatedAt,
        body: bodyToWire(input.body),
      }),
    });
    return { commercials: fromWire(wire) };
  } catch (cause) {
    const stale = extractStaleWrite(cause);
    if (stale) return { stale };
    throw cause;
  }
}

function extractStaleWrite(
  cause: unknown,
): { serverCopy: Commercials; actualUpdatedAt: string } | null {
  if (!cause || typeof cause !== 'object') return null;
  const errorCode = (cause as { code?: unknown }).code;
  if (errorCode !== 'COMMERCIALS_STALE_WRITE') return null;
  const details = (cause as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const serverCopy = (details as { serverCopy?: unknown }).serverCopy;
  const actualUpdatedAt = (details as { actualUpdatedAt?: unknown }).actualUpdatedAt;
  if (!serverCopy || typeof serverCopy !== 'object' || typeof actualUpdatedAt !== 'string') {
    return null;
  }
  return { serverCopy: fromWire(serverCopy as CommercialsWire), actualUpdatedAt };
}

export async function publishCommercials(id: string): Promise<Commercials> {
  const wire = await identityRequest<CommercialsWire>(
    `/api/commercials/${encodeURIComponent(id)}/publish`,
    { method: 'POST' },
  );
  return fromWire(wire);
}

export async function supersedeCommercials(id: string): Promise<Commercials> {
  const wire = await identityRequest<CommercialsWire>(
    `/api/commercials/${encodeURIComponent(id)}/supersede`,
    { method: 'POST' },
  );
  return fromWire(wire);
}

export function createShareLink(id: string): Promise<ShareLinkResponse> {
  return identityRequest(`/api/commercials/${encodeURIComponent(id)}/share-link`, {
    method: 'POST',
  });
}

export function revokeShareLink(id: string, tokenId: string): Promise<{ success: true }> {
  return identityRequest(
    `/api/commercials/${encodeURIComponent(id)}/share-link/${encodeURIComponent(tokenId)}`,
    { method: 'DELETE' },
  );
}
