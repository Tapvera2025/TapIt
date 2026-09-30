import { z } from 'zod';
import { route } from '../../platform/http/route.js';
import {
  createInternalGroup,
  forwardMessage,
  getConversation,
  listConversations,
  listMessages,
  loadConversationResource,
  loadMessageResource,
  markRead,
  reactToMessage,
  removeReactionFromMessage,
  sendMessage,
  startDirectConversation,
  unsendMessage,
} from './service.js';
import {
  createGroupConversationSchema,
  forwardMessageSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  reactionSchema,
  sendMessageSchema,
  startDirectConversationSchema,
} from './validators.js';

const idParam = z.object({ id: z.string().uuid() });

/**
 * Chat HTTP routes — Phase 2 of the messaging build (team-docs has the plan).
 *
 * `chat:view` and `chat:send` are granted to every employee position by
 * default (CH-1: no hierarchy). `chat:manage-groups` is Super-Admin-only —
 * the route below is Phase 3 (Internal Groups); Phase 4's project groups are
 * created through `chat/facade.js` instead, gated by the PROJECTS module's
 * own action, not this one.
 */
export function registerChatRoutes(): void {
  route({
    method: 'GET',
    path: '/api/chat/conversations',
    action: 'chat:view',
    module: 'chat',
    handler: async ({ ctx, query }) => listConversations(ctx, listConversationsQuerySchema.parse(query).kind),
  });

  route({
    method: 'GET',
    path: '/api/chat/conversations/:id',
    action: 'chat:view',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadConversationResource,
    handler: async ({ ctx, params }) => getConversation(ctx, idParam.parse(params).id),
  });

  route({
    method: 'GET',
    path: '/api/chat/conversations/:id/messages',
    action: 'chat:view',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadConversationResource,
    handler: async ({ ctx, params, query }) => listMessages(ctx, idParam.parse(params).id, listMessagesQuerySchema.parse(query)),
  });

  route({
    method: 'POST',
    path: '/api/chat/conversations/:id/read',
    action: 'chat:view',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadConversationResource,
    handler: async ({ ctx, params }) => {
      await markRead(ctx, idParam.parse(params).id);
      return { read: true };
    },
  });

  // No resourceParam: nothing to authorize against yet — the endpoint is how
  // a direct conversation comes to exist (or is reused).
  route({
    method: 'POST',
    path: '/api/chat/conversations/direct',
    action: 'chat:send',
    module: 'chat',
    status: 201,
    handler: async ({ ctx, body }) => startDirectConversation(ctx, startDirectConversationSchema.parse(body).userId),
  });

  route({
    method: 'POST',
    path: '/api/chat/conversations/group',
    action: 'chat:manage-groups',
    module: 'chat',
    status: 201,
    handler: async ({ ctx, body }) => createInternalGroup(ctx, createGroupConversationSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/chat/conversations/:id/messages',
    action: 'chat:send',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadConversationResource,
    status: 201,
    handler: async ({ ctx, params, body }) => sendMessage(ctx, idParam.parse(params).id, sendMessageSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/chat/messages/:id/forward',
    action: 'chat:send',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadMessageResource,
    status: 201,
    handler: async ({ ctx, params, body }) => forwardMessage(ctx, idParam.parse(params).id, forwardMessageSchema.parse(body).conversationId),
  });

  route({
    method: 'POST',
    path: '/api/chat/messages/:id/react',
    action: 'chat:send',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadMessageResource,
    handler: async ({ ctx, params, body }) => reactToMessage(ctx, idParam.parse(params).id, reactionSchema.parse(body).emoji),
  });

  route({
    method: 'DELETE',
    path: '/api/chat/messages/:id/react',
    action: 'chat:send',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadMessageResource,
    handler: async ({ ctx, params, body }) => removeReactionFromMessage(ctx, idParam.parse(params).id, reactionSchema.parse(body).emoji),
  });

  route({
    method: 'POST',
    path: '/api/chat/messages/:id/unsend',
    action: 'chat:send',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadMessageResource,
    handler: async ({ ctx, params }) => unsendMessage(ctx, idParam.parse(params).id),
  });
}
