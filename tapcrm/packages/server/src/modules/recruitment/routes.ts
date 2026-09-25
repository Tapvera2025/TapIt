import { Router, type NextFunction, type Request, type Response } from 'express';
import { globalAccess } from '@tapcrm/contracts';
import { bootstrapDb } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
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
  updateApplicationLinkStatusSchema,
  updateCandidateScreeningSchema,
  updateCandidateStatusSchema,
  updateInterviewStatusSchema,
  updateJoiningStatusSchema,
  updateOfferStatusSchema,
  updateRequisitionStatusSchema,
  updateSubmissionStatusSchema,
  uploadCandidateResumeSchema,
  parseCandidateResumeSchema,
} from './validators.js';

function paramId(req: Request): string {
  const val = req.params['id'];
  return (Array.isArray(val) ? val[0] : val) ?? '';
}

/**
 * HR / Super Admin authorization gate for recruitment operations.
 * Evaluated within the authenticated RequestContext pipeline.
 */
async function requireHrOrAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const ctx = req.ctx;
  if (!ctx || !ctx.principal) {
    res.status(401).json({
      success: false,
      code: 'UNAUTHENTICATED',
      message: 'Authentication required',
    });
    return;
  }

  if (globalAccess(ctx.principal)) {
    next();
    return;
  }

  if ('departmentId' in ctx.principal && ctx.principal.departmentId) {
    const dept = await bootstrapDb.readAs<{ code: string; name: string }>(
      ctx.organizationId,
      sql`
        SELECT code, name
        FROM department
        WHERE organization_id = ${ctx.organizationId}
          AND id = ${ctx.principal.departmentId}
          AND status = 'active'
      `,
    );

    if (dept[0]) {
      const code = dept[0].code.toLowerCase();
      const name = dept[0].name.toLowerCase();
      if (
        code === 'hr' ||
        name === 'human resources' ||
        code.includes('recruitment')
      ) {
        next();
        return;
      }
    }
  }

  res.status(403).json({
    success: false,
    code: 'FORBIDDEN',
    message: 'Access to recruitment module is restricted to HR personnel',
  });
}

/**
 * Builds the Express router mounted at `${config.API_BASE_PATH}/recruitment`.
 */
export function buildRecruitmentRouter(): Router {
  const router = Router();

  router.use(requireHrOrAdmin);

  // -------------------------------------------------------------------
  // 0. Metrics
  // -------------------------------------------------------------------
  router.get('/metrics', async (req, res, next) => {
    try {
      const data = await service.getRecruitmentMetrics(req.ctx!);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------------------------
  // 1. Requisitions
  // -------------------------------------------------------------------
  router.get('/requisitions', async (req, res, next) => {
    try {
      const filter = {
        search: typeof req.query['search'] === 'string' ? req.query['search'] : undefined,
        status: typeof req.query['status'] === 'string' ? req.query['status'] : undefined,
        departmentId: typeof req.query['departmentId'] === 'string' ? req.query['departmentId'] : undefined,
        employmentType: typeof req.query['employmentType'] === 'string' ? req.query['employmentType'] : undefined,
      };
      const data = await service.listRequisitions(req.ctx!, filter);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/requisitions', async (req, res, next) => {
    try {
      const input = createRequisitionSchema.parse(req.body ?? {});
      const data = await service.createRequisition(req.ctx!, input);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/requisitions/:id', async (req, res, next) => {
    try {
      const data = await service.getRequisition(req.ctx!, paramId(req));
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/requisitions/:id/status', async (req, res, next) => {
    try {
      const { status } = updateRequisitionStatusSchema.parse(req.body ?? {});
      const data = await service.updateRequisitionStatus(req.ctx!, paramId(req), status);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------------------------
  // 2. Candidates
  // -------------------------------------------------------------------
  router.get('/candidates', async (req, res, next) => {
    try {
      const filter = {
        search: typeof req.query['search'] === 'string' ? req.query['search'] : undefined,
        status: typeof req.query['status'] === 'string' ? req.query['status'] : undefined,
        requisitionId: typeof req.query['requisitionId'] === 'string' ? req.query['requisitionId'] : undefined,
        source: typeof req.query['source'] === 'string' ? req.query['source'] : undefined,
      };
      const data = await service.listCandidates(req.ctx!, filter);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/candidates/resume/upload', async (req, res, next) => {
    try {
      const input = uploadCandidateResumeSchema.parse(req.body ?? {});
      const data = await service.uploadCandidateResume(req.ctx!, input);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/candidates/resume/parse', async (req, res, next) => {
    try {
      const input = parseCandidateResumeSchema.parse(req.body ?? {});
      const data = await service.parseCandidateResume(req.ctx!, input);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/candidates/resume/preview', async (req, res, next) => {
    try {
      const key = typeof req.query['key'] === 'string' ? req.query['key'] : '';
      const { buffer, mimeType, filename } = await service.getResumePreviewFile(req.ctx!, key);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Length', buffer.length);
      res.status(200).end(buffer);
    } catch (error) {
      next(error);
    }
  });

  router.post('/candidates', async (req, res, next) => {
    try {
      const input = createCandidateSchema.parse(req.body ?? {});
      const data = await service.createCandidate(req.ctx!, input);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/candidates/:id/resume', async (req, res, next) => {
    try {
      const { buffer, mimeType, filename } = await service.getCandidateResumeFile(req.ctx!, paramId(req));
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Length', buffer.length);
      res.status(200).end(buffer);
    } catch (error) {
      next(error);
    }
  });

  router.get('/candidates/:id', async (req, res, next) => {
    try {
      const data = await service.getCandidate(req.ctx!, paramId(req));
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/candidates/:id/status', async (req, res, next) => {
    try {
      const input = updateCandidateStatusSchema.parse(req.body ?? {});
      const data = await service.updateCandidateStatus(req.ctx!, paramId(req), input);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/candidates/:id/screening', async (req, res, next) => {
    try {
      const { screeningNotes } = updateCandidateScreeningSchema.parse(req.body ?? {});
      const data = await service.updateCandidateScreening(req.ctx!, paramId(req), screeningNotes);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------------------------
  // 3. Interviews
  // -------------------------------------------------------------------
  router.get('/interviews', async (req, res, next) => {
    try {
      const filter = {
        candidateId: typeof req.query['candidateId'] === 'string' ? req.query['candidateId'] : undefined,
        requisitionId: typeof req.query['requisitionId'] === 'string' ? req.query['requisitionId'] : undefined,
        status: typeof req.query['status'] === 'string' ? req.query['status'] : undefined,
        stage: typeof req.query['stage'] === 'string' ? req.query['stage'] : undefined,
      };
      const data = await service.listInterviews(req.ctx!, filter);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/interviews', async (req, res, next) => {
    try {
      const input = scheduleInterviewSchema.parse(req.body ?? {});
      const data = await service.scheduleInterview(req.ctx!, input);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/interviews/:id', async (req, res, next) => {
    try {
      const data = await service.getInterview(req.ctx!, paramId(req));
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/interviews/:id/status', async (req, res, next) => {
    try {
      const { status } = updateInterviewStatusSchema.parse(req.body ?? {});
      const data = await service.updateInterviewStatus(req.ctx!, paramId(req), status);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/interviews/:id/feedback', async (req, res, next) => {
    try {
      const input = submitFeedbackSchema.parse(req.body ?? {});
      const data = await service.submitInterviewFeedback(req.ctx!, paramId(req), input);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------------------------
  // 4. Offers
  // -------------------------------------------------------------------
  router.get('/offers', async (req, res, next) => {
    try {
      const filter = {
        candidateId: typeof req.query['candidateId'] === 'string' ? req.query['candidateId'] : undefined,
        status: typeof req.query['status'] === 'string' ? req.query['status'] : undefined,
      };
      const data = await service.listOffers(req.ctx!, filter);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/offers', async (req, res, next) => {
    try {
      const input = createOfferSchema.parse(req.body ?? {});
      const data = await service.createOffer(req.ctx!, input);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/offers/:id', async (req, res, next) => {
    try {
      const data = await service.getOffer(req.ctx!, paramId(req));
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/offers/:id/status', async (req, res, next) => {
    try {
      const { status } = updateOfferStatusSchema.parse(req.body ?? {});
      const data = await service.updateOfferStatus(req.ctx!, paramId(req), status);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------------------------
  // 5. Joining
  // -------------------------------------------------------------------
  const handleListJoining = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filter = {
        status: typeof req.query['status'] === 'string' ? req.query['status'] : undefined,
      };
      const data = await service.listJoinings(req.ctx!, filter);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };

  const handleCreateJoining = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = createJoiningSchema.parse(req.body ?? {});
      const data = await service.createJoining(req.ctx!, input);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };

  const handleGetJoining = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await service.getJoining(req.ctx!, paramId(req));
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };

  const handleUpdateJoining = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = updateJoiningStatusSchema.parse(req.body ?? {});
      const data = await service.updateJoiningStatus(req.ctx!, paramId(req), input);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  };

  router.get('/joining', handleListJoining);
  router.get('/joinings', handleListJoining);
  router.post('/joining', handleCreateJoining);
  router.post('/joinings', handleCreateJoining);
  router.get('/joining/:id', handleGetJoining);
  router.get('/joinings/:id', handleGetJoining);
  router.patch('/joining/:id/status', handleUpdateJoining);
  router.patch('/joinings/:id/status', handleUpdateJoining);

  // -------------------------------------------------------------------
  // 6. Application Links (HR Management)
  // -------------------------------------------------------------------
  router.get('/application-links', async (req, res, next) => {
    try {
      const requisitionId = typeof req.query['requisitionId'] === 'string' ? req.query['requisitionId'] : undefined;
      const data = await service.listApplicationLinks(req.ctx!, requisitionId);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/application-links', async (req, res, next) => {
    try {
      const input = createApplicationLinkSchema.parse(req.body ?? {});
      const data = await service.createApplicationLink(req.ctx!, input);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/application-links/:id', async (req, res, next) => {
    try {
      const data = await service.getApplicationLink(req.ctx!, paramId(req));
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/application-links/:id/status', async (req, res, next) => {
    try {
      const input = updateApplicationLinkStatusSchema.parse(req.body ?? {});
      const data = await service.updateApplicationLinkStatus(req.ctx!, paramId(req), input);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------------------------
  // 7. Resume Submissions (HR Resume Inbox)
  // -------------------------------------------------------------------
  router.get('/resume-submissions', async (req, res, next) => {
    try {
      const filter = {
        requisitionId: typeof req.query['requisitionId'] === 'string' ? req.query['requisitionId'] : undefined,
        status: typeof req.query['status'] === 'string' ? req.query['status'] : undefined,
        search: typeof req.query['search'] === 'string' ? req.query['search'] : undefined,
      };
      const data = await service.listResumeSubmissions(req.ctx!, filter);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/resume-submissions/upload', async (req, res, next) => {
    try {
      const input = hrManualSubmissionSchema.parse(req.body ?? {});
      const data = await service.createManualSubmission(req.ctx!, input);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/resume-submissions/:id', async (req, res, next) => {
    try {
      const data = await service.getResumeSubmission(req.ctx!, paramId(req));
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/resume-submissions/:id/resume', async (req, res, next) => {
    try {
      const { buffer, mimeType, filename } = await service.getResumeFile(req.ctx!, paramId(req));
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
      res.setHeader('Content-Length', buffer.length);
      res.status(200).end(buffer);
    } catch (error) {
      next(error);
    }
  });

  router.get('/resume-submissions/:id/resume-url', async (req, res, next) => {
    try {
      const data = await service.getResumeSignedUrl(req.ctx!, paramId(req));
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/resume-submissions/:id/status', async (req, res, next) => {
    try {
      const input = updateSubmissionStatusSchema.parse(req.body ?? {});
      const data = await service.updateResumeSubmissionStatus(req.ctx!, paramId(req), input);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/resume-submissions/:id/convert', async (req, res, next) => {
    try {
      const input = convertSubmissionSchema.parse(req.body ?? {});
      const data = await service.convertResumeSubmissionToCandidate(req.ctx!, paramId(req), input);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------------------------
  // 8. Candidate Hiring
  // -------------------------------------------------------------------
  router.post('/candidates/:id/hire', async (req, res, next) => {
    try {
      const input = hireCandidateSchema.parse(req.body ?? {});
      const data = await service.hireCandidateAsEmployee(req.ctx!, paramId(req), input);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------------------------
  // 9. Interview Reschedule & Decision
  // -------------------------------------------------------------------
  router.post('/interviews/:id/reschedule', async (req, res, next) => {
    try {
      const input = rescheduleInterviewSchema.parse(req.body ?? {});
      const data = await service.rescheduleInterview(req.ctx!, paramId(req), input);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/interviews/:id/decision', async (req, res, next) => {
    try {
      const input = interviewDecisionSchema.parse(req.body ?? {});
      const data = await service.recordInterviewDecision(req.ctx!, paramId(req), input);
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function registerRecruitmentRoutes(): void {
  // Recruitment routes are mounted via buildRecruitmentRouter() in app.ts.
}
