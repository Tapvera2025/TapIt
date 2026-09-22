import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetRoutes } from '../../platform/http/route.js';
import { checkManifest } from '../../platform/http/router.js';
import { registerTasksRoutes } from './routes.js';

describe('Task routes manifest alignment', () => {
  beforeEach(() => __resetRoutes());
  afterEach(() => __resetRoutes());

  it('registers the 6 core task routes without any manifest mismatch or unknown routes', () => {
    registerTasksRoutes();

    const drift = checkManifest();
    // No route should be unregistered in the manifest
    expect(drift.routesWithoutBinding).toEqual([]);
    // Action metadata must match the manifest
    expect(drift.actionMismatches).toEqual([]);
    // Resource parameter metadata must match the manifest
    expect(drift.resourceMismatches).toEqual([]);
    // No duplicate route definitions
    expect(drift.duplicateRoutes).toEqual([]);
  });
});
