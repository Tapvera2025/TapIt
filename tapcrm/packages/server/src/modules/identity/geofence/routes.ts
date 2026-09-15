import { z } from 'zod';
import { route } from '../../../platform/http/route.js';
import { createManagedLocation, assignManagedLocation, decideManagedAppeal, geofenceLocationResource, listManagedLocations, updateManagedLocation } from './admin.js';

const locationFields = {
  name: z.string().trim().min(1).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMetres: z.number().positive().max(100000),
  accuracyThresholdMetres: z.number().int().positive().max(100000),
};

export function registerGeofenceRoutes(): void {
  route({
    method: 'GET', path: '/api/identity/geofences', action: 'identity:manage-geofence',
    module: 'identity', handler: async ({ ctx }) => listManagedLocations(ctx),
  });
  route({
    method: 'POST', path: '/api/identity/geofences', action: 'identity:manage-geofence',
    module: 'identity', status: 201,
    handler: async ({ ctx, body }) => createManagedLocation(ctx, z.object(locationFields).parse(body)),
  });
  route({
    method: 'PATCH', path: '/api/identity/geofences/:id', action: 'identity:manage-geofence',
    module: 'identity', resourceParam: 'id', loadResource: geofenceLocationResource,
    handler: async ({ ctx, params, body }) => updateManagedLocation(ctx, params['id']!, z.object({
      name: locationFields.name.optional(), latitude: locationFields.latitude.optional(), longitude: locationFields.longitude.optional(),
      radiusMetres: locationFields.radiusMetres.optional(), accuracyThresholdMetres: locationFields.accuracyThresholdMetres.optional(),
      status: z.enum(['active', 'inactive']).optional(),
    }).parse(body)),
  });
  route({
    method: 'POST', path: '/api/identity/geofences/:id/assign', action: 'identity:manage-geofence',
    module: 'identity', resourceParam: 'id', loadResource: geofenceLocationResource,
    handler: async ({ ctx, params, body }) => assignManagedLocation(ctx, params['id']!, z.object({ userId: z.string().uuid(), enabled: z.boolean().default(true) }).parse(body)),
  });
  route({ method: 'GET', path: '/api/identity/geofence-appeals', action: 'identity:manage-geofence', module: 'identity', handler: async ({ ctx }) => (await listManagedLocations(ctx)).appeals });
  route({ method: 'POST', path: '/api/identity/geofence-appeals/:id/decide', action: 'identity:manage-geofence', module: 'identity', handler: async ({ ctx, params, body }) => decideManagedAppeal(ctx, params['id']!, z.object({ decision: z.enum(['approve', 'deny']), locationId: z.string().uuid().optional(), until: z.string().datetime().optional() }).parse(body)) });
}
