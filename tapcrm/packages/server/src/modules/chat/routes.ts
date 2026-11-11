import { z } from 'zod';
import { ApplicationError } from '../../errors.js';
import { route } from '../../platform/http/route.js';
import { deletePendingAttachment, uploadAttachment } from './attachments.js';
import { ChatValidationError } from './errors.js';
import { presenceForColleagues } from './presence.js';
import { cancelScheduled, listScheduled, loadScheduledResource, scheduleMessage, sendScheduledNow, updateScheduled } from './scheduled.js';
import { searchMessages } from './search.js';
import {
  addGroupMembers,
  archiveGroup,
  createInternalGroup,
  editMessage,
  getUnreadSummary,
  forwardMessage,
  getConversation,
  getMessage,
  getMessageEdits,
  listColleagues,
  listConversations,
  listMessages,
  listPins,
  listSaved,
  loadAttachmentResource,
  loadConversationResource,
  loadMessageResource,
  markRead,
  pinMessage,
  reactToMessage,
  removeGroupMember,
  removeReactionFromMessage,
  renameGroup,
  saveMessage,
  sendMessage,
  startDirectConversation,
  unpinMessage,
  unsaveMessage,
  unsendMessage,
} from './service.js';
import {
  addGroupMembersSchema,
  createGroupConversationSchema,
  editMessageSchema,
  forwardMessageSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  listScheduledQuerySchema,
  reactionSchema,
  renameGroupSchema,
  savedQuerySchema,
  scheduleMessageSchema,
  searchQuerySchema,
  sendMessageSchema,
  startDirectConversationSchema,
  updateScheduledSchema,
} from './validators.js';

const idParam = z.object({ id: z.string().uuid() });
const idUserIdParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

function requireEmployeeChat(ctx: { principal: { accountType: string } }): void {
  if (ctx.principal.accountType === 'client') {
    throw new ApplicationError('Client accounts must use their project discussion', 404, 'CHAT_CONVERSATION_NOT_FOUND');
  }
}

/**
 * The uploaded file's name travels in `X-File-Name`, URI-encoded (headers are
 * Latin-1, file names are not); the body is the raw bytes.
 */
export function uploadedFileName(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) throw new ChatValidationError('The upload is missing its file name (X-File-Name header)');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function uploadedBody(body: unknown): Buffer {
  if (!Buffer.isBuffer(body)) throw new ChatValidationError('Send the file itself as the request body (Content-Type: application/octet-stream)');
  return body;
}

/**
 * Chat HTTP routes — Phase 2 of the messaging build (team-docs has the plan).
 *
 * `chat:view` and `chat:send` are granted to every employee position by
 * default (CH-1: no hierarchy). `chat:manage-groups` is Super-Admin-only —
 * the route below is Phase 3 (Internal Groups); Phase 4's project groups are
 * created through `chat/facade.js` instead, gated by the PROJECTS module's
 * own action, not this one.
 *
 * Rich messaging (attachments, search, edit, pins, saved, send later) reuses
 * the same two actions — the real gate on every message-level route is
 * membership of the conversation the message belongs to (see policy.ts).
 */
export function registerChatRoutes(): void {
  route({
    method: 'GET',
    path: '/api/chat/conversations',
    action: 'chat:view',
    module: 'chat',
    handler: async ({ ctx, query }) => { requireEmployeeChat(ctx); return listConversations(ctx, listConversationsQuerySchema.parse(query).kind); },
  });

  route({
    method: 'GET',
    path: '/api/chat/unread-summary',
    action: 'chat:view',
    module: 'chat',
    handler: async ({ ctx }) => { requireEmployeeChat(ctx); return getUnreadSummary(ctx); },
  });

  // Who a Direct Message can be started with — every employee/super-admin in
  // the org, not the HR directory (`users:view`), since `chat:send` is
  // granted far more broadly than that (CH-1).
  route({
    method: 'GET',
    path: '/api/chat/colleagues',
    action: 'chat:send',
    module: 'chat',
    handler: async ({ ctx }) => { requireEmployeeChat(ctx); return listColleagues(ctx); },
  });

  // Green / orange / grey dots, from live-status attendance (coarse state only).
  route({
    method: 'GET',
    path: '/api/chat/presence',
    action: 'chat:view',
    module: 'chat',
    handler: async ({ ctx }) => { requireEmployeeChat(ctx); return presenceForColleagues(ctx); },
  });

  // Full-text search over every conversation the caller is a current member of.
  route({
    method: 'GET',
    path: '/api/chat/search',
    action: 'chat:view',
    module: 'chat',
    handler: async ({ ctx, query }) => { requireEmployeeChat(ctx); return searchMessages(ctx, searchQuerySchema.parse(query)); },
  });

  // The personal "Save for later" tray.
  route({
    method: 'GET',
    path: '/api/chat/saved',
    action: 'chat:view',
    module: 'chat',
    handler: async ({ ctx, query }) => { requireEmployeeChat(ctx); return listSaved(ctx, savedQuerySchema.parse(query)); },
  });

  route({
    method: 'GET',
    path: '/api/chat/scheduled',
    action: 'chat:view',
    module: 'chat',
    handler: async ({ ctx, query }) => { requireEmployeeChat(ctx); return listScheduled(ctx, listScheduledQuerySchema.parse(query).conversationId); },
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
    method: 'GET',
    path: '/api/chat/conversations/:id/pins',
    action: 'chat:view',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadConversationResource,
    handler: async ({ ctx, params }) => listPins(ctx, idParam.parse(params).id),
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
    handler: async ({ ctx, body }) => { requireEmployeeChat(ctx); return startDirectConversation(ctx, startDirectConversationSchema.parse(body).userId); },
  });

  route({
    method: 'POST',
    path: '/api/chat/conversations/group',
    action: 'chat:manage-groups',
    module: 'chat',
    status: 201,
    handler: async ({ ctx, body }) => { requireEmployeeChat(ctx); return createInternalGroup(ctx, createGroupConversationSchema.parse(body)); },
  });

  route({
    method: 'PATCH',
    path: '/api/chat/conversations/:id',
    action: 'chat:manage-groups',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadConversationResource,
    handler: async ({ ctx, params, body }) => {
      const parsed = renameGroupSchema.parse(body);
      return renameGroup(ctx, idParam.parse(params).id, parsed.name, parsed.description);
    },
  });

  route({
    method: 'POST',
    path: '/api/chat/conversations/:id/members',
    action: 'chat:manage-groups',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadConversationResource,
    handler: async ({ ctx, params, body }) => addGroupMembers(ctx, idParam.parse(params).id, addGroupMembersSchema.parse(body).memberIds),
  });

  route({
    method: 'DELETE',
    path: '/api/chat/conversations/:id/members/:userId',
    action: 'chat:manage-groups',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadConversationResource,
    handler: async ({ ctx, params }) => {
      const { id, userId } = idUserIdParams.parse(params);
      return removeGroupMember(ctx, id, userId);
    },
  });

  route({
    method: 'POST',
    path: '/api/chat/conversations/:id/archive',
    action: 'chat:manage-groups',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadConversationResource,
    handler: async ({ ctx, params }) => archiveGroup(ctx, idParam.parse(params).id),
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

  // Step 1 of sending a file: the raw bytes (application/octet-stream, body
  // parsed by express.raw in app.ts), validated and stored as a PENDING
  // upload. Step 2 is an ordinary send carrying its id in `attachmentIds`.
  route({
    method: 'POST',
    path: '/api/chat/conversations/:id/attachments',
    action: 'chat:send',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadConversationResource,
    status: 201,
    handler: async ({ ctx, params, body, req }) =>
      uploadAttachment(ctx, idParam.parse(params).id, { fileName: uploadedFileName(req.headers['x-file-name']), body: uploadedBody(body) }),
  });

  // Removing a file from the composer before it is sent (uploader only).
  route({
    method: 'DELETE',
    path: '/api/chat/attachments/:id',
    action: 'chat:send',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadAttachmentResource,
    handler: async ({ ctx, params }) => deletePendingAttachment(ctx, idParam.parse(params).id),
  });

  route({
    method: 'POST',
    path: '/api/chat/conversations/:id/scheduled',
    action: 'chat:send',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadConversationResource,
    status: 201,
    handler: async ({ ctx, params, body }) => scheduleMessage(ctx, idParam.parse(params).id, scheduleMessageSchema.parse(body)),
  });

  route({
    method: 'PATCH',
    path: '/api/chat/scheduled/:id',
    action: 'chat:send',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadScheduledResource,
    handler: async ({ ctx, params, body }) => updateScheduled(ctx, idParam.parse(params).id, updateScheduledSchema.parse(body)),
  });

  route({
    method: 'DELETE',
    path: '/api/chat/scheduled/:id',
    action: 'chat:send',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadScheduledResource,
    handler: async ({ ctx, params }) => cancelScheduled(ctx, idParam.parse(params).id),
  });

  route({
    method: 'POST',
    path: '/api/chat/scheduled/:id/send-now',
    action: 'chat:send',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadScheduledResource,
    handler: async ({ ctx, params }) => sendScheduledNow(ctx, idParam.parse(params).id),
  });

  route({
    method: 'GET',
    path: '/api/chat/messages/:id',
    action: 'chat:view',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadMessageResource,
    handler: async ({ ctx, params }) => getMessage(ctx, idParam.parse(params).id),
  });

  // Edit — the sender only, within 15 minutes; the history stays readable.
  route({
    method: 'PATCH',
    path: '/api/chat/messages/:id',
    action: 'chat:send',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadMessageResource,
    handler: async ({ ctx, params, body }) => editMessage(ctx, idParam.parse(params).id, editMessageSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/chat/messages/:id/edits',
    action: 'chat:view',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadMessageResource,
    handler: async ({ ctx, params }) => getMessageEdits(ctx, idParam.parse(params).id),
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

  route({
    method: 'POST',
    path: '/api/chat/messages/:id/pin',
    action: 'chat:send',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadMessageResource,
    handler: async ({ ctx, params }) => pinMessage(ctx, idParam.parse(params).id),
  });

  route({
    method: 'DELETE',
    path: '/api/chat/messages/:id/pin',
    action: 'chat:send',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadMessageResource,
    handler: async ({ ctx, params }) => unpinMessage(ctx, idParam.parse(params).id),
  });

  route({
    method: 'POST',
    path: '/api/chat/messages/:id/save',
    action: 'chat:view',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadMessageResource,
    handler: async ({ ctx, params }) => saveMessage(ctx, idParam.parse(params).id),
  });

  route({
    method: 'DELETE',
    path: '/api/chat/messages/:id/save',
    action: 'chat:view',
    module: 'chat',
    resourceParam: 'id',
    loadResource: loadMessageResource,
    handler: async ({ ctx, params }) => unsaveMessage(ctx, idParam.parse(params).id),
  });
}
