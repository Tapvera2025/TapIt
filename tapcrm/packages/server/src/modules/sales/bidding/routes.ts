import { z } from 'zod';
import { route } from '../../../platform/http/route.js';
import { loadLeadResource } from '../leads/repository.js';
import { claimsDistribution, poolHealth } from './dashboard.js';
import { BidPoolLeadNotFoundError } from './errors.js';
import { claim, getBidCard, listBidPool, pass, type PassReason } from './service.js';

const id = (value: string) => z.string().uuid().parse(value);

const passBodySchema = z.object({
  reason: z.enum(['wrong_location', 'out_of_expertise', 'at_capacity', 'other']),
});

export function registerBidPoolRoutes(): void {
  route({
    method: 'GET',
    path: '/api/bid-pool',
    action: 'leads:view',
    module: 'leads',
    handler: async ({ ctx }) => ({ items: await listBidPool(ctx) }),
  });

  route({
    method: 'GET',
    path: '/api/sales/dashboard/claims-distribution',
    action: 'leads:view',
    module: 'leads',
    handler: async ({ ctx }) => ({ rows: await claimsDistribution(ctx) }),
  });

  route({
    method: 'GET',
    path: '/api/sales/dashboard/pool-health',
    action: 'leads:view',
    module: 'leads',
    handler: async ({ ctx }) => poolHealth(ctx),
  });

  route({
    method: 'GET',
    path: '/api/bid-pool/:leadId/card',
    action: 'leads:view',
    module: 'leads',
    resourceParam: 'leadId',
    loadResource: loadLeadResource,
    handler: async ({ ctx, params }) => {
      const leadId = id(params['leadId']!);
      const card = await getBidCard(ctx, leadId);
      if (!card) throw new BidPoolLeadNotFoundError(leadId);
      return card;
    },
  });

  route({
    method: 'POST',
    path: '/api/bid-pool/:leadId/claim',
    action: 'leads:claim',
    module: 'leads',
    resourceParam: 'leadId',
    loadResource: loadLeadResource,
    handler: async ({ ctx, params }) => claim(ctx, id(params['leadId']!)),
  });

  route({
    method: 'POST',
    path: '/api/bid-pool/:leadId/pass',
    action: 'leads:pass',
    module: 'leads',
    resourceParam: 'leadId',
    loadResource: loadLeadResource,
    handler: async ({ ctx, params, body }) => {
      const parsed = passBodySchema.parse(body);
      await pass(ctx, id(params['leadId']!), parsed.reason satisfies PassReason);
      return { ok: true };
    },
  });
}
