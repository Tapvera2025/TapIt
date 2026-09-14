import { sql } from '../../../platform/dal/sql.js';
import type { Tx } from '../../../platform/dal/db.js';
import { platformDb } from '../../../platform/dal/db.js';

/** Retains the derived decision while deleting the sensitive coordinate payload. */
export async function purgeExpiredCoordinates(tx: Tx): Promise<void> {
  await tx.query(sql`
    UPDATE geofence_event
    SET coordinates_ciphertext = NULL, latitude = NULL, longitude = NULL
    WHERE coordinates_purge_at <= now()
      AND coordinates_ciphertext IS NOT NULL
  `);
}

/** Maintenance entry point: run once per organization so tenant RLS remains active. */
export async function purgeAllExpiredGeofenceCoordinates(): Promise<void> {
  const organizations = await platformDb.query<{ id: string }>(
    'retention-enforcement',
    'find organizations for geofence coordinate purge',
    sql`SELECT id FROM organization WHERE status <> 'deleted'`,
  );
  await Promise.all(organizations.map(({ id }) =>
    platformDb.transactionForOrganization(
      id,
      'retention-enforcement',
      'purge expired geofence coordinates',
      purgeExpiredCoordinates,
    ),
  ));
}

export async function getUserGeofenceNotice(tx: Tx, organizationId: string, userId: string) {
  return tx.query<{ id: string; name: string; radiusMetres: number; accuracyThresholdMetres: number }>(sql`
    SELECT l.id, l.name, l.radius_metres, l.accuracy_threshold_metres
    FROM geofence_location l
    JOIN geofence_assignment a ON a.organization_id = l.organization_id AND a.location_id = l.id
    WHERE a.organization_id = ${organizationId} AND a.user_id = ${userId} AND l.status = 'active'
  `);
}
