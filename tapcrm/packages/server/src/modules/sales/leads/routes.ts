import { z } from 'zod';
import { route } from '../../../platform/http/route.js';
import { createLead, createSource, editSource, getCampaigns, getLead, getSources, listLeads, listStalledLeads, loadLeadResource, updateLead } from './service.js';
import { listReengagementSegments } from './reengagement-service.js';
import { createLeadSchema, leadListQuerySchema, reengagementQuerySchema, sourceSchema, updateLeadSchema, updateSourceSchema } from './validators.js';

const id = (value: string) => z.string().uuid().parse(value);

export function registerLeadRoutes(): void {
  route({ method: 'GET', path: '/api/leads', action: 'leads:view', module: 'leads', handler: async ({ ctx, query }) => listLeads(ctx, leadListQuerySchema.parse(query)) });
  route({ method: 'GET', path: '/api/leads/stalled', action: 'leads:view', module: 'leads', handler: async ({ ctx, query }) => listStalledLeads(ctx, leadListQuerySchema.parse(query)) });
  route({ method: 'GET', path: '/api/leads/re-engagement/segments', action: 'leads:view', module: 'leads', handler: async ({ ctx, query }) => listReengagementSegments(ctx, reengagementQuerySchema.parse(query)) });
  route({ method: 'GET', path: '/api/leads/:id', action: 'leads:view', module: 'leads', resourceParam: 'id', loadResource: loadLeadResource, handler: async ({ ctx, params }) => getLead(ctx, id(params['id']!)) });
  route({ method: 'POST', path: '/api/leads', action: 'leads:create', module: 'leads', status: 201, handler: async ({ ctx, body }) => createLead(ctx, createLeadSchema.parse(body)) });
  route({ method: 'PATCH', path: '/api/leads/:id', action: 'leads:edit', module: 'leads', resourceParam: 'id', loadResource: loadLeadResource, handler: async ({ ctx, params, body }) => updateLead(ctx, id(params['id']!), updateLeadSchema.parse(body)) });
  route({ method: 'GET', path: '/api/lead-sources', action: 'leads:view', module: 'leads', handler: async ({ ctx }) => getSources(ctx) });
  route({ method: 'GET', path: '/api/campaigns', action: 'leads:view', module: 'leads', handler: async ({ ctx }) => getCampaigns(ctx) });
  route({ method: 'POST', path: '/api/lead-sources', action: 'leads:create', module: 'leads', status: 201, handler: async ({ ctx, body }) => createSource(ctx, sourceSchema.parse(body)) });
  route({ method: 'PATCH', path: '/api/lead-sources/:id', action: 'leads:edit', module: 'leads', handler: async ({ ctx, params, body }) => editSource(ctx, id(params['id']!), updateSourceSchema.parse(body)) });
}
