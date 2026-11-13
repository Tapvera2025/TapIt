import { z } from 'zod';
import { SOCIAL_COMPANY_PLATFORMS, type Action } from '@tapcrm/contracts';
import { route, type Handler } from '../../platform/http/route.js';
import { ApplicationError } from '../../errors.js';
import {
  loadPostResource,
  loadWorkspaceResource,
  listSocialClients,
  getSocialClient,
} from './policy.js';
import {
  completeCompanyOAuth,
  completeOAuth,
  selectOAuthAccounts,
  startOAuth,
} from './oauth.js';
import {
  completePortalConnection,
  disconnectPortalAccount,
  getPortalOverview,
  selectPortalAccounts,
  startPortalConnection,
} from './portal.js';
import {
  assignCompanyLocation,
  disconnectCompanyConnection,
  listCompanyConnections,
  listCompanyLocations,
  syncCompanyConnection,
} from './company.js';
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
const companyPlatform = (params: Readonly<Record<string, string>>) =>
  z.enum(SOCIAL_COMPANY_PLATFORMS).parse(params['platform']);
const oauthCompletion = z
  .object({
    code: z.string().min(1).max(8192),
    state: z.string().min(1).max(8192),
  })
  .strict();
const revocation = z.object({ revokeGrant: z.boolean().default(false) }).strict();
const assignment = z
  .object({ clientId: z.string().uuid().nullable(), move: z.boolean().default(false) })
  .strict();
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
        oauthCompletion.parse(body),
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
      const { revokeGrant } = revocation.parse(body ?? {});
      let revocationStatus = 'not_requested';
      let othersNeedReconnect = 0;
      if (revokeGrant) {
        const account = await service.getAccountConnection(
          ctx,
          clientId(params),
          id(params, 'accountId'),
        );
        // Revoking would end the company sign-in for every client it serves.
        if (account.connectionClientId === null)
          throw new ApplicationError(
            'This account uses one of your company logins. Unassign it here; manage the login under Company connections.',
            422,
            'SOCIAL_COMPANY_CONNECTION',
          );
        // The client's own platform login: only the client may remove its access.
        if (account.connectionOrigin === 'client_portal')
          throw new ApplicationError(
            'The client connected this account from their client portal. Disconnect it here; only the client can remove TapIt’s access to their own login.',
            422,
            'SOCIAL_CLIENT_OWNED_GRANT',
          );
        if (account.credentialsEncrypted) {
          try {
            const credentials = decryptCredentials<OAuthCredential>(
              account.credentialsEncrypted,
              service.connectionCredentialContext(ctx.organizationId, {
                id: account.connectionId,
                clientId: account.connectionClientId,
                platform: account.connectionPlatform,
              }),
            );
            await getProvider(account.connectionPlatform).revoke(credentials);
            revocationStatus = 'revoked';
          } catch {
            revocationStatus = 'remove_access_in_platform_settings';
          }
        }
        await service.disconnectAccount(ctx, clientId(params), id(params, 'accountId'));
        // Meta removed the app for that whole Facebook user, not only this Page.
        if (revocationStatus === 'revoked')
          othersNeedReconnect = await service.markGrantRevoked(ctx, {
            platform: account.connectionPlatform,
            externalAccountId: account.connectionExternalAccountId,
            connectionId: account.connectionId,
          });
        return { disconnected: true, revocationStatus, othersNeedReconnect };
      }
      await service.disconnectAccount(ctx, clientId(params), id(params, 'accountId'));
      return { disconnected: true, revocationStatus, othersNeedReconnect };
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
  // Google Search Console reporting lives in the SEO dashboard (per website),
  // not in Social: see modules/seo-intelligence/search-console.ts.

  // Client portal: a client connecting its own accounts. Only client principals hold
  // social:connect-own-accounts, and the socialWorkspace check (A2 + resource policy)
  // proves the path's client is the principal's own before any handler runs.
  function portal(method: 'GET' | 'POST' | 'DELETE', suffix: string, handler: Handler) {
    route({
      method,
      path: `/api/social/portal/clients/:clientId${suffix}`,
      action: 'social:connect-own-accounts',
      module: 'social',
      resourceParam: 'clientId',
      loadResource: loadWorkspaceResource,
      handler,
    });
  }
  portal('GET', '/connections', async ({ ctx, params }) =>
    getPortalOverview(ctx, clientId(params)),
  );
  portal('POST', '/oauth/:platform/start', async ({ ctx, params, res }) =>
    startPortalConnection(ctx, clientId(params), platform(params), res),
  );
  portal('POST', '/oauth/:platform/complete', async ({ ctx, params, body, req, res }) =>
    completePortalConnection(
      ctx,
      clientId(params),
      platform(params),
      oauthCompletion.parse(body),
      req,
      res,
    ),
  );
  portal('POST', '/oauth/:platform/select', async ({ ctx, params, body }) =>
    selectPortalAccounts(
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
  portal('DELETE', '/accounts/:accountId', async ({ ctx, params, body }) =>
    disconnectPortalAccount(
      ctx,
      clientId(params),
      id(params, 'accountId'),
      revocation.parse(body ?? {}).revokeGrant,
    ),
  );

  // Company-wide connections: one platform sign-in for the whole company, whose
  // locations are assigned to clients. Managing them is a company integration.
  function company(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    suffix: string,
    handler: Handler,
  ) {
    route({
      method,
      path: `/api/social/company-connections${suffix}`,
      action: 'system:manage-integrations',
      module: 'social',
      handler,
    });
  }
  company('GET', '', async ({ ctx }) => listCompanyConnections(ctx));
  company('POST', '/oauth/:platform/start', async ({ ctx, params, res }) => {
    const providerPlatform = companyPlatform(params);
    const readiness = getProviderReadiness(providerPlatform);
    if (readiness.status !== 'ready')
      throw new ApplicationError(readiness.message, 422, 'SOCIAL_SETUP_REQUIRED');
    return startOAuth(ctx, null, providerPlatform, res);
  });
  company('POST', '/oauth/:platform/complete', async ({ ctx, params, body, req, res }) =>
    completeCompanyOAuth(
      ctx,
      companyPlatform(params),
      oauthCompletion.parse(body),
      req,
      res,
    ),
  );
  company('GET', '/:connectionId/locations', async ({ ctx, params }) =>
    listCompanyLocations(ctx, id(params, 'connectionId')),
  );
  company('POST', '/:connectionId/sync', async ({ ctx, params }) =>
    syncCompanyConnection(ctx, id(params, 'connectionId'), 'manual'),
  );
  company(
    'PUT',
    '/:connectionId/locations/:locationId/client',
    async ({ ctx, params, body }) => {
      const input = assignment.parse(body);
      return assignCompanyLocation(
        ctx,
        id(params, 'connectionId'),
        id(params, 'locationId'),
        input.clientId,
        { move: input.move },
      );
    },
  );
  company('DELETE', '/:connectionId', async ({ ctx, params, body }) =>
    disconnectCompanyConnection(
      ctx,
      id(params, 'connectionId'),
      revocation.parse(body ?? {}).revokeGrant,
    ),
  );
}
