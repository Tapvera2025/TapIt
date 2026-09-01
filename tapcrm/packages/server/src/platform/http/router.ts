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
        throw new Error(`Unsupported HTTP method: ${String(binding.method)}`);
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

      if (definition.resource !== null && binding.loadResource !== undefined) {
        const id =
          binding.resourceParam !== undefined
            ? singleParam(req.params[binding.resourceParam])
            : bodyField(req.body, binding.resourceBodyField);

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

/**
 * Reads the resource id out of the request body, for the bindings whose target
 * is named in the payload rather than the path.
 *
 * Deliberately strict about the type: a non-string here becomes a 404 rather
 * than being coerced into a lookup, because an id the caller controls the shape
 * of is the last place to be relaxed.
 */
function bodyField(body: unknown, field: string | undefined): string | undefined {
  if (field === undefined || typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
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

/**
 * Keys that hold the records inside a paginated response.
 *
 * AZ-I4 — "Serialization happens ONCE, at the response boundary, and EVERY
 * response passes through it." A handler returning `{ items, total }` used to
 * get the wrapper's own keys projected while the records inside passed through
 * untouched, so a field policy on `Deal.commercials` or a payslip would apply
 * to a single record and not to a list of them. Naming the envelope keys keeps
 * one serialization path for both shapes.
 */
const ENVELOPE_KEYS = ['items', 'records', 'rows', 'results', 'data'] as const;

async function projectResult(
  ctx: RequestContext,
  action: Action,
  result: unknown,
): Promise<unknown> {
  if (result === null || result === undefined) {
    return result;
  }

  if (Array.isArray(result)) {
    return projectMany(ctx, action, result);
  }

  if (typeof result === 'object') {
    const record = result as Record<string, unknown>;

    for (const key of ENVELOPE_KEYS) {
      const inner = record[key];
      if (Array.isArray(inner)) {
        return { ...record, [key]: await projectMany(ctx, action, inner) };
      }
    }

    return project(ctx, action, record);
  }

  return result;
}

function projectMany(
  ctx: RequestContext,
  action: Action,
  items: readonly unknown[],
): Promise<unknown[]> {
  return Promise.all(
    items.map((item) =>
      typeof item === 'object' && item !== null
        ? project(ctx, action, item as Record<string, unknown>)
        : item,
    ),
  );
}
