import type { Request, Response } from 'express';

import type { Action, HttpMethod } from '@tapcrm/contracts';

import { REGISTRY } from '@tapcrm/contracts';

import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../dal/context.js';

export interface HandlerArgs<TBody = unknown> {
  readonly ctx: RequestContext;

  readonly params: Readonly<Record<string, string>>;

  readonly query: Readonly<Record<string, unknown>>;

  readonly body: TBody;

  readonly resource: Resource | undefined;

  readonly req: Request;
  readonly res: Response;
}

export type Handler<TBody = unknown, TResult = unknown> = (
  args: HandlerArgs<TBody>,
) => Promise<TResult>;

export type ResourceLoader = (
  ctx: RequestContext,
  id: string,
) => Promise<Resource | null>;

export interface RouteBinding<TBody = unknown, TResult = unknown> {
  readonly method: HttpMethod;
  readonly path: string;

  /**
   * Business authorization action.
   *
   * Required for normal protected routes.
   * Not used by authentication routes.
   */
  readonly action?: Action;

  /** Path parameter holding the resource id, e.g. `id` for `/api/deals/:id`. */
  readonly resourceParam?: string;

  /**
   * Body field holding the resource id, for the routes where the object being
   * acted on is named in the payload rather than the path.
   *
   * `POST /api/access/override` is the case: the manifest fixes the path, and
   * the target is `body.userId`. Reading it here keeps the object-level check
   * in the framework, where AZ-1 wants it, instead of leaving it to the service
   * to remember.
   */
  readonly resourceBodyField?: string;

  readonly loadResource?: ResourceLoader;

  readonly handler: Handler<TBody, TResult>;

  readonly status?: number;

  /**
   * A COLLECTION route: it operates on a set, not on one object.
   *
   * AZ-1 requires an object-level check on every endpoint operating on an
   * object; AZ-2 requires a collection endpoint to build its filter from the
   * scope BEFORE querying. Those are different obligations, and the binding has
   * to say which one it carries — from the outside a list route and an object
   * route with a forgotten loader look identical, and the failure mode of
   * guessing is that the second one gets endpoint-level authorization only and
   * nobody finds out.
   *
   * Declaring this is a promise that the handler calls `visibilityFilter` and
   * puts the result in its WHERE clause. It is not a way to skip the check.
   */
  readonly collection?: boolean;

  /**
   * A CREATE route: the resource does not exist yet, so there is nothing to
   * check against.
   *
   * Authorization here is the action alone — may this principal create one of
   * these at all — and the handler carries the second half: the new record must
   * land inside the caller's scope. A Sales Team Lead who may create a team
   * creates it in their own department, not in Development.
   *
   * Named rather than inferred from the HTTP verb, because plenty of POSTs act
   * on an existing object (`/deals/:id/approve`) and inferring would quietly
   * exempt them.
   */
  readonly creates?: boolean;

  /**
   * Public endpoint.
   *
   * No RequestContext exists.
   */
  readonly public?: boolean;

  /**
   * Authenticated endpoint that does not represent
   * a business authorization capability.
   *
   * Examples:
   *   /api/auth/me
   *   /api/auth/logout
   */
  readonly authOnly?: boolean;
}

const bindings: RouteBinding<never, unknown>[] = [];

export function route<TBody, TResult>(binding: RouteBinding<TBody, TResult>): void {
  if (binding.public === true && binding.authOnly === true) {
    throw new Error(
      `Route ${binding.method} ${binding.path} cannot be both public and authOnly.`,
    );
  }

  if (binding.public === true || binding.authOnly === true) {
    if (binding.action !== undefined) {
      throw new Error(
        `Route ${binding.method} ${binding.path} must not declare an authorization action.`,
      );
    }
  } else if (binding.action === undefined) {
    throw new Error(
      `Protected route ${binding.method} ${binding.path} must declare an action.`,
    );
  }

  if (binding.action !== undefined) {
    const definition = REGISTRY[binding.action];
    const at = `${binding.method} ${binding.path}`;

    const namesObject =
      binding.resourceParam !== undefined || binding.resourceBodyField !== undefined;

    if (binding.resourceParam !== undefined && !binding.path.includes(`:${binding.resourceParam}`)) {
      throw new Error(
        `Route ${at} declares resourceParam "${binding.resourceParam}" which is not a ` +
          'parameter of its path.',
      );
    }

    if (binding.resourceParam !== undefined && binding.resourceBodyField !== undefined) {
      throw new Error(
        `Route ${at} declares both resourceParam and resourceBodyField. The object comes ` +
          'from one place or the other.',
      );
    }

    if (namesObject && binding.loadResource === undefined) {
      throw new Error(
        `Route ${at} names a resource but declares no loadResource. Without a loader the ` +
          'framework has no object to check, so authorization silently degrades to the ' +
          'endpoint level (AZ-1).',
      );
    }

    if (namesObject && (binding.collection === true || binding.creates === true)) {
      throw new Error(
        `Route ${at} names a specific object and is also declared as a collection or a ` +
          'create. It is one of the three, not two.',
      );
    }

    if (binding.collection === true && binding.creates === true) {
      throw new Error(`Route ${at} cannot be both a collection and a create.`);
    }

    /*
     * RM-14 / API-4 / CI-6 — "A binding whose action names a resource must
     * declare resourceParam, asserted at boot."
     *
     * This is the assertion. The previous version only validated a
     * `resourceParam` that was already present, so omitting it entirely was
     * silently accepted — and 21 of 40 protected routes had done exactly that,
     * every one of them running with no object-level check. A route that
     * genuinely operates on a set says so with `collection: true`, which is a
     * claim a reviewer can check rather than an absence nobody notices.
     */
    if (
      definition.resource !== null &&
      !namesObject &&
      binding.collection !== true &&
      binding.creates !== true
    ) {
      throw new Error(
        `Route ${at} uses action "${binding.action}", which names resource ` +
          `"${definition.resource}", but does not say what it operates on.\n\n` +
          '  · One object?  add resourceParam (or resourceBodyField) and loadResource, so the ' +
          'framework runs the object-level check (AZ-1, SE-3).\n' +
          '  · A set?       add collection: true, and build the query filter from ' +
          'visibilityFilter() before querying (AZ-2).\n' +
          '  · A new one?   add creates: true, and validate in the handler that the new record ' +
          "lands inside the caller's scope.",
      );
    }
  }

  bindings.push(binding);
}

export function registeredBindings(): readonly RouteBinding<never, unknown>[] {
  return bindings;
}

export function __resetRoutes(): void {
  bindings.length = 0;
}
