import { buildSocialOAuthRouter } from './modules/social/index.js';
import { buildCalendarOAuthRouter } from './modules/meetings/index.js';
import express, { type Express } from 'express';
import helmet from 'helmet';
import {
  assertResourcePolicyCompleteness,
  registerProtectedConstraints,
} from '@tapcrm/authz';
import { loadConfig } from './config.js';
import { auditFlushMiddleware, installAuthz } from './platform/authz-adapter.js';
import { requestContext, requestId } from './platform/http/context.js';
import { installDevPrincipalResolver } from './platform/http/dev-resolver.js';
import { errorHandler } from './platform/http/error-handler.js';
import { assertManifest, buildRouter, checkManifest } from './platform/http/router.js';
import { registeredBindings } from './platform/http/route.js';
import { initializePorts, registerAllPolicies, registerAllRealtime, registerAllRoutes } from './modules/index.js';
import { buildPlatformRouter } from './platform/routes.js';
import { registerIdentityPublicRoutes } from './modules/identity/index.js';
import { registerDashboardRoutes } from './modules/dashboard/index.js';
import { buildPublicRecruitmentRouter } from './modules/recruitment/index.js';
import { buildPublicProposalPortalRouter } from './modules/sales/proposals/portal/public-routes.js';
import { buildBiometricMachineRouter } from './modules/biometric/index.js';
import { buildWebsiteWebhookRouter } from './modules/sales/adapters/website/index.js';
import { buildMetaWebhookRouter } from './modules/sales/adapters/meta/index.js';
import { buildWhatsAppWebhookRouter } from './modules/sales/adapters/whatsapp/index.js';
import { buildPaymentWebhookRouter } from './modules/finance/payments/public-routes.js';
import { buildGbpWebhookRouter } from './modules/sales/adapters/gbp/index.js';
import { registerNotificationRoutes } from './modules/notifications/routes.js';
import { buildChatFileRouter } from './modules/chat/index.js';
import { Router } from 'express';

/**
 * Application bootstrap.
 *
 * The ORDER of registration matters and is asserted rather than assumed:
 *   1. constraints and resource policies register
 *   2. routes declare their bindings
 *   3. completeness checks run — AND THROW if anything is missing
 *   4. only then does the router mount
 *
 * AZ-I6b and RM-1 both specify STARTUP failure rather than request-time
 * failure: a missing resource policy or an unbound route discovered on a
 * request is a defect discovered by a user.
 */

export interface BuildOptions {
  /** Release verification: also require every manifest binding to have a route. */
  readonly strictManifest?: boolean;
}

// JSON cannot encode BigInt. Our money columns (commercials totals,
// receipts) are bigint minor units; serialize them as decimal strings so
// `res.json()` doesn't throw. Clients re-hydrate with `BigInt(...)`.
if (!('toJSON' in BigInt.prototype)) {
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function toJSON(this: bigint) {
      return this.toString();
    },
    configurable: true,
    writable: true,
  });
}

let registered = false;

/** Idempotent: registration is process-global, so calling twice must not duplicate. */
function registerAll(): void {
  if (registered) return;
  registered = true;

  // A1 runs from sod.ts at step 2; A2–A4 and P1–P8 register here.
  registerProtectedConstraints();

  initializePorts();
  registerAllPolicies();
  registerAllRoutes();
  registerAllRealtime();
}

export function buildApp(options: BuildOptions = {}): Express {
  const config = loadConfig();

  registerAll();
  installAuthz();

  // AZ-I6b — every registry resource must have a registered ResourcePolicy.
  //
  // ⚠ SCAFFOLD: only the `organization` resources are implemented, so this
  // check currently fails for the other ~40 resource types. It is reported
  // rather than thrown until the modules land; `npm run ci` lists the gap and
  // the release-blocking CI set turns it fatal.
  try {
    assertResourcePolicyCompleteness();
  } catch (error) {
    if (process.env['NODE_ENV'] === 'production') throw error;
    const missing = (error as Error).message.split('\n').length - 1;
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'AZ-I6b: resource policies incomplete (expected during phased delivery)',
        missingCount: missing,
      }),
    );
  }

  // RM-1 / RM-2 — a registered route with no manifest entry, or a duplicate
  // route, refuses to start. This one is fatal in every environment.
  const drift = assertManifest({ strict: options.strictManifest === true });
  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'route manifest',
      routesRegistered: registeredBindings().length,
      bindingsAwaitingRoutes: drift.bindingsWithoutRoute.length,
    }),
  );

  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  // G2 — ZKTeco-firmware devices push to /iclock in their own text protocol.
  // Mounted before JSON parsing and product authentication (attendance §10.5).
  app.use('/iclock', buildBiometricMachineRouter());

  // Sales intake webhooks (R1 steps 1.6–1.10). Mounted BEFORE express.json so
  // the HMAC check sees the exact bytes the sender signed. Each adapter owns
  // its own raw parser and auth model (per-connector shared secret).
  app.use(`${config.API_BASE_PATH}/webhooks/website`, buildWebsiteWebhookRouter());
  app.use(`${config.API_BASE_PATH}/webhooks/meta`, buildMetaWebhookRouter());
  app.use(`${config.API_BASE_PATH}/webhooks/whatsapp`, buildWhatsAppWebhookRouter());
  app.use(`${config.API_BASE_PATH}/webhooks/gbp-call`, buildGbpWebhookRouter());
  app.use(`${config.API_BASE_PATH}/webhooks/payments/hyperswitch`, buildPaymentWebhookRouter());

  // Scoped upload body limit; other CRM endpoints retain their current limit.
  app.use('/api/social', express.json({ limit: '72mb' }));
  // Chat attachments arrive as raw bytes (application/octet-stream), not
  // base64 JSON: a third smaller on the wire, and the bytes the type check
  // reads are exactly the bytes stored. The limit is the configured maximum
  // plus headroom; the chat service enforces the exact figure.
  const chatUploadLimit = `${config.CHAT_ATTACHMENT_MAX_MB + 1}mb`;
  // Same literal /api prefix as the routes themselves (platform/http/route.ts paths).
  for (const path of [
    '/api/chat/conversations/:id/attachments',
    '/api/client-portal/projects/:projectId/discussion/:conversationId/attachments',
  ]) {
    app.use(path, express.raw({ type: 'application/octet-stream', limit: chatUploadLimit }));
  }
  app.use(express.json({ limit: '15mb' }));

  app.use(requestId);

  const publicIdentity = Router();
  registerIdentityPublicRoutes(publicIdentity);
  registerDashboardRoutes(publicIdentity);
  registerNotificationRoutes(publicIdentity);
  if (config.IDENTITY_DEV_BYPASS) {
    if (config.NODE_ENV === 'production') {
      throw new Error('IDENTITY_DEV_BYPASS must not be enabled in production');
    }
    installDevPrincipalResolver({ allowIdentityOverride: true });
  }

  // Platform control-plane routes do not create a tenant RequestContext.
  // Master Admin authentication is a separate principal/session namespace.
  app.use(`${config.API_BASE_PATH}/platform`, buildPlatformRouter());

  app.use(`${config.API_BASE_PATH}/social/oauth`, buildSocialOAuthRouter());
  // Google's redirect after "Connect Google Calendar"; it carries no session (see meetings/google/connect.ts).
  app.use(`${config.API_BASE_PATH}/meetings/google`, buildCalendarOAuthRouter());
  app.use(config.API_BASE_PATH, publicIdentity);
  app.use(`${config.API_BASE_PATH}/public/recruitment`, buildPublicRecruitmentRouter());
  app.use(`${config.API_BASE_PATH}/public/proposals`, buildPublicProposalPortalRouter());
  // Chat attachments and preview images for <img>/<a download>: the signed
  // link is the credential (modules/chat/file-urls.ts), checked per request.
  app.use(`${config.API_BASE_PATH}/chat-files`, buildChatFileRouter());

  // Liveness and readiness are public and carry no tenant context.
  app.get('/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok' } });
  });
  app.get('/health/manifest', (_req, res) => {
    res.json({ success: true, data: checkManifest() });
  });

  // Pipeline step 1. Everything below it has a RequestContext or never runs.
  app.use(config.API_BASE_PATH, requestContext);
  app.use(config.API_BASE_PATH, auditFlushMiddleware);
  app.use(buildRouter());

  app.use(errorHandler);

  return app;
}
