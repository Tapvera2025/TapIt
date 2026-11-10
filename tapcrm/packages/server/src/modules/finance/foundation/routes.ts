import { route } from '../../../platform/http/route.js';
import { getFinanceFoundation, updateFinanceFoundation } from './service.js';
import { getReconciliationSettings, updateReconciliationSettings } from './reconciliation.js';
import { updateFinanceFoundationSchema, updateReconciliationSettingsSchema } from './validators.js';

export function registerFinanceFoundationRoutes(): void {
  route({
    method: 'GET', path: '/api/finance/foundation', action: 'accounting:view-finance-settings', module: 'accounting',
    handler: async ({ ctx }) => getFinanceFoundation(ctx),
  });
  route({
    method: 'PATCH', path: '/api/finance/foundation', action: 'accounting:manage-finance-settings', module: 'accounting',
    handler: async ({ ctx, body }) => updateFinanceFoundation(ctx, updateFinanceFoundationSchema.parse(body)),
  });
  route({
    method: 'GET', path: '/api/finance/reconciliation-settings', action: 'accounting:view-finance-settings', module: 'accounting',
    handler: async ({ ctx }) => getReconciliationSettings(ctx),
  });
  route({
    method: 'PUT', path: '/api/finance/reconciliation-settings', action: 'accounting:manage-finance-settings', module: 'accounting',
    handler: async ({ ctx, body }) => updateReconciliationSettings(ctx, updateReconciliationSettingsSchema.parse(body)),
  });
}
