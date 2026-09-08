import { sql } from '../../../platform/dal/sql.js';
import type { Tx } from '../../../platform/dal/db.js';

/** Retains the derived decision while deleting the sensitive coordinate payload. */
export async function purgeExpiredCoordinates(tx: Tx): Promise<void> {
  await tx.query(sql`
    UPDATE geofence_event
    SET coordinates_ciphertext = NULL, latitude = NULL, longitude = NULL
    WHERE coordinates_purge_at <= now()
      AND coordinates_ciphertext IS NOT NULL
  `);
}

export async function getUserGeofenceNotice(tx: Tx, organizationId: string, userId: string) {
  return tx.query<{ id: string; name: string; radiusMetres: number; accuracyThresholdMetres: number }>(sql`
    SELECT l.id, l.name, l.radius_metres, l.accuracy_threshold_metres
    FROM geofence_location l
    JOIN geofence_assignment a ON a.organization_id = l.organization_id AND a.location_id = l.id
    WHERE a.organization_id = ${organizationId} AND a.user_id = ${userId}
  `);
}
