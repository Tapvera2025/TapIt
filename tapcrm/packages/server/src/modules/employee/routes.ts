import { route } from '../../platform/http/route.js';
import { provisionEmployee } from './service.js';
import { createEmployeeSchema } from './validators.js';

export function registerEmployeeRoutes(): void {
  route({
    method: 'POST',
    path: '/api/users',
    action: 'users:manage',
    module: 'employee-directory',
    status: 201,
    handler: async ({ ctx, body }) => provisionEmployee(ctx, createEmployeeSchema.parse(body)),
  });
}
