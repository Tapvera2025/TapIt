import { z } from 'zod';
import { route } from '../../../platform/http/route.js';
import { loadDeal } from './service.js';
import {
  cancelAfterWin,
  createDeal,
  getDeal,
  listDeals,
  markLost,
  overrideProbability,
  updateDealStage,
} from './service.js';
import {
  cancelAfterWinSchema,
  createDealSchema,
  dealListQuerySchema,
  markLostSchema,
  overrideProbabilitySchema,
  updateDealStageSchema,
} from './validators.js';
import { listReadyToClose, readinessForClose, recordWin } from './won.js';

const id = (value: string) => z.string().uuid().parse(value);

export function registerDealRoutes(): void {
  route({
    method: 'GET',
    path: '/api/deals',
    action: 'deals:view',
    module: 'deals',
    handler: async ({ ctx, query }) => listDeals(ctx, dealListQuerySchema.parse(query)),
  });

  // Static sibling paths MUST register before `/api/deals/:id`; Express
  // matches in registration order and `:id` is greedy.
  route({
    method: 'GET',
    path: '/api/deals/wins-to-record',
    action: 'deals:record-win',
    module: 'deals',
    handler: async ({ ctx }) => listReadyToClose(ctx),
  });

  route({
    method: 'GET',
    path: '/api/deals/:id',
    action: 'deals:view',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDeal,
    handler: async ({ ctx, params }) => getDeal(ctx, id(params['id']!)),
  });

  route({
    method: 'POST',
    path: '/api/deals',
    action: 'deals:create',
    module: 'deals',
    status: 201,
    handler: async ({ ctx, body }) => createDeal(ctx, createDealSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/deals/:id/stage',
    action: 'deals:edit',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDeal,
    handler: async ({ ctx, params, body }) => updateDealStage(ctx, id(params['id']!), updateDealStageSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/deals/:id/probability',
    action: 'deals:edit',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDeal,
    handler: async ({ ctx, params, body }) => overrideProbability(ctx, id(params['id']!), overrideProbabilitySchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/deals/:id/lost',
    action: 'deals:edit',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDeal,
    handler: async ({ ctx, params, body }) => markLost(ctx, id(params['id']!), markLostSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/deals/:id/cancel-after-win',
    action: 'deals:approve',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDeal,
    handler: async ({ ctx, params, body }) => cancelAfterWin(ctx, id(params['id']!), cancelAfterWinSchema.parse(body)),
  });

  // Won recorder (R2 step 2.14). `readiness` is a cheap read so UIs
  // can render per-row unmet conditions without touching the writer;
  // the writer re-runs the exact same checks under a row lock.
  route({
    method: 'GET',
    path: '/api/deals/:id/win-readiness',
    action: 'deals:view',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDeal,
    handler: async ({ ctx, params }) => readinessForClose(ctx, id(params['id']!)),
  });

  route({
    method: 'POST',
    path: '/api/deals/:id/record-win',
    action: 'deals:record-win',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDeal,
    handler: async ({ ctx, params }) => recordWin(ctx, id(params['id']!)),
  });
}
