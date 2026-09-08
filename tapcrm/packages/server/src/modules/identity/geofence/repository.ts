import { sql } from '../../../platform/dal/sql.js';
import type { Tx } from '../../../platform/dal/db.js';
import { distanceBand, distanceMetres, encryptCoordinates } from './geo.js';

export async function evaluateLogin(tx: Tx, input: { organizationId: string; userId: string; latitude: number; longitude: number; accuracyMetres: number | null }) {
  const locations = await tx.query<{ id: string; name: string; latitude: number; longitude: number; radiusMetres: number; accuracyThresholdMetres: number }>(sql`
    SELECT l.id, l.name, l.latitude, l.longitude, l.radius_metres, l.accuracy_threshold_metres
    FROM geofence_location l
    JOIN geofence_assignment a ON a.organization_id = l.organization_id AND a.location_id = l.id
    WHERE a.organization_id = ${input.organizationId} AND a.user_id = ${input.userId}
      AND (a.bypass_until IS NULL OR a.bypass_until < now())
  `);
  const nearest = locations
    .map((location) => ({ ...location, distance: distanceMetres(input.latitude, input.longitude, Number(location.latitude), Number(location.longitude)) }))
    .sort((a, b) => a.distance - b.distance)[0];
  const accuracyAccepted = input.accuracyMetres !== null && locations.some((location) => input.accuracyMetres! <= location.accuracyThresholdMetres);
  const allowed = accuracyAccepted && locations.some((location) => distanceMetres(input.latitude, input.longitude, Number(location.latitude), Number(location.longitude)) <= location.radiusMetres);
  await tx.query(sql`
    INSERT INTO geofence_event(organization_id, user_id, allowed, latitude, longitude, coordinates_ciphertext, accuracy_metres, distance_band, nearest_location_id)
    VALUES (${input.organizationId}, ${input.userId}, ${allowed}, NULL, NULL, ${encryptCoordinates(input.latitude, input.longitude)}, ${input.accuracyMetres}, ${nearest ? distanceBand(nearest.distance) : '1000m+'}, ${nearest?.id ?? null})
  `);
  if (!allowed && nearest) {
    const denials = await tx.maybeOne<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM geofence_event
      WHERE organization_id = ${input.organizationId} AND nearest_location_id = ${nearest.id}
        AND allowed = false AND occurred_at >= now() - interval '1 hour'
    `);
    if ((denials?.count ?? 0) >= 5) {
      await tx.query(sql`
        INSERT INTO geofence_configuration_alert(organization_id, location_id, denial_count, window_started_at)
        SELECT ${input.organizationId}, ${nearest.id}, ${denials?.count ?? 0}, now() - interval '1 hour'
        WHERE NOT EXISTS (
          SELECT 1 FROM geofence_configuration_alert
          WHERE organization_id = ${input.organizationId} AND location_id = ${nearest.id} AND resolved_at IS NULL
        )
      `);
    }
  }
  return { allowed, accuracyAccepted, nearestLocationName: nearest?.name ?? 'No assigned location', distanceMetres: nearest?.distance ?? null };
}
