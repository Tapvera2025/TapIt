import { z } from 'zod';
import type { Action } from '@tapcrm/contracts';
import { route, type Handler } from '../../platform/http/route.js';
import { ApplicationError } from '../../errors.js';
import {
  loadPostResource,
  loadWorkspaceResource,
  listSocialClients,
  getSocialClient,
} from './policy.js';
import { completeOAuth, selectOAuthAccounts, startOAuth } from './oauth.js';
import {
  listProviderReadiness,
  getProviderReadiness,
  getProvider,
} from './providers/index.js';
import { SOCIAL_PLATFORMS, type OAuthCredential } from './providers/types.js';
import { decryptCredentials, socialSecurityReady } from './security.js';
import * as service from './service.js';
import { getMedia, uploadMedia } from './media.js';
import { exportAnalyticsCsv, getAnalytics, syncAnalytics } from './service.js';
import {
  socialPostSchema,
  socialPostQuerySchema,
  socialSettingsSchema,
  socialMediaSchema,
  socialAnalyticsQuerySchema,
} from './validators.js';

const ids = z.object({
  clientId: z.string().uuid(),
  postId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  mediaId: z.string().uuid().optional(),
});
const clientId = (params: Readonly<Record<string, string>>) => ids.parse(params).clientId;
const id = (params: Readonly<Record<string, string>>, key: string) =>
  z.string().uuid().parse(params[key]);
const platform = (params: Readonly<Record<string, string>>) =>
  z.enum(SOCIAL_PLATFORMS).parse(params['platform']);
// Preparing content cannot smuggle a publish or approval command through social:manage.
const preparePost = socialPostSchema.extend({
  intent: z.enum(['draft', 'submit']).default('draft'),
});
const actions = z
  .object({
    action: z.enum(['cancel', 'duplicate', 'submit']),
    comment: z.string().max(4000).optional(),
  })
  .strict();

export function registerSocialRoutes(): void {
  function workspace(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    suffix: string,
    action: Action,
    handler: Handler,
  ) {
    route({
      method,
      path: `/api/social/clients/:clientId${suffix}`,
      action,
      module: 'social',
      resourceParam: 'clientId',
      loadResource: loadWorkspaceResource,
      handler,
    });
  }
  route({
    method: 'GET',
    path: '/api/social/providers',
    action: 'social:view',
    module: 'social',
    handler: async () =>
      listProviderReadiness().map((provider) =>
        socialSecurityReady()
          ? provider
          : {
              ...provider,
              status: 'setup_required' as const,
              message:
                'Configure the social encryption key and public CRM origin before connecting accounts.',
            },
      ),
  });
  route({
    method: 'GET',
    path: '/api/social/clients',
    action: 'social:view',
    module: 'social',
    handler: async ({ ctx, query }) =>
      listSocialClients(
        ctx,
        z
          .object({
            search: z.string().max(200).optional(),
            page: z.coerce.number().int().min(1).default(1),
            pageSize: z.coerce.number().int().min(1).max(100).default(50),
          })
          .parse(query),
      ),
  });
  workspace('GET', '', 'social:view', async ({ ctx, params }) =>
    getSocialClient(ctx, clientId(params)),
  );
  workspace('GET', '/accounts', 'social:view', async ({ ctx, params }) =>
    service.listAccounts(ctx, clientId(params)),
  );
  workspace(
    'POST',
    '/oauth/:platform/start',
    'social:connect',
    async ({ ctx, params, res }) => {
      const providerPlatform = platform(params);
      const readiness = getProviderReadiness(providerPlatform);
      if (readiness.status !== 'ready')
        throw new ApplicationError(readiness.message, 422, 'SOCIAL_SETUP_REQUIRED');
      return startOAuth(ctx, clientId(params), providerPlatform, res);
    },
  );
  workspace(
    'POST',
    '/oauth/:platform/complete',
    'social:connect',
    async ({ ctx, params, body, req, res }) =>
      completeOAuth(
        ctx,
        clientId(params),
        platform(params),
        z
          .object({
            code: z.string().min(1).max(8192),
            state: z.string().min(1).max(8192),
          })
          .strict()
          .parse(body),
        req,
        res,
      ),
  );
  workspace(
    'POST',
    '/oauth/:platform/select',
    'social:connect',
    async ({ ctx, params, body }) =>
      selectOAuthAccounts(
        ctx,
        clientId(params),
        platform(params),
        z
          .object({
            state: z.string().min(1).max(8192),
            accountIds: z.array(z.string().min(1).max(300)).min(1).max(100),
          })
          .strict()
          .parse(body),
      ),
  );
  workspace(
    'DELETE',
    '/accounts/:accountId',
    'social:connect',
    async ({ ctx, params, body }) => {
      const { revokeGrant } = z
        .object({ revokeGrant: z.boolean().default(false) })
        .strict()
        .parse(body ?? {});
      let revocationStatus = 'not_requested';
      if (revokeGrant) {
        const account = await service.getAccountConnection(
          ctx,
          clientId(params),
          id(params, 'accountId'),
        );
        if (account.credentialsEncrypted) {
          try {
            const credentials = decryptCredentials<OAuthCredential>(
              account.credentialsEncrypted,
              {
                organizationId: ctx.organizationId,
                clientId: account.clientId,
                platform: account.platform,
              },
            );
            await getProvider(account.platform).revoke(credentials);
            revocationStatus = 'revoked';
          } catch {
            revocationStatus = 'remove_access_in_platform_settings';
          }
        }
      }
      await service.disconnectAccount(ctx, clientId(params), id(params, 'accountId'));
      return { disconnected: true, revocationStatus };
    },
  );
  workspace('GET', '/posts', 'social:view', async ({ ctx, params, query }) =>
    service.listPosts(ctx, clientId(params), socialPostQuerySchema.parse(query)),
  );
  workspace('GET', '/posts/:postId', 'social:view', async ({ ctx, params }) =>
    service.getPost(ctx, clientId(params), id(params, 'postId')),
  );
  workspace('POST', '/posts', 'social:manage', async ({ ctx, params, body }) =>
    service.createPost(ctx, clientId(params), preparePost.parse(body)),
  );
  workspace('PATCH', '/posts/:postId', 'social:manage', async ({ ctx, params, body }) =>
    service.updatePost(
      ctx,
      clientId(params),
      id(params, 'postId'),
      preparePost.parse(body),
    ),
  );
  workspace(
    'POST',
    '/posts/:postId/actions',
    'social:manage',
    async ({ ctx, params, body }) => {
      const input = actions.parse(body);
      return input.action === 'duplicate'
        ? service.duplicatePost(ctx, clientId(params), id(params, 'postId'))
        : service.transitionPost(ctx, clientId(params), id(params, 'postId'), input);
    },
  );
  workspace(
    'POST',
    '/posts/:postId/publish',
    'social:publish',
    async ({ ctx, params, body }) => {
      const input = z
        .object({ scheduledAt: z.string().datetime({ offset: true }).optional() })
        .strict()
        .parse(body ?? {});
      return service.transitionPost(ctx, clientId(params), id(params, 'postId'), {
        action: input.scheduledAt ? 'schedule' : 'publish',
        ...input,
      });
    },
  );
  route({
    method: 'POST',
    path: '/api/social/clients/:clientId/posts/:postId/review',
    action: 'social:approve',
    module: 'social',
    resourceParam: 'postId',
    loadResource: loadPostResource,
    handler: async ({ ctx, params, body }) => {
      const input = z
        .object({
          decision: z.enum(['approve', 'request_changes']),
          comment: z.string().trim().max(4000).optional(),
        })
        .strict()
        .parse(body);
      return service.transitionPost(ctx, clientId(params), id(params, 'postId'), {
        action: input.decision,
        ...(input.comment !== undefined ? { comment: input.comment } : {}),
      });
    },
  });
  workspace('POST', '/media', 'social:manage', async ({ ctx, params, body }) =>
    uploadMedia(ctx, clientId(params), socialMediaSchema.parse(body)),
  );
  workspace('GET', '/media/:mediaId', 'social:view', async ({ ctx, params }) =>
    getMedia(ctx, clientId(params), id(params, 'mediaId')),
  );
  workspace('GET', '/settings', 'social:view', async ({ ctx, params }) =>
    service.getSettings(ctx, clientId(params)),
  );
  workspace('PUT', '/settings', 'social:settings', async ({ ctx, params, body }) =>
    service.updateSettings(ctx, clientId(params), socialSettingsSchema.parse(body)),
  );
  workspace('GET', '/analytics', 'social:view', async ({ ctx, params, query }) =>
    getAnalytics(ctx, clientId(params), socialAnalyticsQuerySchema.parse(query)),
  );
  workspace(
    'GET',
    '/analytics/export',
    'social:view',
    async ({ ctx, params, query, res }) => {
      const range = socialAnalyticsQuerySchema.parse(query);
      const csv = await exportAnalyticsCsv(ctx, clientId(params), range);
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="social-analytics-${stamp}.csv"`,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(csv);
      return undefined;
    },
  );
  workspace('POST', '/analytics/sync', 'social:manage', async ({ ctx, params, body }) => {
    const range = socialAnalyticsQuerySchema.parse(body ?? {});
    await syncAnalytics(
      ctx,
      clientId(params),
      range.from && range.to ? { from: range.from, to: range.to } : undefined,
    );
    return getAnalytics(ctx, clientId(params), {});
  });
}
