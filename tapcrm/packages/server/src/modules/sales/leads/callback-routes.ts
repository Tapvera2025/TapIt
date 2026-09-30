import { z } from 'zod';
import { route } from '../../../platform/http/route.js';
import { completeCallback, createCallback, getCallback, listLeadCallbacks, loadCallbackResource, updateCallback } from './callback-service.js';
import { callbackListQuerySchema, callbackOutcomeSchema, createCallbackSchema, updateCallbackSchema } from './validators.js';

const id = (value: string) => z.string().uuid().parse(value);
export function registerCallbackRoutes(): void {
  route({ method: 'GET', path: '/api/callbacks', action: 'callbacks:view', module: 'callbacks', handler: async ({ ctx, query }) => listLeadCallbacks(ctx, callbackListQuerySchema.parse(query)) });
  route({ method: 'GET', path: '/api/callbacks/:id', action: 'callbacks:view', module: 'callbacks', resourceParam: 'id', loadResource: loadCallbackResource, handler: async ({ ctx, params }) => getCallback(ctx, id(params['id']!)) });
  route({ method: 'POST', path: '/api/callbacks', action: 'callbacks:create', module: 'callbacks', status: 201, handler: async ({ ctx, body }) => createCallback(ctx, createCallbackSchema.parse(body)) });
  route({ method: 'PATCH', path: '/api/callbacks/:id', action: 'callbacks:edit', module: 'callbacks', resourceParam: 'id', loadResource: loadCallbackResource, handler: async ({ ctx, params, body }) => updateCallback(ctx, id(params['id']!), updateCallbackSchema.parse(body)) });
  route({ method: 'POST', path: '/api/callbacks/:id/outcome', action: 'callbacks:edit', module: 'callbacks', resourceParam: 'id', loadResource: loadCallbackResource, handler: async ({ ctx, params, body }) => completeCallback(ctx, id(params['id']!), callbackOutcomeSchema.parse(body)) });
}
