import { route } from '../../platform/http/route.js';
import { userResource } from '../identity/facade.js';
import { provisionEmployee, updateEmployee, adminResetPassword } from './service.js';
import { createEmployeeSchema, updateEmployeeSchema, resetPasswordSchema } from './validators.js';
import { getOrganizationChart, listReportingManagerOptions } from '../organization/facade.js';
import { z } from 'zod';

export function registerEmployeeRoutes(): void {
  route({
    method: 'GET',
    path: '/api/users',
    action: 'users:view',
    module: 'employee-directory',
    handler: async ({ ctx, query }) => {
      if (query['departmentId'] !== undefined && query['positionId'] !== undefined) {
        return listReportingManagerOptions(
          ctx,
          z.string().uuid().parse(query['departmentId']),
          z.string().uuid().parse(query['positionId']),
          query['subjectUserId'] === undefined
            ? null
            : z.string().uuid().parse(query['subjectUserId']),
          query['teamId'] === undefined ? null : z.string().uuid().parse(query['teamId']),
        );
      }
      // The employee directory is authorized by users:view. The organization
      // chart keeps its separate org:view-people visibility contract, while
      // this directory must honor HR's all-people employee-directory policy.
      return (await getOrganizationChart(ctx, 'users:view')).people;
    },
  });
  route({
    method: 'POST',
    path: '/api/users',
    action: 'users:manage',
    module: 'employee-directory',
    status: 201,
    handler: async ({ ctx, body }) =>
      provisionEmployee(ctx, createEmployeeSchema.parse(body)),
  });
  route({
    method: 'PATCH',
    path: '/api/users/:id',
    action: 'users:manage',
    module: 'employee-directory',
    resourceParam: 'id',
    loadResource: userResource,
    handler: async ({ ctx, params, body }) =>
      updateEmployee(ctx, params['id']!, updateEmployeeSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/users/:id/reset-password',
    action: 'users:manage',
    module: 'employee-directory',
    resourceParam: 'id',
    loadResource: userResource,
    handler: async ({ ctx, params, body }) => {
      const { password } = resetPasswordSchema.parse(body);
      return adminResetPassword(ctx, params['id']!, password);
    },
  });
}
