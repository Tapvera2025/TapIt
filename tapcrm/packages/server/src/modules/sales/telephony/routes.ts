import { z } from 'zod';
import { route } from '../../../platform/http/route.js';
import { loadCallResource } from './repository.js';
import {
  createConnection,
  disconnectConnection,
  employeeOptions,
  getCall,
  getOverview,
  listAgents,
  listCalls,
  listConnectionRuns,
  listConnections,
  listPeople,
  mapAgent,
  rematchAgents,
  streamRecording,
  syncConnectionNow,
  testConnection,
  updateConnection,
} from './service.js';
import {
  agentListQuerySchema,
  agentMappingSchema,
  callListQuerySchema,
  createConnectionSchema,
  overviewQuerySchema,
  runListQuerySchema,
  updateConnectionSchema,
} from './validators.js';

const MODULE = 'telephony';
const id = (value: string | undefined) => z.string().uuid('Not a valid id').parse(value);

/**
 * Call Analytics routes. Bindings: AUTHORIZATION.md §6.5.
 *
 *   telephony:view    calls and analytics, filtered to the caller's reach
 *   telephony:listen  recording playback (sensitive: every play is audited)
 *   telephony:manage  connections, API keys, user matching, syncs
 */
export function registerTelephonyRoutes(): void {
  /* ---- Analytics ---- */
  route({
    method: 'GET',
    path: '/api/telephony/overview',
    action: 'telephony:view',
    module: MODULE,
    handler: async ({ ctx, query }) => getOverview(ctx, overviewQuerySchema.parse(query)),
  });
  route({
    method: 'GET',
    path: '/api/telephony/calls',
    action: 'telephony:view',
    module: MODULE,
    handler: async ({ ctx, query }) => listCalls(ctx, callListQuerySchema.parse(query)),
  });
  route({
    method: 'GET',
    path: '/api/telephony/calls/:id',
    action: 'telephony:view',
    module: MODULE,
    resourceParam: 'id',
    loadResource: loadCallResource,
    handler: async ({ ctx, params }) => getCall(ctx, id(params['id'])),
  });
  route({
    method: 'GET',
    path: '/api/telephony/calls/:id/recording',
    action: 'telephony:listen',
    module: MODULE,
    resourceParam: 'id',
    loadResource: loadCallResource,
    handler: async ({ ctx, params, res }) => {
      await streamRecording(ctx, id(params['id']), res);
      return undefined;
    },
  });
  route({
    method: 'GET',
    path: '/api/telephony/employees',
    action: 'telephony:view',
    module: MODULE,
    handler: async ({ ctx }) => listPeople(ctx),
  });

  /* ---- Connections ---- */
  route({
    method: 'GET',
    path: '/api/telephony/connections',
    action: 'telephony:manage',
    module: MODULE,
    handler: async ({ ctx }) => listConnections(ctx),
  });
  route({
    method: 'POST',
    path: '/api/telephony/connections',
    action: 'telephony:manage',
    module: MODULE,
    status: 201,
    handler: async ({ ctx, body }) => createConnection(ctx, createConnectionSchema.parse(body)),
  });
  route({
    method: 'PATCH',
    path: '/api/telephony/connections/:id',
    action: 'telephony:manage',
    module: MODULE,
    resourceParam: 'id',
    handler: async ({ ctx, params, body }) => updateConnection(ctx, id(params['id']), updateConnectionSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/telephony/connections/:id/test',
    action: 'telephony:manage',
    module: MODULE,
    resourceParam: 'id',
    status: 200,
    handler: async ({ ctx, params }) => testConnection(ctx, id(params['id'])),
  });
  route({
    method: 'POST',
    path: '/api/telephony/connections/:id/sync',
    action: 'telephony:manage',
    module: MODULE,
    resourceParam: 'id',
    status: 202,
    handler: async ({ ctx, params }) => syncConnectionNow(ctx, id(params['id'])),
  });
  route({
    method: 'POST',
    path: '/api/telephony/connections/:id/disconnect',
    action: 'telephony:manage',
    module: MODULE,
    resourceParam: 'id',
    status: 200,
    handler: async ({ ctx, params }) => disconnectConnection(ctx, id(params['id'])),
  });
  route({
    method: 'GET',
    path: '/api/telephony/connections/:id/runs',
    action: 'telephony:manage',
    module: MODULE,
    resourceParam: 'id',
    handler: async ({ ctx, params, query }) => listConnectionRuns(ctx, id(params['id']), runListQuerySchema.parse(query).limit),
  });

  /* ---- Platform users ↔ employees ---- */
  route({
    method: 'GET',
    path: '/api/telephony/agents',
    action: 'telephony:manage',
    module: MODULE,
    handler: async ({ ctx, query }) => listAgents(ctx, agentListQuerySchema.parse(query)),
  });
  route({
    method: 'PUT',
    path: '/api/telephony/agents/:id/employee',
    action: 'telephony:manage',
    module: MODULE,
    resourceParam: 'id',
    handler: async ({ ctx, params, body }) => mapAgent(ctx, id(params['id']), agentMappingSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/telephony/agents/rematch',
    action: 'telephony:manage',
    module: MODULE,
    status: 200,
    handler: async ({ ctx }) => rematchAgents(ctx),
  });
  route({
    method: 'GET',
    path: '/api/telephony/employee-options',
    action: 'telephony:manage',
    module: MODULE,
    handler: async ({ ctx }) => employeeOptions(ctx),
  });
}
