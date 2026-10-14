import { z } from 'zod';
import { route } from '../../../platform/http/route.js';
import { PlatformValidationError } from '../../../platform/errors.js';
import { ingestLeadImport } from './service.js';

/**
 * Lead imports are a Super-Admin pilot tool. The handler is marked
 * `authOnly` because no registry Action for "import leads" exists yet;
 * the service enforces `accountType === 'super-admin'`. A follow-up
 * can promote the capability to a proper `imports:leads` action.
 *
 * The raw `text/csv` body parser is installed globally in `app.ts`
 * before `express.json`, so `req.body` arrives here as a Buffer.
 */

const importQuerySchema = z.object({
  connectorId: z.string().uuid(),
  dryRun: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => v === true || v === 'true')
    .default('true'),
  scopeToPoolId: z.string().uuid().optional(),
});

export function registerLeadImportRoutes(): void {
  route({
    method: 'POST',
    path: '/api/lead-imports',
    authOnly: true,
    module: 'leads',
    status: 202,
    handler: async ({ ctx, req }) => {
      const query = importQuerySchema.safeParse(req.query);
      if (!query.success) {
        throw new PlatformValidationError(query.error.issues.map((i) => i.message).join('; '));
      }
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      const csv = rawBody.toString('utf8');
      return ingestLeadImport(ctx, {
        csv,
        connectorId: query.data.connectorId,
        dryRun: query.data.dryRun,
        scopeToPoolId: query.data.scopeToPoolId ?? null,
      });
    },
  });
}
