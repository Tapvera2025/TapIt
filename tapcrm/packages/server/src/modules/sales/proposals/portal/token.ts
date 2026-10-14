/**
 * Sales v1.1 R2 — Portal token (R2 plan step 2.10, R-PORTAL-01).
 *
 * We generate 32 random bytes, base64url-encode them, and persist only the
 * SHA-256 hex digest. The raw token is returned to the issuer exactly once
 * at creation and never again. Lookups rehash the inbound token and match
 * on the stored digest. Logs redact the raw token.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { RequestContext } from '../../../../platform/dal/context.js';
import { db, platformDb, type Tx } from '../../../../platform/dal/db.js';
import { sql } from '../../../../platform/dal/sql.js';

const RAW_BYTES = 32;
const MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;         // 30 days (R-PORTAL-01)

export function generateRawToken(): string {
  return randomBytes(RAW_BYTES).toString('base64url');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** 30-day cap OR the commercials validity_at — whichever is sooner. */
export function resolveExpiry(validityAt: Date | null, now = new Date()): Date {
  const defaultExpiry = new Date(now.getTime() + MAX_LIFETIME_MS);
  if (!validityAt) return defaultExpiry;
  return validityAt.getTime() < defaultExpiry.getTime() ? validityAt : defaultExpiry;
}

export interface IssueTokenInput {
  readonly commercialsId: string;
  readonly validityAt: Date | null;
  readonly createdBy: string;
}

export interface IssuedToken {
  readonly rawToken: string;         // returned ONCE to the issuer
  readonly tokenId: string;
  readonly expiresAt: Date;
}

export async function issueToken(
  tx: Tx,
  ctx: RequestContext,
  input: IssueTokenInput,
): Promise<IssuedToken> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = resolveExpiry(input.validityAt);
  const row = await tx.one<{ id: string }>(sql`
    INSERT INTO proposal_portal_token (
      organization_id, commercials_id, token_hash, expires_at, created_by
    ) VALUES (
      ${ctx.organizationId}, ${input.commercialsId}, ${tokenHash}, ${expiresAt}, ${input.createdBy}
    )
    RETURNING id
  `);
  return { rawToken, tokenId: row.id, expiresAt };
}

export async function revokeToken(ctx: RequestContext, tokenId: string): Promise<void> {
  await db.query(
    ctx,
    sql`UPDATE proposal_portal_token
           SET revoked_at = now()
         WHERE organization_id = ${ctx.organizationId}
           AND id              = ${tokenId}
           AND revoked_at IS NULL`,
  );
}

export interface ResolvedToken {
  readonly tokenId: string;
  readonly organizationId: string;
  readonly commercialsId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

/**
 * Look up a token row by the raw-value hash. Runs against the platform DB
 * because the public portal has no tenant context yet — the tenant is
 * resolved FROM this row. Subsequent reads use the returned organizationId
 * for RLS binding.
 */
export async function resolveToken(rawToken: string): Promise<ResolvedToken | null> {
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);
  return platformDb.maybeOne<ResolvedToken>(
    'public-portal',
    'resolve proposal portal token from raw value',
    sql`SELECT id              AS "tokenId",
               organization_id AS "organizationId",
               commercials_id  AS "commercialsId",
               token_hash      AS "tokenHash",
               expires_at      AS "expiresAt",
               revoked_at      AS "revokedAt"
          FROM proposal_portal_token
         WHERE token_hash = ${tokenHash}`,
  );
}

/** Opaque log-safe form of a token — never log the raw value. */
export function redactToken(rawToken: string): string {
  if (!rawToken) return '<empty>';
  const hash = hashToken(rawToken);
  return `tok:sha256:${hash.slice(0, 12)}`;
}
