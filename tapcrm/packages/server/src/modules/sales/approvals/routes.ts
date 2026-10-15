import { z } from 'zod';
import { route } from '../../../platform/http/route.js';
import {
  decide,
  listPending,
  loadApprovalResource,
  requestApproval,
} from './service.js';
import { decideSchema, requestApprovalSchema } from './validators.js';

const uuid = (value: string) => z.string().uuid().parse(value);

export function registerApprovalRoutes(): void {
  route({
    method: 'GET',
    path: '/api/approvals/queue',
    action: 'approvals:decide',
    module: 'approvals',
    handler: async ({ ctx }) => listPending(ctx),
  });

  // Request creation lives on the authenticated commercials path — the
  // route-manifest doesn't declare a POST for this specifically, so the
  // issuer path is `POST /api/commercials/:id/request-approval` under
  // deals:edit (added here).
  route({
    method: 'POST',
    path: '/api/commercials/:id/request-approval',
    action: 'deals:edit',
    module: 'deals',
    status: 201,
    resourceParam: 'id',
    loadResource: async (ctx, id) => {
      // Delegate to proposals' deal-loader so authz lands on the parent deal.
      const { loadDealForCommercials } = await import('../proposals/service.js');
      return loadDealForCommercials(ctx, id);
    },
    handler: async ({ ctx, params, body }) => {
      requestApprovalSchema.parse({ commercialsId: params['id'], ...(body as object) });
      return requestApproval(ctx, uuid(params['id']!));
    },
  });

  route({
    method: 'POST',
    path: '/api/approvals/:id/decide',
    action: 'approvals:decide',
    module: 'approvals',
    resourceParam: 'id',
    loadResource: loadApprovalResource,
    handler: async ({ ctx, params, body }) => decide(ctx, uuid(params['id']!), decideSchema.parse(body)),
  });
}
