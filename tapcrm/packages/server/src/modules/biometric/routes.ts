import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { route } from '../../platform/http/route.js';
import * as repo from './repository.js';
import {
  changeDevice,
  createDevice,
  listDevices,
  listPunches,
  putMapping,
  requestReplay,
} from './service.js';
import {
  createDeviceSchema,
  deviceQuerySchema,
  mappingSchema,
  patchDeviceSchema,
  punchQuerySchema,
  replaySchema,
  serialSchema,
} from './validators.js';

/**
 * The biometric admin API (§10.8): the six bindings the registry declares, all
 * `biometric:manage`. The machine surface (`/iclock`) is not here: it arrives
 * with its own router once G2 is decided (5c).
 */

/** PATCH's object: the device with this serial in the caller's tenant. */
export async function loadDeviceBySerial(
  ctx: RequestContext,
  serial: string,
): Promise<Resource | null> {
  if (!serialSchema.safeParse(serial).success) return null;
  const device = await db.transaction(ctx, (tx) => repo.findDeviceBySerial(tx, serial));
  return device === null
    ? null
    : { type: 'biometricDevice', id: device.id, organizationId: ctx.organizationId };
}

export function registerBiometricRoutes(): void {
  route({
    method: 'GET',
    path: '/api/biometric/devices',
    action: 'biometric:manage',
    module: 'biometric',
    handler: async ({ ctx, query }) => listDevices(ctx, deviceQuerySchema.parse(query)),
  });

  route({
    method: 'POST',
    path: '/api/biometric/devices',
    action: 'biometric:manage',
    module: 'biometric',
    handler: async ({ ctx, body }) => createDevice(ctx, createDeviceSchema.parse(body)),
  });

  route({
    method: 'PATCH',
    path: '/api/biometric/devices/:serial',
    action: 'biometric:manage',
    module: 'biometric',
    resourceParam: 'serial',
    loadResource: loadDeviceBySerial,
    handler: async ({ ctx, params, body }) =>
      changeDevice(ctx, params['serial']!, patchDeviceSchema.parse(body)),
  });

  route({
    method: 'PUT',
    path: '/api/biometric/mapping',
    action: 'biometric:manage',
    module: 'biometric',
    handler: async ({ ctx, body }) => putMapping(ctx, mappingSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/biometric/punches',
    action: 'biometric:manage',
    module: 'biometric',
    handler: async ({ ctx, query }) => listPunches(ctx, punchQuerySchema.parse(query)),
  });

  route({
    method: 'POST',
    path: '/api/biometric/punches/replay',
    action: 'biometric:manage',
    module: 'biometric',
    // Accepted: the replay runs after the answer.
    status: 202,
    handler: async ({ ctx, body }) => requestReplay(ctx, replaySchema.parse(body)),
  });
}
