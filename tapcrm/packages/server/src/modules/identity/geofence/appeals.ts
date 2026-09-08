import { sql } from '../../../platform/dal/sql.js';
import type { Tx } from '../../../platform/dal/db.js';
import { encryptCoordinates } from './geo.js';
import { IdentityValidationError } from '../errors.js';

export async function createBypassRequest(tx: Tx, input: { organizationId: string; userId: string; latitude: number; longitude: number; accuracyMetres: number | null; reason: string }) {
  return tx.one<{ id: string }>(sql`
    INSERT INTO geofence_bypass_request(organization_id, user_id, latitude, longitude, coordinates_ciphertext, accuracy_metres, reason)
    VALUES (${input.organizationId}, ${input.userId}, NULL, NULL, ${encryptCoordinates(input.latitude, input.longitude)}, ${input.accuracyMetres}, ${input.reason})
    RETURNING id
  `);
}

export async function approveBypass(tx: Tx, input: { organizationId: string; requestId: string; decidedBy: string; locationId: string; userId: string; until: Date }) {
  if (input.until.getTime() > Date.now() + 7 * 24 * 60 * 60 * 1000)
    throw new IdentityValidationError('IDENTITY_GEOFENCE_BYPASS_TOO_LONG', 'A temporary geofence bypass cannot exceed 7 days');
  const request = await tx.maybeOne<{ id: string }>(sql`
    UPDATE geofence_bypass_request
    SET status = 'approved', decided_by = ${input.decidedBy}, decided_at = now(), bypass_until = ${input.until}
    WHERE organization_id = ${input.organizationId} AND id = ${input.requestId} AND user_id = ${input.userId} AND status = 'pending'
    RETURNING id
  `);
  if (!request) return false;
  await tx.query(sql`
    UPDATE geofence_assignment SET bypass_until = ${input.until}, bypass_reason = 'Approved geofence appeal'
    WHERE organization_id = ${input.organizationId} AND user_id = ${input.userId} AND location_id = ${input.locationId}
  `);
  return true;
}
