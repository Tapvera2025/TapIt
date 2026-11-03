import { route } from '../../../platform/http/route.js';
import { getFinanceFoundation, updateFinanceFoundation } from './service.js';
import { updateFinanceFoundationSchema } from './validators.js';

export function registerFinanceFoundationRoutes(): void {
  route({
    method: 'GET', path: '/api/finance/foundation', action: 'accounting:view-finance-settings', module: 'accounting',
    handler: async ({ ctx }) => getFinanceFoundation(ctx),
  });
  route({
    method: 'PATCH', path: '/api/finance/foundation', action: 'accounting:manage-finance-settings', module: 'accounting',
    handler: async ({ ctx, body }) => updateFinanceFoundation(ctx, updateFinanceFoundationSchema.parse(body)),
  });
}
