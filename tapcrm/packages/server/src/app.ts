import express, {
  type Express,
} from 'express';

import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import morgan from "morgan";
import {
  assertResourcePolicyCompleteness,
  registerProtectedConstraints,
} from '@tapcrm/authz';

import { loadConfig } from './config.js';

import { installAuthz } from './platform/authz-adapter.js';

import {
  requestContext,
  requestId,
} from './platform/http/context.js';

import { installIdentityPrincipalResolver } from './modules/identity/resolver.js';

import { errorHandler } from './platform/http/error-handler.js';

import {
  assertManifest,
  buildRouter,
  checkManifest,
} from './platform/http/router.js';

import {
  registerAllPolicies,
  registerAllRoutes,
} from './modules/index.js';

export interface BuildOptions {
  readonly strictManifest?: boolean;
}

let registered = false;

function registerAll(): void {
  if (registered) {
    return;
  }

  registered = true;

  registerProtectedConstraints();

  registerAllPolicies();
  registerAllRoutes();
}

export function buildApp(
  options: BuildOptions = {},
): Express {
  const config = loadConfig();

  registerAll();

  installAuthz();

  /*
   * Identity owns authentication and principal resolution.
   */
  installIdentityPrincipalResolver();

  try {
    assertResourcePolicyCompleteness();
  } catch (error) {
    if (config.NODE_ENV === 'production') {
      throw error;
    }

    const missing =
      (error as Error).message.split('\n').length - 1;

    console.warn(
      JSON.stringify({
        level: 'warn',
        msg:
          'AZ-I6b: resource policies incomplete (expected during phased delivery)',
        missingCount: missing,
      }),
    );
  }

  const drift = assertManifest({
    strict: options.strictManifest === true,
  });

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'route manifest',
      routesRegistered:
        292 - drift.bindingsWithoutRoute.length,
      bindingsAwaitingRoutes:
        drift.bindingsWithoutRoute.length,
    }),
  );

  const app = express();

  app.set('trust proxy', 1);

  app.disable('x-powered-by');

  /*
   * Security headers.
   */
  app.use(helmet());
  app.use(morgan("dev"));

  /*
   * JSON request parsing.
   */
  app.use(
    express.json({
      limit: '1mb',
    }),
  );

  /*
   * Authentication cookies.
   */
  app.use(cookieParser());

  /*
   * CORS.
   *
   * Use the configured origin rather than hardcoding localhost.
   */
  app.use(
    cors({
      origin: config.CORS_ORIGIN,
      credentials: true,
      methods: [
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'OPTIONS',
      ],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Request-Id',
      ],
    }),
  );

  app.use(requestId);

  /*
   * Health endpoint.
   *
   * This intentionally remains /health rather than /api/health because
   * it is an infrastructure health check.
   */
  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        status: 'ok',
      },
    });
  });

  /*
   * Route-manifest health endpoint.
   */
  app.get('/health/manifest', (_req, res) => {
    res.json({
      success: true,
      data: checkManifest(),
    });
  });

  /*
   * PUBLIC ROUTES
   *
   * The registered routes already contain /api in their paths:
   *
   *   /api/auth/login
   *   /api/auth/refresh
   *   /api/auth/forgot-password
   *
   * Therefore DO NOT mount this router under /api again.
   */
  app.use(
    buildRouter({
      publicOnly: true,
    }),
  );

  /*
   * Everything below this point requires an authenticated
   * RequestContext.
   */
  app.use(requestContext);

  /*
   * Authenticated + business-authorized routes.
   */
  app.use(buildRouter());

  /*
   * Central error handler must remain last.
   */
  app.use(errorHandler);

  return app;
}
