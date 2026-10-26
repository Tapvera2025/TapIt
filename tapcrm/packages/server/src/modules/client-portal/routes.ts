import { route } from '../../platform/http/route.js';
import {
  getDashboard, getProfile, getProject, getProjects, getProjectDiscussion, getClientProjectDiscussions,
  getProjectDiscussionMessages, markProjectDiscussionRead, reactToProjectDiscussionMessage,
  removeProjectDiscussionReaction, sendProjectDiscussionMessage,
} from './service.js';
import { listMessagesQuerySchema, reactionSchema, sendMessageSchema } from '../chat/validators.js';

/**
 * Client portal read API and project-scoped discussion API (PRD §12.3).
 *
 * These are `authOnly` because the action registry (generated from
 * AUTHORIZATION.md) has no client-portal actions yet. That is safe here, and
 * only here, because (a) the `client-portal` module entitlement is enforced
 * per organization, and (b) every handler obtains its client id exclusively
 * from `requireClientId` in service.ts, which rejects non-client principals,
 * and every query is filtered by it. Discussion handlers also re-check the
 * live project, client membership, and exact conversation on every request. When registry actions are added, move
 * these to `action:` bindings and keep the service-level guard as defence in depth.
 */
export function registerClientPortalRoutes(): void {
  const common = { authOnly: true, module: 'client-portal' } as const;

  route({ ...common, method: 'GET', path: '/api/client-portal/me', handler: async ({ ctx }) => getProfile(ctx) });
  route({ ...common, method: 'GET', path: '/api/client-portal/dashboard', handler: async ({ ctx }) => getDashboard(ctx) });
  route({ ...common, method: 'GET', path: '/api/client-portal/projects', handler: async ({ ctx }) => getProjects(ctx) });
  route({ ...common, method: 'GET', path: '/api/client-portal/discussions', handler: async ({ ctx }) => getClientProjectDiscussions(ctx) });
  route({
    ...common,
    method: 'GET',
    path: '/api/client-portal/projects/:id',
    handler: async ({ ctx, params }) => getProject(ctx, params['id']!),
  });
  route({
    ...common, method: 'GET', path: '/api/client-portal/projects/:id/discussion',
    handler: async ({ ctx, params }) => getProjectDiscussion(ctx, params['id']!),
  });
  route({
    ...common, method: 'GET', path: '/api/client-portal/projects/:projectId/discussion/:conversationId/messages',
    handler: async ({ ctx, params, query }) => getProjectDiscussionMessages(ctx, params['projectId']!, params['conversationId']!, listMessagesQuerySchema.parse(query)),
  });
  route({
    ...common, method: 'POST', path: '/api/client-portal/projects/:projectId/discussion/:conversationId/messages', status: 201,
    handler: async ({ ctx, params, body }) => sendProjectDiscussionMessage(ctx, params['projectId']!, params['conversationId']!, sendMessageSchema.parse(body)),
  });
  route({
    ...common, method: 'POST', path: '/api/client-portal/projects/:projectId/discussion/:conversationId/read',
    handler: async ({ ctx, params }) => markProjectDiscussionRead(ctx, params['projectId']!, params['conversationId']!),
  });
  route({
    ...common, method: 'POST', path: '/api/client-portal/projects/:projectId/discussion/:conversationId/messages/:messageId/react',
    handler: async ({ ctx, params, body }) => reactToProjectDiscussionMessage(ctx, params['projectId']!, params['conversationId']!, params['messageId']!, reactionSchema.parse(body).emoji),
  });
  route({
    ...common, method: 'DELETE', path: '/api/client-portal/projects/:projectId/discussion/:conversationId/messages/:messageId/react',
    handler: async ({ ctx, params, body }) => removeProjectDiscussionReaction(ctx, params['projectId']!, params['conversationId']!, params['messageId']!, reactionSchema.parse(body).emoji),
  });
}
