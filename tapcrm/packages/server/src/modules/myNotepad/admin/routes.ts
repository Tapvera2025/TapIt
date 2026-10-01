import { route } from '../../../platform/http/route.js';
import {
  getEmployeeCurrentNoteController,
  getEmployeeHistoricalNoteController,
  getEmployeeNoteHistoryController,
  listEmployeeNotesController,
} from './controller.js';
import * as service from './service.js';

/**
 * Register Super Admin Employee Notes monitoring routes into the central route registry.
 *
 * All routes require the protected 'notepad:view-all' action, which is strictly
 * restricted to Super Admin (positionGrantable = false, delegationAllowed = false,
 * superAdminOnly = true).
 *
 * These routes go through the standard authorization pipeline (authorize()).
 */
export function registerMyNotepadAdminRoutes(): void {
  route({
    method: 'GET',
    path: '/api/admin/employee-notes',
    action: 'notepad:view-all',
    handler: async ({ ctx, query }) => listEmployeeNotesController(ctx, query),
  });

  route({
    method: 'GET',
    path: '/api/admin/employee-notes/:userId',
    action: 'notepad:view-all',
    resourceParam: 'userId',
    loadResource: (ctx, id) => service.loadNotepadResource(ctx, id),
    handler: async ({ ctx, params }) =>
      getEmployeeCurrentNoteController(ctx, params),
  });

  route({
    method: 'GET',
    path: '/api/admin/employee-notes/:userId/history',
    action: 'notepad:view-all',
    resourceParam: 'userId',
    loadResource: (ctx, id) => service.loadNotepadResource(ctx, id),
    handler: async ({ ctx, params }) =>
      getEmployeeNoteHistoryController(ctx, params),
  });

  route({
    method: 'GET',
    path: '/api/admin/employee-notes/:userId/history/:historyId',
    action: 'notepad:view-all',
    resourceParam: 'userId',
    loadResource: (ctx, id) => service.loadNotepadResource(ctx, id),
    handler: async ({ ctx, params }) =>
      getEmployeeHistoricalNoteController(ctx, params),
  });
}
