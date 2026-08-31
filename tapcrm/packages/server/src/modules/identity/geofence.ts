import { bootstrapDb, platformDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { sendGeofenceDenialAlert } from './email.js';

export interface GeofenceCoordinateInput {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMetres?: number | undefined;
}

export interface GeofenceLocationRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusMetres: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GeofenceAssignmentRecord {
  readonly userId: string;
  readonly locationId: string;
  readonly locationName: string;
  readonly bypassUntil: string | null;
  readonly bypassReason: string | null;
}

export interface GeofenceEvaluationResult {
  readonly allowed: boolean;
  readonly reason?: string | undefined;
  readonly distanceMeters?: number | undefined;
  readonly nearestLocationName?: string | undefined;
}

/**
 * Calculates distance in meters between two lat/long points using Haversine formula.
 */
export function calculateHaversineDistanceMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Categorizes distance into audit bands (ID-15a).
 */
export function getDistanceBand(distanceMetres: number): string {
  if (distanceMetres <= 50) return 'exact';
  if (distanceMetres <= 200) return 'near';
  if (distanceMetres <= 1000) return 'moderate';
  if (distanceMetres <= 10000) return 'extended';
  return 'remote';
}

/**
 * ID-13..ID-18b: Evaluates geofencing for a user sign-in.
 */
export async function evaluateGeofence(
  organizationId: string,
  user: {
    id: string;
    accountType: string;
    email: string | null;
    fullName: string;
  },
  coordinates: GeofenceCoordinateInput | null | undefined,
  meta: { ip: string | null },
): Promise<GeofenceEvaluationResult> {
  // ID-17: Super Admin accounts are never geofenced
  if (user.accountType === 'super-admin') {
    return { allowed: true };
  }

  // Check if user has any assigned geofence locations
  const assignments = await bootstrapDb.readAs<{
    locationId: string;
    name: string;
    latitude: string;
    longitude: string;
    radiusMetres: number;
    bypassUntil: string | null;
    bypassReason: string | null;
  }>(
    organizationId,
    sql`
      SELECT
        gl.id AS "locationId",
        gl.name,
        gl.latitude,
        gl.longitude,
        gl.radius_metres AS "radiusMetres",
        ga.bypass_until AS "bypassUntil",
        ga.bypass_reason AS "bypassReason"
      FROM geofence_assignment ga
      INNER JOIN geofence_location gl
        ON gl.id = ga.location_id
       AND gl.organization_id = ga.organization_id
      WHERE ga.organization_id = ${organizationId}
        AND ga.user_id = ${user.id}
    `,
  );

  // If user has no geofences assigned, allow login (ID-13)
  if (assignments.length === 0) {
    return { allowed: true };
  }

  // ID-18: Check active temporary bypass
  const now = Date.now();
  const hasActiveBypass = assignments.some(
    (a) => a.bypassUntil && new Date(a.bypassUntil).getTime() > now,
  );
  if (hasActiveBypass) {
    return { allowed: true };
  }

  // ID-18b: Check if employee has an approved Work From Home (WFH) arrangement for today
  try {
    const today = new Date().toISOString().split('T')[0];
    const wfhRows = await bootstrapDb.readAs<{ id: string }>(
      organizationId,
      sql`
        SELECT id
        FROM attendance_record
        WHERE organization_id = ${organizationId}
          AND user_id = ${user.id}
          AND work_date = ${today}::date
          AND status IN ('wfh', 'remote')
        LIMIT 1
      `,
    );
    if (wfhRows.length > 0) {
      return { allowed: true };
    }
  } catch {
    // Non-blocking WFH check
  }

  // ID-16: If location is missing or accuracy is worse than threshold
  if (
    !coordinates ||
    typeof coordinates.latitude !== 'number' ||
    typeof coordinates.longitude !== 'number'
  ) {
    return {
      allowed: false,
      reason:
        'Location access is required to sign in to your account. Please enable browser location services.',
    };
  }

  const accuracy = coordinates.accuracyMetres ?? 50;
  if (accuracy > 300) {
    return {
      allowed: false,
      reason: `Location accuracy is too low (±${Math.round(accuracy)}m). Please connect to GPS or Wi-Fi to sign in.`,
    };
  }

  // Check distances to all assigned locations
  let minDistance = Infinity;
  let nearestLocation: (typeof assignments)[0] | null = null;
  let insideAnyFence = false;

  for (const assign of assignments) {
    const locLat = parseFloat(assign.latitude);
    const locLon = parseFloat(assign.longitude);
    const dist = calculateHaversineDistanceMetres(
      coordinates.latitude,
      coordinates.longitude,
      locLat,
      locLon,
    );

    if (dist < minDistance) {
      minDistance = dist;
      nearestLocation = assign;
    }

    if (dist <= assign.radiusMetres) {
      insideAnyFence = true;
      nearestLocation = assign;
      minDistance = dist;
      break;
    }
  }

  const distanceBand = getDistanceBand(minDistance);

  // ID-15a: Record geofence event
  await platformDb.query(
    'health-check',
    'record geofence event',
    sql`
      INSERT INTO geofence_event (
        organization_id,
        user_id,
        allowed,
        latitude,
        longitude,
        accuracy_metres,
        distance_band,
        nearest_location_id,
        coordinates_purge_at
      )
      VALUES (
        ${organizationId},
        ${user.id},
        ${insideAnyFence},
        ${coordinates.latitude},
        ${coordinates.longitude},
        ${Math.round(accuracy)},
        ${distanceBand},
        ${nearestLocation?.locationId ?? null},
        NOW() + INTERVAL '90 days'
      )
    `,
  );

  if (insideAnyFence) {
    return { allowed: true };
  }

  // ID-15: Send alert to admins on denial
  const outsideBy = Math.max(0, minDistance - (nearestLocation?.radiusMetres ?? 0));
  try {
    const adminRows = await bootstrapDb.readAs<{ email: string }>(
      organizationId,
      sql`
        SELECT email
        FROM app_user
        WHERE organization_id = ${organizationId}
          AND account_type = 'super-admin'
          AND status = 'active'
        LIMIT 1
      `,
    );
    if (adminRows[0]?.email) {
      void sendGeofenceDenialAlert(adminRows[0].email, {
        userEmail: user.email ?? 'unknown',
        userName: user.fullName,
        distanceMeters: outsideBy,
        nearestLocationName: nearestLocation?.name ?? 'Office',
        ip: meta.ip,
      });
    }
  } catch {
    // Non-blocking
  }

  return {
    allowed: false,
    reason: `Sign-in denied: You are outside your assigned location (${nearestLocation?.name ?? 'Assigned location'}). Measured distance: ${Math.round(outsideBy)}m outside geofence.`,
    distanceMeters: outsideBy,
    nearestLocationName: nearestLocation?.name,
  };
}

/**
 * ID-14: Lists geofence locations for an organization.
 */
export async function listGeofenceLocations(
  organizationId: string,
): Promise<GeofenceLocationRecord[]> {
  const rows = await bootstrapDb.readAs<{
    id: string;
    organizationId: string;
    name: string;
    latitude: string;
    longitude: string;
    radiusMetres: number;
    createdAt: string;
    updatedAt: string;
  }>(
    organizationId,
    sql`
      SELECT
        id,
        organization_id AS "organizationId",
        name,
        latitude,
        longitude,
        radius_metres AS "radiusMetres",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM geofence_location
      WHERE organization_id = ${organizationId}
      ORDER BY name ASC
    `,
  );

  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    latitude: parseFloat(r.latitude),
    longitude: parseFloat(r.longitude),
    radiusMetres: r.radiusMetres,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Creates a new geofence location.
 */
export async function createGeofenceLocation(
  organizationId: string,
  input: {
    name: string;
    latitude: number;
    longitude: number;
    radiusMetres: number;
  },
): Promise<GeofenceLocationRecord> {
  const rows = await platformDb.query<{
    id: string;
    organizationId: string;
    name: string;
    latitude: string;
    longitude: string;
    radiusMetres: number;
    createdAt: string;
    updatedAt: string;
  }>(
    'health-check',
    'create geofence location',
    sql`
      INSERT INTO geofence_location (
        organization_id,
        name,
        latitude,
        longitude,
        radius_metres
      )
      VALUES (
        ${organizationId},
        ${input.name},
        ${input.latitude},
        ${input.longitude},
        ${input.radiusMetres}
      )
      RETURNING
        id,
        organization_id AS "organizationId",
        name,
        latitude,
        longitude,
        radius_metres AS "radiusMetres",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
  );

  const r = rows[0]!;
  return {
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    latitude: parseFloat(r.latitude),
    longitude: parseFloat(r.longitude),
    radiusMetres: r.radiusMetres,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Updates a geofence location.
 */
export async function updateGeofenceLocation(
  organizationId: string,
  locationId: string,
  input: {
    name?: string | undefined;
    latitude?: number | undefined;
    longitude?: number | undefined;
    radiusMetres?: number | undefined;
  },
): Promise<GeofenceLocationRecord> {
  const rows = await platformDb.query<{
    id: string;
    organizationId: string;
    name: string;
    latitude: string;
    longitude: string;
    radiusMetres: number;
    createdAt: string;
    updatedAt: string;
  }>(
    'health-check',
    'update geofence location',
    sql`
      UPDATE geofence_location
      SET
        name = COALESCE(${input.name ?? null}, name),
        latitude = COALESCE(${input.latitude ?? null}, latitude),
        longitude = COALESCE(${input.longitude ?? null}, longitude),
        radius_metres = COALESCE(${input.radiusMetres ?? null}, radius_metres),
        updated_at = NOW()
      WHERE organization_id = ${organizationId}
        AND id = ${locationId}
      RETURNING
        id,
        organization_id AS "organizationId",
        name,
        latitude,
        longitude,
        radius_metres AS "radiusMetres",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
  );

  const r = rows[0]!;
  return {
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    latitude: parseFloat(r.latitude),
    longitude: parseFloat(r.longitude),
    radiusMetres: r.radiusMetres,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Assigns or updates a geofence location for a user (with optional bypass).
 */
export async function assignGeofenceLocation(
  organizationId: string,
  locationId: string,
  userId: string,
  bypassUntil?: string | null,
  bypassReason?: string | null,
): Promise<void> {
  await platformDb.query(
    'health-check',
    'assign geofence location',
    sql`
      INSERT INTO geofence_assignment (
        organization_id,
        user_id,
        location_id,
        bypass_until,
        bypass_reason
      )
      VALUES (
        ${organizationId},
        ${userId},
        ${locationId},
        ${bypassUntil ? new Date(bypassUntil) : null},
        ${bypassReason ?? null}
      )
      ON CONFLICT (organization_id, user_id, location_id)
      DO UPDATE SET
        bypass_until = EXCLUDED.bypass_until,
        bypass_reason = EXCLUDED.bypass_reason
    `,
  );
}

/**
 * ID-15b: In-product status for employees explaining their assigned geofences.
 */
export async function getUserGeofenceStatus(
  organizationId: string,
  userId: string,
): Promise<{
  isGeofenced: boolean;
  locations: readonly { name: string; radiusMetres: number }[];
  bypassUntil: string | null;
  retentionDays: number;
}> {
  const rows = await bootstrapDb.readAs<{
    name: string;
    radiusMetres: number;
    bypassUntil: string | null;
  }>(
    organizationId,
    sql`
      SELECT
        gl.name,
        gl.radius_metres AS "radiusMetres",
        ga.bypass_until AS "bypassUntil"
      FROM geofence_assignment ga
      INNER JOIN geofence_location gl
        ON gl.id = ga.location_id
       AND gl.organization_id = ga.organization_id
      WHERE ga.organization_id = ${organizationId}
        AND ga.user_id = ${userId}
    `,
  );

  return {
    isGeofenced: rows.length > 0,
    locations: rows.map((r) => ({ name: r.name, radiusMetres: r.radiusMetres })),
    bypassUntil: rows[0]?.bypassUntil ?? null,
    retentionDays: 90,
  };
}

/**
 * ID-15a: Purges coordinates older than 90 days.
 */
export async function purgeExpiredGeofenceCoordinates(): Promise<number> {
  const result = await platformDb.query<{ count: string }>(
    'health-check',
    'purge expired coordinates',
    sql`
      WITH purged AS (
        UPDATE geofence_event
        SET latitude = NULL,
            longitude = NULL
        WHERE coordinates_purge_at <= NOW()
          AND latitude IS NOT NULL
        RETURNING id
      )
      SELECT count(*)::text AS count FROM purged
    `,
  );

  return parseInt(result[0]?.count ?? '0', 10);
}
