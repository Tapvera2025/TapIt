import type { Request } from 'express';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { verifyIdentityAccessToken } from './crypto.js';
import { createIdentityContext } from './principal.js';
import { findUserById } from '../repository.js';

export async function logout(req: Request): Promise<void> {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return;
  const claims = await verifyIdentityAccessToken(header.slice(7).trim());
  const user = await findUserById(claims.userId, claims.organizationId);
  if (!user) return;
  await db.transaction(createIdentityContext(user, `identity:logout:${claims.sessionId}`), (tx) => tx.query(sql`UPDATE session SET revoked_at = now() WHERE organization_id = ${claims.organizationId} AND id = ${claims.sessionId}`).then(() => undefined));
}
