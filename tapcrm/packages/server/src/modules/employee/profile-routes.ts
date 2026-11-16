import { z } from 'zod';
import { route } from '../../platform/http/route.js';
import { userResource } from '../identity/facade.js';
import {
  downloadMyDocument,
  getEmployeeProfileDetails,
  getMyProfile,
  removeMyDocument,
  updateMyExperience,
  updateMyPersonalDetails,
  updateMyQualifications,
  updateMySkills,
  uploadMyDocument,
} from './profile.js';
import {
  experienceSchema,
  ownDocumentUploadSchema,
  personalDetailsSchema,
  qualificationsSchema,
  skillsSchema,
} from './profile-validators.js';

const documentId = z.string().uuid();

/**
 * The employee's own profile. Every route acts on the signed-in person only —
 * there is no id in the path to point elsewhere — so, like My Todo and My
 * Notepad, they need a session but no position policy (`authOnly`). The
 * service refuses accounts that are not employees.
 */
export function registerEmployeeProfileRoutes(): void {
  route({
    method: 'GET',
    path: '/api/my-profile',
    authOnly: true,
    module: 'employee-directory',
    handler: async ({ ctx }) => getMyProfile(ctx),
  });
  route({
    method: 'PUT',
    path: '/api/my-profile/personal',
    authOnly: true,
    module: 'employee-directory',
    handler: async ({ ctx, body }) => updateMyPersonalDetails(ctx, personalDetailsSchema.parse(body)),
  });
  route({
    method: 'PUT',
    path: '/api/my-profile/education',
    authOnly: true,
    module: 'employee-directory',
    handler: async ({ ctx, body }) => updateMyQualifications(ctx, qualificationsSchema.parse(body)),
  });
  route({
    method: 'PUT',
    path: '/api/my-profile/experience',
    authOnly: true,
    module: 'employee-directory',
    handler: async ({ ctx, body }) => updateMyExperience(ctx, experienceSchema.parse(body)),
  });
  route({
    method: 'PUT',
    path: '/api/my-profile/skills',
    authOnly: true,
    module: 'employee-directory',
    handler: async ({ ctx, body }) => updateMySkills(ctx, skillsSchema.parse(body)),
  });
  route({
    method: 'POST',
    path: '/api/my-profile/documents',
    authOnly: true,
    module: 'employee-directory',
    status: 201,
    handler: async ({ ctx, body }) => uploadMyDocument(ctx, ownDocumentUploadSchema.parse(body)),
  });
  route({
    method: 'DELETE',
    path: '/api/my-profile/documents/:docId',
    authOnly: true,
    module: 'employee-directory',
    handler: async ({ ctx, params }) => removeMyDocument(ctx, documentId.parse(params['docId'])),
  });
  route({
    method: 'GET',
    path: '/api/my-profile/documents/:docId/download',
    authOnly: true,
    module: 'employee-directory',
    handler: async ({ ctx, params }) => downloadMyDocument(ctx, documentId.parse(params['docId'])),
  });

  // HR's read of an employee's completed profile: personal details and
  // documents, so it needs the manage power, not just directory view.
  route({
    method: 'GET',
    path: '/api/users/:id/profile-details',
    action: 'users:manage',
    module: 'employee-directory',
    resourceParam: 'id',
    loadResource: userResource,
    handler: async ({ ctx, params }) => getEmployeeProfileDetails(ctx, params['id']!),
  });
}
