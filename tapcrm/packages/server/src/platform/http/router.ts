import { Router, type Request, type Response, type NextFunction } from 'express';

import { REGISTRY, BINDINGS, HTTP_STATUS, type Action } from '@tapcrm/contracts';

import { authorize, project, type Resource } from '@tapcrm/authz';

import { registeredBindings, type RouteBinding } from './route.js';

import { NotFoundError } from './error-handler.js';

import { success } from './envelope.js';

import type { RequestContext } from '../dal/context.js';

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: RequestContext;
    authSessionId?: string;
  }
}

export interface ManifestDrift {
  readonly routesWithoutBinding: readonly string[];

  readonly bindingsWithoutRoute: readonly string[];

  readonly actionsWithoutBinding: readonly string[];

  readonly duplicateRoutes: readonly string[];
}

export function checkManifest(): ManifestDrift {
  const declared = registeredBindings();

  /*
   * Public and authentication-only routes
   * are intentionally not part of the business
   * authorization manifest.
   */
  const declaredKeys = new Set(
    declared
      .filter((binding) => binding.public !== true && binding.authOnly !== true)
      .map((binding) => `${binding.method} ${binding.path}`),
  );

  const manifestKeys = new Set(
    BINDINGS.map((binding) => `${binding.method} ${binding.path}`),
  );

  const duplicates: string[] = [];

  const seen = new Set<string>();

  for (const binding of declared) {
    if (binding.public === true || binding.authOnly === true) {
      continue;
    }

    const key = `${binding.method} ${binding.path}`;

    if (seen.has(key)) {
      duplicates.push(key);
    }

    seen.add(key);
  }

  const boundActions = new Set<Action>(
    declared.flatMap((binding) => (binding.action === undefined ? [] : [binding.action])),
  );

  return {
    routesWithoutBinding: [...declaredKeys]
      .filter((key) => !manifestKeys.has(key))
      .sort(),

    bindingsWithoutRoute: [...manifestKeys]
      .filter((key) => !declaredKeys.has(key))
      .sort(),

    actionsWithoutBinding: (Object.keys(REGISTRY) as Action[])
      .filter((action) => !boundActions.has(action))
      .sort(),

    duplicateRoutes: duplicates.sort(),
  };
}

export function assertManifest(
  options: {
    strict?: boolean;
  } = {},
): ManifestDrift {
  const drift = checkManifest();

  const fatal: string[] = [];

  if (drift.routesWithoutBinding.length > 0) {
    fatal.push(
      `RM-1: ${drift.routesWithoutBinding.length} registered route(s) have no manifest entry:\n    ${drift.routesWithoutBinding.join('\n    ')}`,
    );
  }

  if (drift.duplicateRoutes.length > 0) {
    fatal.push(
      `RM-2: ${drift.duplicateRoutes.length} route(s) registered twice:\n    ${drift.duplicateRoutes.join('\n    ')}`,
    );
  }

  if (options.strict === true && drift.bindingsWithoutRoute.length > 0) {
    fatal.push(`${drift.bindingsWithoutRoute.length} manifest binding(s) have no route.`);
  }

  if (fatal.length > 0) {
    throw new Error(`Route manifest drift — refusing to start.\n\n${fatal.join('\n\n')}`);
  }

  return drift;
}

export function buildRouter(
  options: {
    publicOnly?: boolean;
  } = {},
): Router {
  const router = Router();

  for (const binding of registeredBindings()) {
    const isPublic = binding.public === true;

    if (options.publicOnly === true && !isPublic) {
      continue;
    }

    if (options.publicOnly === false && isPublic) {
      continue;
    }

    const handler = makeHandler(binding);

    switch (binding.method) {
      case 'GET':
        router.get(binding.path, handler);
        break;

      case 'POST':
        router.post(binding.path, handler);
        break;

      case 'PATCH':
        router.patch(binding.path, handler);
        break;

      case 'PUT':
        router.put(binding.path, handler);
        break;

      case 'DELETE':
        router.delete(binding.path, handler);
        break;

      default:
        throw new Error(`Unsupported HTTP method: ${binding.method}`);
    }
  }

  return router;
}

function makeHandler(binding: RouteBinding<never, unknown>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      /*
       * PUBLIC
       */
      if (binding.public === true) {
        const result = await binding.handler({
          ctx: undefined as never,
          params: normaliseParams(req.params),
          query: req.query,
          body: req.body as never,
          resource: undefined,
          req,
          res,
        });

        if (res.headersSent) {
          return;
        }

        res
          .status(
            binding.status ??
              (binding.method === 'POST' ? HTTP_STATUS.CREATED : HTTP_STATUS.OK),
          )
          .json(success(result));

        return;
      }

      /*
       * AUTHENTICATED BUT NOT BUSINESS-AUTHORIZED
       */
      if (binding.authOnly === true) {
        const ctx = req.ctx;

        if (ctx === undefined) {
          throw new Error(`No RequestContext on ${binding.method} ${binding.path}.`);
        }

        const result = await binding.handler({
          ctx,
          params: normaliseParams(req.params),
          query: req.query,
          body: req.body as never,
          resource: undefined,
          req,
          res,
        });

        if (res.headersSent) {
          return;
        }

        res
          .status(
            binding.status ??
              (binding.method === 'POST' ? HTTP_STATUS.CREATED : HTTP_STATUS.OK),
          )
          .json(
            success(result, {
              requestId: ctx.requestId,
            }),
          );

        return;
      }

      /*
       * NORMAL BUSINESS ROUTE
       */
      const action = binding.action;

      if (action === undefined) {
        throw new Error(
          `Protected route ${binding.method} ${binding.path} has no action.`,
        );
      }

      const ctx = req.ctx;

      if (ctx === undefined) {
        throw new Error(`No RequestContext on ${binding.method} ${binding.path}.`);
      }

      const definition = REGISTRY[action];

      let resource: Resource | undefined;

      if (
        definition.resource !== null &&
        binding.resourceParam !== undefined &&
        binding.loadResource !== undefined
      ) {
        const id = singleParam(req.params[binding.resourceParam]);

        if (id === undefined) {
          throw new NotFoundError(definition.resource);
        }

        const loaded = await binding.loadResource(ctx, id);

        if (loaded === null) {
          throw new NotFoundError(definition.resource);
        }

        resource = loaded;
      }

      await authorize(ctx, action, resource);

      const result = await binding.handler({
        ctx,
        params: normaliseParams(req.params),
        query: req.query,
        body: req.body as never,
        resource,
        req,
        res,
      });

      if (res.headersSent) {
        return;
      }

      const projected = await projectResult(ctx, action, result);

      const status =
        binding.status ??
        (binding.method === 'POST' ? HTTP_STATUS.CREATED : HTTP_STATUS.OK);

      res.status(status).json(
        success(projected, {
          requestId: ctx.requestId,
        }),
      );
    } catch (error) {
      next(error);
    }
  };
}

function singleParam(value: string | string[] | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value;
}

function normaliseParams(
  params: Record<string, string | string[] | undefined>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    const single = singleParam(value);

    if (single !== undefined) {
      out[key] = single;
    }
  }

  return out;
}

async function projectResult(
  ctx: RequestContext,
  action: Action,
  result: unknown,
): Promise<unknown> {
  if (result === null || result === undefined) {
    return result;
  }

  if (Array.isArray(result)) {
    return Promise.all(
      result.map((item) =>
        typeof item === 'object' && item !== null
          ? project(ctx, action, item as Record<string, unknown>)
          : item,
      ),
    );
  }

  if (typeof result === 'object') {
    return project(ctx, action, result as Record<string, unknown>);
  }

  return result;
}
