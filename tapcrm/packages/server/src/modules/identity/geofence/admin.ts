import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import type { RequestContext } from '../../../platform/dal/context.js';
import { IdentityNotFoundError, IdentityValidationError } from '../errors.js';
import { createLocation, listLocations, setAssignment, updateLocation } from './repository.js';
import { approveBypass, denyBypass, listBypassRequests } from './appeals.js';

export const geofenceLocationResource = async (ctx: RequestContext, id: string) => {
  const row = await db.maybeOne<Record<string, unknown>>(ctx, sql`
    SELECT id, organization_id AS "organizationId"
    FROM geofence_location
    WHERE organization_id = ${ctx.organizationId} AND id = ${id}
  `);
  return row === null ? null : { ...row, type: 'geofenceLocation', id };
};

export function listManagedLocations(ctx: RequestContext) {
  return db.transaction(ctx, async (tx) => ({
    locations: await listLocations(tx, ctx.organizationId),
    users: await tx.query(sql`
      SELECT id, full_name, email, geofence_required
      FROM app_user
      WHERE organization_id = ${ctx.organizationId} AND account_type = 'employee' AND status = 'active'
      ORDER BY full_name
    `),
    appeals: await listBypassRequests(tx, ctx.organizationId),
  }));
}

export async function decideManagedAppeal(ctx: RequestContext, requestId: string, input: { decision: 'approve' | 'deny'; locationId?: string | undefined; until?: string | undefined }) {
  return db.transaction(ctx, async (tx) => {
    if (input.decision === 'deny') return denyBypass(tx, { organizationId: ctx.organizationId, requestId, decidedBy: ctx.principal.id });
    if (!input.locationId || !input.until) throw new IdentityValidationError('IDENTITY_GEOFENCE_APPEAL_DETAILS_REQUIRED', 'An active location and expiry are required to approve an appeal');
    const request = await tx.maybeOne<{ userId: string }>(sql`
      SELECT user_id FROM geofence_bypass_request
      WHERE organization_id = ${ctx.organizationId} AND id = ${requestId} AND status = 'pending'
    `);
    if (!request) throw new IdentityNotFoundError('IDENTITY_GEOFENCE_APPEAL_NOT_FOUND', 'Pending geofence appeal not found');
    const approved = await approveBypass(tx, { organizationId: ctx.organizationId, requestId, decidedBy: ctx.principal.id, locationId: input.locationId, userId: request.userId, until: new Date(input.until) });
    if (!approved) throw new IdentityNotFoundError('IDENTITY_GEOFENCE_APPEAL_NOT_FOUND', 'Pending geofence appeal not found');
    return { id: requestId, status: 'approved' };
  });
}

export function createManagedLocation(ctx: RequestContext, input: { name: string; latitude: number; longitude: number; radiusMetres: number; accuracyThresholdMetres: number }) {
  return db.transaction(ctx, (tx) => createLocation(tx, { ...input, organizationId: ctx.organizationId }));
}

export async function updateManagedLocation(ctx: RequestContext, id: string, input: { name?: string | undefined; latitude?: number | undefined; longitude?: number | undefined; radiusMetres?: number | undefined; accuracyThresholdMetres?: number | undefined; status?: 'active' | 'inactive' | undefined }) {
  try {
    return await db.transaction(ctx, (tx) => updateLocation(tx, { ...input, organizationId: ctx.organizationId, id }));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Expected exactly one row')) {
      throw new IdentityNotFoundError('IDENTITY_GEOFENCE_LOCATION_NOT_FOUND', 'Geofence location not found');
    }
    throw error;
  }
}

export async function assignManagedLocation(ctx: RequestContext, locationId: string, input: { userId: string; enabled: boolean }) {
  return db.transaction(ctx, async (tx) => {
    const location = await tx.maybeOne<{ id: string }>(sql`
      SELECT id FROM geofence_location WHERE organization_id = ${ctx.organizationId} AND id = ${locationId}
    `);
    const user = await tx.maybeOne<{ id: string; accountType: string }>(sql`
      SELECT id, account_type FROM app_user WHERE organization_id = ${ctx.organizationId} AND id = ${input.userId}
    `);
    if (!location || !user) throw new IdentityNotFoundError('IDENTITY_GEOFENCE_TARGET_NOT_FOUND', 'Geofence location or user not found');
    if (user.accountType === 'super-admin') throw new IdentityValidationError('IDENTITY_SUPER_ADMIN_NOT_GEOFENCED', 'Super Admin accounts are never geofenced');
    return setAssignment(tx, { organizationId: ctx.organizationId, locationId, ...input });
  });
}

export async function listManagedUsers(ctx: RequestContext) {
  return db.query(ctx, sql`
    SELECT id, full_name, email, geofence_required
    FROM app_user
    WHERE organization_id = ${ctx.organizationId} AND account_type = 'employee' AND status = 'active'
    ORDER BY full_name
  `);
}
