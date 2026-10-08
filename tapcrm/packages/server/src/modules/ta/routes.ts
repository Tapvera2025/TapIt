import { route } from '../../platform/http/route.js';
import * as service from './service.js';
import {
  assignmentSchema,
  listSchema,
  mySchema,
  recalculateSchema,
  sendSchema,
} from './validators.js';

export function registerTaRoutes(): void {
  route({
    method: 'GET',
    path: '/api/ta/assignments',
    action: 'ta:manage',
    module: 'ta',
    handler: async ({ ctx }) => ({ assignments: await service.listAssignments(ctx) }),
  });
  route({
    method: 'POST',
    path: '/api/ta/assignments',
    action: 'ta:manage',
    module: 'ta',
    status: 201,
    handler: async ({ ctx, body }) =>
      service.createAssignment(ctx, assignmentSchema.parse(body ?? {})),
  });
  route({
    method: 'POST',
    path: '/api/ta/assignments/:id/deactivate',
    action: 'ta:manage',
    module: 'ta',
    handler: async ({ ctx, params }) => {
      await service.changeAssignmentStatus(ctx, params['id']!, 'inactive');
      return null;
    },
  });
  route({
    method: 'POST',
    path: '/api/ta/assignments/:id/reactivate',
    action: 'ta:manage',
    module: 'ta',
    handler: async ({ ctx, params }) => {
      await service.changeAssignmentStatus(ctx, params['id']!, 'active');
      return null;
    },
  });
  route({
    method: 'GET',
    path: '/api/ta/report',
    action: 'ta:view',
    module: 'ta',
    handler: async ({ ctx, query }) => service.listReport(ctx, listSchema.parse(query)),
  });
  route({
    method: 'POST',
    path: '/api/ta/statements/recalculate',
    action: 'ta:recalculate',
    module: 'ta',
    handler: async ({ ctx, body }) => {
      const input = recalculateSchema.parse(body ?? {});
      return service.recalculate(ctx, input.taMonth, input.assignmentIds);
    },
  });
  route({
    method: 'POST',
    path: '/api/ta/statements/send',
    action: 'ta:send',
    module: 'ta',
    handler: async ({ ctx, body }) =>
      service.send(ctx, sendSchema.parse(body ?? {}).statementIds),
  });
  route({
    method: 'GET',
    path: '/api/ta/export',
    action: 'ta:export',
    module: 'ta',
    handler: async ({ ctx, query, res }) => {
      const file = await service.exportReport(
        ctx,
        listSchema.parse(query),
        query['format'] === 'xlsx' ? 'xlsx' : 'csv',
      );
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      res.send(file.body);
      return null;
    },
  });
  route({
    method: 'GET',
    path: '/api/ta/my',
    action: 'ta:view-own',
    module: 'ta',
    handler: async ({ ctx, query }) =>
      service.myStatements(ctx, mySchema.parse(query).taMonth),
  });
}
