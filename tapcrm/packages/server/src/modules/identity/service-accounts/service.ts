import { createOpaqueToken, hashToken } from '../../../platform/auth/crypto.js';
import { db, platformDb } from '../../../platform/dal/db.js';
import { createRequestContext } from '../../../platform/dal/context.js';
import { sql } from '../../../platform/dal/sql.js';

export async function issueServiceCredential(input: { organizationId: string; serviceAccountId: string; expiresAt: Date }) {
  const credential = `tapcrm_sa_${createOpaqueToken(32)}`;
  const context = createRequestContext({
    organizationId: input.organizationId,
    principal: {
      id: input.serviceAccountId,
      organizationId: input.organizationId,
      accountType: 'service',
      sessionVersion: 1,
      allowedActions: [],
      allowedResources: [],
      expiresAt: input.expiresAt,
    },
    requestId: `identity:service-credential:${input.serviceAccountId}`,
  });
  await db.transaction(context, async (tx) => {
    const updated = await tx.query<{ id: string }>(sql`
      UPDATE service_account
      SET credential_hash = ${hashToken(credential).toString('hex')}, last_used_at = NULL
      WHERE organization_id = ${input.organizationId} AND id = ${input.serviceAccountId} AND disabled_at IS NULL AND expires_at >= ${input.expiresAt}
      RETURNING id
    `);
    if (updated.length === 0) return;
    await tx.query(sql`
      INSERT INTO audit_outbox (organization_id, stream, payload)
      VALUES (${input.organizationId}, 'access', ${JSON.stringify({
        action: 'identity.service_credential_issued',
        actorId: input.serviceAccountId,
        actorType: 'service',
        targetType: 'serviceAccount',
        targetId: input.serviceAccountId,
        before: null,
        after: { expiresAt: input.expiresAt.toISOString() },
        reason: null,
        requestId: `identity:service-credential:${input.serviceAccountId}`,
        sourceIp: null,
      })}::jsonb)
    `);
  });
  return credential;
}

export async function authenticateServiceCredential(credential: string) {
  return platformDb.maybeOne<{
    id: string;
    organizationId: string;
    allowedActions: string[];
    allowedResources: string[];
    expiresAt: Date;
  }>('health-check', 'authenticate service account credential', sql`
    SELECT id, organization_id, allowed_actions, allowed_resources, expires_at
    FROM service_account
    WHERE credential_hash = ${hashToken(credential).toString('hex')}
      AND disabled_at IS NULL AND expires_at > now()
  `);
}
