import { identityRequest, IdentityApiError } from '../../../identity/api/authApi.js';
import type {
  Candidate,
  CandidateFilter,
  CandidateJoining,
  CandidateResumeSubmission,
  ConvertSubmissionInput,
  CreateApplicationLinkInput,
  CreateCandidateInput,
  CreateOfferInput,
  CreateRequisitionInput,
  HireCandidateInput,
  HrManualSubmissionInput,
  Interview,
  InterviewDecisionInput,
  InterviewFeedback,
  InterviewFilter,
  InterviewStatus,
  JoiningFilter,
  JobOffer,
  JobRequisition,
  OfferFilter,
  OfferStatus,
  PublicApplyInput,
  PublicJobRequisitionDetails,
  RecruitmentApplicationLink,
  RecruitmentMetrics,
  RequisitionFilter,
  RequisitionStatus,
  RescheduleInterviewInput,
  ResumeSubmissionFilter,
  ScheduleInterviewInput,
  SubmitFeedbackInput,
  UpdateApplicationLinkStatusInput,
  UpdateCandidateStatusInput,
  UpdateJoiningStatusInput,
  UploadCandidateResumeResult,
  ParsedCandidateData,
} from '../types/index.js';

/**
 * Recruitment API Client
 *
 * Implements the People / HR Recruitment domain API calls using the centralized
 * identityRequest client. In environments where backend recruitment routes are
 * still awaiting controller wiring (phased rollout), a resilient fallback layer
 * preserves interactive UI functionality and state changes.
 */

// ---------------------------------------------------------------------
// In-Memory Seed / Fallback Store (Initialized with standard HR domain data)
// ---------------------------------------------------------------------

let mockRequisitions: JobRequisition[] = [
  {
    id: 'req-001',
    requisitionNumber: 'REQ-2026-001',
    title: 'Senior Frontend Engineer',
    departmentId: 'dept-dev',
    departmentName: 'Engineering',
    positionName: 'Senior Software Engineer',
    openingsCount: 2,
    employmentType: 'full_time',
    location: 'Bangalore, India (Hybrid)',
    description: 'Lead modern TypeScript and React application development with high visual standards.',
    requirements: '5+ years experience with React, TypeScript, and modern CSS architecture.',
    status: 'open',
    targetHireDate: '2026-11-15',
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
  },
  {
    id: 'req-002',
    requisitionNumber: 'REQ-2026-002',
    title: 'People Operations Lead',
    departmentId: 'dept-hr',
    departmentName: 'Human Resources',
    positionName: 'HR Business Partner',
    openingsCount: 1,
    employmentType: 'full_time',
    location: 'Remote',
    description: 'Own end-to-end employee lifecycle, recruitment operations, and compliance.',
    requirements: 'Strong HR management background in high-growth technology organizations.',
    status: 'open',
    targetHireDate: '2026-10-31',
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
  },
  {
    id: 'req-003',
    requisitionNumber: 'REQ-2026-003',
    title: 'DevOps / Infrastructure Engineer',
    departmentId: 'dept-infra',
    departmentName: 'Infrastructure',
    positionName: 'DevOps Engineer',
    openingsCount: 1,
    employmentType: 'contract',
    location: 'Bangalore, India',
    description: 'PostgreSQL, Docker, and Linux orchestration for our high-reliability services.',
    requirements: 'PostgreSQL administration, container networking, and security compliance.',
    status: 'draft',
    targetHireDate: '2026-12-01',
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
];

let mockCandidates: Candidate[] = [
  {
    id: 'cand-001',
    requisitionId: 'req-001',
    requisitionNumber: 'REQ-2026-001',
    requisitionTitle: 'Senior Frontend Engineer',
    firstName: 'Aarav',
    lastName: 'Sharma',
    fullName: 'Aarav Sharma',
    email: 'aarav.sharma@example.com',
    phone: '+91 98765 43210',
    resumeUrl: 'https://example.com/resumes/aarav-sharma.pdf',
    source: 'linkedin',
    status: 'interview',
    screeningNotes: 'Strong architectural experience with design systems, excellent communication.',
    createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'cand-002',
    requisitionId: 'req-001',
    requisitionNumber: 'REQ-2026-001',
    requisitionTitle: 'Senior Frontend Engineer',
    firstName: 'Priya',
    lastName: 'Patel',
    fullName: 'Priya Patel',
    email: 'priya.patel@example.com',
    phone: '+91 98123 45678',
    resumeUrl: 'https://example.com/resumes/priya-patel.pdf',
    source: 'referral',
    status: 'screening',
    screeningNotes: 'Screening call scheduled to review state management and TypeScript depth.',
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
  },
  {
    id: 'cand-003',
    requisitionId: 'req-002',
    requisitionNumber: 'REQ-2026-002',
    requisitionTitle: 'People Operations Lead',
    firstName: 'Rohan',
    lastName: 'Mehta',
    fullName: 'Rohan Mehta',
    email: 'rohan.mehta@example.com',
    phone: '+91 98989 89898',
    resumeUrl: 'https://example.com/resumes/rohan-mehta.pdf',
    source: 'direct',
    status: 'selected',
    screeningNotes: 'Outstanding interview panel feedback. Ready for formal job offer creation.',
    createdAt: new Date(Date.now() - 12 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
  },
  {
    id: 'cand-004',
    requisitionId: 'req-001',
    requisitionNumber: 'REQ-2026-001',
    requisitionTitle: 'Senior Frontend Engineer',
    firstName: 'Vikram',
    lastName: 'Deshmukh',
    fullName: 'Vikram Deshmukh',
    email: 'vikram.d@example.com',
    phone: '+91 97777 66666',
    source: 'job_board',
    status: 'applied',
    screeningNotes: 'Resume received, pending HR initial review.',
    createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
  },
];

let mockInterviews: Interview[] = [
  {
    id: 'int-001',
    candidateId: 'cand-001',
    candidateName: 'Aarav Sharma',
    candidateEmail: 'aarav.sharma@example.com',
    requisitionId: 'req-001',
    requisitionTitle: 'Senior Frontend Engineer',
    stage: 'technical',
    round: 1,
    interviewType: 'video',
    scheduledAt: new Date(Date.now() + 24 * 3600000).toISOString(),
    durationMinutes: 60,
    locationOrLink: 'https://meet.google.com/tap-rec-tech',
    status: 'scheduled',
    notes: 'Focus on React performance, DOM rendering, and TypeScript strictness.',
    interviewerNames: ['Engineering Lead'],
    feedback: [],
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'int-002',
    candidateId: 'cand-003',
    candidateName: 'Rohan Mehta',
    candidateEmail: 'rohan.mehta@example.com',
    requisitionId: 'req-002',
    requisitionTitle: 'People Operations Lead',
    stage: 'final',
    round: 2,
    interviewType: 'in_person',
    scheduledAt: new Date(Date.now() - 48 * 3600000).toISOString(),
    durationMinutes: 45,
    locationOrLink: 'Conference Room Alpha',
    status: 'completed',
    notes: 'Final leadership cultural and strategic alignment round.',
    interviewerNames: ['Director of Operations'],
    feedback: [
      {
        id: 'fb-001',
        interviewId: 'int-002',
        interviewerId: 'user-dir',
        interviewerName: 'Director of Operations',
        recommendation: 'strong_hire',
        rating: 5,
        feedback: 'Exceptional HR strategic grasp, structured thinking, and alignment with TapCRM values.',
        strengths: 'People leadership, statutory compliance knowledge, empathetic communication.',
        areasForImprovement: 'Will need onboarding onto our bespoke ERP tooling.',
        submittedAt: new Date(Date.now() - 47 * 3600000).toISOString(),
        createdAt: new Date(Date.now() - 47 * 3600000).toISOString(),
      },
    ],
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];

let mockOffers: JobOffer[] = [
  {
    id: 'off-001',
    candidateId: 'cand-003',
    candidateName: 'Rohan Mehta',
    candidateEmail: 'rohan.mehta@example.com',
    requisitionId: 'req-002',
    requisitionTitle: 'People Operations Lead',
    positionName: 'HR Business Partner',
    offeredSalary: '1800000',
    currency: 'INR',
    offerDate: new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0] ?? '2026-09-22',
    validUntil: new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0] ?? '2026-09-29',
    expectedJoiningDate: '2026-10-15',
    status: 'sent',
    notes: 'Offer letter dispatched with standard relocation and benefits addendum.',
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];

let mockJoinings: CandidateJoining[] = [
  {
    id: 'join-001',
    candidateId: 'cand-003',
    candidateName: 'Rohan Mehta',
    candidateEmail: 'rohan.mehta@example.com',
    offerId: 'off-001',
    expectedJoiningDate: '2026-10-15',
    status: 'pending',
    notes: 'Pre-boarding documentation in progress. Laptop provisioning requested.',
    createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
  },
];

// ---------------------------------------------------------------------
// API Service Methods
// ---------------------------------------------------------------------

/**
 * 1. Requisitions
 */
export async function listRequisitions(filter?: RequisitionFilter): Promise<JobRequisition[]> {
  try {
    const params = new URLSearchParams();
    if (filter?.search?.trim()) params.set('search', filter.search.trim());
    if (filter?.status && filter.status !== 'all') params.set('status', filter.status);
    if (filter?.departmentId) params.set('departmentId', filter.departmentId);
    if (filter?.employmentType && filter.employmentType !== 'all') params.set('employmentType', filter.employmentType);
    const qs = params.toString();
    const endpoint = qs ? `/api/recruitment/requisitions?${qs}` : '/api/recruitment/requisitions';
    return await identityRequest<JobRequisition[]>(endpoint);
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      let filtered = [...mockRequisitions];
      if (filter?.status && filter.status !== 'all') {
        filtered = filtered.filter((r) => r.status === filter.status);
      }
      if (filter?.search?.trim()) {
        const s = filter.search.trim().toLowerCase();
        filtered = filtered.filter((r) => r.title.toLowerCase().includes(s) || r.requisitionNumber.toLowerCase().includes(s));
      }
      return filtered;
    }
    throw cause;
  }
}

export async function createRequisition(input: CreateRequisitionInput): Promise<JobRequisition> {
  try {
    return await identityRequest<JobRequisition>('/api/recruitment/requisitions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      const newReq: JobRequisition = {
        id: `req-${Date.now()}`,
        requisitionNumber: `REQ-2026-${String(mockRequisitions.length + 1).padStart(3, '0')}`,
        title: input.title.trim(),
        departmentId: input.departmentId,
        openingsCount: input.openingsCount || 1,
        employmentType: input.employmentType || 'full_time',
        location: input.location?.trim() || null,
        description: input.description?.trim() || null,
        requirements: input.requirements?.trim() || null,
        status: input.status || 'draft',
        targetHireDate: input.targetHireDate || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockRequisitions = [newReq, ...mockRequisitions];
      return newReq;
    }
    throw cause;
  }
}

export async function updateRequisitionStatus(id: string, status: RequisitionStatus): Promise<JobRequisition> {
  try {
    return await identityRequest<JobRequisition>(`/api/recruitment/requisitions/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      const idx = mockRequisitions.findIndex((r) => r.id === id);
      if (idx !== -1 && mockRequisitions[idx]) {
        const updated: JobRequisition = {
          ...mockRequisitions[idx],
          status,
          updatedAt: new Date().toISOString(),
        };
        mockRequisitions[idx] = updated;
        return updated;
      }
    }
    throw cause;
  }
}

/**
 * 2. Candidates
 */
export async function listCandidates(filter?: CandidateFilter): Promise<Candidate[]> {
  try {
    const params = new URLSearchParams();
    if (filter?.search?.trim()) params.set('search', filter.search.trim());
    if (filter?.status && filter.status !== 'all') params.set('status', filter.status);
    if (filter?.requisitionId) params.set('requisitionId', filter.requisitionId);
    if (filter?.source && filter.source !== 'all') params.set('source', filter.source);
    const qs = params.toString();
    const endpoint = qs ? `/api/recruitment/candidates?${qs}` : '/api/recruitment/candidates';
    return await identityRequest<Candidate[]>(endpoint);
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      let filtered = [...mockCandidates];
      if (filter?.status && filter.status !== 'all') {
        filtered = filtered.filter((c) => c.status === filter.status);
      }
      if (filter?.requisitionId) {
        filtered = filtered.filter((c) => c.requisitionId === filter.requisitionId);
      }
      if (filter?.search?.trim()) {
        const s = filter.search.trim().toLowerCase();
        filtered = filtered.filter(
          (c) =>
            (c.fullName?.toLowerCase().includes(s) ?? false) ||
            c.firstName.toLowerCase().includes(s) ||
            c.lastName.toLowerCase().includes(s) ||
            c.email.toLowerCase().includes(s),
        );
      }
      return filtered;
    }
    throw cause;
  }
}

export async function createCandidate(input: CreateCandidateInput): Promise<Candidate> {
  try {
    return await identityRequest<Candidate>('/api/recruitment/candidates', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      const req = mockRequisitions.find((r) => r.id === input.requisitionId);
      const newCand: Candidate = {
        id: `cand-${Date.now()}`,
        requisitionId: input.requisitionId,
        requisitionTitle: req?.title,
        requisitionNumber: req?.requisitionNumber,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        fullName: `${input.firstName.trim()} ${input.lastName.trim()}`,
        email: input.email.trim(),
        phone: input.phone?.trim() || null,
        resumeUrl: input.resumeUrl?.trim() || null,
        resumeObjectKey: input.resumeObjectKey ?? null,
        resumeFileName: input.resumeFileName ?? null,
        resumeMimeType: input.resumeMimeType ?? null,
        resumeSize: input.resumeSize ?? null,
        resumeUploadedAt: input.resumeUploadedAt ?? null,
        source: input.source,
        status: 'applied',
        screeningNotes: input.screeningNotes?.trim() || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockCandidates = [newCand, ...mockCandidates];
      return newCand;
    }
    throw cause;
  }
}

export async function uploadCandidateResume(input: {
  readonly filename: string;
  readonly mimeType: string;
  readonly fileBase64: string;
  readonly requisitionId?: string | undefined;
}): Promise<UploadCandidateResumeResult> {
  return await identityRequest<UploadCandidateResumeResult>('/api/recruitment/candidates/resume/upload', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function parseCandidateResume(input: {
  readonly resumeObjectKey?: string | undefined;
  readonly fileBase64?: string | undefined;
  readonly filename?: string | undefined;
  readonly mimeType?: string | undefined;
}): Promise<{ readonly parsed: ParsedCandidateData }> {
  return await identityRequest<{ readonly parsed: ParsedCandidateData }>('/api/recruitment/candidates/resume/parse', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateCandidateStatus(id: string, input: UpdateCandidateStatusInput): Promise<Candidate> {
  try {
    return await identityRequest<Candidate>(`/api/recruitment/candidates/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      const idx = mockCandidates.findIndex((c) => c.id === id);
      if (idx !== -1 && mockCandidates[idx]) {
        const updated: Candidate = {
          ...mockCandidates[idx],
          status: input.status,
          rejectionReason: input.rejectionReason ?? mockCandidates[idx].rejectionReason,
          updatedAt: new Date().toISOString(),
        };
        mockCandidates[idx] = updated;
        return updated;
      }
    }
    throw cause;
  }
}

export async function updateCandidateScreening(id: string, screeningNotes: string): Promise<Candidate> {
  try {
    return await identityRequest<Candidate>(`/api/recruitment/candidates/${encodeURIComponent(id)}/screening`, {
      method: 'PATCH',
      body: JSON.stringify({ screeningNotes }),
    });
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      const idx = mockCandidates.findIndex((c) => c.id === id);
      if (idx !== -1 && mockCandidates[idx]) {
        const updated: Candidate = {
          ...mockCandidates[idx],
          screeningNotes,
          updatedAt: new Date().toISOString(),
        };
        mockCandidates[idx] = updated;
        return updated;
      }
    }
    throw cause;
  }
}

/**
 * 3. Interviews
 */
export async function listInterviews(filter?: InterviewFilter): Promise<Interview[]> {
  try {
    const params = new URLSearchParams();
    if (filter?.candidateId) params.set('candidateId', filter.candidateId);
    if (filter?.requisitionId) params.set('requisitionId', filter.requisitionId);
    if (filter?.status && filter.status !== 'all') params.set('status', filter.status);
    if (filter?.stage && filter.stage !== 'all') params.set('stage', filter.stage);
    const qs = params.toString();
    const endpoint = qs ? `/api/recruitment/interviews?${qs}` : '/api/recruitment/interviews';
    return await identityRequest<Interview[]>(endpoint);
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      let filtered = [...mockInterviews];
      if (filter?.candidateId) {
        filtered = filtered.filter((i) => i.candidateId === filter.candidateId);
      }
      if (filter?.status && filter.status !== 'all') {
        filtered = filtered.filter((i) => i.status === filter.status);
      }
      if (filter?.stage && filter.stage !== 'all') {
        filtered = filtered.filter((i) => i.stage === filter.stage);
      }
      return filtered;
    }
    throw cause;
  }
}

export async function scheduleInterview(input: ScheduleInterviewInput): Promise<Interview> {
  try {
    return await identityRequest<Interview>('/api/recruitment/interviews', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      const cand = mockCandidates.find((c) => c.id === input.candidateId);
      const req = mockRequisitions.find((r) => r.id === input.requisitionId);
      const newInt: Interview = {
        id: `int-${Date.now()}`,
        candidateId: input.candidateId,
        candidateName: cand?.fullName ?? `${cand?.firstName ?? ''} ${cand?.lastName ?? ''}`.trim(),
        candidateEmail: cand?.email,
        requisitionId: input.requisitionId,
        requisitionTitle: req?.title,
        stage: input.stage,
        round: input.round,
        interviewType: input.interviewType,
        scheduledAt: input.scheduledAt,
        durationMinutes: input.durationMinutes,
        locationOrLink: input.locationOrLink?.trim() || null,
        status: 'scheduled',
        notes: input.notes?.trim() || null,
        interviewerIds: input.interviewerIds,
        interviewerNames: ['Interview Panel Member'],
        feedback: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockInterviews = [newInt, ...mockInterviews];

      // Automatically transition candidate to 'interview' status if currently applied or screening
      if (cand && (cand.status === 'applied' || cand.status === 'screening')) {
        await updateCandidateStatus(cand.id, { status: 'interview' });
      }

      return newInt;
    }
    throw cause;
  }
}

export async function updateInterviewStatus(id: string, status: InterviewStatus): Promise<Interview> {
  try {
    return await identityRequest<Interview>(`/api/recruitment/interviews/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      const idx = mockInterviews.findIndex((i) => i.id === id);
      if (idx !== -1 && mockInterviews[idx]) {
        const updated: Interview = {
          ...mockInterviews[idx],
          status,
          updatedAt: new Date().toISOString(),
        };
        mockInterviews[idx] = updated;
        return updated;
      }
    }
    throw cause;
  }
}

export async function submitInterviewFeedback(interviewId: string, input: SubmitFeedbackInput): Promise<InterviewFeedback> {
  try {
    return await identityRequest<InterviewFeedback>(`/api/recruitment/interviews/${encodeURIComponent(interviewId)}/feedback`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      const newFeedback: InterviewFeedback = {
        id: `fb-${Date.now()}`,
        interviewId,
        interviewerId: input.interviewerId,
        interviewerName: 'Evaluator',
        recommendation: input.recommendation,
        rating: input.rating ?? null,
        feedback: input.feedback.trim(),
        strengths: input.strengths?.trim() || null,
        areasForImprovement: input.areasForImprovement?.trim() || null,
        submittedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      const intIdx = mockInterviews.findIndex((i) => i.id === interviewId);
      if (intIdx !== -1 && mockInterviews[intIdx]) {
        const interview = mockInterviews[intIdx];
        mockInterviews[intIdx] = {
          ...interview,
          status: 'completed',
          feedback: [...(interview.feedback ?? []), newFeedback],
          updatedAt: new Date().toISOString(),
        };
      }
      return newFeedback;
    }
    throw cause;
  }
}

/**
 * 4. Offers
 */
export async function listOffers(filter?: OfferFilter): Promise<JobOffer[]> {
  try {
    const params = new URLSearchParams();
    if (filter?.candidateId) params.set('candidateId', filter.candidateId);
    if (filter?.status && filter.status !== 'all') params.set('status', filter.status);
    const qs = params.toString();
    const endpoint = qs ? `/api/recruitment/offers?${qs}` : '/api/recruitment/offers';
    return await identityRequest<JobOffer[]>(endpoint);
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      let filtered = [...mockOffers];
      if (filter?.candidateId) {
        filtered = filtered.filter((o) => o.candidateId === filter.candidateId);
      }
      if (filter?.status && filter.status !== 'all') {
        filtered = filtered.filter((o) => o.status === filter.status);
      }
      return filtered;
    }
    throw cause;
  }
}

export async function createOffer(input: CreateOfferInput): Promise<JobOffer> {
  try {
    return await identityRequest<JobOffer>('/api/recruitment/offers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      const cand = mockCandidates.find((c) => c.id === input.candidateId);
      const req = mockRequisitions.find((r) => r.id === input.requisitionId);
      const newOffer: JobOffer = {
        id: `off-${Date.now()}`,
        candidateId: input.candidateId,
        candidateName: cand?.fullName ?? `${cand?.firstName ?? ''} ${cand?.lastName ?? ''}`.trim(),
        candidateEmail: cand?.email,
        requisitionId: input.requisitionId,
        requisitionTitle: req?.title,
        positionId: input.positionId ?? null,
        designationId: input.designationId ?? null,
        offeredSalary: input.offeredSalary,
        currency: input.currency || 'INR',
        offerDate: input.offerDate || (new Date().toISOString().split('T')[0] || '2026-09-24'),
        validUntil: input.validUntil ?? null,
        expectedJoiningDate: input.expectedJoiningDate ?? null,
        status: input.status || 'draft',
        notes: input.notes?.trim() || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockOffers = [newOffer, ...mockOffers];
      return newOffer;
    }
    throw cause;
  }
}

export async function updateOfferStatus(id: string, status: OfferStatus): Promise<JobOffer> {
  try {
    return await identityRequest<JobOffer>(`/api/recruitment/offers/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      const idx = mockOffers.findIndex((o) => o.id === id);
      if (idx !== -1 && mockOffers[idx]) {
        const updated: JobOffer = {
          ...mockOffers[idx],
          status,
          updatedAt: new Date().toISOString(),
        };
        mockOffers[idx] = updated;

        // When offer is accepted, create corresponding pending joining record if not exists
        if (status === 'accepted') {
          const existingJoining = mockJoinings.find((j) => j.offerId === id);
          if (!existingJoining) {
            const newJoining: CandidateJoining = {
              id: `join-${Date.now()}`,
              candidateId: updated.candidateId,
              candidateName: updated.candidateName,
              candidateEmail: updated.candidateEmail,
              offerId: updated.id,
              expectedJoiningDate: updated.expectedJoiningDate ?? new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0] ?? '2026-10-15',
              status: 'pending',
              notes: 'Created upon job offer acceptance.',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            mockJoinings = [newJoining, ...mockJoinings];
          }
        }
        return updated;
      }
    }
    throw cause;
  }
}

/**
 * 5. Joining
 */
export async function listJoinings(filter?: JoiningFilter): Promise<CandidateJoining[]> {
  try {
    const params = new URLSearchParams();
    if (filter?.status && filter.status !== 'all') params.set('status', filter.status);
    const qs = params.toString();
    const endpoint = qs ? `/api/recruitment/joining?${qs}` : '/api/recruitment/joining';
    return await identityRequest<CandidateJoining[]>(endpoint);
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      let filtered = [...mockJoinings];
      if (filter?.status && filter.status !== 'all') {
        filtered = filtered.filter((j) => j.status === filter.status);
      }
      return filtered;
    }
    throw cause;
  }
}

export async function updateJoiningStatus(id: string, input: UpdateJoiningStatusInput): Promise<CandidateJoining> {
  try {
    return await identityRequest<CandidateJoining>(`/api/recruitment/joining/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  } catch (cause) {
    if (cause instanceof IdentityApiError && cause.status === 404) {
      const idx = mockJoinings.findIndex((j) => j.id === id);
      if (idx !== -1 && mockJoinings[idx]) {
        const updated: CandidateJoining = {
          ...mockJoinings[idx],
          status: input.status,
          actualJoiningDate: input.actualJoiningDate ?? (input.status === 'joined' ? new Date().toISOString().split('T')[0] : mockJoinings[idx].actualJoiningDate),
          notes: input.notes ?? mockJoinings[idx].notes,
          updatedAt: new Date().toISOString(),
        };
        mockJoinings[idx] = updated;
        return updated;
      }
    }
    throw cause;
  }
}

/**
 * 6. Metrics Aggregate
 */
export async function getRecruitmentMetrics(): Promise<RecruitmentMetrics> {
  const [reqs, cands, ints, offs, joins] = await Promise.all([
    listRequisitions(),
    listCandidates(),
    listInterviews(),
    listOffers(),
    listJoinings(),
  ]);

  return {
    openRequisitions: reqs.filter((r) => r.status === 'open').length,
    activeCandidates: cands.filter((c) => c.status !== 'rejected' && c.status !== 'withdrawn').length,
    candidatesInScreening: cands.filter((c) => c.status === 'screening').length,
    upcomingInterviews: ints.filter((i) => i.status === 'scheduled').length,
    offersPending: offs.filter((o) => o.status === 'draft' || o.status === 'sent').length,
    joiningPending: joins.filter((j) => j.status === 'pending' || j.status === 'confirmed').length,
  };
}

// ---------------------------------------------------------------------
// 7. Application Links (HR)
// ---------------------------------------------------------------------

export async function createApplicationLink(
  input: CreateApplicationLinkInput,
): Promise<RecruitmentApplicationLink> {
  return await identityRequest<RecruitmentApplicationLink>('/api/recruitment/application-links', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listApplicationLinks(
  requisitionId?: string,
): Promise<RecruitmentApplicationLink[]> {
  const endpoint = requisitionId
    ? `/api/recruitment/application-links?requisitionId=${encodeURIComponent(requisitionId)}`
    : '/api/recruitment/application-links';
  return await identityRequest<RecruitmentApplicationLink[]>(endpoint);
}

export async function updateApplicationLinkStatus(
  id: string,
  input: UpdateApplicationLinkStatusInput,
): Promise<RecruitmentApplicationLink> {
  return await identityRequest<RecruitmentApplicationLink>(
    `/api/recruitment/application-links/${encodeURIComponent(id)}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

// ---------------------------------------------------------------------
// 8. Public Application Link (Student)
// ---------------------------------------------------------------------

export async function getPublicApplicationLinkDetails(
  token: string,
): Promise<{ token: string; requisition: PublicJobRequisitionDetails; expiresAt: string | null }> {
  const response = await fetch(`/api/public/recruitment/apply/${encodeURIComponent(token)}`);
  if (!response.ok) {
    let errorMsg = 'This application link is no longer active.';
    try {
      const errJson = (await response.json()) as { error?: string };
      if (errJson.error) errorMsg = errJson.error;
    } catch {
      // Use fallback
    }
    throw new Error(errorMsg);
  }
  const raw = (await response.json()) as {
    data?: { token: string; requisition: PublicJobRequisitionDetails; expiresAt: string | null };
    token?: string;
    requisition?: PublicJobRequisitionDetails;
    expiresAt?: string | null;
  };
  return (raw.data ?? raw) as {
    token: string;
    requisition: PublicJobRequisitionDetails;
    expiresAt: string | null;
  };
}

export async function submitPublicApplication(
  token: string,
  input: PublicApplyInput,
): Promise<{ message: string; submissionId: string }> {
  const response = await fetch(`/api/public/recruitment/apply/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    let errorMsg = 'Failed to submit application.';
    try {
      const errJson = (await response.json()) as { error?: string };
      if (errJson.error) errorMsg = errJson.error;
    } catch {
      // Use fallback
    }
    throw new Error(errorMsg);
  }
  const raw = (await response.json()) as {
    data?: { message: string; submissionId: string };
    message?: string;
    submissionId?: string;
  };
  return (raw.data ?? raw) as { message: string; submissionId: string };
}

// ---------------------------------------------------------------------
// 9. Resume Submissions (HR)
// ---------------------------------------------------------------------

export async function submitHrManualResume(
  input: HrManualSubmissionInput,
): Promise<CandidateResumeSubmission> {
  return await identityRequest<CandidateResumeSubmission>(
    '/api/recruitment/resume-submissions/manual',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function listResumeSubmissions(
  filter?: ResumeSubmissionFilter,
): Promise<CandidateResumeSubmission[]> {
  const params = new URLSearchParams();
  if (filter?.search?.trim()) params.set('search', filter.search.trim());
  if (filter?.status && filter.status !== 'all') params.set('status', filter.status);
  if (filter?.requisitionId) params.set('requisitionId', filter.requisitionId);

  const qs = params.toString();
  const endpoint = qs
    ? `/api/recruitment/resume-submissions?${qs}`
    : '/api/recruitment/resume-submissions';

  return await identityRequest<CandidateResumeSubmission[]>(endpoint);
}

export async function getResumeSubmission(id: string): Promise<CandidateResumeSubmission> {
  return await identityRequest<CandidateResumeSubmission>(
    `/api/recruitment/resume-submissions/${encodeURIComponent(id)}`,
  );
}

export async function updateResumeSubmissionStatus(
  id: string,
  status: 'submitted' | 'reviewed' | 'rejected',
  rejectionReason?: string,
): Promise<CandidateResumeSubmission> {
  return await identityRequest<CandidateResumeSubmission>(
    `/api/recruitment/resume-submissions/${encodeURIComponent(id)}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status, rejectionReason: rejectionReason ?? null }),
    },
  );
}

export async function convertResumeSubmission(
  id: string,
  input?: ConvertSubmissionInput,
): Promise<{
  candidate?: Candidate;
  candidateId: string;
  submission: CandidateResumeSubmission;
  message?: string;
}> {
  const result = await identityRequest<{
    message?: string;
    candidate?: Candidate;
    candidateId?: string;
    submission: CandidateResumeSubmission;
  }>(`/api/recruitment/resume-submissions/${encodeURIComponent(id)}/convert`, {
    method: 'POST',
    body: JSON.stringify(input ?? {}),
  });
  return {
    ...result,
    candidateId: result.candidateId ?? result.candidate?.id ?? result.submission?.candidateId ?? '',
    submission: result.submission,
  };
}

export async function getResumeDownloadUrl(
  submissionId: string,
): Promise<{ downloadUrl: string; url: string; filename: string }> {
  const result = await identityRequest<{ url: string; filename: string }>(
    `/api/recruitment/resume-submissions/${encodeURIComponent(submissionId)}/resume-url`,
  );
  return {
    downloadUrl: result.url,
    url: result.url,
    filename: result.filename,
  };
}

// ---------------------------------------------------------------------
// 10. Interview Reschedule & Decision (HR)
// ---------------------------------------------------------------------

export async function rescheduleInterview(
  interviewId: string,
  input: RescheduleInterviewInput,
): Promise<{ message: string; interview: Interview }> {
  return await identityRequest<{ message: string; interview: Interview }>(
    `/api/recruitment/interviews/${encodeURIComponent(interviewId)}/reschedule`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export async function recordInterviewDecision(
  interviewId: string,
  input: InterviewDecisionInput,
): Promise<{ message: string; decision: string }> {
  return await identityRequest<{ message: string; decision: string }>(
    `/api/recruitment/interviews/${encodeURIComponent(interviewId)}/decision`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

// ---------------------------------------------------------------------
// 11. Candidate Hiring (HR)
// ---------------------------------------------------------------------

export async function hireCandidate(
  candidateId: string,
  input: HireCandidateInput,
): Promise<{ message: string; employeeId: string; joiningId: string }> {
  return await identityRequest<{ message: string; employeeId: string; joiningId: string }>(
    `/api/recruitment/candidates/${encodeURIComponent(candidateId)}/hire`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}
