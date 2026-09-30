import { route } from '../../platform/http/route.js';
import {
  clearNote,
  getCurrentNote,
  getHistoricalNote,
  getNoteHistory,
  saveNote,
} from './service.js';
import { historyIdParamSchema, saveNoteSchema } from './validators.js';

/**
 * Register My Notepad routes into the central route registry.
 *
 * My Notepad is a universal authenticated-user utility. It does not require
 * position-based authorization — every authenticated user in every tenant
 * can use their own notepad. Routes are registered with `authOnly: true`
 * to explicitly opt out of action-based authorization while still requiring
 * a valid authenticated RequestContext (authentication + tenant + RLS).
 */
export function registerMyNotepadRoutes(): void {
  route({
    method: 'GET',
    path: '/api/my-notepad',
    authOnly: true,
    handler: async ({ ctx }) => getCurrentNote(ctx),
  });

  route({
    method: 'PUT',
    path: '/api/my-notepad',
    authOnly: true,
    handler: async ({ ctx, body }) => {
      const input = saveNoteSchema.parse(body);
      return saveNote(ctx, input);
    },
  });

  route({
    method: 'DELETE',
    path: '/api/my-notepad',
    authOnly: true,
    handler: async ({ ctx }) => clearNote(ctx),
  });

  route({
    method: 'GET',
    path: '/api/my-notepad/history',
    authOnly: true,
    handler: async ({ ctx }) => getNoteHistory(ctx),
  });

  route({
    method: 'GET',
    path: '/api/my-notepad/history/:id',
    authOnly: true,
    handler: async ({ ctx, params }) => {
      const { id } = historyIdParamSchema.parse(params);
      return getHistoricalNote(ctx, id);
    },
  });
}
