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

  readonly resourceParam?: string;

  readonly loadResource?: ResourceLoader;

  readonly handler: Handler<TBody, TResult>;

  readonly status?: number;

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

    if (definition.resource !== null && binding.resourceParam !== undefined) {
      if (!binding.path.includes(`:${binding.resourceParam}`)) {
        throw new Error(
          `Route ${binding.method} ${binding.path} declares resourceParam "${binding.resourceParam}" which is not a parameter of its path.`,
        );
      }

      if (binding.loadResource === undefined) {
        throw new Error(
          `Route ${binding.method} ${binding.path} declares resourceParam but no loadResource.`,
        );
      }
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
