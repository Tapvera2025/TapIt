import { sql } from '../../../platform/dal/sql.js';
import type { Tx } from '../../../platform/dal/db.js';

export type IdentitySecurityEvent =
  | 'SUSPICIOUS_LOGIN_NEW_DEVICE'
  | 'SUSPICIOUS_LOGIN_NEW_IP'
  | 'SUSPICIOUS_LOGIN_NEW_COUNTRY'
  | 'SUSPICIOUS_LOGIN_IMPROBABLE_TRAVEL'
  | 'ACCOUNT_UNLOCKED'
  | 'GEOFENCE_CONFIGURATION_ALERT';

/** Security events are durable audit/outbox records, not notifications. */
export async function recordSecurityEvent(tx: Tx, input: {
  organizationId: string;
  event: IdentitySecurityEvent;
  actorId: string;
  actorType: string;
  targetId?: string;
  sessionId?: string | null;
  sourceIp?: string | null;
  countryCode?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await tx.query(sql`
    INSERT INTO audit_outbox(organization_id, stream, payload)
    VALUES (${input.organizationId}, 'activity', ${JSON.stringify({
      action: `identity.${input.event.toLowerCase()}`,
      eventType: input.event,
      actorId: input.actorId,
      actorType: input.actorType,
      targetType: 'user',
      targetId: input.targetId ?? input.actorId,
      sessionId: input.sessionId ?? null,
      sourceIp: input.sourceIp ?? null,
      countryCode: input.countryCode ?? null,
      metadata: input.metadata ?? {},
    })}::jsonb)
  `);
}
