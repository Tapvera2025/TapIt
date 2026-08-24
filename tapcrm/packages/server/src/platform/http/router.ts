import { Router, type Request, type Response, type NextFunction } from 'express';
import { REGISTRY, BINDINGS, HTTP_STATUS, type Action } from '@tapcrm/contracts';
import { authorize, project } from '@tapcrm/authz';
import { registeredBindings, type RouteBinding } from './route.js';
import { NotFoundError } from './error-handler.js';
import { success } from './envelope.js';
import type { RequestContext } from '../dal/context.js';

/**
 * Route mounting and the boot-time manifest check.
 *
 * TECH.md §8.3 — the FRAMEWORK, not the handler:
 *   1. Resolves the binding's action from the registry
 *   2. Loads the resource named by `resourceParam`
 *   3. Calls `authorize(ctx, action, resource)`
 *   4. Invokes the handler
 *   5. Passes the result through `project(ctx, action, result)`
 *
 * That ordering is why a handler never needs to remember an authorization
 * check, and why forgetting one is not possible: there is no path to a handler
 * that does not pass through step 3.
 */

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: RequestContext;
  }
}

/**
 * AC-14 / RM-1 / RM-2 / CI-2 / CI-4 — the manifest check.
 *
 *   "Every registered route has a manifest entry and every manifest entry
 *    resolves to a route; DRIFT FAILS THE BUILD."
 *
 * RM-1 makes an unbound route a STARTUP failure: "A missing binding is a defect
 * and should surface at deploy, not on a request."
 */
export interface ManifestDrift {
  readonly routesWithoutBinding: readonly string[];
  readonly bindingsWithoutRoute: readonly string[];
  readonly actionsWithoutBinding: readonly string[];
  readonly duplicateRoutes: readonly string[];
}

export function checkManifest(): ManifestDrift {
  const declared = registeredBindings();
  const declaredKeys = new Set(declared.map((b) => `${b.method} ${b.path}`));
  const manifestKeys = new Set(BINDINGS.map((b) => `${b.method} ${b.path}`));

  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const binding of declared) {
    const key = `${binding.method} ${binding.path}`;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }

  const boundActions = new Set<Action>(declared.map((b) => b.action));

  return {
    // A route the code registers that AUTHORIZATION.md §6.5 does not know about.
    routesWithoutBinding: [...declaredKeys].filter((k) => !manifestKeys.has(k)).sort(),
    // A binding in the document with no implementation yet. Expected during
    // phased delivery — reported, not fatal, and surfaced so the gap is visible.
    bindingsWithoutRoute: [...manifestKeys].filter((k) => !declaredKeys.has(k)).sort(),
    actionsWithoutBinding: (Object.keys(REGISTRY) as Action[])
      .filter((a) => !boundActions.has(a))
      .sort(),
    duplicateRoutes: duplicates.sort(),
  };
}

/**
 * RM-1 — a registered route with no binding fails at BOOT.
 *
 * `bindingsWithoutRoute` and `actionsWithoutBinding` are reported but do not
 * throw: during phased delivery most of the 292 bindings have no route yet, and
 * refusing to start would mean nothing runs until P7. The dangerous direction
 * is the other one — a route the manifest does not describe is a route nobody
 * reviewed the authorization of.
 */
export function assertManifest(options: { strict?: boolean } = {}): ManifestDrift {
  const drift = checkManifest();
  const fatal: string[] = [];

  if (drift.routesWithoutBinding.length > 0) {
    fatal.push(
      `RM-1: ${drift.routesWithoutBinding.length} registered route(s) have no entry in ` +
        `AUTHORIZATION.md §6.5:\n    ${drift.routesWithoutBinding.join('\n    ')}`,
    );
  }
  if (drift.duplicateRoutes.length > 0) {
    fatal.push(
      `RM-2: ${drift.duplicateRoutes.length} route(s) registered twice. §6.2 makes ` +
        `method+path the authorization key:\n    ${drift.duplicateRoutes.join('\n    ')}`,
    );
  }
  if (options.strict === true && drift.bindingsWithoutRoute.length > 0) {
    fatal.push(
      `${drift.bindingsWithoutRoute.length} manifest binding(s) have no route. ` +
        'Strict mode is for release verification, not phased development.',
    );
  }

  if (fatal.length > 0) {
    throw new Error(`Route manifest drift — refusing to start.\n\n  ${fatal.join('\n\n  ')}`);
  }

  return drift;
}

/** Mounts every declared binding onto an Express router. */
export function buildRouter(): Router {
  const router = Router();

  for (const binding of registeredBindings()) {
    const method = binding.method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete';
    router[method](binding.path, makeHandler(binding));
  }

  return router;
}

function makeHandler(binding: RouteBinding<never, unknown>) {
  const definition = REGISTRY[binding.action];

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = req.ctx;
      if (ctx === undefined) {
        // Step 1 of the pipeline runs in middleware. Reaching a handler without
        // it means the middleware was not mounted — fail closed, loudly.
        throw new Error(
          `No RequestContext on ${binding.method} ${binding.path}. ` +
            'requestContext middleware must run before the router.',
        );
      }

      /* ---- 2. Load the resource named by resourceParam ---- */
      // Skipped when the action names no resource, even if the path has a
      // parameter — `PUT /api/system/integrations/:key` addresses a config key,
      // not an object, so there is nothing to perform an object check against.
      let resource;
      if (
        definition.resource !== null &&
        binding.resourceParam !== undefined &&
        binding.loadResource !== undefined
      ) {
        const id = singleParam(req.params[binding.resourceParam]);
        if (id === undefined) throw new NotFoundError(definition.resource);
        const loaded = await binding.loadResource(ctx, id);
        // AZ-3 / CP-2 — a record outside the caller's reach is indistinguishable
        // from one that does not exist.
        if (loaded === null) throw new NotFoundError(definition.resource);
        resource = loaded;
      }

      /* ---- 3. Authorize. Steps 2–8 and 10 of the pipeline. ---- */
      await authorize(ctx, binding.action, resource);

      /* ---- 4. Handler. Business logic only (API-1). ---- */
      const result = await binding.handler({
        ctx,
        params: normaliseParams(req.params),
        query: req.query,
        body: req.body as never,
        resource,
        req,
        res,
      });

      if (res.headersSent) return;

      /* ---- 5. Project. Pipeline step 9, at the response boundary. ---- */
      // AZ-I4: "every response passes through it. A handler that assembles JSON
      // by hand bypasses field policy, so handlers return domain objects and
      // the framework serializes."
      const projected = await projectResult(ctx, binding.action, result);

      const status =
        binding.status ?? (binding.method === 'POST' ? HTTP_STATUS.CREATED : HTTP_STATUS.OK);
      res.status(status).json(success(projected, { requestId: ctx.requestId }));
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Express 5 types a route parameter as `string | string[]` because a wildcard
 * segment can repeat. Every binding in AUTHORIZATION.md §6.5 uses single
 * segments, so a repeated value means a crafted URL rather than a real route —
 * take the first and let the resource loader decide it does not exist.
 */
function singleParam(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function normaliseParams(
  params: Record<string, string | string[] | undefined>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const single = singleParam(value);
    if (single !== undefined) out[key] = single;
  }
  return out;
}

async function projectResult(
  ctx: RequestContext,
  action: Action,
  result: unknown,
): Promise<unknown> {
  if (result === null || result === undefined) return result;

  if (Array.isArray(result)) {
    return Promise.all(
      (result as unknown[]).map((item): unknown =>
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
