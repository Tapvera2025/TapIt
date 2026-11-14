import { route } from '../../../platform/http/route.js';
import * as service from './service.js';
import { forecastSchema, scenarioSchema, snapshotIdSchema } from './validators.js';

export function registerCashFlowRoutes(): void {
  route({ method: 'GET', path: '/api/cash-flow/command-centre', action: 'accounting:view-statements', module: 'accounting', handler: async ({ ctx, query }) => service.getCommandCentre(ctx, typeof query['baseCurrency'] === 'string' ? query['baseCurrency'] : 'INR') });
  route({ method: 'GET', path: '/api/cash-flow/snapshots', action: 'accounting:view-statements', module: 'accounting', handler: async ({ ctx }) => service.listSnapshots(ctx) });
  route({ method: 'GET', path: '/api/cash-flow/snapshots/:id/forecast', action: 'accounting:view-statements', module: 'accounting', handler: async ({ ctx, params }) => service.listForecast(ctx, snapshotIdSchema.parse(params).id) });
  route({ method: 'POST', path: '/api/cash-flow/forecast', action: 'accounting:manage-periods', module: 'accounting', status: 201, handler: async ({ ctx, body }) => service.createForecast(ctx, forecastSchema.parse(body)) });
  route({ method: 'GET', path: '/api/cash-flow/scenarios', action: 'accounting:view-statements', module: 'accounting', handler: async ({ ctx }) => service.listScenarios(ctx) });
  route({ method: 'GET', path: '/api/cash-flow/scenarios/:id/forecast', action: 'accounting:view-statements', module: 'accounting', handler: async ({ ctx, params }) => service.listScenarioForecast(ctx, snapshotIdSchema.parse(params).id) });
  route({ method: 'POST', path: '/api/cash-flow/scenarios', action: 'accounting:manage-periods', module: 'accounting', status: 201, handler: async ({ ctx, body }) => service.createScenario(ctx, scenarioSchema.parse(body)) });
}
