import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetRoutes, route } from './route.js';
import { checkManifest } from './router.js';

const handler = async () => null;

describe('route manifest validation', () => {
  beforeEach(() => __resetRoutes());
  afterEach(() => __resetRoutes());

  it('matches registered method, path, action, and resource metadata', () => {
    route({
      method: 'GET',
      path: '/api/users',
      action: 'users:view',
      handler,
    });

    const drift = checkManifest();
    expect(drift.routesWithoutBinding).toEqual([]);
    expect(drift.actionMismatches).toEqual([]);
    expect(drift.resourceMismatches).toEqual([]);
  });

  it('reports an action mismatch instead of silently accepting it', () => {
    route({
      method: 'GET',
      path: '/api/users',
      action: 'users:manage',
      handler,
    });

    expect(checkManifest().actionMismatches).toEqual([
      'GET /api/users: registered action users:manage, manifest action users:view',
    ]);
  });
});
