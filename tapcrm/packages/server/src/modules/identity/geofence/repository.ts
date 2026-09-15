import { sql } from '../../../platform/dal/sql.js';
import type { Tx } from '../../../platform/dal/db.js';
import { distanceBand, distanceMetres, encryptCoordinates } from './geo.js';
import { recordSecurityEvent } from '../security/events.js';

export async function evaluateLogin(tx: Tx, input: { organizationId: string; userId: string; latitude: number; longitude: number; accuracyMetres: number | null }) {
  const locations = await tx.query<{ id: string; name: string; latitude: number; longitude: number; radiusMetres: number; accuracyThresholdMetres: number }>(sql`
    SELECT l.id, l.name, l.latitude, l.longitude, l.radius_metres, l.accuracy_threshold_metres
    FROM geofence_location l
    JOIN geofence_assignment a ON a.organization_id = l.organization_id AND a.location_id = l.id
    WHERE a.organization_id = ${input.organizationId} AND a.user_id = ${input.userId}
      AND l.status = 'active'
      AND (a.bypass_until IS NULL OR a.bypass_until < now())
  `);
  const nearest = locations
    .map((location) => ({ ...location, distance: distanceMetres(input.latitude, input.longitude, Number(location.latitude), Number(location.longitude)) }))
    .sort((a, b) => a.distance - b.distance)[0];
  const matchingLocation = input.accuracyMetres === null ? undefined : locations.find((location) => {
    const distance = distanceMetres(input.latitude, input.longitude, Number(location.latitude), Number(location.longitude));
    return input.accuracyMetres! <= location.accuracyThresholdMetres && distance <= location.radiusMetres;
  });
  const accuracyAccepted = input.accuracyMetres !== null && locations.some((location) => input.accuracyMetres! <= location.accuracyThresholdMetres);
  const allowed = matchingLocation !== undefined;
  await tx.query(sql`
    INSERT INTO geofence_event(organization_id, user_id, allowed, latitude, longitude, coordinates_ciphertext, accuracy_metres, distance_band, nearest_location_id)
    VALUES (${input.organizationId}, ${input.userId}, ${allowed}, NULL, NULL, ${encryptCoordinates(input.latitude, input.longitude)}, ${input.accuracyMetres}, ${nearest ? distanceBand(nearest.distance) : '1000m+'}, ${nearest?.id ?? null})
  `);
  let configurationAlertCreated = false;
  if (!allowed && nearest) {
    const denials = await tx.maybeOne<{ count: number }>(sql`
      SELECT count(DISTINCT user_id)::int AS count FROM geofence_event
      WHERE organization_id = ${input.organizationId} AND nearest_location_id = ${nearest.id}
        AND allowed = false AND occurred_at >= now() - interval '1 hour'
    `);
    if ((denials?.count ?? 0) >= 5) {
      const alertRows = await tx.query<{ id: string }>(sql`
        INSERT INTO geofence_configuration_alert(organization_id, location_id, denial_count, window_started_at)
        SELECT ${input.organizationId}, ${nearest.id}, ${denials?.count ?? 0}, now() - interval '1 hour'
        WHERE NOT EXISTS (
          SELECT 1 FROM geofence_configuration_alert
          WHERE organization_id = ${input.organizationId} AND location_id = ${nearest.id} AND resolved_at IS NULL
        )
        RETURNING id
      `);
      configurationAlertCreated = alertRows.length > 0;
      if (configurationAlertCreated) {
        await recordSecurityEvent(tx, {
          organizationId: input.organizationId,
          event: 'GEOFENCE_CONFIGURATION_ALERT',
          actorId: input.userId,
          actorType: 'identity',
          targetId: input.userId,
          metadata: { locationId: nearest.id, locationName: nearest.name, distinctDeniedUsers: denials?.count ?? 0 },
        });
      }
    }
  }
  return { allowed, accuracyAccepted, nearestLocationName: nearest?.name ?? 'No assigned location', distanceMetres: nearest?.distance ?? null, configurationAlertCreated, accuracyMetres: input.accuracyMetres };
}

export async function listLocations(tx: Tx, organizationId: string) {
  return tx.query(sql`
    SELECT l.id, l.name, l.latitude, l.longitude, l.radius_metres,
           l.accuracy_threshold_metres, l.status, l.created_at, l.updated_at,
           COALESCE(json_agg(json_build_object(
             'userId', a.user_id,
             'userName', u.full_name,
             'userEmail', u.email,
             'bypassUntil', a.bypass_until
           ) ORDER BY u.full_name) FILTER (WHERE a.user_id IS NOT NULL), '[]'::json) AS assignments
    FROM geofence_location l
    LEFT JOIN geofence_assignment a
      ON a.organization_id = l.organization_id AND a.location_id = l.id
    LEFT JOIN app_user u
      ON u.organization_id = a.organization_id AND u.id = a.user_id
    WHERE l.organization_id = ${organizationId}
    GROUP BY l.id
    ORDER BY l.name
  `);
}

export async function createLocation(tx: Tx, input: { organizationId: string; name: string; latitude: number; longitude: number; radiusMetres: number; accuracyThresholdMetres: number }) {
  return tx.one(sql`
    INSERT INTO geofence_location(organization_id, name, latitude, longitude, radius_metres, accuracy_threshold_metres)
    VALUES (${input.organizationId}, ${input.name}, ${input.latitude}, ${input.longitude}, ${input.radiusMetres}, ${input.accuracyThresholdMetres})
    RETURNING id, name, latitude, longitude, radius_metres, accuracy_threshold_metres, status, created_at, updated_at
  `);
}

export async function updateLocation(tx: Tx, input: { organizationId: string; id: string; name?: string | undefined; latitude?: number | undefined; longitude?: number | undefined; radiusMetres?: number | undefined; accuracyThresholdMetres?: number | undefined; status?: 'active' | 'inactive' | undefined }) {
  return tx.one(sql`
    UPDATE geofence_location
    SET name = COALESCE(${input.name ?? null}, name),
        latitude = COALESCE(${input.latitude ?? null}, latitude),
        longitude = COALESCE(${input.longitude ?? null}, longitude),
        radius_metres = COALESCE(${input.radiusMetres ?? null}, radius_metres),
        accuracy_threshold_metres = COALESCE(${input.accuracyThresholdMetres ?? null}, accuracy_threshold_metres),
        status = COALESCE(${input.status ?? null}, status),
        updated_at = now()
    WHERE organization_id = ${input.organizationId} AND id = ${input.id}
    RETURNING id, name, latitude, longitude, radius_metres, accuracy_threshold_metres, status, created_at, updated_at
  `);
}

export async function setAssignment(tx: Tx, input: { organizationId: string; locationId: string; userId: string; enabled: boolean }) {
  if (!input.enabled) {
    await tx.query(sql`
      DELETE FROM geofence_assignment
      WHERE organization_id = ${input.organizationId} AND location_id = ${input.locationId} AND user_id = ${input.userId}
    `);
    return tx.one(sql`
      UPDATE app_user
      SET geofence_required = EXISTS (
        SELECT 1 FROM geofence_assignment
        WHERE organization_id = ${input.organizationId} AND user_id = ${input.userId}
      )
      WHERE organization_id = ${input.organizationId} AND id = ${input.userId}
      RETURNING id, geofence_required
    `);
  }
  await tx.query(sql`
    INSERT INTO geofence_assignment(organization_id, user_id, location_id)
    VALUES (${input.organizationId}, ${input.userId}, ${input.locationId})
    ON CONFLICT (organization_id, user_id, location_id) DO NOTHING
  `);
  return tx.one(sql`
    UPDATE app_user SET geofence_required = true
    WHERE organization_id = ${input.organizationId} AND id = ${input.userId}
    RETURNING id, geofence_required
  `);
}
