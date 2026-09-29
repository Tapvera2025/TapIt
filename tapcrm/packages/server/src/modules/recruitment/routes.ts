import { route } from '../../platform/http/route.js';
import { z } from 'zod';
import * as service from './service.js';
import {
  convertSubmissionSchema,
  createApplicationLinkSchema,
  createCandidateSchema,
  createJoiningSchema,
  createOfferSchema,
  createRequisitionSchema,
  hireCandidateSchema,
  hrManualSubmissionSchema,
  interviewDecisionSchema,
  rescheduleInterviewSchema,
  scheduleInterviewSchema,
  submitFeedbackSchema,
  updateFeedbackSchema,
  updateApplicationLinkStatusSchema,
  updateCandidateScreeningSchema,
  updateCandidateStatusSchema,
  updateInterviewStatusSchema,
  updateJoiningSchema,
  updateJoiningStatusSchema,
  updateOfferSchema,
  updateOfferStatusSchema,
  updateRequisitionStatusSchema,
  updateSubmissionStatusSchema,
  uploadCandidateResumeSchema,
  parseCandidateResumeSchema,
} from './validators.js';

const idSchema = z.string().uuid();

/**
 * Recruitment HTTP route definitions.
 *
 * Route bindings declare action, path, parameters, and resource loader.
 * Authorization is evaluated by the platform router BEFORE handler invocation.
 *
 * Pipeline (TECH.md §8.3):
 *   Request → requestContext → module-entitlement → loadResource
 *     → authorize(ctx, action, resource) → handler → project → Response
 *
 * Handlers do NOT call authorize() directly (API-1).
 */
export function registerRecruitmentRoutes(): void {
  // -----------------------------------------------------------------
  // 0. Metrics — no resource
  // -----------------------------------------------------------------
  route({
    method: 'GET',
    path: '/api/recruitment/metrics',
    action: 'recruitment:view-metrics',
    module: 'recruitment',
    handler: async ({ ctx }) => service.getRecruitmentMetrics(ctx),
  });

  // -----------------------------------------------------------------
  // 1. Requisitions
  // -----------------------------------------------------------------
  route({
    method: 'GET',
    path: '/api/recruitment/requisitions',
    action: 'recruitment:view-requisitions',
    module: 'recruitment',
    handler: async ({ ctx, query }) => {
      const filter = {
        search: typeof query['search'] === 'string' ? query['search'] : undefined,
        status: typeof query['status'] === 'string' ? query['status'] : undefined,
        departmentId: typeof query['departmentId'] === 'string' ? query['departmentId'] : undefined,
        employmentType: typeof query['employmentType'] === 'string' ? query['employmentType'] : undefined,
      };
      return service.listRequisitions(ctx, filter);
    },
  });

  route({
    method: 'POST',
    path: '/api/recruitment/requisitions',
    action: 'recruitment:manage-requisitions',
    module: 'recruitment',
    status: 201,
    handler: async ({ ctx, body }) =>
      service.createRequisition(ctx, createRequisitionSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/recruitment/requisitions/:id',
    action: 'recruitment:view-requisitions',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadRequisitionResource,
    handler: async ({ ctx, params }) =>
      service.getRequisition(ctx, idSchema.parse(params['id'])),
  });

  route({
    method: 'PATCH',
    path: '/api/recruitment/requisitions/:id/status',
    action: 'recruitment:manage-requisitions',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadRequisitionResource,
    handler: async ({ ctx, params, body }) => {
      const { status } = updateRequisitionStatusSchema.parse(body);
      return service.updateRequisitionStatus(ctx, idSchema.parse(params['id']), status);
    },
  });

  // -----------------------------------------------------------------
  // 2. Candidates — static paths before parameterised paths
  // -----------------------------------------------------------------
  route({
    method: 'GET',
    path: '/api/recruitment/candidates',
    action: 'recruitment:view-candidates',
    module: 'recruitment',
    handler: async ({ ctx, query }) => {
      const filter = {
        search: typeof query['search'] === 'string' ? query['search'] : undefined,
        status: typeof query['status'] === 'string' ? query['status'] : undefined,
        requisitionId: typeof query['requisitionId'] === 'string' ? query['requisitionId'] : undefined,
        source: typeof query['source'] === 'string' ? query['source'] : undefined,
      };
      return service.listCandidates(ctx, filter);
    },
  });

  route({
    method: 'POST',
    path: '/api/recruitment/candidates/resume/upload',
    action: 'recruitment:manage-candidates',
    module: 'recruitment',
    status: 201,
    handler: async ({ ctx, body }) =>
      service.uploadCandidateResume(ctx, uploadCandidateResumeSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/recruitment/candidates/resume/parse',
    action: 'recruitment:manage-candidates',
    module: 'recruitment',
    handler: async ({ ctx, body }) =>
      service.parseCandidateResume(ctx, parseCandidateResumeSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/recruitment/candidates/resume/preview',
    action: 'recruitment:view-candidates',
    module: 'recruitment',
    handler: async ({ ctx, query, res }) => {
      const key = typeof query['key'] === 'string' ? query['key'] : '';
      const { buffer, mimeType, filename } = await service.getResumePreviewFile(ctx, key);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Length', buffer.length);
      res.status(200).end(buffer);
      return null; // framework checks res.headersSent before sending JSON
    },
  });

  route({
    method: 'POST',
    path: '/api/recruitment/candidates',
    action: 'recruitment:manage-candidates',
    module: 'recruitment',
    status: 201,
    handler: async ({ ctx, body }) =>
      service.createCandidate(ctx, createCandidateSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/recruitment/candidates/:id/resume',
    action: 'recruitment:view-candidates',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadCandidateResource,
    handler: async ({ ctx, params, res }) => {
      const { buffer, mimeType, filename } = await service.getCandidateResumeFile(
        ctx,
        idSchema.parse(params['id']),
      );
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Length', buffer.length);
      res.status(200).end(buffer);
      return null;
    },
  });

  route({
    method: 'GET',
    path: '/api/recruitment/candidates/:id',
    action: 'recruitment:view-candidates',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadCandidateResource,
    handler: async ({ ctx, params }) =>
      service.getCandidate(ctx, idSchema.parse(params['id'])),
  });

  route({
    method: 'PATCH',
    path: '/api/recruitment/candidates/:id/status',
    action: 'recruitment:manage-candidates',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadCandidateResource,
    handler: async ({ ctx, params, body }) =>
      service.updateCandidateStatus(
        ctx,
        idSchema.parse(params['id']),
        updateCandidateStatusSchema.parse(body),
      ),
  });

  route({
    method: 'PATCH',
    path: '/api/recruitment/candidates/:id/screening',
    action: 'recruitment:manage-candidates',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadCandidateResource,
    handler: async ({ ctx, params, body }) => {
      const { screeningNotes } = updateCandidateScreeningSchema.parse(body);
      return service.updateCandidateScreening(ctx, idSchema.parse(params['id']), screeningNotes);
    },
  });

  route({
    method: 'POST',
    path: '/api/recruitment/candidates/:id/hire',
    action: 'recruitment:manage-candidates',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadCandidateResource,
    handler: async ({ ctx, params, body }) =>
      service.hireCandidateAsEmployee(
        ctx,
        idSchema.parse(params['id']),
        hireCandidateSchema.parse(body),
      ),
  });

  // -----------------------------------------------------------------
  // 3. Interviews
  // -----------------------------------------------------------------
  route({
    method: 'GET',
    path: '/api/recruitment/interviews',
    action: 'recruitment:view-interviews',
    module: 'recruitment',
    handler: async ({ ctx, query }) => {
      const filter = {
        candidateId: typeof query['candidateId'] === 'string' ? query['candidateId'] : undefined,
        requisitionId: typeof query['requisitionId'] === 'string' ? query['requisitionId'] : undefined,
        status: typeof query['status'] === 'string' ? query['status'] : undefined,
        stage: typeof query['stage'] === 'string' ? query['stage'] : undefined,
      };
      return service.listInterviews(ctx, filter);
    },
  });

  route({
    method: 'POST',
    path: '/api/recruitment/interviews',
    action: 'recruitment:manage-interviews',
    module: 'recruitment',
    status: 201,
    handler: async ({ ctx, body }) =>
      service.scheduleInterview(ctx, scheduleInterviewSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/recruitment/interviews/:id',
    action: 'recruitment:view-interviews',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadInterviewResource,
    handler: async ({ ctx, params }) =>
      service.getInterview(ctx, idSchema.parse(params['id'])),
  });

  route({
    method: 'PATCH',
    path: '/api/recruitment/interviews/:id/status',
    action: 'recruitment:manage-interviews',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadInterviewResource,
    handler: async ({ ctx, params, body }) => {
      const { status } = updateInterviewStatusSchema.parse(body);
      return service.updateInterviewStatus(ctx, idSchema.parse(params['id']), status);
    },
  });

  route({
    method: 'POST',
    path: '/api/recruitment/interviews/:id/feedback',
    action: 'recruitment:manage-interviews',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadInterviewResource,
    handler: async ({ ctx, params, body }) =>
      service.submitInterviewFeedback(
        ctx,
        idSchema.parse(params['id']),
        submitFeedbackSchema.parse(body),
      ),
  });

  route({
    method: 'PATCH',
    path: '/api/recruitment/interviews/:id/feedback/:feedbackId',
    action: 'recruitment:manage-interviews',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadInterviewResource,
    handler: async ({ ctx, params, body }) =>
      service.updateInterviewFeedback(
        ctx,
        idSchema.parse(params['feedbackId']),
        updateFeedbackSchema.parse(body),
      ),
  });

  route({
    method: 'PATCH',
    path: '/api/recruitment/interview-feedback/:id',
    action: 'recruitment:manage-interviews',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadInterviewFeedbackAsInterviewResource,
    handler: async ({ ctx, params, body }) =>
      service.updateInterviewFeedback(
        ctx,
        idSchema.parse(params['id']),
        updateFeedbackSchema.parse(body),
      ),
  });

  route({
    method: 'POST',
    path: '/api/recruitment/interviews/:id/reschedule',
    action: 'recruitment:manage-interviews',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadInterviewResource,
    handler: async ({ ctx, params, body }) =>
      service.rescheduleInterview(
        ctx,
        idSchema.parse(params['id']),
        rescheduleInterviewSchema.parse(body),
      ),
  });

  route({
    method: 'POST',
    path: '/api/recruitment/interviews/:id/decision',
    action: 'recruitment:manage-interviews',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadInterviewResource,
    handler: async ({ ctx, params, body }) =>
      service.recordInterviewDecision(
        ctx,
        idSchema.parse(params['id']),
        interviewDecisionSchema.parse(body),
      ),
  });

  // -----------------------------------------------------------------
  // 4. Offers
  // -----------------------------------------------------------------
  route({
    method: 'GET',
    path: '/api/recruitment/offers',
    action: 'recruitment:view-offers',
    module: 'recruitment',
    handler: async ({ ctx, query }) => {
      const filter = {
        candidateId: typeof query['candidateId'] === 'string' ? query['candidateId'] : undefined,
        status: typeof query['status'] === 'string' ? query['status'] : undefined,
      };
      return service.listOffers(ctx, filter);
    },
  });

  route({
    method: 'POST',
    path: '/api/recruitment/offers',
    action: 'recruitment:manage-offers',
    module: 'recruitment',
    status: 201,
    handler: async ({ ctx, body }) =>
      service.createOffer(ctx, createOfferSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/recruitment/offers/:id',
    action: 'recruitment:view-offers',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadOfferResource,
    handler: async ({ ctx, params }) =>
      service.getOffer(ctx, idSchema.parse(params['id'])),
  });

  route({
    method: 'PATCH',
    path: '/api/recruitment/offers/:id',
    action: 'recruitment:manage-offers',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadOfferResource,
    handler: async ({ ctx, params, body }) =>
      service.updateOffer(ctx, idSchema.parse(params['id']), updateOfferSchema.parse(body)),
  });

  route({
    method: 'PATCH',
    path: '/api/recruitment/offers/:id/status',
    action: 'recruitment:manage-offers',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadOfferResource,
    handler: async ({ ctx, params, body }) => {
      const { status } = updateOfferStatusSchema.parse(body);
      return service.updateOfferStatus(ctx, idSchema.parse(params['id']), status);
    },
  });

  // -----------------------------------------------------------------
  // 5. Joining
  // -----------------------------------------------------------------
  route({
    method: 'GET',
    path: '/api/recruitment/joining',
    action: 'recruitment:view-joining',
    module: 'recruitment',
    handler: async ({ ctx, query }) =>
      service.listJoinings(ctx, {
        status: typeof query['status'] === 'string' ? query['status'] : undefined,
      }),
  });

  route({
    method: 'GET',
    path: '/api/recruitment/joinings',
    action: 'recruitment:view-joining',
    module: 'recruitment',
    handler: async ({ ctx, query }) =>
      service.listJoinings(ctx, {
        status: typeof query['status'] === 'string' ? query['status'] : undefined,
      }),
  });

  route({
    method: 'POST',
    path: '/api/recruitment/joining',
    action: 'recruitment:manage-joining',
    module: 'recruitment',
    status: 201,
    handler: async ({ ctx, body }) =>
      service.createJoining(ctx, createJoiningSchema.parse(body)),
  });

  route({
    method: 'POST',
    path: '/api/recruitment/joinings',
    action: 'recruitment:manage-joining',
    module: 'recruitment',
    status: 201,
    handler: async ({ ctx, body }) =>
      service.createJoining(ctx, createJoiningSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/recruitment/joining/:id',
    action: 'recruitment:view-joining',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadJoiningResource,
    handler: async ({ ctx, params }) =>
      service.getJoining(ctx, idSchema.parse(params['id'])),
  });

  route({
    method: 'GET',
    path: '/api/recruitment/joinings/:id',
    action: 'recruitment:view-joining',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadJoiningResource,
    handler: async ({ ctx, params }) =>
      service.getJoining(ctx, idSchema.parse(params['id'])),
  });

  route({
    method: 'PATCH',
    path: '/api/recruitment/joining/:id/status',
    action: 'recruitment:manage-joining',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadJoiningResource,
    handler: async ({ ctx, params, body }) =>
      service.updateJoiningStatus(
        ctx,
        idSchema.parse(params['id']),
        updateJoiningStatusSchema.parse(body),
      ),
  });

  route({
    method: 'PATCH',
    path: '/api/recruitment/joinings/:id/status',
    action: 'recruitment:manage-joining',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadJoiningResource,
    handler: async ({ ctx, params, body }) =>
      service.updateJoiningStatus(
        ctx,
        idSchema.parse(params['id']),
        updateJoiningStatusSchema.parse(body),
      ),
  });

  route({
    method: 'PATCH',
    path: '/api/recruitment/joining/:id',
    action: 'recruitment:manage-joining',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadJoiningResource,
    handler: async ({ ctx, params, body }) =>
      service.updateJoining(
        ctx,
        idSchema.parse(params['id']),
        updateJoiningSchema.parse(body),
      ),
  });

  route({
    method: 'PATCH',
    path: '/api/recruitment/joinings/:id',
    action: 'recruitment:manage-joining',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadJoiningResource,
    handler: async ({ ctx, params, body }) =>
      service.updateJoining(
        ctx,
        idSchema.parse(params['id']),
        updateJoiningSchema.parse(body),
      ),
  });

  // -----------------------------------------------------------------
  // 6. Application Links
  // -----------------------------------------------------------------
  route({
    method: 'GET',
    path: '/api/recruitment/application-links',
    action: 'recruitment:manage-links',
    module: 'recruitment',
    handler: async ({ ctx, query }) =>
      service.listApplicationLinks(
        ctx,
        typeof query['requisitionId'] === 'string' ? query['requisitionId'] : undefined,
      ),
  });

  route({
    method: 'POST',
    path: '/api/recruitment/application-links',
    action: 'recruitment:manage-links',
    module: 'recruitment',
    status: 201,
    handler: async ({ ctx, body }) =>
      service.createApplicationLink(ctx, createApplicationLinkSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/recruitment/application-links/:id',
    action: 'recruitment:manage-links',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadApplicationLinkResource,
    handler: async ({ ctx, params }) =>
      service.getApplicationLink(ctx, idSchema.parse(params['id'])),
  });

  route({
    method: 'PATCH',
    path: '/api/recruitment/application-links/:id/status',
    action: 'recruitment:manage-links',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadApplicationLinkResource,
    handler: async ({ ctx, params, body }) =>
      service.updateApplicationLinkStatus(
        ctx,
        idSchema.parse(params['id']),
        updateApplicationLinkStatusSchema.parse(body),
      ),
  });

  // -----------------------------------------------------------------
  // 7. Resume Submissions — static paths before parameterised paths
  // -----------------------------------------------------------------
  route({
    method: 'GET',
    path: '/api/recruitment/resume-submissions',
    action: 'recruitment:manage-submissions',
    module: 'recruitment',
    handler: async ({ ctx, query }) => {
      const filter = {
        requisitionId: typeof query['requisitionId'] === 'string' ? query['requisitionId'] : undefined,
        status: typeof query['status'] === 'string' ? query['status'] : undefined,
        search: typeof query['search'] === 'string' ? query['search'] : undefined,
      };
      return service.listResumeSubmissions(ctx, filter);
    },
  });

  route({
    method: 'POST',
    path: '/api/recruitment/resume-submissions/upload',
    action: 'recruitment:manage-submissions',
    module: 'recruitment',
    status: 201,
    handler: async ({ ctx, body }) =>
      service.createManualSubmission(ctx, hrManualSubmissionSchema.parse(body)),
  });

  route({
    method: 'GET',
    path: '/api/recruitment/resume-submissions/:id',
    action: 'recruitment:manage-submissions',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadResumeSubmissionResource,
    handler: async ({ ctx, params }) =>
      service.getResumeSubmission(ctx, idSchema.parse(params['id'])),
  });

  route({
    method: 'GET',
    path: '/api/recruitment/resume-submissions/:id/resume',
    action: 'recruitment:manage-submissions',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadResumeSubmissionResource,
    handler: async ({ ctx, params, res }) => {
      const { buffer, mimeType, filename } = await service.getResumeFile(
        ctx,
        idSchema.parse(params['id']),
      );
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Length', buffer.length);
      res.status(200).end(buffer);
      return null;
    },
  });

  route({
    method: 'GET',
    path: '/api/recruitment/resume-submissions/:id/resume-url',
    action: 'recruitment:manage-submissions',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadResumeSubmissionResource,
    handler: async ({ ctx, params }) =>
      service.getResumeSignedUrl(ctx, idSchema.parse(params['id'])),
  });

  route({
    method: 'PATCH',
    path: '/api/recruitment/resume-submissions/:id/status',
    action: 'recruitment:manage-submissions',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadResumeSubmissionResource,
    handler: async ({ ctx, params, body }) =>
      service.updateResumeSubmissionStatus(
        ctx,
        idSchema.parse(params['id']),
        updateSubmissionStatusSchema.parse(body),
      ),
  });

  route({
    method: 'POST',
    path: '/api/recruitment/resume-submissions/:id/convert',
    action: 'recruitment:manage-submissions',
    module: 'recruitment',
    resourceParam: 'id',
    loadResource: service.loadResumeSubmissionResource,
    handler: async ({ ctx, params, body }) =>
      service.convertResumeSubmissionToCandidate(
        ctx,
        idSchema.parse(params['id']),
        convertSubmissionSchema.parse(body),
      ),
  });
}
