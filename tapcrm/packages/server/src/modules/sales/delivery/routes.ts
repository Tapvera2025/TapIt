/**
 * Sales v1.1 R2 — Delivery brief routes (R2 plan step 2.15).
 *
 * Routes under `/api/deals/:dealId/delivery-brief` scope by the parent
 * deal (deals:edit for Sales-owned work). The review decision uses
 * `delivery:approve` since it is the PM / Delivery HOD that accepts;
 * cancellation after a Won deal is additionally guarded in-service by
 * `deals:approve` (R-DEL-02).
 */

import { z } from 'zod';
import { route } from '../../../platform/http/route.js';
import { loadDeal } from '../deals/service.js';
import {
  getBrief,
  getBriefForDeal,
  loadDealForBrief,
  reviewDecision,
  startBrief,
  submit,
  updateBrief,
} from './service.js';
import {
  reviewDecisionSchema,
  startBriefSchema,
  updateBriefSchema,
} from './validators.js';

const uuid = (value: string) => z.string().uuid().parse(value);

export function registerDeliveryBriefRoutes(): void {
  route({
    method: 'GET',
    path: '/api/deals/:dealId/delivery-brief',
    action: 'delivery:view',
    module: 'delivery',
    resourceParam: 'dealId',
    loadResource: loadDeal,
    handler: async ({ ctx, params }) => getBriefForDeal(ctx, uuid(params['dealId']!)),
  });

  route({
    method: 'POST',
    path: '/api/deals/:dealId/delivery-brief',
    action: 'deals:edit',
    module: 'deals',
    status: 201,
    resourceParam: 'dealId',
    loadResource: loadDeal,
    handler: async ({ ctx, params, body }) =>
      startBrief(ctx, uuid(params['dealId']!), startBriefSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/delivery-briefs/:id',
    action: 'delivery:view',
    module: 'delivery',
    resourceParam: 'id',
    loadResource: loadDealForBrief,
    handler: async ({ ctx, params }) => getBrief(ctx, uuid(params['id']!)),
  });

  route({
    method: 'PATCH',
    path: '/api/delivery-briefs/:id',
    action: 'deals:edit',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDealForBrief,
    handler: async ({ ctx, params, body }) =>
      updateBrief(ctx, uuid(params['id']!), updateBriefSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/delivery-briefs/:id/submit',
    action: 'deals:edit',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDealForBrief,
    handler: async ({ ctx, params }) => submit(ctx, uuid(params['id']!)),
  });

  // Accept / request_changes / cancel — the review action. Delivery
  // approvers run this path; cancellation after Won is additionally
  // gated inside the service via effectivePolicy('deals:approve').
  route({
    method: 'POST',
    path: '/api/delivery-briefs/:id/review',
    action: 'delivery:approve',
    module: 'delivery',
    resourceParam: 'id',
    loadResource: loadDealForBrief,
    handler: async ({ ctx, params, body }) =>
      reviewDecision(ctx, uuid(params['id']!), reviewDecisionSchema.parse(body)),
  });
}
