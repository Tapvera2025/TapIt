import { z } from 'zod';
import { route } from '../../platform/http/route.js';
import { loadContentSite, loadContentReviewResource } from './content-policy.js';
import * as service from './content-service.js';
import {
  contentBrandSchema,
  contentCreateSchema,
  contentSaveSchema,
  contentBodySaveSchema,
  contentCheckpointSchema,
  contentCommentCreateSchema,
  contentCommentStatusSchema,
  contentRestoreSchema,
  contentTransitionSchema,
  contentParams,
  contentPage,
} from './content-validators.js';

const module = 'seo-intelligence';
const siteResource = { module, resourceParam: 'siteId', loadResource: loadContentSite };
const paramsSchema = contentParams.extend({ documentId: z.string().uuid() });
export function registerContentRoutes() {
  route({
    ...siteResource,
    method: 'GET',
    path: '/api/seo/sites/:siteId/content',
    action: 'seo:read-content',
    handler: async ({ ctx, params, query }) =>
      service.listContent(
        ctx,
        contentParams.parse(params).siteId,
        contentPage.parse(query).offset,
      ),
  });
  route({
    ...siteResource,
    method: 'POST',
    path: '/api/seo/sites/:siteId/content',
    action: 'seo:create-content',
    handler: async ({ ctx, params, body }) =>
      service.createContent(
        ctx,
        contentParams.parse(params).siteId,
        contentCreateSchema.parse(body),
      ),
  });
  route({
    ...siteResource,
    method: 'GET',
    path: '/api/seo/sites/:siteId/content-members',
    action: 'seo:read-content',
    handler: async ({ ctx, params }) =>
      service.contentMembers(ctx, contentParams.parse(params).siteId),
  });
  route({
    ...siteResource,
    method: 'GET',
    path: '/api/seo/sites/:siteId/content-brand',
    action: 'seo:read-content',
    handler: async ({ ctx, params, query }) =>
      service.readContentBrand(
        ctx,
        contentParams.parse(params).siteId,
        z.object({ version: z.coerce.number().int().positive().optional() }).parse(query)
          .version,
      ),
  });
  route({
    ...siteResource,
    method: 'PUT',
    path: '/api/seo/sites/:siteId/content-brand',
    action: 'seo:manage-content-brand',
    handler: async ({ ctx, params, body }) => {
      const input = contentBrandSchema.parse(body);
      return service.saveContentBrand(
        ctx,
        contentParams.parse(params).siteId,
        input.expectedVersion,
        input.guidance,
      );
    },
  });
  route({
    ...siteResource,
    method: 'PUT',
    path: '/api/seo/sites/:siteId/content/:documentId/body',
    action: 'seo:edit-content',
    handler: async ({ ctx, params, body }) => {
      const p = paramsSchema.parse(params);
      return service.saveContentBody(
        ctx,
        p.siteId,
        p.documentId,
        contentBodySaveSchema.parse(body).body,
      );
    },
  });
  route({
    ...siteResource,
    method: 'POST',
    path: '/api/seo/sites/:siteId/content/:documentId/checkpoint',
    action: 'seo:edit-content',
    status: 200,
    handler: async ({ ctx, params, body }) => {
      const p = paramsSchema.parse(params);
      return service.checkpointContent(
        ctx,
        p.siteId,
        p.documentId,
        contentCheckpointSchema.parse(body).expectedVersion,
      );
    },
  });
  route({
    ...siteResource,
    method: 'GET',
    path: '/api/seo/sites/:siteId/content/:documentId',
    action: 'seo:read-content',
    handler: async ({ ctx, params }) => {
      const p = paramsSchema.parse(params);
      return service.readContent(ctx, p.siteId, p.documentId);
    },
  });
  route({
    ...siteResource,
    method: 'PUT',
    path: '/api/seo/sites/:siteId/content/:documentId',
    action: 'seo:edit-content',
    handler: async ({ ctx, params, body }) => {
      const p = paramsSchema.parse(params);
      return service.saveContent(
        ctx,
        p.siteId,
        p.documentId,
        contentSaveSchema.parse(body),
      );
    },
  });
  route({
    ...siteResource,
    method: 'GET',
    path: '/api/seo/sites/:siteId/content/:documentId/history',
    action: 'seo:read-content',
    handler: async ({ ctx, params, query }) => {
      const p = paramsSchema.parse(params);
      return service.contentHistory(
        ctx,
        p.siteId,
        p.documentId,
        contentPage.parse(query).offset,
      );
    },
  });
  route({
    ...siteResource,
    method: 'GET',
    path: '/api/seo/sites/:siteId/content/:documentId/comments',
    action: 'seo:read-content',
    handler: async ({ ctx, params }) => {
      const p = paramsSchema.parse(params);
      return service.contentCommentThreads(ctx, p.siteId, p.documentId);
    },
  });
  route({
    module,
    resourceParam: 'documentId',
    loadResource: loadContentReviewResource,
    method: 'POST',
    path: '/api/seo/sites/:siteId/content/:documentId/comments',
    action: 'seo:comment-content',
    status: 201,
    handler: async ({ ctx, params, body }) => {
      const p = paramsSchema.parse(params);
      return service.createContentComment(
        ctx,
        p.siteId,
        p.documentId,
        contentCommentCreateSchema.parse(body),
      );
    },
  });
  route({
    module,
    resourceParam: 'documentId',
    loadResource: loadContentReviewResource,
    method: 'PATCH',
    path: '/api/seo/sites/:siteId/content/:documentId/comments/:threadId',
    action: 'seo:comment-content',
    handler: async ({ ctx, params, body }) => {
      const p = paramsSchema.extend({ threadId: z.string().uuid() }).parse(params);
      return service.updateContentCommentStatus(
        ctx,
        p.siteId,
        p.documentId,
        p.threadId,
        contentCommentStatusSchema.parse(body).status,
      );
    },
  });
  route({
    ...siteResource,
    method: 'POST',
    path: '/api/seo/sites/:siteId/content/:documentId/restore',
    action: 'seo:edit-content',
    status: 200,
    handler: async ({ ctx, params, body }) => {
      const p = paramsSchema.parse(params);
      const b = contentRestoreSchema.parse(body);
      return service.restoreContent(
        ctx,
        p.siteId,
        p.documentId,
        b.expectedVersion,
        b.version,
      );
    },
  });
  route({
    ...siteResource,
    method: 'POST',
    path: '/api/seo/sites/:siteId/content/:documentId/workflow',
    action: 'seo:edit-content',
    status: 200,
    handler: async ({ ctx, params, body }) => {
      const p = paramsSchema.parse(params);
      const b = contentTransitionSchema
        .extend({ transition: z.enum(['submit', 'archive', 'reopen']) })
        .parse(body);
      return service.transitionContent(ctx, p.siteId, p.documentId, b);
    },
  });
  route({
    module,
    resourceParam: 'documentId',
    loadResource: loadContentReviewResource,
    method: 'POST',
    path: '/api/seo/sites/:siteId/content/:documentId/review',
    action: 'seo:review-content',
    status: 200,
    handler: async ({ ctx, params, body }) => {
      const p = paramsSchema.parse(params);
      const b = contentTransitionSchema
        .extend({ transition: z.enum(['approve', 'request_changes']) })
        .parse(body);
      return service.transitionContent(ctx, p.siteId, p.documentId, b);
    },
  });
  route({
    ...siteResource,
    method: 'POST',
    path: '/api/seo/sites/:siteId/content/:documentId/export',
    action: 'seo:export-content',
    status: 200,
    handler: async ({ ctx, params }) => {
      const p = paramsSchema.parse(params);
      return service.exportContent(ctx, p.siteId, p.documentId);
    },
  });
}
