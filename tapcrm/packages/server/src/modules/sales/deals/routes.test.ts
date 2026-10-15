import { Router, type Request, type Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRoutes, registeredBindings } from '../../../platform/http/route.js';
import { registerDealRoutes } from './routes.js';

vi.mock('./service.js');
vi.mock('./won.js');

function matchedGetRoute(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const router = Router();
    // Use the same binding order as buildRouter, exercising Express matching
    // without invoking database services or opening a listening socket.
    for (const binding of registeredBindings()) {
      if (binding.method === 'GET') {
        router.get(binding.path, () => resolve(binding.path));
      }
    }
    router({ method: 'GET', url } as Request, {} as Response, (error?: unknown) => {
      reject(error instanceof Error ? error : new Error(`No GET route matched ${url}`));
    });
  });
}

describe('deal route matching', () => {
  beforeEach(() => {
    __resetRoutes();
    registerDealRoutes();
  });
  afterEach(() => __resetRoutes());

  it('dispatches the wins queue to its collection route rather than deal detail', async () => {
    await expect(matchedGetRoute('/api/deals/wins-to-record')).resolves.toBe('/api/deals/wins-to-record');
  });

  it('still dispatches a deal ID to the deal detail route', async () => {
    await expect(matchedGetRoute('/api/deals/00000000-0000-4000-8000-000000000001')).resolves.toBe('/api/deals/:id');
  });
});
