import { route } from '../../../../platform/http/route.js';
import { parsePagination } from '../../pagination.js';
import {
  createEntity,
  createRevaluation,
  createSchedule,
  enqueueSync,
  getCompletionOverview,
  listEntities,
  listSchedules,
  listSchedulesPage,
  listRevaluationsPage,
  listSyncQueue,
  listSyncQueuePage,
  listSyncSources,
  loadScheduleResource,
  recognizeSchedule,
} from './service.js';
import {
  entitySchema,
  idSchema,
  recognizeScheduleSchema,
  revaluationSchema,
  scheduleSchema,
  syncSchema,
  syncSourceQuerySchema,
} from './validators.js';

export function registerAccountingCompletionRoutes(): void {
  route({
    method: 'GET',
    path: '/api/accounting/completion/overview',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx }) => getCompletionOverview(ctx),
  });
  route({
    method: 'GET',
    path: '/api/accounting/completion/entities',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx }) => listEntities(ctx),
  });
  route({
    method: 'POST',
    path: '/api/accounting/completion/entities',
    action: 'accounting:manage-accounts',
    module: 'accounting',
    status: 201,
    handler: async ({ ctx, body }) => createEntity(ctx, entitySchema.parse(body)),
  });
  route({
    method: 'GET',
    path: '/api/accounting/completion/schedules/page',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx, query }) => listSchedulesPage(ctx, parsePagination(query)),
  });
  route({
    method: 'GET',
    path: '/api/accounting/completion/fx-revaluations',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx, query }) => listRevaluationsPage(ctx, parsePagination(query)),
  });
  route({
    method: 'GET',
    path: '/api/accounting/completion/schedules',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx }) => listSchedules(ctx),
  });
  route({
    method: 'POST',
    path: '/api/accounting/completion/schedules',
    action: 'accounting:manage-periods',
    module: 'accounting',
    status: 201,
    handler: async ({ ctx, body }) => createSchedule(ctx, scheduleSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/accounting/completion/schedules/:id/recognize',
    action: 'accounting:post-journal',
    module: 'accounting',
    resourceParam: 'id',
    loadResource: loadScheduleResource,
    handler: async ({ ctx, params, body }) =>
      recognizeSchedule(
        ctx,
        idSchema.parse(params).id,
        recognizeScheduleSchema.parse(body),
      ),
  });
  route({
    method: 'POST',
    path: '/api/accounting/completion/fx-revaluations',
    action: 'accounting:post-journal',
    module: 'accounting',
    status: 201,
    handler: async ({ ctx, body }) =>
      createRevaluation(ctx, revaluationSchema.parse(body)),
  });
  route({
    method: 'GET',
    path: '/api/accounting/completion/sync-queue',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx }) => listSyncQueue(ctx),
  });
  route({
    method: 'GET',
    path: '/api/accounting/completion/sync-queue/page',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx, query }) => listSyncQueuePage(ctx, parsePagination(query)),
  });
  route({
    method: 'GET',
    path: '/api/accounting/completion/sync-sources',
    action: 'accounting:view-ledger',
    module: 'accounting',
    handler: async ({ ctx, query }) =>
      listSyncSources(ctx, syncSourceQuerySchema.parse(query)),
  });
  route({
    method: 'POST',
    path: '/api/accounting/completion/sync-queue',
    action: 'accounting:manage-periods',
    module: 'accounting',
    status: 201,
    handler: async ({ ctx, body }) => enqueueSync(ctx, syncSchema.parse(body)),
  });
}
