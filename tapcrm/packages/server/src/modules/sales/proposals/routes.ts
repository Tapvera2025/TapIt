/**
 * Sales v1.1 R2 — Proposal (Commercials) routes (R2 plan step 2.9).
 *
 * Visibility and edit authority come from the parent deal. Both route
 * families (`/api/deals/:dealId/commercials` and `/api/commercials/:id`)
 * load the owning deal as the authz resource via `deals:view-commercials` /
 * `deals:edit`. No new action class is introduced in step 2.9.
 */

import { z } from 'zod';
import { route } from '../../../platform/http/route.js';
import { loadDeal } from '../deals/service.js';
import {
  createDraft,
  createShareLink,
  getCommercials,
  listVersions,
  loadDealForCommercials,
  publishVersion,
  revokeShareLink,
  supersede,
  updateDraft,
} from './service.js';
import { createDraftSchema, updateDraftSchema } from './validators.js';

const uuid = (value: string) => z.string().uuid().parse(value);

export function registerProposalRoutes(): void {
  route({
    method: 'GET',
    path: '/api/deals/:dealId/commercials',
    action: 'deals:view-commercials',
    module: 'deals',
    resourceParam: 'dealId',
    loadResource: loadDeal,
    handler: async ({ ctx, params }) => listVersions(ctx, uuid(params['dealId']!)),
  });

  route({
    method: 'POST',
    path: '/api/deals/:dealId/commercials',
    action: 'deals:edit',
    module: 'deals',
    status: 201,
    resourceParam: 'dealId',
    loadResource: loadDeal,
    handler: async ({ ctx, params, body }) =>
      createDraft(ctx, uuid(params['dealId']!), createDraftSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/commercials/:id',
    action: 'deals:view-commercials',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDealForCommercials,
    handler: async ({ ctx, params }) => getCommercials(ctx, uuid(params['id']!)),
  });

  route({
    method: 'PATCH',
    path: '/api/commercials/:id',
    action: 'deals:edit',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDealForCommercials,
    handler: async ({ ctx, params, body }) =>
      updateDraft(ctx, uuid(params['id']!), updateDraftSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/commercials/:id/publish',
    action: 'deals:edit',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDealForCommercials,
    handler: async ({ ctx, params }) => publishVersion(ctx, uuid(params['id']!)),
  });

  route({
    method: 'POST',
    path: '/api/commercials/:id/supersede',
    action: 'deals:edit',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDealForCommercials,
    handler: async ({ ctx, params }) => supersede(ctx, uuid(params['id']!)),
  });

  route({
    method: 'POST',
    path: '/api/commercials/:id/share-link',
    action: 'deals:edit',
    module: 'deals',
    status: 201,
    resourceParam: 'id',
    loadResource: loadDealForCommercials,
    handler: async ({ ctx, params }) => createShareLink(ctx, uuid(params['id']!)),
  });

  route({
    method: 'DELETE',
    path: '/api/commercials/:id/share-link/:tokenId',
    action: 'deals:edit',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDealForCommercials,
    handler: async ({ ctx, params }) => {
      await revokeShareLink(ctx, uuid(params['tokenId']!));
      return { success: true };
    },
  });
}
