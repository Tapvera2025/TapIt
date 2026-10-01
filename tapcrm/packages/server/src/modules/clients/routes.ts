import { z } from 'zod';
import { route } from '../../platform/http/route.js';
import {
  createClient,
  getClient,
  listClients,
  loadClientResource,
  revokeClientCredentials,
  setClientCredentials,
  updateClient,
} from './service.js';
import { clientListQuerySchema, createClientSchema, resetClientCredentialsSchema, updateClientSchema } from './validators.js';

const idParam = z.object({ id: z.string().uuid() });

/**
 * Client HTTP routes. `clients:view`/`clients:manage` already existed in
 * AUTHORIZATION.md before this module did; see clients/policy.ts for how
 * their matrix-declared scopes are interpreted against the `client` table.
 */
export function registerClientRoutes(): void {
  route({
    method: 'GET',
    path: '/api/clients',
    action: 'clients:view',
    module: 'clients',
    handler: async ({ ctx, query }) => listClients(ctx, clientListQuerySchema.parse(query)),
  });

  route({
    method: 'GET',
    path: '/api/clients/:id',
    action: 'clients:view',
    module: 'clients',
    resourceParam: 'id',
    loadResource: loadClientResource,
    handler: async ({ ctx, params }) => getClient(ctx, idParam.parse(params).id),
  });

  route({
    method: 'POST',
    path: '/api/clients',
    action: 'clients:manage',
    module: 'clients',
    status: 201,
    handler: async ({ ctx, body }) => createClient(ctx, createClientSchema.parse(body)),
  });

  route({
    method: 'PATCH',
    path: '/api/clients/:id',
    action: 'clients:manage',
    module: 'clients',
    resourceParam: 'id',
    loadResource: loadClientResource,
    handler: async ({ ctx, params, body }) => updateClient(ctx, idParam.parse(params).id, updateClientSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/clients/:id/credentials',
    action: 'clients:manage',
    module: 'clients',
    resourceParam: 'id',
    loadResource: loadClientResource,
    handler: async ({ ctx, params, body }) => setClientCredentials(ctx, idParam.parse(params).id, resetClientCredentialsSchema.parse(body)),
  });

  route({
    method: 'DELETE',
    path: '/api/clients/:id/credentials',
    action: 'clients:manage',
    module: 'clients',
    resourceParam: 'id',
    loadResource: loadClientResource,
    handler: async ({ ctx, params }) => revokeClientCredentials(ctx, idParam.parse(params).id),
  });
}
