import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { createRequestContext } from '../../platform/dal/context.js';
import { resolvePrincipal } from '../identity/service.js';
import { getPreferences, savePreferences, preferencesInputSchema } from './service.js';

/**
 * Self-scoped preferences. Follows the same public-router pattern as
 * `/api/identity/sessions` and `/api/identity/me`: the caller is authenticated
 * via bearer token, the row is keyed to their own (organization_id, user_id),
 * and the widget catalog is validated server-side so a client cannot invent ids.
 */
export function registerDashboardRoutes(router: Router): void {
  router.get('/dashboard/preferences', async (req, res, next) => {
    try {
      const resolved = await resolvePrincipal(req);
      if (!resolved) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }
      const ctx = createRequestContext({
        organizationId: resolved.organizationId,
        principal: resolved.principal,
        requestId: randomUUID(),
      });
      const data = await getPreferences(ctx);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.put('/dashboard/preferences', async (req, res, next) => {
    try {
      const resolved = await resolvePrincipal(req);
      if (!resolved) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }
      const input = preferencesInputSchema.parse(req.body ?? {});
      const ctx = createRequestContext({
        organizationId: resolved.organizationId,
        principal: resolved.principal,
        requestId: randomUUID(),
      });
      const data = await savePreferences(ctx, input);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });
}
