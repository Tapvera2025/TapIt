import { describe, expect, it } from 'vitest';
import { REGISTRY, type Action } from '@tapcrm/contracts';
import { registeredBindings, type RouteBinding } from '../route.js';
import { registerAllRoutes } from '../../../modules/index.js';

/**
 * Every protected route says what it operates on — AZ-1, AZ-2, RM-14, CI-6.
 *
 * `route()` already refuses a binding that does not, at registration time. This
 * test exists because that assertion only fires when something imports the
 * route modules, and the thing that normally does is the server starting up —
 * which CI does not do. Here the assertion runs in the ordinary test pass, with
 * no database and no configuration, so a route added without a loader fails in
 * seconds rather than at deploy.
 *
 * The failure this guards against is quiet by nature: a binding whose action
 * names a resource but which loads no resource still authorizes, still returns
 * 200, and still looks correct in every manual test. It has simply stopped
 * asking whether the caller may touch THAT record.
 */

registerAllRoutes();

const protectedRoutes = registeredBindings().filter(
  (binding): binding is RouteBinding<never, unknown> & { action: Action } =>
    binding.public !== true && binding.authOnly !== true && binding.action !== undefined,
);

const label = (binding: { method: string; path: string }): string =>
  `${binding.method} ${binding.path}`;

describe('route shape', () => {
  it('registers at least one protected route', () => {
    expect(protectedRoutes.length).toBeGreaterThan(0);
  });

  it('AZ-1 — every resource-bearing route declares object, collection or create', () => {
    const undeclared = protectedRoutes
      .filter((binding) => REGISTRY[binding.action].resource !== null)
      .filter(
        (binding) =>
          binding.resourceParam === undefined &&
          binding.resourceBodyField === undefined &&
          binding.collection !== true &&
          binding.creates !== true,
      )
      .map(label);

    expect(undeclared).toEqual([]);
  });

  it('AZ-1 — every route naming an object can actually load it', () => {
    const missingLoader = protectedRoutes
      .filter(
        (binding) =>
          binding.resourceParam !== undefined || binding.resourceBodyField !== undefined,
      )
      .filter((binding) => binding.loadResource === undefined)
      .map(label);

    expect(missingLoader).toEqual([]);
  });

  it('a route is exactly one of object, collection or create', () => {
    const ambiguous = protectedRoutes
      .filter((binding) => {
        const kinds = [
          binding.resourceParam !== undefined || binding.resourceBodyField !== undefined,
          binding.collection === true,
          binding.creates === true,
        ].filter(Boolean);
        return kinds.length > 1;
      })
      .map(label);

    expect(ambiguous).toEqual([]);
  });

  it('every declared resourceParam is a real path parameter', () => {
    const dangling = protectedRoutes
      .filter(
        (binding) =>
          binding.resourceParam !== undefined &&
          !binding.path.includes(`:${binding.resourceParam}`),
      )
      .map(label);

    expect(dangling).toEqual([]);
  });

  it('RM-2 — no route is registered twice', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const binding of protectedRoutes) {
      const key = label(binding);
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    }
    expect(duplicates).toEqual([]);
  });
});
