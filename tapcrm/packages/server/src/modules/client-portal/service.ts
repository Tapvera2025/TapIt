import { z } from 'zod';
import type { RequestContext } from '../../platform/dal/context.js';
import { ApplicationError } from '../../errors.js';
import { countProjectsByStatus, findProfile, findProject, findProjectDiscussion, listProjectDiscussions, listProjects } from './repository.js';
import { deletePendingAttachment, editMessage, findMessageById, getConversation, getMessageEdits, listMessages, listPins, markRead, reactToMessage, removeReactionFromMessage, sendMessage, uploadAttachment } from '../chat/facade.js';
import { listBlogs, overview } from '../projects/reports/repository.js';
import { getSeoReport } from '../projects/reports/service.js';
import type { ReportQuery } from '../projects/reports/validators.js';
import { listBacklinks } from '../projects/reports/off-page.js';
import { downloadScreenshot, listScreenshots } from '../projects/reports/screenshots.js';
import { createClientFeedback, listClientFeedback, type CreateClientFeedbackInput, type FeedbackArea } from '../projects/reports/clientFeedback.js';
import type { Conversation, ListMessagesQuery, Message, MessageEdit, PinnedMessage, ReactionEmoji } from '../chat/facade.js';
import type { PortalBacklinkPage, PortalBlogReport, PortalDashboard, PortalKeywordReport, PortalProfile, PortalProject, PortalScreenshotPage } from './types.js';

const projectIdSchema = z.string().uuid();
type PortalBacklinkQuery = { page: number; pageSize: number; search?: string | undefined; category: 'all' | 'social_media' | 'others'; period: 7 | 30 | 90 };
type PortalScreenshotQuery = { page: number; pageSize: number; period: 7 | 30 | 90 };

/**
 * The only way a handler obtains a client id. Employees and service accounts
 * are refused outright; a client without a bound account fails closed (A2).
 */
function requireClientId(ctx: RequestContext): string {
  const { principal } = ctx;
  if (principal.accountType !== 'client' || !principal.clientId) {
    throw new ApplicationError('The client portal is only available to client accounts', 403, 'CLIENT_PORTAL_FORBIDDEN');
  }
  return principal.clientId;
}

const notFound = () => new ApplicationError('Project not found', 404, 'CLIENT_PORTAL_NOT_FOUND');

export async function getProfile(ctx: RequestContext): Promise<PortalProfile> {
  const profile = await findProfile(ctx, requireClientId(ctx));
  if (!profile) throw new ApplicationError('This client account is inactive', 403, 'CLIENT_PORTAL_INACTIVE');
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
    profile: { clientName: profile.clientName, businessName: profile.businessName, organizationName: profile.organizationName },
    counts,
    recentProjects,
  };
}

export async function getProjects(ctx: RequestContext): Promise<PortalProject[]> {
  return listProjects(ctx, requireClientId(ctx));
}

/** CP-2: a malformed id and another client's project are both a plain 404. */
export async function getProject(ctx: RequestContext, id: string): Promise<PortalProject> {
  const clientId = requireClientId(ctx);
  const parsed = projectIdSchema.safeParse(id);
  if (!parsed.success) throw notFound();
  const project = await findProject(ctx, clientId, parsed.data);
  if (!project) throw notFound();
  return project;
}

/** Client-safe blog preview. Project ownership is checked before report data is read. */
export async function getProjectBlogReport(ctx: RequestContext, id: string, query: ReportQuery): Promise<PortalBlogReport> {
  const project = await getProject(ctx, id);
  const scoped = { ...ctx, projectId: project.id };
  const [blogs, summary] = await Promise.all([listBlogs(scoped, query), overview(scoped, query.period)]);
  const items = blogs.items.map((blog) => ({
    id: blog.id,
    title: blog.title,
    url: blog.url,
    description: blog.description,
    category: blog.category,
    status: blog.status,
    publishDate: blog.publishDate,
    wordCount: blog.wordCount,
    targetKeywords: blog.targetKeywords,
    createdAt: blog.createdAt,
    updatedAt: blog.updatedAt,
  }));
  return {
    period: query.period,
    overview: {
      totalBlogs: summary.totalBlogs,
      publishedBlogs: summary.publishedBlogs,
      draftBlogs: summary.draftBlogs,
      archivedBlogs: summary.archivedBlogs,
      lastUpdatedAt: summary.lastUpdatedAt,
    },
    blogs: { items, total: blogs.total, page: blogs.page, pageSize: blogs.pageSize, totalPages: Math.max(1, Math.ceil(blogs.total / blogs.pageSize)) },
  };
}

/** Client-safe keyword tracker. Notes, rank history, automation controls, and Search Console data are excluded. */
export async function getProjectKeywordReport(ctx: RequestContext, id: string, query: ReportQuery): Promise<PortalKeywordReport> {
  const project = await getProject(ctx, id);
  const scoped = { ...ctx, projectId: project.id };
  const [report, summary] = await Promise.all([getSeoReport(scoped, project.id, query), overview(scoped, query.period)]);
  const items = report.keywords.items.map((keyword) => ({
    id: keyword.id,
    keyword: keyword.keyword,
    pastRank: keyword.pastRank,
    previousRank: keyword.previousRank,
    currentRank: keyword.currentRank,
    targetUrl: keyword.targetUrl,
    searchEngine: keyword.searchEngine,
    country: keyword.country,
    city: keyword.city,
    device: keyword.device,
    priority: keyword.priority,
    category: keyword.category,
    lastCheckedAt: keyword.lastCheckedAt,
    trend: keyword.trend,
    rankChange: keyword.rankChange,
  }));
  return {
    period: query.period,
    overview: { totalKeywords: summary.totalKeywords, improving: summary.improving, declining: summary.declining, stagnant: summary.stagnant, unclassified: summary.unclassified, averageCurrentRank: summary.averageCurrentRank },
    keywords: { items, total: report.keywords.total, page: report.keywords.page, pageSize: report.keywords.pageSize, totalPages: report.keywords.totalPages },
  };
}

export async function getProjectBacklinks(ctx: RequestContext, id: string, query: PortalBacklinkQuery): Promise<PortalBacklinkPage> {
  const project = await getProject(ctx, id);
  const result = await listBacklinks(ctx, project.id, query);
  return { ...result, items: result.items.map(({ id: backlinkId, url, category, createdAt, updatedAt }) => ({ id: backlinkId, url, category, createdAt, updatedAt })) };
}

export async function getProjectScreenshots(ctx: RequestContext, id: string, query: PortalScreenshotQuery): Promise<PortalScreenshotPage> {
  const project = await getProject(ctx, id);
  const result = await listScreenshots(ctx, project.id, query);
  return { ...result, items: result.items.map(({ id: screenshotId, title, description, originalFilename, mimeType, sizeBytes, createdAt, updatedAt }) => ({ id: screenshotId, title, description, originalFilename, mimeType, sizeBytes, createdAt, updatedAt })) };
}

export async function getProjectFeedback(ctx: RequestContext, id: string, area?: FeedbackArea) {
  const project = await getProject(ctx, id);
  return (await listClientFeedback(ctx, project.id, area)).map(({ id: feedbackId, projectId, area: feedbackArea, note, createdAt }) => ({ id: feedbackId, projectId, area: feedbackArea, note, createdAt }));
}

export async function createProjectFeedback(ctx: RequestContext, id: string, input: CreateClientFeedbackInput) {
  const project = await getProject(ctx, id);
  const feedback = await createClientFeedback(ctx, project.id, input);
  return { id: feedback.id, projectId: feedback.projectId, area: feedback.area, note: feedback.note, createdAt: feedback.createdAt };
}

export async function getProjectScreenshotContent(ctx: RequestContext, id: string, screenshotId: string) {
  const project = await getProject(ctx, id);
  return downloadScreenshot(ctx, project.id, screenshotId);
}

async function requireProjectDiscussion(ctx: RequestContext, projectId: string, conversationId: string): Promise<void> {
  const clientId = requireClientId(ctx);
  const parsedProjectId = projectIdSchema.safeParse(projectId);
  const parsedConversationId = projectIdSchema.safeParse(conversationId);
  if (!parsedProjectId.success || !parsedConversationId.success) throw notFound();
  const project = await findProject(ctx, clientId, parsedProjectId.data);
  const actualConversationId = project && await findProjectDiscussion(ctx, clientId, project.id, ctx.principal.id);
  if (!actualConversationId || actualConversationId !== parsedConversationId.data) throw notFound();
}

/** Returns only a conversation the authenticated client currently belongs to. */
export async function getProjectDiscussion(ctx: RequestContext, projectId: string): Promise<{ currentUserId: string; conversation: Conversation | null }> {
  const clientId = requireClientId(ctx);
  const project = await getProject(ctx, projectId);
  const conversationId = await findProjectDiscussion(ctx, clientId, project.id, ctx.principal.id);
  if (!conversationId) return { currentUserId: ctx.principal.id, conversation: null };
  const conversation = await getConversation(ctx, conversationId);
  if (conversation.kind !== 'project' || conversation.projectId !== project.id || !conversation.members.some((member) => member.userId === ctx.principal.id)) {
    return { currentUserId: ctx.principal.id, conversation: null };
  }
  return { currentUserId: ctx.principal.id, conversation };
}

export async function getClientProjectDiscussions(ctx: RequestContext): Promise<{ currentUserId: string; discussions: { projectId: string; projectName: string; conversation: Conversation }[] }> {
  const clientId = requireClientId(ctx);
  const rows = await listProjectDiscussions(ctx, clientId, ctx.principal.id);
  const discussions = await Promise.all(rows.map(async (row) => ({
    projectId: row.projectId,
    projectName: row.projectName,
    conversation: await getConversation(ctx, row.conversationId),
  })));
  return {
    currentUserId: ctx.principal.id,
    discussions: discussions.filter(({ projectId, conversation }) =>
      conversation.kind === 'project' && conversation.projectId === projectId && conversation.members.some((member) => member.userId === ctx.principal.id)),
  };
}

export async function getProjectDiscussionMessages(ctx: RequestContext, projectId: string, conversationId: string, query: ListMessagesQuery) {
  await requireProjectDiscussion(ctx, projectId, conversationId);
  return listMessages(ctx, conversationId, query);
}

export async function sendProjectDiscussionMessage(
  ctx: RequestContext,
  projectId: string,
  conversationId: string,
  input: { body: string; replyToMessageId?: string | null | undefined; mentionedUserIds?: readonly string[] | undefined; attachmentIds?: readonly string[] | undefined },
): Promise<Message> {
  await requireProjectDiscussion(ctx, projectId, conversationId);
  return sendMessage(ctx, conversationId, input);
}

/** A client shares a contract, mockup or screenshot with their project team (step 1: the upload). */
export async function uploadProjectDiscussionAttachment(ctx: RequestContext, projectId: string, conversationId: string, file: { fileName: string; body: Buffer }) {
  await requireProjectDiscussion(ctx, projectId, conversationId);
  return uploadAttachment(ctx, conversationId, file);
}

export async function deleteProjectDiscussionAttachment(ctx: RequestContext, projectId: string, conversationId: string, attachmentId: string): Promise<{ deleted: true }> {
  await requireProjectDiscussion(ctx, projectId, conversationId);
  if (!projectIdSchema.safeParse(attachmentId).success) throw notFound();
  return deletePendingAttachment(ctx, attachmentId);
}

export async function getProjectDiscussionMessage(ctx: RequestContext, projectId: string, conversationId: string, messageId: string): Promise<Message> {
  await requireProjectDiscussionMessage(ctx, projectId, conversationId, messageId);
  const message = await findMessageById(ctx, messageId);
  if (!message) throw notFound();
  return message;
}

/** Clients may correct their own messages within the same 15-minute window as employees. */
export async function editProjectDiscussionMessage(
  ctx: RequestContext,
  projectId: string,
  conversationId: string,
  messageId: string,
  input: { body: string; mentionedUserIds?: readonly string[] | undefined },
): Promise<Message> {
  await requireProjectDiscussionMessage(ctx, projectId, conversationId, messageId);
  return editMessage(ctx, messageId, input);
}

export async function getProjectDiscussionMessageEdits(ctx: RequestContext, projectId: string, conversationId: string, messageId: string): Promise<MessageEdit[]> {
  await requireProjectDiscussionMessage(ctx, projectId, conversationId, messageId);
  return getMessageEdits(ctx, messageId);
}

/** Read-only for clients: pinning is an employee action (product decision). */
export async function getProjectDiscussionPins(ctx: RequestContext, projectId: string, conversationId: string): Promise<PinnedMessage[]> {
  await requireProjectDiscussion(ctx, projectId, conversationId);
  return listPins(ctx, conversationId);
}

export async function markProjectDiscussionRead(ctx: RequestContext, projectId: string, conversationId: string): Promise<{ read: true }> {
  await requireProjectDiscussion(ctx, projectId, conversationId);
  await markRead(ctx, conversationId);
  return { read: true };
}

async function requireProjectDiscussionMessage(ctx: RequestContext, projectId: string, conversationId: string, messageId: string): Promise<void> {
  await requireProjectDiscussion(ctx, projectId, conversationId);
  if (!projectIdSchema.safeParse(messageId).success) throw notFound();
  const message = await findMessageById(ctx, messageId);
  if (!message || message.conversationId !== conversationId) throw notFound();
}

export async function reactToProjectDiscussionMessage(ctx: RequestContext, projectId: string, conversationId: string, messageId: string, emoji: ReactionEmoji): Promise<Message> {
  await requireProjectDiscussionMessage(ctx, projectId, conversationId, messageId);
  return reactToMessage(ctx, messageId, emoji);
}

export async function removeProjectDiscussionReaction(ctx: RequestContext, projectId: string, conversationId: string, messageId: string, emoji: ReactionEmoji): Promise<Message> {
  await requireProjectDiscussionMessage(ctx, projectId, conversationId, messageId);
  return removeReactionFromMessage(ctx, messageId, emoji);
}
