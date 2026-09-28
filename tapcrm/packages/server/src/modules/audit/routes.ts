import { route } from '../../platform/http/route.js';
import { z } from 'zod';
import { listAuditEntries, loadAuditEntryResource } from './repository.js';
import { getLatestAuditIntegrityReport } from './integrity.js';
import { streamAuditExport } from './export.js';
import {
  createLegalHold,
  listLegalHoldTargets,
  listLegalHolds,
  loadLegalHoldResource,
  releaseLegalHold,
  HOLD_TYPES,
} from './legal-holds.js';

const legalHoldSchema = z.object({
  holdType: z.enum(HOLD_TYPES),
  targetId: z.string().uuid().nullable().optional().transform((value) => value ?? null),
  startsAt: z.string().datetime({ offset: true }).transform((value) => new Date(value)).nullable().optional().transform((value) => value ?? null),
  endsAt: z.string().datetime({ offset: true }).transform((value) => new Date(value)).nullable().optional().transform((value) => value ?? null),
  reason: z.string().trim().min(1).max(2000),
}).superRefine((value, context) => {
  if (value.holdType === 'date-range' && (value.startsAt === null || value.endsAt === null || value.endsAt < value.startsAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'Date-range holds require an ordered start and end.' });
  }
  if (value.holdType !== 'date-range' && (value.targetId === null || value.startsAt !== null || value.endsAt !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetId'], message: 'User and client holds require only a target.' });
  }
});
const releaseSchema = z.object({ reason: z.string().trim().min(1).max(2000).optional() }).default({});

const querySchema = z.object({
  stream: z.enum(['access', 'activity']).optional(),
  actorId: z.string().uuid().optional(),
  targetId: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(200).optional(),
  from: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  to: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  organizationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

const exportSchema = z.object({
  format: z.enum(['csv', 'json']).default('json'),
  stream: z.enum(['access', 'activity']).optional(),
  actorId: z.string().uuid().optional(),
  targetId: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(200).optional(),
  from: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  to: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional(),
}).superRefine((value, context) => {
  if (value.from && value.to && value.to < value.from) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'End date must be after start date.' });
  }
});

export function registerAuditRoutes(): void {
  route({
    method: 'GET',
    path: '/api/audit/hold-targets',
    action: 'audit:manage-holds',
    handler: async ({ ctx }) => listLegalHoldTargets(ctx),
  });

  route({
    method: 'GET',
    path: '/api/audit/holds',
    action: 'audit:manage-holds',
    handler: async ({ ctx, query }) => listLegalHolds(ctx, z.enum(['active', 'released', 'all']).parse(query['status'] ?? 'active')),
  });

  route({
    method: 'POST',
    path: '/api/audit/holds',
    action: 'audit:manage-holds',
    status: 201,
    handler: async ({ ctx, body }) => createLegalHold(ctx, legalHoldSchema.parse(body)),
  });

  route({
    method: 'DELETE',
    path: '/api/audit/holds/:id',
    action: 'audit:manage-holds',
    resourceParam: 'id',
    loadResource: loadLegalHoldResource,
    handler: async ({ ctx, params, body }) => releaseLegalHold(ctx, params['id']!, releaseSchema.parse(body ?? {}).reason ?? null),
  });

  route({
    method: 'GET',
    path: '/api/audit/integrity',
    action: 'audit:view',
    handler: async ({ ctx }) => getLatestAuditIntegrityReport(ctx),
  });

  route({
    method: 'POST',
    path: '/api/audit/export',
    action: 'audit:export',
    handler: async ({ ctx, body, res }) => {
      const input = exportSchema.parse(body ?? {});
      res.status(200);
      res.setHeader('Content-Type', input.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="tapcrm-audit-${input.format}.${input.format}"`);
      await streamAuditExport(ctx, input, (chunk) => res.write(chunk));
      res.end();
      return undefined;
    },
  });

  route({
    method: 'GET',
    path: '/api/audit',
    action: 'audit:view',
    handler: async ({ ctx, query }) => {
      const parsed = querySchema.parse(query);
      return listAuditEntries(ctx, {
        limit: parsed.limit,
        ...(parsed.stream ? { stream: parsed.stream } : {}),
        ...(parsed.actorId ? { actorId: parsed.actorId } : {}),
        ...(parsed.targetId ? { targetId: parsed.targetId } : {}),
        ...(parsed.action ? { action: parsed.action } : {}),
        ...(parsed.from ? { from: parsed.from } : {}),
        ...(parsed.to ? { to: parsed.to } : {}),
        ...(parsed.organizationId ? { organizationId: parsed.organizationId } : {}),
        ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
      });
    },
  });

  route({
    method: 'GET',
    path: '/api/audit/:id',
    action: 'audit:view',
    resourceParam: 'id',
    loadResource: loadAuditEntryResource,
    handler: async ({ resource }) => resource,
  });
}
