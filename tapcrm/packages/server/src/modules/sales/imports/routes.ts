import { z } from 'zod';
import { route } from '../../../platform/http/route.js';
import {
  assign,
  assignees,
  createImport,
  discardImport,
  getImport,
  leadCalls,
  listImported,
  listImports,
  listRows,
  previewImport,
  resumeImport,
  startImport,
  trackCalls,
} from './service.js';
import {
  assignSchema,
  callTrackingQuerySchema,
  createImportSchema,
  importedLeadsQuerySchema,
  importRowsQuerySchema,
  importSettingsSchema,
  listImportsQuerySchema,
} from './validators.js';

const MODULE = 'lead-imports';
const id = (value: string | undefined) => z.string().uuid('Not a valid id').parse(value);

/**
 * Lead Imports routes. Bindings: AUTHORIZATION.md §6.5.
 *
 *   lead-imports:view    imports, imported leads and their call tracking
 *   lead-imports:manage  upload, review, import and assign
 *
 * Static paths register before `/api/lead-imports/:id`, which is greedy.
 */
export function registerLeadImportRoutes(): void {
  route({
    method: 'GET',
    path: '/api/lead-imports',
    action: 'lead-imports:view',
    module: MODULE,
    handler: async ({ ctx, query }) => listImports(ctx, listImportsQuerySchema.parse(query).limit),
  });
  route({
    method: 'POST',
    path: '/api/lead-imports',
    action: 'lead-imports:manage',
    module: MODULE,
    status: 201,
    handler: async ({ ctx, body }) => createImport(ctx, createImportSchema.parse(body)),
  });

  /* ---- Imported leads ---- */
  route({
    method: 'GET',
    path: '/api/lead-imports/leads',
    action: 'lead-imports:view',
    module: MODULE,
    handler: async ({ ctx, query }) => listImported(ctx, importedLeadsQuerySchema.parse(query)),
  });
  route({
    method: 'POST',
    path: '/api/lead-imports/assign',
    action: 'lead-imports:manage',
    module: MODULE,
    handler: async ({ ctx, body }) => assign(ctx, assignSchema.parse(body)),
  });
  route({
    method: 'GET',
    path: '/api/lead-imports/assignees',
    action: 'lead-imports:manage',
    module: MODULE,
    handler: async ({ ctx }) => assignees(ctx),
  });

  /* ---- Are assigned leads being called? ---- */
  route({
    method: 'GET',
    path: '/api/lead-imports/call-tracking',
    action: 'lead-imports:view',
    module: MODULE,
    handler: async ({ ctx, query }) => trackCalls(ctx, callTrackingQuerySchema.parse(query)),
  });
  route({
    method: 'GET',
    path: '/api/lead-imports/call-tracking/leads/:id',
    action: 'lead-imports:view',
    module: MODULE,
    resourceParam: 'id',
    handler: async ({ ctx, params }) => leadCalls(ctx, id(params['id'])),
  });

  /* ---- One import ---- */
  route({
    method: 'GET',
    path: '/api/lead-imports/:id',
    action: 'lead-imports:view',
    module: MODULE,
    resourceParam: 'id',
    handler: async ({ ctx, params }) => getImport(ctx, id(params['id'])),
  });
  route({
    method: 'POST',
    path: '/api/lead-imports/:id/preview',
    action: 'lead-imports:manage',
    module: MODULE,
    resourceParam: 'id',
    handler: async ({ ctx, params, body }) => previewImport(ctx, id(params['id']), importSettingsSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/lead-imports/:id/start',
    action: 'lead-imports:manage',
    module: MODULE,
    resourceParam: 'id',
    status: 202,
    handler: async ({ ctx, params, body }) => startImport(ctx, id(params['id']), importSettingsSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/lead-imports/:id/resume',
    action: 'lead-imports:manage',
    module: MODULE,
    resourceParam: 'id',
    status: 202,
    handler: async ({ ctx, params }) => resumeImport(ctx, id(params['id'])),
  });
  route({
    method: 'POST',
    path: '/api/lead-imports/:id/discard',
    action: 'lead-imports:manage',
    module: MODULE,
    resourceParam: 'id',
    handler: async ({ ctx, params }) => discardImport(ctx, id(params['id'])),
  });
  route({
    method: 'GET',
    path: '/api/lead-imports/:id/rows',
    action: 'lead-imports:view',
    module: MODULE,
    resourceParam: 'id',
    handler: async ({ ctx, params, query }) => listRows(ctx, id(params['id']), importRowsQuerySchema.parse(query)),
  });
}
