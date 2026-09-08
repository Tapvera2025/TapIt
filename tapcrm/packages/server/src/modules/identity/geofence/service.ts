import { db } from '../../../platform/dal/db.js';
import { IdentityValidationError } from '../errors.js';
import { evaluateLogin } from './repository.js';
import { createBypassRequest } from './appeals.js';
import { getUserGeofenceNotice } from './privacy.js';
import { sql } from '../../../platform/dal/sql.js';
import { createIdentityContext, type IdentityUser } from '../authentication/principal.js';
import { findUserById } from '../repository.js';

export async function enforceGeofencedLogin(input: { organizationId: string; userId: string; accountType: string; user: IdentityUser; latitude?: number; longitude?: number; accuracyMetres?: number | null }) {
  if (input.accountType === 'super-admin') return;
  const exception = await db.transaction(createIdentityContext(input.user, `identity:geofence-exception:${input.userId}`), async (tx) => {
    const wfh = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM work_from_home_day
      WHERE organization_id = ${input.organizationId} AND user_id = ${input.userId} AND work_date = CURRENT_DATE
    `);
    const bypass = await tx.maybeOne<{ id: string }>(sql`
      SELECT a.location_id AS id FROM geofence_assignment a
      WHERE a.organization_id = ${input.organizationId} AND a.user_id = ${input.userId} AND a.bypass_until > now()
      LIMIT 1
    `);
    return Boolean(wfh || bypass);
  });
  if (exception) return;
  if (input.latitude === undefined || input.longitude === undefined)
    throw new IdentityValidationError('IDENTITY_LOCATION_REQUIRED', 'Location access is required. Enable browser location permission and try again.');
  const result = await db.transaction(createIdentityContext(input.user, `identity:geofence-evaluate:${input.userId}`), (tx) => evaluateLogin(tx, {
    organizationId: input.organizationId,
    userId: input.userId,
    latitude: input.latitude!,
    longitude: input.longitude!,
    accuracyMetres: input.accuracyMetres ?? null,
  }));
  if (!result.accuracyAccepted) throw new IdentityValidationError('IDENTITY_LOCATION_ACCURACY_TOO_LOW', 'Location accuracy is too low. Move to an area with a clearer location signal and try again.');
  if (!result.allowed) throw new IdentityValidationError('IDENTITY_LOCATION_NOT_ALLOWED', 'Sign-in is outside your assigned locations.');
  return result;
}

export async function requestGeofenceBypass(input: { organizationId: string; userId: string; latitude: number; longitude: number; accuracyMetres: number | null; reason: string }) {
  const user = await findUserById(input.userId, input.organizationId);
  if (!user) throw new IdentityValidationError('IDENTITY_USER_NOT_FOUND', 'Identity user not found');
  return db.transaction(createIdentityContext(user, `identity:geofence-appeal:${input.userId}`), (tx) => createBypassRequest(tx, input));
}

export async function geofenceNotice(organizationId: string, userId: string) {
  const user = await findUserById(userId, organizationId);
  if (!user) throw new IdentityValidationError('IDENTITY_USER_NOT_FOUND', 'Identity user not found');
  const locations = await db.transaction(createIdentityContext(user, `identity:geofence-notice:${userId}`), (tx) => getUserGeofenceNotice(tx, organizationId, userId));
  return { retentionDays: 90, locations };
}
