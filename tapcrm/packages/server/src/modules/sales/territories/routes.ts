import { z } from 'zod';
import { route } from '../../../platform/http/route.js';
import { createTerritory, getRoutingConfiguration, getTerritory, getTerritoryCoverage, getTerritoryReporting, listTerritories, loadTerritoryResource, reassignTerritory, updateRoutingConfiguration, updateTerritory, updateTerritoryStatus } from './service.js';
import { createTerritorySchema, routingConfigurationSchema, territoryReportingQuerySchema, territoryReassignmentSchema, territoryStatusSchema, updateTerritorySchema } from './validators.js';

export function registerTerritoryRoutes(): void {
  route({ method: 'GET', path: '/api/territories/routing', action: 'territories:view', module: 'territories', handler: async ({ ctx }) => getRoutingConfiguration(ctx) });
  route({ method: 'PUT', path: '/api/territories/routing', action: 'territories:manage', module: 'territories', handler: async ({ ctx, body }) => updateRoutingConfiguration(ctx, routingConfigurationSchema.parse(body)) });
  route({ method: 'GET', path: '/api/territories/coverage', action: 'territories:view', module: 'territories', handler: async ({ ctx }) => getTerritoryCoverage(ctx) });
  route({ method: 'GET', path: '/api/territories/reporting', action: 'territories:view', module: 'territories', handler: async ({ ctx, query }) => getTerritoryReporting(ctx, territoryReportingQuerySchema.parse(query)) });
  route({ method: 'GET', path: '/api/territories', action: 'territories:view', module: 'territories', handler: async ({ ctx }) => listTerritories(ctx) });
  route({ method: 'GET', path: '/api/territories/:id', action: 'territories:view', module: 'territories', resourceParam: 'id', loadResource: loadTerritoryResource, handler: async ({ ctx, params }) => getTerritory(ctx, z.string().uuid().parse(params['id'])) });
  route({ method: 'POST', path: '/api/territories', action: 'territories:manage', module: 'territories', status: 201, handler: async ({ ctx, body }) => createTerritory(ctx, createTerritorySchema.parse(body)) });
  route({ method: 'PATCH', path: '/api/territories/:id', action: 'territories:manage', module: 'territories', resourceParam: 'id', loadResource: loadTerritoryResource, handler: async ({ ctx, params, body }) => updateTerritory(ctx, z.string().uuid().parse(params['id']), updateTerritorySchema.parse(body)) });
  route({ method: 'POST', path: '/api/territories/:id/reassign', action: 'territories:manage', module: 'territories', resourceParam: 'id', loadResource: loadTerritoryResource, handler: async ({ ctx, params, body }) => reassignTerritory(ctx, z.string().uuid().parse(params['id']), territoryReassignmentSchema.parse(body)) });
  route({ method: 'PUT', path: '/api/territories/:id/status', action: 'territories:manage', module: 'territories', resourceParam: 'id', loadResource: loadTerritoryResource, handler: async ({ ctx, params, body }) => updateTerritoryStatus(ctx, z.string().uuid().parse(params['id']), territoryStatusSchema.parse(body)) });
}
