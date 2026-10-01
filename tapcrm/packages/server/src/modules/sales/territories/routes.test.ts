import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetRoutes } from '../../../platform/http/route.js';
import { checkManifest } from '../../../platform/http/router.js';
import { registerTerritoryRoutes } from './routes.js';

describe('territory routes', () => {
  beforeEach(() => __resetRoutes());
  afterEach(() => __resetRoutes());
  it('matches the authorization manifest', () => {
    registerTerritoryRoutes();
    const drift = checkManifest();
    expect(drift.routesWithoutBinding).toEqual([]);
    expect(drift.actionMismatches).toEqual([]);
    expect(drift.resourceMismatches).toEqual([]);
    expect(drift.duplicateRoutes).toEqual([]);
  });
});
