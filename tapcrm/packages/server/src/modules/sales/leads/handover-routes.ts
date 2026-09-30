import { z } from 'zod';
import { route } from '../../../platform/http/route.js';
import { acceptLeadHandover, createHandover, declineLeadHandover, getHandover, getHandoverTargets, listHandovers, loadHandoverResource, recordLeadHandoverDisposition } from './service.js';
import { createHandoverSchema, declineHandoverSchema, handoverDispositionSchema, handoverListQuerySchema, handoverTargetQuerySchema } from './validators.js';

const id = (value: string) => z.string().uuid().parse(value);

export function registerHandoverRoutes(): void {
  route({ method: 'POST', path: '/api/handovers', action: 'handovers:initiate', module: 'handovers', status: 201, handler: async ({ ctx, body }) => createHandover(ctx, createHandoverSchema.parse(body)) });
  route({ method: 'GET', path: '/api/handovers/targets', action: 'handovers:initiate', module: 'handovers', handler: async ({ ctx, query }) => getHandoverTargets(ctx, handoverTargetQuerySchema.parse(query).leadId) });
  route({ method: 'POST', path: '/api/handovers/:id/accept', action: 'handovers:receive', module: 'handovers', resourceParam: 'id', loadResource: loadHandoverResource, handler: async ({ ctx, params }) => acceptLeadHandover(ctx, id(params['id']!)) });
  route({ method: 'POST', path: '/api/handovers/:id/decline', action: 'handovers:receive', module: 'handovers', resourceParam: 'id', loadResource: loadHandoverResource, handler: async ({ ctx, params, body }) => declineLeadHandover(ctx, id(params['id']!), declineHandoverSchema.parse(body)) });
  route({ method: 'POST', path: '/api/handovers/:id/disposition', action: 'handovers:record-disposition', module: 'handovers', resourceParam: 'id', loadResource: loadHandoverResource, handler: async ({ ctx, params, body }) => recordLeadHandoverDisposition(ctx, id(params['id']!), handoverDispositionSchema.parse(body)) });
  route({ method: 'GET', path: '/api/handovers', action: 'handovers:view', module: 'handovers', handler: async ({ ctx, query }) => listHandovers(ctx, handoverListQuerySchema.parse(query)) });
  route({ method: 'GET', path: '/api/handovers/:id', action: 'handovers:view', module: 'handovers', resourceParam: 'id', loadResource: loadHandoverResource, handler: async ({ ctx, params }) => getHandover(ctx, id(params['id']!)) });
}
