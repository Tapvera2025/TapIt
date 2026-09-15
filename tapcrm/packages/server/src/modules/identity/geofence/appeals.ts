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
  if (!Number.isFinite(input.until.getTime()) || input.until.getTime() <= Date.now())
    throw new IdentityValidationError('IDENTITY_GEOFENCE_BYPASS_EXPIRY_REQUIRED', 'A temporary geofence bypass must expire in the future');
  if (input.until.getTime() > Date.now() + 7 * 24 * 60 * 60 * 1000)
    throw new IdentityValidationError('IDENTITY_GEOFENCE_BYPASS_TOO_LONG', 'A temporary geofence bypass cannot exceed 7 days');
  const assignment = await tx.maybeOne<{ id: string }>(sql`
    SELECT a.location_id AS id
    FROM geofence_assignment a
    JOIN geofence_location l ON l.organization_id = a.organization_id AND l.id = a.location_id
    WHERE a.organization_id = ${input.organizationId} AND a.user_id = ${input.userId}
      AND a.location_id = ${input.locationId} AND l.status = 'active'
  `);
  if (!assignment) throw new IdentityValidationError('IDENTITY_GEOFENCE_LOCATION_NOT_ASSIGNED', 'The employee is not assigned to that active location');
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

export async function listBypassRequests(tx: Tx, organizationId: string) {
  return tx.query(sql`
    SELECT r.id, r.user_id, u.full_name AS user_name, u.email AS user_email,
           r.accuracy_metres, r.reason, r.status, r.bypass_until, r.created_at,
           COALESCE(json_agg(json_build_object('id', l.id, 'name', l.name)) FILTER (WHERE l.id IS NOT NULL), '[]'::json) AS locations
    FROM geofence_bypass_request r
    JOIN app_user u ON u.organization_id = r.organization_id AND u.id = r.user_id
    LEFT JOIN geofence_assignment a ON a.organization_id = r.organization_id AND a.user_id = r.user_id
    LEFT JOIN geofence_location l ON l.organization_id = a.organization_id AND l.id = a.location_id AND l.status = 'active'
    WHERE r.organization_id = ${organizationId}
    GROUP BY r.id, u.full_name, u.email
    ORDER BY r.created_at DESC
  `);
}

export async function denyBypass(tx: Tx, input: { organizationId: string; requestId: string; decidedBy: string }) {
  return tx.maybeOne(sql`
    UPDATE geofence_bypass_request
    SET status = 'denied', decided_by = ${input.decidedBy}, decided_at = now()
    WHERE organization_id = ${input.organizationId} AND id = ${input.requestId} AND status = 'pending'
    RETURNING id, status
  `);
}
