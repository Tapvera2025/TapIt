/**
 * Sales v1.1 R2 — Contract routes (R2 plan step 2.12).
 *
 * Contracts share their parent deal's authz surface — the viewer / editor
 * routes resolve the owning deal via `loadDeal` / `loadDealForContract`.
 * Recording a signature and amending a signed contract require the
 * dedicated `deals:approve-contract` action (R-CON-02).
 */

import { z } from 'zod';
import { route } from '../../../platform/http/route.js';
import { loadDeal } from '../deals/service.js';
import {
  amend,
  createDraft,
  getContract,
  listForDeal,
  loadDealForContract,
  markSent,
  recordSignature,
  voidContract,
} from './service.js';
import {
  amendContractSchema,
  createDraftSchema,
  markSentSchema,
  recordSignatureSchema,
  voidContractSchema,
} from './validators.js';

const uuid = (value: string) => z.string().uuid().parse(value);

export function registerContractRoutes(): void {
  route({
    method: 'GET',
    path: '/api/deals/:dealId/contracts',
    action: 'deals:view',
    module: 'deals',
    resourceParam: 'dealId',
    loadResource: loadDeal,
    handler: async ({ ctx, params }) => listForDeal(ctx, uuid(params['dealId']!)),
  });

  route({
    method: 'POST',
    path: '/api/deals/:dealId/contracts',
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
    path: '/api/contracts/:id',
    action: 'deals:view',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDealForContract,
    handler: async ({ ctx, params }) => getContract(ctx, uuid(params['id']!)),
  });

  route({
    method: 'POST',
    path: '/api/contracts/:id/send',
    action: 'deals:edit',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDealForContract,
    handler: async ({ ctx, params, body }) =>
      markSent(ctx, uuid(params['id']!), markSentSchema.parse(body)),
  });

  // Recording a signature flips the deal's contract readiness; it needs
  // the dedicated approve-contract authority (R-CON-02 / R-WIN-01).
  route({
    method: 'POST',
    path: '/api/contracts/:id/signature',
    action: 'deals:approve-contract',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDealForContract,
    handler: async ({ ctx, params, body }) =>
      recordSignature(ctx, uuid(params['id']!), recordSignatureSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/contracts/:id/void',
    action: 'deals:edit',
    module: 'deals',
    resourceParam: 'id',
    loadResource: loadDealForContract,
    handler: async ({ ctx, params, body }) =>
      voidContract(ctx, uuid(params['id']!), voidContractSchema.parse(body)),
  });

  // Amendment creates a new draft that supersedes a signed contract. We
  // gate it on `deals:approve-contract` since it alters a signed artifact.
  route({
    method: 'POST',
    path: '/api/contracts/:id/amend',
    action: 'deals:approve-contract',
    module: 'deals',
    status: 201,
    resourceParam: 'id',
    loadResource: loadDealForContract,
    handler: async ({ ctx, params, body }) =>
      amend(ctx, uuid(params['id']!), amendContractSchema.parse(body)),
  });
}
