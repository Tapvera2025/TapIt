import type { Request, Response } from 'express';
import type { Action, HttpMethod } from '@tapcrm/contracts';
import { REGISTRY } from '@tapcrm/contracts';
import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../dal/context.js';

/**
 * Route binding — TECH.md §8.3, AUTHORIZATION.md RM-1..RM-8.
 *
 *   "Routes declare metadata; they do not implement authorization."
 *
 * API-1: "A handler that calls `authorize` itself is a code smell and fails
 * review. The framework already did. Handlers do business logic."
 *
 * NF-21 is the reason this indirection exists at all: "One screen may exercise
 * a dozen actions, and one URL family may carry four different capabilities by
 * method, so AUTHORIZATION CANNOT BE DERIVED FROM A PATH."
 */

export interface HandlerArgs<TBody = unknown> {
  readonly ctx: RequestContext;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly body: TBody;
  /** The resource the framework already loaded and authorized. */
  readonly resource: Resource | undefined;
  readonly req: Request;
  readonly res: Response;
}

export type Handler<TBody = unknown, TResult = unknown> = (
  args: HandlerArgs<TBody>,
) => Promise<TResult>;

/** Loads the object named by `resourceParam`, for the framework's step-7 check. */
export type ResourceLoader = (
  ctx: RequestContext,
  id: string,
) => Promise<Resource | null>;

export interface RouteBinding<TBody = unknown, TResult = unknown> {
  readonly method: HttpMethod;
  readonly path: string;
  /**
   * API-3 — typed as the generated union, so a binding naming an action outside
   * the registry is a COMPILE error, not a runtime deny (RG-I2).
   */
  readonly action: Action;
  /** RM-14 / API-4 — mandatory when the action names a resource. */
  readonly resourceParam?: string;
  readonly loadResource?: ResourceLoader;
  readonly handler: Handler<TBody, TResult>;
  /** Success status. Defaults to 200, or 201 for POST. */
  readonly status?: number;
  /** Routes that must work before authentication (login, health). */
  readonly public?: boolean;
}

const bindings: RouteBinding<never, unknown>[] = [];

/**
 * Declares a route. The only way to register one — `app.get()` / `app.post()`
 * are not used for product routes (TECH.md §2.3), and CI-4 asserts that every
 * registered Express route came through here.
 */
export function route<TBody, TResult>(binding: RouteBinding<TBody, TResult>): void {
  const definition = REGISTRY[binding.action];

  // API-4 / RM-14, asserted at DECLARATION time rather than at boot, so the
  // stack trace points at the offending route.
  if (definition.resource !== null && binding.resourceParam !== undefined) {
    if (!binding.path.includes(`:${binding.resourceParam}`)) {
      throw new Error(
        `Route ${binding.method} ${binding.path} declares resourceParam ` +
          `"${binding.resourceParam}" which is not a parameter of its path.`,
      );
    }
    if (binding.loadResource === undefined) {
      throw new Error(
        `Route ${binding.method} ${binding.path} declares resourceParam but no ` +
          'loadResource. Without a loader the framework cannot perform the ' +
          'object-level check required by AZ-1, and an endpoint-level check alone ' +
          'is insufficient (SE-3).',
      );
    }
  }

  bindings.push(binding);
}

export function registeredBindings(): readonly RouteBinding<never, unknown>[] {
  return bindings;
}

/** Test-only. */
export function __resetRoutes(): void {
  bindings.length = 0;
}
