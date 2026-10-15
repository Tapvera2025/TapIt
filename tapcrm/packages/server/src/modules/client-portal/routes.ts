import { route } from '../../platform/http/route.js';
import { getDashboard, getProfile, getProject, getProjects } from './service.js';

/**
 * Client portal read API (PRD §12.3).
 *
 * These are `authOnly` because the action registry (generated from
 * AUTHORIZATION.md) has no client-portal actions yet. That is safe here, and
 * only here, because (a) the `client-portal` module entitlement is enforced
 * per organization, and (b) every handler obtains its client id exclusively
 * from `requireClientId` in service.ts, which rejects non-client principals,
 * and every query is filtered by it. When registry actions are added, move
 * these to `action:` bindings and keep the service-level guard as defence in depth.
 */
export function registerClientPortalRoutes(): void {
  const common = { authOnly: true, module: 'client-portal' } as const;

  route({ ...common, method: 'GET', path: '/api/client-portal/me', handler: async ({ ctx }) => getProfile(ctx) });
  route({ ...common, method: 'GET', path: '/api/client-portal/dashboard', handler: async ({ ctx }) => getDashboard(ctx) });
  route({ ...common, method: 'GET', path: '/api/client-portal/projects', handler: async ({ ctx }) => getProjects(ctx) });
  route({
    ...common,
    method: 'GET',
    path: '/api/client-portal/projects/:id',
    handler: async ({ ctx, params }) => getProject(ctx, params['id']!),
  });
}
