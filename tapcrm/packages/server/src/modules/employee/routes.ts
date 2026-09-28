import { route } from '../../platform/http/route.js';
import { provisionEmployee } from './service.js';
import { createEmployeeSchema } from './validators.js';
import { getOrganizationChart } from '../organization/chart/service.js';
import { listReportingManagerOptions } from '../organization/reporting/service.js';
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
}
