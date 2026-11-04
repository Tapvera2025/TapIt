import { z } from 'zod';
import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import { ApplicationError } from '../../errors.js';
import {
  countProjectsByStatus,
  findProfile,
  findProject,
  findProjectDiscussion,
  listProjectDiscussions,
  listProjects,
} from './repository.js';
import {
  findMessageById,
  getConversation,
  listMessages,
  markRead,
  reactToMessage,
  removeReactionFromMessage,
  sendMessage,
} from '../chat/facade.js';
import type {
  Conversation,
  ListMessagesQuery,
  Message,
  ReactionEmoji,
} from '../chat/facade.js';
import type { PortalDashboard, PortalProfile, PortalProject } from './types.js';

const projectIdSchema = z.string().uuid();

/**
 * The only way a handler obtains a client id. Employees and service accounts
 * are refused outright; a client without a bound account fails closed (A2).
 */
function requireClientId(ctx: RequestContext): string {
  const { principal } = ctx;
  if (principal.accountType !== 'client' || !principal.clientId) {
    throw new ApplicationError(
      'The client portal is only available to client accounts',
      403,
      'CLIENT_PORTAL_FORBIDDEN',
    );
  }
  return principal.clientId;
}

const notFound = () =>
  new ApplicationError('Project not found', 404, 'CLIENT_PORTAL_NOT_FOUND');

export async function getProfile(ctx: RequestContext): Promise<PortalProfile> {
  const profile = await findProfile(ctx, requireClientId(ctx));
  if (!profile)
    throw new ApplicationError(
      'This client account is inactive',
      403,
      'CLIENT_PORTAL_INACTIVE',
    );
  return profile;
}

export async function getDashboard(ctx: RequestContext): Promise<PortalDashboard> {
  const clientId = requireClientId(ctx);
  const [profile, counts, recentProjects] = await Promise.all([
    getProfile(ctx),
    countProjectsByStatus(ctx, clientId),
    listProjects(ctx, clientId, 5),
  ]);
  return {
    profile: {
      clientName: profile.clientName,
      businessName: profile.businessName,
      organizationName: profile.organizationName,
    },
    counts,
    recentProjects,
  };
}

export async function getProjects(ctx: RequestContext): Promise<PortalProject[]> {
  return listProjects(ctx, requireClientId(ctx));
}

export async function getPaymentStatement(ctx: RequestContext) {
  const clientId = requireClientId(ctx);
  return db.query(
    ctx,
    sql`SELECT i.invoice_number AS "invoiceNumber",i.invoice_date AS "invoiceDate",i.due_date AS "dueDate",i.currency,i.total::text AS total,i.receivable_status AS status,COALESCE(SUM(pa.amount_minor),0)::text AS "paidMinor",GREATEST(round(i.total*100)::bigint-COALESCE(SUM(pa.amount_minor),0),0)::text AS "outstandingMinor" FROM finance_invoice i LEFT JOIN payment_allocation pa ON pa.organization_id=i.organization_id AND pa.invoice_id=i.id WHERE i.organization_id=${ctx.organizationId} AND i.client_id=${clientId} AND i.status='issued' GROUP BY i.id ORDER BY i.invoice_date DESC,i.invoice_number DESC`,
  );
}

/** CP-2: a malformed id and another client's project are both a plain 404. */
export async function getProject(
  ctx: RequestContext,
  id: string,
): Promise<PortalProject> {
  const clientId = requireClientId(ctx);
  const parsed = projectIdSchema.safeParse(id);
  if (!parsed.success) throw notFound();
  const project = await findProject(ctx, clientId, parsed.data);
  if (!project) throw notFound();
  return project;
}

async function requireProjectDiscussion(
  ctx: RequestContext,
  projectId: string,
  conversationId: string,
): Promise<void> {
  const clientId = requireClientId(ctx);
  const parsedProjectId = projectIdSchema.safeParse(projectId);
  const parsedConversationId = projectIdSchema.safeParse(conversationId);
  if (!parsedProjectId.success || !parsedConversationId.success) throw notFound();
  const project = await findProject(ctx, clientId, parsedProjectId.data);
  const actualConversationId =
    project && (await findProjectDiscussion(ctx, clientId, project.id, ctx.principal.id));
  if (!actualConversationId || actualConversationId !== parsedConversationId.data)
    throw notFound();
}

/** Returns only a conversation the authenticated client currently belongs to. */
export async function getProjectDiscussion(
  ctx: RequestContext,
  projectId: string,
): Promise<{ currentUserId: string; conversation: Conversation | null }> {
  const clientId = requireClientId(ctx);
  const project = await getProject(ctx, projectId);
  const conversationId = await findProjectDiscussion(
    ctx,
    clientId,
    project.id,
    ctx.principal.id,
  );
  if (!conversationId) return { currentUserId: ctx.principal.id, conversation: null };
  const conversation = await getConversation(ctx, conversationId);
  if (
    conversation.kind !== 'project' ||
    conversation.projectId !== project.id ||
    !conversation.members.some((member) => member.userId === ctx.principal.id)
  ) {
    return { currentUserId: ctx.principal.id, conversation: null };
  }
  return { currentUserId: ctx.principal.id, conversation };
}

export async function getClientProjectDiscussions(
  ctx: RequestContext,
): Promise<{
  currentUserId: string;
  discussions: { projectId: string; projectName: string; conversation: Conversation }[];
}> {
  const clientId = requireClientId(ctx);
  const rows = await listProjectDiscussions(ctx, clientId, ctx.principal.id);
  const discussions = await Promise.all(
    rows.map(async (row) => ({
      projectId: row.projectId,
      projectName: row.projectName,
      conversation: await getConversation(ctx, row.conversationId),
    })),
  );
  return {
    currentUserId: ctx.principal.id,
    discussions: discussions.filter(
      ({ projectId, conversation }) =>
        conversation.kind === 'project' &&
        conversation.projectId === projectId &&
        conversation.members.some((member) => member.userId === ctx.principal.id),
    ),
  };
}

export async function getProjectDiscussionMessages(
  ctx: RequestContext,
  projectId: string,
  conversationId: string,
  query: ListMessagesQuery,
) {
  await requireProjectDiscussion(ctx, projectId, conversationId);
  return listMessages(ctx, conversationId, query);
}

export async function sendProjectDiscussionMessage(
  ctx: RequestContext,
  projectId: string,
  conversationId: string,
  input: {
    body: string;
    replyToMessageId?: string | null | undefined;
    mentionedUserIds?: readonly string[] | undefined;
  },
): Promise<Message> {
  await requireProjectDiscussion(ctx, projectId, conversationId);
  return sendMessage(ctx, conversationId, input);
}

export async function markProjectDiscussionRead(
  ctx: RequestContext,
  projectId: string,
  conversationId: string,
): Promise<{ read: true }> {
  await requireProjectDiscussion(ctx, projectId, conversationId);
  await markRead(ctx, conversationId);
  return { read: true };
}

async function requireProjectDiscussionMessage(
  ctx: RequestContext,
  projectId: string,
  conversationId: string,
  messageId: string,
): Promise<void> {
  await requireProjectDiscussion(ctx, projectId, conversationId);
  const message = await findMessageById(ctx, messageId);
  if (!message || message.conversationId !== conversationId) throw notFound();
}

export async function reactToProjectDiscussionMessage(
  ctx: RequestContext,
  projectId: string,
  conversationId: string,
  messageId: string,
  emoji: ReactionEmoji,
): Promise<Message> {
  await requireProjectDiscussionMessage(ctx, projectId, conversationId, messageId);
  return reactToMessage(ctx, messageId, emoji);
}

export async function removeProjectDiscussionReaction(
  ctx: RequestContext,
  projectId: string,
  conversationId: string,
  messageId: string,
  emoji: ReactionEmoji,
): Promise<Message> {
  await requireProjectDiscussionMessage(ctx, projectId, conversationId, messageId);
  return removeReactionFromMessage(ctx, messageId, emoji);
}
