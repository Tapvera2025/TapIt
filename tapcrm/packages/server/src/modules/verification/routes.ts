import { route } from '../../platform/http/route.js';
import { userResource } from '../identity/facade.js';
import {
  approveVerificationDocument,
  completeEmployeeVerification,
  getEmployeeVerification,
  getVerificationDocumentDownloadUrl,
  initializeEmployeeVerification,
  rejectEmployeeVerification,
  rejectVerificationDocument,
  uploadVerificationDocument,
} from './service.js';
import {
  rejectDocumentSchema,
  rejectVerificationSchema,
  uploadVerificationDocumentSchema,
} from './validators.js';

export function registerVerificationRoutes(): void {
  route({
    method: 'GET',
    path: '/api/users/:id/verification',
    action: 'users:view',
    module: 'employee-directory',
    resourceParam: 'id',
    loadResource: userResource,
    handler: async ({ ctx, params }) => getEmployeeVerification(ctx, params['id']!),
  });

  route({
    method: 'POST',
    path: '/api/users/:id/verification',
    action: 'users:manage',
    module: 'employee-directory',
    resourceParam: 'id',
    loadResource: userResource,
    status: 200,
    handler: async ({ ctx, params }) => initializeEmployeeVerification(ctx, params['id']!),
  });

  route({
    method: 'POST',
    path: '/api/users/:id/verification/documents',
    action: 'users:manage',
    module: 'employee-directory',
    resourceParam: 'id',
    loadResource: userResource,
    status: 201,
    handler: async ({ ctx, params, body }) =>
      uploadVerificationDocument(ctx, params['id']!, uploadVerificationDocumentSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/users/:id/verification/documents/:docId/download',
    action: 'users:view',
    module: 'employee-directory',
    resourceParam: 'id',
    loadResource: userResource,
    handler: async ({ ctx, params }) =>
      getVerificationDocumentDownloadUrl(ctx, params['id']!, params['docId']!),
  });

  route({
    method: 'POST',
    path: '/api/users/:id/verification/documents/:docId/approve',
    action: 'users:manage',
    module: 'employee-directory',
    resourceParam: 'id',
    loadResource: userResource,
    status: 200,
    handler: async ({ ctx, params }) =>
      approveVerificationDocument(ctx, params['id']!, params['docId']!),
  });

  route({
    method: 'POST',
    path: '/api/users/:id/verification/documents/:docId/reject',
    action: 'users:manage',
    module: 'employee-directory',
    resourceParam: 'id',
    loadResource: userResource,
    status: 200,
    handler: async ({ ctx, params, body }) =>
      rejectVerificationDocument(
        ctx,
        params['id']!,
        params['docId']!,
        rejectDocumentSchema.parse(body),
      ),
  });

  route({
    method: 'POST',
    path: '/api/users/:id/verification/complete',
    action: 'users:manage',
    module: 'employee-directory',
    resourceParam: 'id',
    loadResource: userResource,
    status: 200,
    handler: async ({ ctx, params }) => completeEmployeeVerification(ctx, params['id']!),
  });

  route({
    method: 'POST',
    path: '/api/users/:id/verification/reject',
    action: 'users:manage',
    module: 'employee-directory',
    resourceParam: 'id',
    loadResource: userResource,
    status: 200,
    handler: async ({ ctx, params, body }) =>
      rejectEmployeeVerification(
        ctx,
        params['id']!,
        rejectVerificationSchema.parse(body),
      ),
  });
}
