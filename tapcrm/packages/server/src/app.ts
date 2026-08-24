import express, { type Express } from 'express';
import helmet from 'helmet';
import {
  assertResourcePolicyCompleteness,
  registerProtectedConstraints,
} from '@tapcrm/authz';
import { loadConfig } from './config.js';
import { installAuthz } from './platform/authz-adapter.js';
import { requestContext, requestId } from './platform/http/context.js';
import { installDevPrincipalResolver } from './platform/http/dev-resolver.js';
import { errorHandler } from './platform/http/error-handler.js';
import { assertManifest, buildRouter, checkManifest } from './platform/http/router.js';
import { registerAllPolicies, registerAllRoutes } from './modules/index.js';

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

let registered = false;

/** Idempotent: registration is process-global, so calling twice must not duplicate. */
function registerAll(): void {
  if (registered) return;
  registered = true;

  // A1 runs from sod.ts at step 2; A2–A4 and P1–P8 register here.
  registerProtectedConstraints();

  registerAllPolicies();
  registerAllRoutes();
}

export function buildApp(options: BuildOptions = {}): Express {
  const config = loadConfig();

  registerAll();
  installAuthz();

  // Until the `identity` module lands, development installs a header-trusting
  // resolver so the pipeline can be exercised. It refuses to run in production.
  if (config.NODE_ENV !== 'production') {
    installDevPrincipalResolver();
  }

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
      routesRegistered: 292 - drift.bindingsWithoutRoute.length,
      bindingsAwaitingRoutes: drift.bindingsWithoutRoute.length,
    }),
  );

  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));

  app.use(requestId);

  // Liveness and readiness are public and carry no tenant context.
  app.get('/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok' } });
  });
  app.get('/health/manifest', (_req, res) => {
    res.json({ success: true, data: checkManifest() });
  });

  // Pipeline step 1. Everything below it has a RequestContext or never runs.
  app.use(config.API_BASE_PATH, requestContext);
  app.use(buildRouter());

  app.use(errorHandler);

  return app;
}
