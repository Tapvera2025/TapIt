import type { Tx } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { IdentitySecurityEvent } from './events.js';

export interface LoginSignals {
  readonly deviceLabel: string | null;
  readonly ip: string | null;
  readonly countryCode: string | null;
}

/**
 * Uses only server-observed session metadata. Missing country/location data is
 * deliberately inconclusive; it must never manufacture an impossible-travel
 * decision.
 */
export async function detectSuspiciousLogin(tx: Tx, input: {
  organizationId: string;
  userId: string;
  signals: LoginSignals;
}): Promise<ReadonlyArray<{ event: IdentitySecurityEvent; metadata: Record<string, unknown> }>> {
  const previous = await tx.maybeOne<{
    deviceLabel: string | null;
    ip: string | null;
    countryCode: string | null;
    createdAt: Date;
  }>(sql`
    SELECT device_label, ip, country_code, created_at
    FROM session
    WHERE organization_id = ${input.organizationId} AND user_id = ${input.userId}
      AND revoked_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `);
  if (!previous) return [];

  const events: Array<{ event: IdentitySecurityEvent; metadata: Record<string, unknown> }> = [];
  if (input.signals.deviceLabel && input.signals.deviceLabel !== 'unknown' &&
      previous.deviceLabel !== input.signals.deviceLabel) {
    events.push({ event: 'SUSPICIOUS_LOGIN_NEW_DEVICE', metadata: { deviceLabel: input.signals.deviceLabel } });
  }
  if (input.signals.ip && previous.ip !== input.signals.ip) {
    events.push({ event: 'SUSPICIOUS_LOGIN_NEW_IP', metadata: {} });
  }
  if (input.signals.countryCode && previous.countryCode && previous.countryCode !== input.signals.countryCode) {
    events.push({ event: 'SUSPICIOUS_LOGIN_NEW_COUNTRY', metadata: { previousCountry: previous.countryCode, country: input.signals.countryCode } });
  }
  // No coordinates are stored in sessions, so an impossible-travel decision is
  // intentionally omitted unless a future trusted location source is added.
  return events;
}
