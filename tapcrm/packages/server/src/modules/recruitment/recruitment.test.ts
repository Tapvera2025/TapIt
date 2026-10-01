import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { RequestContext } from '../../platform/dal/context.js';
import * as repo from './repository.js';
import { PlatformValidationError } from '../../platform/errors.js';
import { NotFoundError, ConflictError } from '../../platform/http/error-handler.js';
import type {
  Candidate,
  CandidateJoining,
  CandidateStatus,
  Interview,
  InterviewFeedback,
  InterviewStatus,
  JobOffer,
  JobRequisition,
  JoiningStatus,
  OfferStatus,
  RequisitionStatus,
  RecruitmentApplicationLink,
  CandidateResumeSubmission,
} from './types.js';
import {
  generateResumeObjectKey,
  getStorageService,
  MemoryStorageService,
  validateResumeUpload,
} from './storage.js';
import { parseResume } from './parser.js';
import {
  convertSubmissionSchema,
  createApplicationLinkSchema,
  hireCandidateSchema,
  hrManualSubmissionSchema,
  interviewDecisionSchema,
  publicApplySchema,
  rescheduleInterviewSchema,
  uploadCandidateResumeSchema,
  parseCandidateResumeSchema,
  scheduleInterviewSchema,
  submitFeedbackSchema,
  updateFeedbackSchema,
  createOfferSchema,
  updateOfferSchema,
  createJoiningSchema,
  updateJoiningSchema,
  updateJoiningStatusSchema,
} from './validators.js';
import {
  uploadCandidateResume,
  parseCandidateResume,
  scheduleInterview,
  submitInterviewFeedback,
  updateInterviewFeedback,
  createOffer,
  updateOffer,
  updateOfferStatus,
  createJoining,
  updateJoining,
  updateJoiningStatus,
  recordInterviewDecision,
  updateCandidateStatus,
  updateInterviewStatus,
  updateRequisitionStatus,
  resolvePublicApplicationLink,
  submitPublicApplication,
  createApplicationLink,
  updateApplicationLinkStatus,
  convertResumeSubmissionToCandidate,
  getResumeSignedUrl,
  getResumeFile,
} from './service.js';
import {
  notifyCandidateRejection,
  notifyInterviewRescheduled,
  notifyInterviewScheduled,
  notifyOnboardingWelcome,
} from './notifications.js';

describe('Recruitment Storage & Upload Validation', () => {
  it('MemoryStorageService stores, retrieves, generates signed URLs, and deletes files', async () => {
    const storage = new MemoryStorageService();
    const testKey = 'recruitment/resumes/org-123/sub-456/resume.pdf';
    const testBuffer = Buffer.from('PDF file content');
    const mimeType = 'application/pdf';

    await storage.putObject(testKey, testBuffer, mimeType);

    const retrieved = await storage.getObject(testKey);
    expect(retrieved).not.toBeNull();
    expect(retrieved.buffer.toString()).toBe('PDF file content');
    expect(retrieved.mimeType).toBe(mimeType);

    const signedUrl = await storage.getSignedUrl(testKey, 3600);
    expect(signedUrl).toContain(encodeURIComponent(testKey));

    await storage.deleteObject(testKey);
    await expect(storage.getObject(testKey)).rejects.toThrow('Object not found');
  });

  it('getStorageService returns MemoryStorageService in test environment', () => {
    const service = getStorageService();
    expect(service).toBeInstanceOf(MemoryStorageService);
  });

  it('validateResumeUpload accepts valid PDF, DOCX, DOC, and TXT files', () => {
    const validPdf = Buffer.from('%PDF-1.4 test resume');
    expect(validateResumeUpload(validPdf, 'resume.pdf', 'application/pdf').valid).toBe(true);

    const validDocx = Buffer.from('PK\x03\x04 fake docx content');
    expect(
      validateResumeUpload(
        validDocx,
        'resume.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ).valid,
    ).toBe(true);

    const validTxt = Buffer.from('Plain text resume content');
    expect(validateResumeUpload(validTxt, 'resume.txt', 'text/plain').valid).toBe(true);
  });

  it('validateResumeUpload rejects empty buffers', () => {
    const empty = Buffer.alloc(0);
    const result = validateResumeUpload(empty, 'empty.pdf', 'application/pdf');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('validateResumeUpload rejects files exceeding 10MB limit', () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
    const result = validateResumeUpload(oversized, 'huge.pdf', 'application/pdf');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('10MB');
  });

  it('validateResumeUpload rejects unsupported file types', () => {
    const image = Buffer.from('PNG image content');
    const result = validateResumeUpload(image, 'photo.png', 'image/png');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid file type');

    const exe = Buffer.from('executable binary');
    const exeResult = validateResumeUpload(exe, 'script.sh', 'application/x-sh');
    expect(exeResult.valid).toBe(false);
  });

  it('generateResumeObjectKey formats sharded path with proper extension', () => {
    const key = generateResumeObjectKey(
      'org-uuid-1',
      'sub-uuid-2',
      'John_Doe_CV.pdf',
    );
    expect(key).toMatch(/^recruitment\/resumes\/org-uuid-1\/sub-uuid-2\/[a-f0-9]{32}\.pdf$/);

    const docxKey = generateResumeObjectKey(
      'org-uuid-1',
      'sub-uuid-2',
      'Jane_Resume.docx',
    );
    expect(docxKey).toMatch(/^recruitment\/resumes\/org-uuid-1\/sub-uuid-2\/[a-f0-9]{32}\.docx$/);
  });
});

describe('Recruitment Resume Parser', () => {
  it('parses structured fields from plain text resume', async () => {
    const resumeText = `
      Johnathan Doe
      Email: johnathan.doe@example.com
      Phone: +1 (555) 234-5678

      Summary:
      Senior Software Engineer with 6 years of experience building distributed systems and cloud platforms.

      Skills:
      TypeScript, React, Node.js, PostgreSQL, Docker, AWS, GraphQL, Python, Redis

      Education:
      Bachelor of Science in Computer Science - State University, 2018
      Master of Technology in Software Systems - Tech Institute, 2020

      Experience:
      Software Engineer (2018 - 2024)
      6 years of experience in full-stack architecture and microservices deployment.
    `;

    const parsed = parseResume(Buffer.from(resumeText), 'resume.txt', 'text/plain');

    expect(parsed.name).toBe('Johnathan Doe');
    expect(parsed.email).toBe('johnathan.doe@example.com');
    expect(parsed.phone).toContain('555');
    expect(parsed.skills).toEqual(
      expect.arrayContaining(['typescript', 'react', 'node.js', 'postgresql', 'docker', 'aws', 'python', 'redis']),
    );
    expect(parsed.education).toBeDefined();
    expect(parsed.education?.length).toBeGreaterThan(0);
    expect(parsed.experience).toBeDefined();
    expect(parsed.experience?.length).toBeGreaterThan(0);
    expect(parsed.experience?.[0]?.title?.toLowerCase()).toContain('software engineer');
    expect(parsed.rawTextPreview).toContain('Johnathan Doe');
  });

  it('handles corrupted or empty buffer safely without throwing', async () => {
    const corruptBuffer = Buffer.from([0x00, 0x1f, 0x8b, 0xff, 0xee]);
    const parsed = parseResume(corruptBuffer, 'corrupted.pdf', 'application/pdf');

    expect(parsed).toBeDefined();
    expect(parsed.name).toBeNull();
    expect(parsed.email).toBeNull();
    expect(parsed.skills).toEqual([]);
    expect(parsed.rawTextPreview).toBeDefined();
  });
});

describe('Recruitment Validators', () => {
  const validUuid = '11111111-2222-3333-4444-555555555555';

  it('validates createApplicationLinkSchema', () => {
    const valid = {
      requisitionId: validUuid,
      expiresAt: '2026-12-31T23:59:59.000Z',
      status: 'active' as const,
    };
    expect(createApplicationLinkSchema.safeParse(valid).success).toBe(true);

    const invalid = {
      requisitionId: 'not-a-uuid',
      status: 'unknown_status',
    };
    expect(createApplicationLinkSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates publicApplySchema', () => {
    const valid = {
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
      phone: '+1987654321',
      resumeBase64: Buffer.from('Resume dummy content').toString('base64'),
      resumeFilename: 'Alice_CV.pdf',
      resumeMimeType: 'application/pdf',
    };
    expect(publicApplySchema.safeParse(valid).success).toBe(true);

    const invalidEmail = {
      ...valid,
      email: 'not-an-email',
    };
    expect(publicApplySchema.safeParse(invalidEmail).success).toBe(false);

    const missingResume = {
      ...valid,
      resumeBase64: '',
    };
    expect(publicApplySchema.safeParse(missingResume).success).toBe(false);
  });

  it('validates hrManualSubmissionSchema', () => {
    const valid = {
      requisitionId: validUuid,
      firstName: 'Bob',
      lastName: 'Williams',
      email: 'bob@example.com',
      resumeBase64: Buffer.from('Bob resume').toString('base64'),
      resumeFilename: 'bob_resume.docx',
      resumeMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    expect(hrManualSubmissionSchema.safeParse(valid).success).toBe(true);

    const missingName = {
      ...valid,
      firstName: '',
    };
    expect(hrManualSubmissionSchema.safeParse(missingName).success).toBe(false);
  });

  it('validates convertSubmissionSchema', () => {
    expect(
      convertSubmissionSchema.safeParse({
        source: 'referral',
        screeningNotes: 'Promising candidate',
        firstName: 'Jane',
        lastName: 'Doe',
      }).success,
    ).toBe(true);

    expect(
      convertSubmissionSchema.safeParse({
        source: 'invalid_source',
      }).success,
    ).toBe(false);
  });

  it('validates rescheduleInterviewSchema', () => {
    const valid = {
      scheduledAt: '2026-10-15T14:00:00.000Z',
      durationMinutes: 60,
      locationOrLink: 'https://meet.google.com/abc-defg-hij',
      interviewerIds: [validUuid],
      notes: 'Rescheduling due to panel conflict',
    };
    expect(rescheduleInterviewSchema.safeParse(valid).success).toBe(true);

    const invalidDuration = {
      ...valid,
      durationMinutes: 0,
    };
    expect(rescheduleInterviewSchema.safeParse(invalidDuration).success).toBe(false);
  });

  it('validates interviewDecisionSchema', () => {
    const selected = {
      decision: 'accepted' as const,
      notes: 'Strong candidate, recommended for hire',
    };
    expect(interviewDecisionSchema.safeParse(selected).success).toBe(true);

    const rejected = {
      decision: 'rejected' as const,
      rejectionReason: 'Lacks required depth in distributed systems',
    };
    expect(interviewDecisionSchema.safeParse(rejected).success).toBe(true);

    const invalidDecision = {
      decision: 'maybe',
      notes: 'Uncertain',
    };
    expect(interviewDecisionSchema.safeParse(invalidDecision).success).toBe(false);
  });

  it('validates hireCandidateSchema', () => {
    const valid = {
      actualJoiningDate: '2026-11-01',
      teamId: validUuid,
      reportsTo: validUuid,
      specialization: 'Backend Systems',
      password: 'InitialPassword123!',
    };
    expect(hireCandidateSchema.safeParse(valid).success).toBe(true);

    const invalidPassword = {
      ...valid,
      password: 'short',
    };
    expect(hireCandidateSchema.safeParse(invalidPassword).success).toBe(false);
  });
});

describe('Recruitment Email Notifications', () => {
  it('executes notification functions gracefully without throwing', async () => {
    await expect(
      notifyInterviewScheduled({
        to: 'candidate@example.com',
        candidateName: 'Candidate Name',
        requisitionTitle: 'Backend Engineer',
        stage: 'technical',
        round: 1,
        scheduledAt: '2026-10-10T10:00:00Z',
        durationMinutes: 45,
        locationOrLink: 'https://meet.google.com/test',
        notes: 'Panel interview',
      }),
    ).resolves.not.toThrow();

    await expect(
      notifyInterviewRescheduled({
        to: 'candidate@example.com',
        candidateName: 'Candidate Name',
        requisitionTitle: 'Backend Engineer',
        stage: 'technical',
        round: 1,
        newScheduledAt: '2026-10-12T14:00:00Z',
        durationMinutes: 60,
        locationOrLink: 'https://meet.google.com/rescheduled',
        notes: 'Panel availability',
      }),
    ).resolves.not.toThrow();

    await expect(
      notifyCandidateRejection({
        to: 'candidate@example.com',
        candidateName: 'Candidate Name',
        requisitionTitle: 'Backend Engineer',
        reason: 'Position filled',
      }),
    ).resolves.not.toThrow();

    await expect(
      notifyOnboardingWelcome({
        to: 'candidate@example.com',
        employeeName: 'New Hire',
        jobTitle: 'Software Engineer',
        departmentName: 'Engineering',
        joiningDate: '2026-11-01',
      }),
    ).resolves.not.toThrow();
  });
});

describe('Candidate Resume Upload & Parse Flow', () => {
  const mockCtx = {
    organizationId: 'org-test-uuid',
    principal: { id: 'user-test-uuid', type: 'user' as const, roles: ['hr'] },
    requestId: 'req-1',
  } as unknown as RequestContext;

  it('validates uploadCandidateResumeSchema and parseCandidateResumeSchema', () => {
    const validUpload = {
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      fileBase64: Buffer.from('PDF content').toString('base64'),
    };
    expect(uploadCandidateResumeSchema.parse(validUpload)).toBeDefined();

    const validParse = {
      resumeObjectKey: 'recruitment/resumes/org/sub/123.pdf',
      filename: 'resume.pdf',
    };
    expect(parseCandidateResumeSchema.parse(validParse)).toBeDefined();
  });

  it('uploads resume to storage and parses candidate information without hallucination', async () => {
    const sampleResume = `
Rahul Sharma
Email: rahul.sharma@example.com
Phone: +91 98765 43210

Skills: React, Node.js, TypeScript, PostgreSQL

Education:
B.Tech in Computer Science, 2021

Experience:
Software Engineer (2021 - Present)
`;
    const base64 = Buffer.from(sampleResume).toString('base64');

    const uploadResult = await uploadCandidateResume(mockCtx, {
      filename: 'Rahul_Sharma_Resume.txt',
      mimeType: 'text/plain',
      fileBase64: base64,
    });

    expect(uploadResult.resumeObjectKey).toContain('recruitment/resumes/org-test-uuid/');
    expect(uploadResult.resumeFileName).toBe('Rahul_Sharma_Resume.txt');
    expect(uploadResult.resumeSize).toBeGreaterThan(0);
    expect(uploadResult.previewUrl).toContain('/api/recruitment/candidates/resume/preview');

    const parseResult = await parseCandidateResume(mockCtx, {
      resumeObjectKey: uploadResult.resumeObjectKey,
      filename: uploadResult.resumeFileName,
      mimeType: uploadResult.resumeMimeType,
    });

    expect(parseResult.parsed.name).toBe('Rahul Sharma');
    expect(parseResult.parsed.firstName).toBe('Rahul');
    expect(parseResult.parsed.lastName).toBe('Sharma');
    expect(parseResult.parsed.email).toBe('rahul.sharma@example.com');
    expect(parseResult.parsed.phone).toContain('98765');
    expect(parseResult.parsed.skills).toContain('react');
    expect(parseResult.parsed.skills).toContain('node.js');
    expect(parseResult.parsed.skills).toContain('typescript');
    expect(parseResult.parsed.skills).toContain('postgresql');
  });

  it('gracefully handles resume with missing contact info without hallucinating data', async () => {
    const emptyResume = `Just some text without contact info or skills.`;
    const base64 = Buffer.from(emptyResume).toString('base64');

    const parseResult = await parseCandidateResume(mockCtx, {
      fileBase64: base64,
      filename: 'unknown.txt',
      mimeType: 'text/plain',
    });

    expect(parseResult.parsed.name).toBeNull();
    expect(parseResult.parsed.firstName).toBeNull();
    expect(parseResult.parsed.lastName).toBeNull();
    expect(parseResult.parsed.email).toBeNull();
    expect(parseResult.parsed.phone).toBeNull();
    expect(parseResult.parsed.skills).toEqual([]);
  });
});

describe('Candidate ↔ Job Requisition Relational Integrity', () => {
  const orgA = 'org-tenant-a';
  const orgB = 'org-tenant-b';

  const mockCtxOrgA = {
    organizationId: orgA,
    principal: { id: 'user-hr-1', type: 'user' as const, roles: ['hr'] },
    requestId: 'req-1',
  } as unknown as RequestContext;

  const candidateA: Candidate = {
    id: '11111111-1111-1111-1111-111111111111',
    organizationId: orgA,
    requisitionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    firstName: 'Alice',
    lastName: 'Smith',
    fullName: 'Alice Smith',
    email: 'alice@example.com',
    phone: '+1234567890',
    resumeUrl: null,
    source: 'direct',
    status: 'screening',
    screeningNotes: null,
    rejectionReason: null,
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const requisition1: JobRequisition = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    organizationId: orgA,
    requisitionNumber: 'REQ-0001',
    title: 'Senior Software Engineer',
    departmentId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    positionId: null,
    openingsCount: 1,
    employmentType: 'full_time',
    location: 'Remote',
    description: 'Dev role',
    requirements: 'TypeScript, Node.js',
    status: 'open',
    targetHireDate: null,
    closedAt: null,
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const requisition2: JobRequisition = {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    organizationId: orgA,
    requisitionNumber: 'REQ-0002',
    title: 'Product Manager',
    departmentId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    positionId: null,
    openingsCount: 1,
    employmentType: 'full_time',
    location: 'Remote',
    description: 'PM role',
    requirements: 'Product specs',
    status: 'open',
    targetHireDate: null,
    closedAt: null,
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockInterview: Interview = {
    id: '99999999-9999-9999-9999-999999999999',
    organizationId: orgA,
    candidateId: candidateA.id,
    requisitionId: requisition1.id,
    stage: 'technical',
    round: 1,
    interviewType: 'video',
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    durationMinutes: 60,
    locationOrLink: 'https://meet.google.com/abc',
    status: 'scheduled',
    notes: 'Technical round',
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockOffer: JobOffer = {
    id: '88888888-8888-8888-8888-888888888888',
    organizationId: orgA,
    candidateId: candidateA.id,
    requisitionId: requisition1.id,
    positionId: null,
    designationId: null,
    offeredSalary: '1200000',
    currency: 'INR',
    offerDate: '2026-10-01',
    validUntil: '2026-10-15',
    expectedJoiningDate: '2026-11-01',
    status: 'draft',
    notes: 'Standard offer',
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. matching Candidate + Requisition → ALLOW
  it('1. matching Candidate + Requisition -> ALLOW for both scheduleInterview and createOffer', async () => {
    vi.spyOn(repo, 'findCandidateById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgA && id === candidateA.id) return candidateA;
      return null;
    });
    vi.spyOn(repo, 'findRequisitionById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgA && id === requisition1.id) return requisition1;
      return null;
    });
    const createInterviewSpy = vi.spyOn(repo, 'createInterview').mockResolvedValue(mockInterview);
    const createOfferSpy = vi.spyOn(repo, 'createOffer').mockResolvedValue(mockOffer);

    // scheduleInterview
    // scheduleInterview
    const interviewResult = await scheduleInterview(
      mockCtxOrgA,
      scheduleInterviewSchema.parse({
        candidateId: candidateA.id,
        requisitionId: requisition1.id,
        stage: 'technical',
        round: 1,
        interviewType: 'video',
        scheduledAt: new Date().toISOString(),
        durationMinutes: 60,
        interviewerIds: [],
      }),
    );
    expect(interviewResult).toEqual(mockInterview);
    expect(createInterviewSpy).toHaveBeenCalledTimes(1);

    // createOffer
    const offerResult = await createOffer(
      mockCtxOrgA,
      createOfferSchema.parse({
        candidateId: candidateA.id,
        requisitionId: requisition1.id,
        offeredSalary: '1200000',
        currency: 'INR',
      }),
    );
    expect(offerResult).toEqual(mockOffer);
    expect(createOfferSpy).toHaveBeenCalledTimes(1);
  });

  // 2. mismatched Candidate + Requisition → DENY
  it('2. mismatched Candidate + Requisition -> DENY with PlatformValidationError and never rewrites requisitionId', async () => {
    vi.spyOn(repo, 'findCandidateById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgA && id === candidateA.id) return candidateA;
      return null;
    });
    vi.spyOn(repo, 'findRequisitionById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgA && id === requisition2.id) return requisition2;
      return null;
    });
    const createInterviewSpy = vi.spyOn(repo, 'createInterview');
    const createOfferSpy = vi.spyOn(repo, 'createOffer');

    // scheduleInterview with Candidate A (belongs to req1) + Requisition 2
    await expect(
      scheduleInterview(
        mockCtxOrgA,
        scheduleInterviewSchema.parse({
          candidateId: candidateA.id,
          requisitionId: requisition2.id, // Mismatch!
          stage: 'technical',
          round: 1,
          interviewType: 'video',
          scheduledAt: new Date().toISOString(),
          durationMinutes: 60,
          interviewerIds: [],
        }),
      ),
    ).rejects.toThrow(PlatformValidationError);

    await expect(
      scheduleInterview(
        mockCtxOrgA,
        scheduleInterviewSchema.parse({
          candidateId: candidateA.id,
          requisitionId: requisition2.id,
          stage: 'technical',
          round: 1,
          interviewType: 'video',
          scheduledAt: new Date().toISOString(),
          durationMinutes: 60,
          interviewerIds: [],
        }),
      ),
    ).rejects.toThrow('Candidate does not belong to the specified job requisition');

    expect(createInterviewSpy).not.toHaveBeenCalled();

    // createOffer with Candidate A (belongs to req1) + Requisition 2
    await expect(
      createOffer(
        mockCtxOrgA,
        createOfferSchema.parse({
          candidateId: candidateA.id,
          requisitionId: requisition2.id, // Mismatch!
          offeredSalary: '1200000',
          currency: 'INR',
        }),
      ),
    ).rejects.toThrow(PlatformValidationError);

    await expect(
      createOffer(
        mockCtxOrgA,
        createOfferSchema.parse({
          candidateId: candidateA.id,
          requisitionId: requisition2.id,
          offeredSalary: '1200000',
          currency: 'INR',
        }),
      ),
    ).rejects.toThrow('Candidate does not belong to the specified job requisition');

    expect(createOfferSpy).not.toHaveBeenCalled();
  });

  // 3. nonexistent Candidate → existing error
  it('3. nonexistent Candidate -> existing NotFoundError("Candidate")', async () => {
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(null);
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(requisition1);
    const createInterviewSpy = vi.spyOn(repo, 'createInterview');
    const createOfferSpy = vi.spyOn(repo, 'createOffer');

    await expect(
      scheduleInterview(
        mockCtxOrgA,
        scheduleInterviewSchema.parse({
          candidateId: '00000000-0000-0000-0000-000000000000',
          requisitionId: requisition1.id,
          stage: 'technical',
          round: 1,
          interviewType: 'video',
          scheduledAt: new Date().toISOString(),
          durationMinutes: 60,
          interviewerIds: [],
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    await expect(
      scheduleInterview(
        mockCtxOrgA,
        scheduleInterviewSchema.parse({
          candidateId: '00000000-0000-0000-0000-000000000000',
          requisitionId: requisition1.id,
          stage: 'technical',
          round: 1,
          interviewType: 'video',
          scheduledAt: new Date().toISOString(),
          durationMinutes: 60,
          interviewerIds: [],
        }),
      ),
    ).rejects.toThrow('Candidate not found');

    await expect(
      createOffer(
        mockCtxOrgA,
        createOfferSchema.parse({
          candidateId: '00000000-0000-0000-0000-000000000000',
          requisitionId: requisition1.id,
          offeredSalary: '1200000',
          currency: 'INR',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    await expect(
      createOffer(
        mockCtxOrgA,
        createOfferSchema.parse({
          candidateId: '00000000-0000-0000-0000-000000000000',
          requisitionId: requisition1.id,
          offeredSalary: '1200000',
          currency: 'INR',
        }),
      ),
    ).rejects.toThrow('Candidate not found');

    expect(createInterviewSpy).not.toHaveBeenCalled();
    expect(createOfferSpy).not.toHaveBeenCalled();
  });

  // 4. nonexistent Requisition → existing error
  it('4. nonexistent Requisition -> existing NotFoundError("Job requisition")', async () => {
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(candidateA);
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(null);
    const createInterviewSpy = vi.spyOn(repo, 'createInterview');
    const createOfferSpy = vi.spyOn(repo, 'createOffer');

    await expect(
      scheduleInterview(
        mockCtxOrgA,
        scheduleInterviewSchema.parse({
          candidateId: candidateA.id,
          requisitionId: '00000000-0000-0000-0000-000000000000',
          stage: 'technical',
          round: 1,
          interviewType: 'video',
          scheduledAt: new Date().toISOString(),
          durationMinutes: 60,
          interviewerIds: [],
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    await expect(
      scheduleInterview(
        mockCtxOrgA,
        scheduleInterviewSchema.parse({
          candidateId: candidateA.id,
          requisitionId: '00000000-0000-0000-0000-000000000000',
          stage: 'technical',
          round: 1,
          interviewType: 'video',
          scheduledAt: new Date().toISOString(),
          durationMinutes: 60,
          interviewerIds: [],
        }),
      ),
    ).rejects.toThrow('Job requisition not found');

    await expect(
      createOffer(
        mockCtxOrgA,
        createOfferSchema.parse({
          candidateId: candidateA.id,
          requisitionId: '00000000-0000-0000-0000-000000000000',
          offeredSalary: '1200000',
          currency: 'INR',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    await expect(
      createOffer(
        mockCtxOrgA,
        createOfferSchema.parse({
          candidateId: candidateA.id,
          requisitionId: '00000000-0000-0000-0000-000000000000',
          offeredSalary: '1200000',
          currency: 'INR',
        }),
      ),
    ).rejects.toThrow('Job requisition not found');

    expect(createInterviewSpy).not.toHaveBeenCalled();
    expect(createOfferSpy).not.toHaveBeenCalled();
  });

  // 5. cross-tenant mismatch → DENY
  it('5. cross-tenant mismatch -> DENY (tenant isolation throws NotFoundError without data leakage)', async () => {
    // Org A context trying to reference Org B's candidate
    vi.spyOn(repo, 'findCandidateById').mockImplementation(async (ctx, id) => {
      // Candidate exists in Org B only
      if (ctx.organizationId === orgB && id === candidateA.id) return { ...candidateA, organizationId: orgB };
      return null; // Org A caller cannot see Org B's candidate
    });
    vi.spyOn(repo, 'findRequisitionById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgA && id === requisition1.id) return requisition1;
      if (ctx.organizationId === orgB && id === requisition2.id) return { ...requisition2, organizationId: orgB };
      return null;
    });

    // Caller in Org A cannot access candidate from Org B
    await expect(
      scheduleInterview(
        mockCtxOrgA,
        scheduleInterviewSchema.parse({
          candidateId: candidateA.id,
          requisitionId: requisition1.id,
          stage: 'technical',
          round: 1,
          interviewType: 'video',
          scheduledAt: new Date().toISOString(),
          durationMinutes: 60,
          interviewerIds: [],
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    await expect(
      createOffer(
        mockCtxOrgA,
        createOfferSchema.parse({
          candidateId: candidateA.id,
          requisitionId: requisition1.id,
          offeredSalary: '1200000',
          currency: 'INR',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    // If candidate exists in Org A, but caller tries to pass requisition belonging to Org B
    vi.spyOn(repo, 'findCandidateById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgA && id === candidateA.id) return candidateA;
      return null;
    });

    await expect(
      scheduleInterview(
        mockCtxOrgA,
        scheduleInterviewSchema.parse({
          candidateId: candidateA.id,
          requisitionId: requisition2.id, // Belongs to Org B
          stage: 'technical',
          round: 1,
          interviewType: 'video',
          scheduledAt: new Date().toISOString(),
          durationMinutes: 60,
          interviewerIds: [],
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    await expect(
      createOffer(
        mockCtxOrgA,
        createOfferSchema.parse({
          candidateId: candidateA.id,
          requisitionId: requisition2.id, // Belongs to Org B
          offeredSalary: '1200000',
          currency: 'INR',
        }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  // 6. existing valid workflow remains valid
  it('6. existing valid workflow remains valid with requisition ID preserved', async () => {
    vi.spyOn(repo, 'findCandidateById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgA && id === candidateA.id) return candidateA;
      return null;
    });
    vi.spyOn(repo, 'findRequisitionById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgA && id === requisition1.id) return requisition1;
      return null;
    });

    const createInterviewSpy = vi.spyOn(repo, 'createInterview').mockImplementation(async (_ctx, input) => {
      return {
        ...mockInterview,
        candidateId: input.candidateId,
        requisitionId: input.requisitionId,
      };
    });

    const createOfferSpy = vi.spyOn(repo, 'createOffer').mockImplementation(async (_ctx, input) => {
      return {
        ...mockOffer,
        candidateId: input.candidateId,
        requisitionId: input.requisitionId,
      };
    });

    const interview = await scheduleInterview(
      mockCtxOrgA,
      scheduleInterviewSchema.parse({
        candidateId: candidateA.id,
        requisitionId: requisition1.id,
        stage: 'final',
        round: 2,
        interviewType: 'in_person',
        scheduledAt: '2026-10-05T14:00:00.000Z',
        durationMinutes: 90,
        locationOrLink: 'Conference Room 3',
        interviewerIds: [],
      }),
    );

    expect(createInterviewSpy).toHaveBeenCalledWith(
      mockCtxOrgA,
      expect.objectContaining({ requisitionId: requisition1.id }),
    );
    expect(interview.requisitionId).toBe(requisition1.id);

    const offer = await createOffer(
      mockCtxOrgA,
      createOfferSchema.parse({
        candidateId: candidateA.id,
        requisitionId: requisition1.id,
        offeredSalary: '1500000',
        currency: 'INR',
        notes: 'Final offer',
      }),
    );

    expect(createOfferSpy).toHaveBeenCalledWith(
      mockCtxOrgA,
      expect.objectContaining({ requisitionId: requisition1.id }),
    );
    expect(offer.requisitionId).toBe(requisition1.id);
  });
});

describe('Offer ↔ Candidate ↔ Requisition Relational Integrity', () => {
  const orgA = 'org-tenant-a';
  const orgB = 'org-tenant-b';

  const mockCtxOrgA = {
    organizationId: orgA,
    principal: { id: 'user-hr-1', type: 'user' as const, roles: ['hr'] },
    requestId: 'req-1',
  } as unknown as RequestContext;

  const candidateA: Candidate = {
    id: '11111111-1111-1111-1111-111111111111',
    organizationId: orgA,
    requisitionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    firstName: 'Alice',
    lastName: 'Smith',
    fullName: 'Alice Smith',
    email: 'alice@example.com',
    phone: '+1234567890',
    resumeUrl: null,
    source: 'direct',
    status: 'screening',
    screeningNotes: null,
    rejectionReason: null,
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const candidateB: Candidate = {
    id: '22222222-2222-2222-2222-222222222222',
    organizationId: orgA,
    requisitionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    firstName: 'Bob',
    lastName: 'Jones',
    fullName: 'Bob Jones',
    email: 'bob@example.com',
    phone: '+1987654321',
    resumeUrl: null,
    source: 'direct',
    status: 'screening',
    screeningNotes: null,
    rejectionReason: null,
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const requisition1: JobRequisition = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    organizationId: orgA,
    requisitionNumber: 'REQ-0001',
    title: 'Senior Software Engineer',
    departmentId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    positionId: null,
    openingsCount: 1,
    employmentType: 'full_time',
    location: 'Remote',
    description: 'Dev role',
    requirements: 'TypeScript, Node.js',
    status: 'open',
    targetHireDate: null,
    closedAt: null,
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const requisition2: JobRequisition = {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    organizationId: orgA,
    requisitionNumber: 'REQ-0002',
    title: 'Product Manager',
    departmentId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    positionId: null,
    openingsCount: 1,
    employmentType: 'full_time',
    location: 'Remote',
    description: 'PM role',
    requirements: 'Product specs',
    status: 'open',
    targetHireDate: null,
    closedAt: null,
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const existingOffer1: JobOffer = {
    id: '88888888-8888-8888-8888-888888888888',
    organizationId: orgA,
    candidateId: candidateA.id,
    requisitionId: requisition1.id,
    positionId: null,
    designationId: null,
    offeredSalary: '1200000',
    currency: 'INR',
    offerDate: '2026-10-01',
    validUntil: '2026-10-15',
    expectedJoiningDate: '2026-11-01',
    status: 'draft',
    notes: 'Standard offer',
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('valid candidate + requisition -> ALLOW for createOffer', async () => {
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(candidateA);
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(requisition1);
    const createOfferSpy = vi.spyOn(repo, 'createOffer').mockResolvedValue(existingOffer1);

    const offer = await createOffer(
      mockCtxOrgA,
      createOfferSchema.parse({
        candidateId: candidateA.id,
        requisitionId: requisition1.id,
        offeredSalary: '1200000',
        currency: 'INR',
      }),
    );

    expect(offer).toEqual(existingOffer1);
    expect(createOfferSpy).toHaveBeenCalledWith(
      mockCtxOrgA,
      expect.objectContaining({
        candidateId: candidateA.id,
        requisitionId: requisition1.id,
      }),
    );
  });

  it('mismatched requisition -> DENY for createOffer', async () => {
    vi.spyOn(repo, 'findCandidateById').mockImplementation(async (ctx, id) => {
      if (id === candidateA.id) return candidateA;
      return null;
    });
    vi.spyOn(repo, 'findRequisitionById').mockImplementation(async (ctx, id) => {
      if (id === requisition2.id) return requisition2;
      return null;
    });
    const createOfferSpy = vi.spyOn(repo, 'createOffer');

    await expect(
      createOffer(
        mockCtxOrgA,
        createOfferSchema.parse({
          candidateId: candidateA.id,
          requisitionId: requisition2.id, // candidateA belongs to requisition1!
          offeredSalary: '1200000',
          currency: 'INR',
        }),
      ),
    ).rejects.toThrow(PlatformValidationError);

    expect(createOfferSpy).not.toHaveBeenCalled();
  });

  it('nonexistent candidate -> throws NotFoundError("Candidate")', async () => {
    vi.spyOn(repo, 'findOfferById').mockResolvedValue(existingOffer1);
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(null);
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(requisition1);
    const createOfferSpy = vi.spyOn(repo, 'createOffer');
    const updateOfferSpy = vi.spyOn(repo, 'updateOffer');

    await expect(
      createOffer(
        mockCtxOrgA,
        createOfferSchema.parse({
          candidateId: '00000000-0000-0000-0000-000000000000',
          requisitionId: requisition1.id,
          offeredSalary: '1200000',
          currency: 'INR',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    await expect(
      updateOffer(
        mockCtxOrgA,
        existingOffer1.id,
        updateOfferSchema.parse({
          candidateId: '00000000-0000-0000-0000-000000000000',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    expect(createOfferSpy).not.toHaveBeenCalled();
    expect(updateOfferSpy).not.toHaveBeenCalled();
  });

  it('nonexistent requisition -> throws NotFoundError("Job requisition")', async () => {
    vi.spyOn(repo, 'findOfferById').mockResolvedValue(existingOffer1);
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(candidateA);
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(null);
    const createOfferSpy = vi.spyOn(repo, 'createOffer');
    const updateOfferSpy = vi.spyOn(repo, 'updateOffer');

    await expect(
      createOffer(
        mockCtxOrgA,
        createOfferSchema.parse({
          candidateId: candidateA.id,
          requisitionId: '00000000-0000-0000-0000-000000000000',
          offeredSalary: '1200000',
          currency: 'INR',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    await expect(
      updateOffer(
        mockCtxOrgA,
        existingOffer1.id,
        updateOfferSchema.parse({
          requisitionId: '00000000-0000-0000-0000-000000000000',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    expect(createOfferSpy).not.toHaveBeenCalled();
    expect(updateOfferSpy).not.toHaveBeenCalled();
  });

  it('cross-tenant IDs -> DENY via tenant isolation', async () => {
    vi.spyOn(repo, 'findOfferById').mockResolvedValue(existingOffer1);
    vi.spyOn(repo, 'findCandidateById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgB && id === candidateA.id) return { ...candidateA, organizationId: orgB };
      return null;
    });
    vi.spyOn(repo, 'findRequisitionById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgA && id === requisition1.id) return requisition1;
      return null;
    });

    await expect(
      createOffer(
        mockCtxOrgA,
        createOfferSchema.parse({
          candidateId: candidateA.id,
          requisitionId: requisition1.id,
          offeredSalary: '1200000',
          currency: 'INR',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    await expect(
      updateOffer(
        mockCtxOrgA,
        existingOffer1.id,
        updateOfferSchema.parse({
          candidateId: candidateA.id,
        }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('update cannot create mismatch -> DENY with PlatformValidationError', async () => {
    vi.spyOn(repo, 'findOfferById').mockResolvedValue(existingOffer1);
    vi.spyOn(repo, 'findCandidateById').mockImplementation(async (ctx, id) => {
      if (id === candidateA.id) return candidateA; // candidateA belongs to requisition1
      if (id === candidateB.id) return candidateB; // candidateB belongs to requisition2
      return null;
    });
    vi.spyOn(repo, 'findRequisitionById').mockImplementation(async (ctx, id) => {
      if (id === requisition1.id) return requisition1;
      if (id === requisition2.id) return requisition2;
      return null;
    });
    const updateOfferSpy = vi.spyOn(repo, 'updateOffer');
    const updateOfferStatusSpy = vi.spyOn(repo, 'updateOfferStatus');

    // 1. Updating requisition to requisition2 on existing offer (which has candidateA) -> mismatch!
    await expect(
      updateOffer(
        mockCtxOrgA,
        existingOffer1.id,
        updateOfferSchema.parse({
          requisitionId: requisition2.id,
        }),
      ),
    ).rejects.toThrow(PlatformValidationError);

    // 2. Updating candidate to candidateB on existing offer (which has requisition1) -> mismatch!
    await expect(
      updateOffer(
        mockCtxOrgA,
        existingOffer1.id,
        updateOfferSchema.parse({
          candidateId: candidateB.id,
        }),
      ),
    ).rejects.toThrow(PlatformValidationError);

    // 3. Updating both candidate and requisition to mismatched pair
    await expect(
      updateOffer(
        mockCtxOrgA,
        existingOffer1.id,
        updateOfferSchema.parse({
          candidateId: candidateA.id,
          requisitionId: requisition2.id,
        }),
      ),
    ).rejects.toThrow(PlatformValidationError);

    expect(updateOfferSpy).not.toHaveBeenCalled();

    // 4. Updating status on an inconsistent offer record also rejects
    const inconsistentOffer: JobOffer = {
      ...existingOffer1,
      candidateId: candidateA.id, // belongs to requisition1
      requisitionId: requisition2.id, // mismatch
    };
    vi.spyOn(repo, 'findOfferById').mockResolvedValue(inconsistentOffer);

    await expect(
      updateOfferStatus(mockCtxOrgA, existingOffer1.id, 'sent'),
    ).rejects.toThrow(PlatformValidationError);

    expect(updateOfferStatusSpy).not.toHaveBeenCalled();
  });

  it('existing valid offers remain valid -> ALLOW updates on matching records', async () => {
    vi.spyOn(repo, 'findOfferById').mockResolvedValue(existingOffer1);
    vi.spyOn(repo, 'findCandidateById').mockImplementation(async (ctx, id) => {
      if (id === candidateA.id) return candidateA;
      if (id === candidateB.id) return candidateB;
      return null;
    });
    vi.spyOn(repo, 'findRequisitionById').mockImplementation(async (ctx, id) => {
      if (id === requisition1.id) return requisition1;
      if (id === requisition2.id) return requisition2;
      return null;
    });

    const updateOfferSpy = vi.spyOn(repo, 'updateOffer').mockImplementation(async (_ctx, _id, input) => ({
      ...existingOffer1,
      offeredSalary: input.offeredSalary ?? existingOffer1.offeredSalary,
      status: input.status ?? existingOffer1.status,
      candidateId: input.candidateId ?? existingOffer1.candidateId,
      requisitionId: input.requisitionId ?? existingOffer1.requisitionId,
      notes: input.notes !== undefined ? input.notes : existingOffer1.notes,
    }));

    const updateOfferStatusSpy = vi.spyOn(repo, 'updateOfferStatus').mockImplementation(async (_ctx, _id, status) => ({
      ...existingOffer1,
      status: status as JobOffer['status'],
    }));

    // Update non-relational fields on existing valid offer
    const updatedSalaryOffer = await updateOffer(
      mockCtxOrgA,
      existingOffer1.id,
      updateOfferSchema.parse({
        offeredSalary: '1600000',
        notes: 'Updated compensation',
      }),
    );
    expect(updatedSalaryOffer.offeredSalary).toBe('1600000');
    expect(updatedSalaryOffer.candidateId).toBe(candidateA.id);
    expect(updatedSalaryOffer.requisitionId).toBe(requisition1.id);
    expect(updateOfferSpy).toHaveBeenCalledTimes(1);

    // Update to matching candidateB + requisition2
    const updatedPairOffer = await updateOffer(
      mockCtxOrgA,
      existingOffer1.id,
      updateOfferSchema.parse({
        candidateId: candidateB.id,
        requisitionId: requisition2.id,
      }),
    );
    expect(updatedPairOffer.candidateId).toBe(candidateB.id);
    expect(updatedPairOffer.requisitionId).toBe(requisition2.id);

    // Update status on valid offer
    const statusUpdated = await updateOfferStatus(mockCtxOrgA, existingOffer1.id, 'sent');
    expect(statusUpdated.status).toBe('sent');
    expect(updateOfferStatusSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Joining ↔ Offer ↔ Candidate Relational Integrity', () => {
  const orgA = '11111111-1111-1111-1111-111111111111';
  const orgB = '22222222-2222-2222-2222-222222222222';

  const mockCtxOrgA = {
    organizationId: orgA,
    principal: { id: 'user-hr-1', type: 'user' as const, roles: ['hr'] },
    requestId: 'req-1',
  } as unknown as RequestContext;

  const candidateA: Candidate = {
    id: '11111111-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    organizationId: orgA,
    requisitionId: '33333333-3333-4333-a333-333333333333',
    firstName: 'Candidate',
    lastName: 'One',
    email: 'c1@example.com',
    phone: '1234567890',
    resumeUrl: null,
    source: 'direct',
    status: 'selected',
    screeningNotes: null,
    rejectionReason: null,
    createdBy: 'user-hr-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const candidateB: Candidate = {
    id: '22222222-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    organizationId: orgA,
    requisitionId: '44444444-4444-4444-a444-444444444444',
    firstName: 'Candidate',
    lastName: 'Two',
    email: 'c2@example.com',
    phone: '9876543210',
    resumeUrl: null,
    source: 'direct',
    status: 'selected',
    screeningNotes: null,
    rejectionReason: null,
    createdBy: 'user-hr-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const offerA: JobOffer = {
    id: '55555555-5555-4555-a555-555555555555',
    organizationId: orgA,
    candidateId: candidateA.id,
    requisitionId: '33333333-3333-4333-a333-333333333333',
    positionId: null,
    designationId: null,
    offeredSalary: '1200000',
    currency: 'INR',
    offerDate: '2026-10-01',
    validUntil: null,
    expectedJoiningDate: '2026-11-01',
    status: 'accepted',
    notes: null,
    createdBy: 'user-hr-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const offerB: JobOffer = {
    id: '66666666-6666-4666-a666-666666666666',
    organizationId: orgA,
    candidateId: candidateB.id,
    requisitionId: '44444444-4444-4444-a444-444444444444',
    positionId: null,
    designationId: null,
    offeredSalary: '1500000',
    currency: 'INR',
    offerDate: '2026-10-01',
    validUntil: null,
    expectedJoiningDate: '2026-11-01',
    status: 'accepted',
    notes: null,
    createdBy: 'user-hr-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const existingJoiningA: CandidateJoining = {
    id: '77777777-7777-4777-a777-777777777777',
    organizationId: orgA,
    candidateId: candidateA.id,
    offerId: offerA.id,
    expectedJoiningDate: '2026-11-01',
    actualJoiningDate: null,
    status: 'pending',
    employeeId: null,
    notes: null,
    createdBy: 'user-hr-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('matching candidate + offer -> ALLOW', async () => {
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(candidateA);
    vi.spyOn(repo, 'findOfferById').mockResolvedValue(offerA);
    const createJoiningSpy = vi.spyOn(repo, 'createJoining').mockResolvedValue(existingJoiningA);

    const result = await createJoining(
      mockCtxOrgA,
      createJoiningSchema.parse({
        candidateId: candidateA.id,
        offerId: offerA.id,
        expectedJoiningDate: '2026-11-01',
      }),
    );

    expect(result).toEqual(existingJoiningA);
    expect(createJoiningSpy).toHaveBeenCalledTimes(1);
    expect(createJoiningSpy).toHaveBeenCalledWith(
      mockCtxOrgA,
      expect.objectContaining({
        candidateId: candidateA.id,
        offerId: offerA.id,
        expectedJoiningDate: '2026-11-01',
      }),
    );
  });

  it('mismatched candidate + offer -> DENY with PlatformValidationError', async () => {
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(candidateB);
    vi.spyOn(repo, 'findOfferById').mockResolvedValue(offerA); // offerA belongs to candidateA
    const createJoiningSpy = vi.spyOn(repo, 'createJoining');

    await expect(
      createJoining(
        mockCtxOrgA,
        createJoiningSchema.parse({
          candidateId: candidateB.id,
          offerId: offerA.id,
          expectedJoiningDate: '2026-11-01',
        }),
      ),
    ).rejects.toThrow(PlatformValidationError);

    expect(createJoiningSpy).not.toHaveBeenCalled();
  });

  it('nonexistent offer -> DENY with NotFoundError', async () => {
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(candidateA);
    vi.spyOn(repo, 'findOfferById').mockResolvedValue(null);
    vi.spyOn(repo, 'findJoiningById').mockResolvedValue(existingJoiningA);
    const createJoiningSpy = vi.spyOn(repo, 'createJoining');
    const updateJoiningSpy = vi.spyOn(repo, 'updateJoining');

    await expect(
      createJoining(
        mockCtxOrgA,
        createJoiningSchema.parse({
          candidateId: candidateA.id,
          offerId: '00000000-0000-0000-0000-000000000000',
          expectedJoiningDate: '2026-11-01',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    await expect(
      updateJoining(
        mockCtxOrgA,
        existingJoiningA.id,
        updateJoiningSchema.parse({
          offerId: '00000000-0000-0000-0000-000000000000',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    expect(createJoiningSpy).not.toHaveBeenCalled();
    expect(updateJoiningSpy).not.toHaveBeenCalled();
  });

  it('nonexistent candidate -> DENY with NotFoundError', async () => {
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(null);
    vi.spyOn(repo, 'findOfferById').mockResolvedValue(offerA);
    vi.spyOn(repo, 'findJoiningById').mockResolvedValue(existingJoiningA);
    const createJoiningSpy = vi.spyOn(repo, 'createJoining');
    const updateJoiningSpy = vi.spyOn(repo, 'updateJoining');

    await expect(
      createJoining(
        mockCtxOrgA,
        createJoiningSchema.parse({
          candidateId: '00000000-0000-0000-0000-000000000000',
          offerId: offerA.id,
          expectedJoiningDate: '2026-11-01',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    await expect(
      updateJoining(
        mockCtxOrgA,
        existingJoiningA.id,
        updateJoiningSchema.parse({
          candidateId: '00000000-0000-0000-0000-000000000000',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    expect(createJoiningSpy).not.toHaveBeenCalled();
    expect(updateJoiningSpy).not.toHaveBeenCalled();
  });

  it('cross-tenant mismatch -> DENY via tenant isolation', async () => {
    vi.spyOn(repo, 'findCandidateById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgB && id === candidateA.id) return { ...candidateA, organizationId: orgB };
      return null;
    });
    vi.spyOn(repo, 'findOfferById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgA && id === offerA.id) return offerA;
      return null;
    });

    await expect(
      createJoining(
        mockCtxOrgA,
        createJoiningSchema.parse({
          candidateId: candidateA.id,
          offerId: offerA.id,
          expectedJoiningDate: '2026-11-01',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    // Cross-tenant offer
    vi.spyOn(repo, 'findCandidateById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgA && id === candidateA.id) return candidateA;
      return null;
    });
    vi.spyOn(repo, 'findOfferById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgB && id === offerA.id) return { ...offerA, organizationId: orgB };
      return null;
    });

    await expect(
      createJoining(
        mockCtxOrgA,
        createJoiningSchema.parse({
          candidateId: candidateA.id,
          offerId: offerA.id,
          expectedJoiningDate: '2026-11-01',
        }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('update cannot create mismatch -> DENY with PlatformValidationError', async () => {
    vi.spyOn(repo, 'findJoiningById').mockImplementation(async (_ctx, id) => {
      if (id === existingJoiningA.id) return existingJoiningA;
      return null;
    });
    vi.spyOn(repo, 'findCandidateById').mockImplementation(async (_ctx, id) => {
      if (id === candidateA.id) return candidateA;
      if (id === candidateB.id) return candidateB;
      return null;
    });
    vi.spyOn(repo, 'findOfferById').mockImplementation(async (_ctx, id) => {
      if (id === offerA.id) return offerA; // belongs to candidateA
      if (id === offerB.id) return offerB; // belongs to candidateB
      return null;
    });

    const updateJoiningSpy = vi.spyOn(repo, 'updateJoining');

    // Attempt to change candidateId to candidateB while keeping offerId as offerA (mismatch)
    await expect(
      updateJoining(
        mockCtxOrgA,
        existingJoiningA.id,
        updateJoiningSchema.parse({
          candidateId: candidateB.id,
        }),
      ),
    ).rejects.toThrow(PlatformValidationError);

    // Attempt to change offerId to offerB while keeping candidateId as candidateA (mismatch)
    await expect(
      updateJoining(
        mockCtxOrgA,
        existingJoiningA.id,
        updateJoiningSchema.parse({
          offerId: offerB.id,
        }),
      ),
    ).rejects.toThrow(PlatformValidationError);

    // Attempt to change both candidateId to candidateB and offerId to offerA (mismatch)
    await expect(
      updateJoining(
        mockCtxOrgA,
        existingJoiningA.id,
        updateJoiningSchema.parse({
          candidateId: candidateB.id,
          offerId: offerA.id,
        }),
      ),
    ).rejects.toThrow(PlatformValidationError);

    expect(updateJoiningSpy).not.toHaveBeenCalled();

    // Inconsistent state test for updateJoiningStatus
    const inconsistentJoining: CandidateJoining = {
      ...existingJoiningA,
      id: '88888888-8888-4888-a888-888888888888',
      candidateId: candidateB.id,
      offerId: offerA.id,
    };
    vi.spyOn(repo, 'findJoiningById').mockImplementation(async (_ctx, id) => {
      if (id === inconsistentJoining.id) return inconsistentJoining;
      if (id === existingJoiningA.id) return existingJoiningA;
      return null;
    });

    await expect(
      updateJoiningStatus(
        mockCtxOrgA,
        inconsistentJoining.id,
        updateJoiningStatusSchema.parse({
          status: 'confirmed',
        }),
      ),
    ).rejects.toThrow(PlatformValidationError);

    // Nonexistent joining
    await expect(
      updateJoining(
        mockCtxOrgA,
        '00000000-0000-0000-0000-000000000000',
        updateJoiningSchema.parse({
          notes: 'Nonexistent',
        }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('update preserves valid relationship -> ALLOW', async () => {
    vi.spyOn(repo, 'findJoiningById').mockImplementation(async (_ctx, id) => {
      if (id === existingJoiningA.id) return existingJoiningA;
      return null;
    });
    vi.spyOn(repo, 'findCandidateById').mockImplementation(async (_ctx, id) => {
      if (id === candidateA.id) return candidateA;
      if (id === candidateB.id) return candidateB;
      return null;
    });
    vi.spyOn(repo, 'findOfferById').mockImplementation(async (_ctx, id) => {
      if (id === offerA.id) return offerA;
      if (id === offerB.id) return offerB;
      return null;
    });

    const updateJoiningSpy = vi.spyOn(repo, 'updateJoining').mockImplementation(async (_ctx, _id, input) => ({
      ...existingJoiningA,
      candidateId: input.candidateId ?? existingJoiningA.candidateId,
      offerId: input.offerId ?? existingJoiningA.offerId,
      expectedJoiningDate: input.expectedJoiningDate ?? existingJoiningA.expectedJoiningDate,
      actualJoiningDate: input.actualJoiningDate !== undefined ? input.actualJoiningDate : existingJoiningA.actualJoiningDate,
      status: input.status ?? existingJoiningA.status,
      notes: input.notes !== undefined ? input.notes : existingJoiningA.notes,
    }));

    const updateJoiningStatusSpy = vi.spyOn(repo, 'updateJoiningStatus').mockImplementation(async (_ctx, _id, status, actualJoiningDate, notes) => ({
      ...existingJoiningA,
      status: status as CandidateJoining['status'],
      actualJoiningDate: actualJoiningDate !== undefined ? actualJoiningDate : existingJoiningA.actualJoiningDate,
      notes: notes !== undefined ? notes : existingJoiningA.notes,
    }));

    // Update non-relational fields on existing valid joining
    const updatedNotesJoining = await updateJoining(
      mockCtxOrgA,
      existingJoiningA.id,
      updateJoiningSchema.parse({
        notes: 'Joining date confirmed by candidate',
      }),
    );
    expect(updatedNotesJoining.notes).toBe('Joining date confirmed by candidate');
    expect(updatedNotesJoining.candidateId).toBe(candidateA.id);
    expect(updatedNotesJoining.offerId).toBe(offerA.id);
    expect(updateJoiningSpy).toHaveBeenCalledTimes(1);

    // Update to matching candidateB + offerB
    const updatedPairJoining = await updateJoining(
      mockCtxOrgA,
      existingJoiningA.id,
      updateJoiningSchema.parse({
        candidateId: candidateB.id,
        offerId: offerB.id,
      }),
    );
    expect(updatedPairJoining.candidateId).toBe(candidateB.id);
    expect(updatedPairJoining.offerId).toBe(offerB.id);

    // Update status on valid joining
    const statusUpdated = await updateJoiningStatus(
      mockCtxOrgA,
      existingJoiningA.id,
      updateJoiningStatusSchema.parse({
        status: 'confirmed',
      }),
    );
    expect(statusUpdated.status).toBe('confirmed');
    expect(updateJoiningStatusSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Interviewer ↔ Feedback Authorization & Integrity', () => {
  const orgA = '11111111-1111-4111-a111-111111111111';
  const orgB = '22222222-2222-4222-a222-222222222222';

  const mockCtxOrgA = {
    organizationId: orgA,
    principal: { id: 'user-hr-1', type: 'user' as const, roles: ['hr'] },
    requestId: 'req-1',
  } as unknown as RequestContext;

  const interviewerA = {
    id: '33333333-3333-4333-a333-333333333333',
    fullName: 'Interviewer Alice',
  };

  const interviewerB = {
    id: '44444444-4444-4444-a444-444444444444',
    fullName: 'Interviewer Bob',
  };

  const interviewerX = {
    id: '55555555-5555-4555-a555-555555555555',
    fullName: 'Interviewer Xavier (Unassigned)',
  };

  const interviewerOrgB = {
    id: '66666666-6666-4666-a666-666666666666',
    fullName: 'Cross-Tenant User',
  };

  const interview1Id = '77777777-7777-4777-a777-777777777777';
  const feedback1Id = '88888888-8888-4888-a888-888888888888';

  const interview1: Interview = {
    id: interview1Id,
    organizationId: orgA,
    candidateId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    requisitionId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
    stage: 'technical',
    round: 1,
    interviewType: 'video',
    scheduledAt: new Date(),
    durationMinutes: 60,
    locationOrLink: 'https://meet.google.com/abc-defg-hij',
    status: 'scheduled',
    notes: null,
    interviewerIds: [interviewerA.id, interviewerB.id],
    interviewerNames: [interviewerA.fullName, interviewerB.fullName],
    feedback: [],
    createdBy: 'user-hr-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const existingFeedback1: InterviewFeedback = {
    id: feedback1Id,
    organizationId: orgA,
    interviewId: interview1Id,
    interviewerId: interviewerA.id,
    interviewerName: interviewerA.fullName,
    recommendation: 'hire',
    rating: 4,
    feedback: 'Strong technical depth',
    strengths: 'Clean architecture',
    areasForImprovement: 'None',
    submittedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('assigned interviewer -> ALLOW', async () => {
    vi.spyOn(repo, 'findInterviewById').mockResolvedValue(interview1);
    vi.spyOn(repo, 'findUserById').mockImplementation(async (_ctx, id) => {
      if (id === interviewerA.id) return interviewerA;
      if (id === interviewerB.id) return interviewerB;
      return null;
    });
    const createFeedbackSpy = vi.spyOn(repo, 'createInterviewFeedback').mockResolvedValue(existingFeedback1);

    // Interviewer A is assigned
    const resultA = await submitInterviewFeedback(
      mockCtxOrgA,
      interview1Id,
      submitFeedbackSchema.parse({
        interviewerId: interviewerA.id,
        recommendation: 'hire',
        rating: 4,
        feedback: 'Strong technical depth',
      }),
    );
    expect(resultA).toEqual(existingFeedback1);
    expect(createFeedbackSpy).toHaveBeenCalledTimes(1);

    // Interviewer B is also assigned
    const feedbackB: InterviewFeedback = {
      ...existingFeedback1,
      id: '99999999-9999-4999-a999-999999999999',
      interviewerId: interviewerB.id,
      interviewerName: interviewerB.fullName,
    };
    createFeedbackSpy.mockResolvedValueOnce(feedbackB);

    const resultB = await submitInterviewFeedback(
      mockCtxOrgA,
      interview1Id,
      submitFeedbackSchema.parse({
        interviewerId: interviewerB.id,
        recommendation: 'strong_hire',
        rating: 5,
        feedback: 'Exceptional answers',
      }),
    );
    expect(resultB.interviewerId).toBe(interviewerB.id);
    expect(createFeedbackSpy).toHaveBeenCalledTimes(2);
  });

  it('unassigned interviewer -> DENY with PlatformValidationError', async () => {
    vi.spyOn(repo, 'findInterviewById').mockResolvedValue(interview1);
    vi.spyOn(repo, 'findUserById').mockImplementation(async (_ctx, id) => {
      if (id === interviewerX.id) return interviewerX;
      return null;
    });
    const createFeedbackSpy = vi.spyOn(repo, 'createInterviewFeedback');

    // Interviewer X exists in the org, but is NOT assigned to interview1
    await expect(
      submitInterviewFeedback(
        mockCtxOrgA,
        interview1Id,
        submitFeedbackSchema.parse({
          interviewerId: interviewerX.id,
          recommendation: 'hire',
          rating: 4,
          feedback: 'Unauthorized feedback submission',
        }),
      ),
    ).rejects.toThrow(PlatformValidationError);

    expect(createFeedbackSpy).not.toHaveBeenCalled();
  });

  it('nonexistent interviewer -> DENY with NotFoundError', async () => {
    vi.spyOn(repo, 'findInterviewById').mockResolvedValue(interview1);
    vi.spyOn(repo, 'findUserById').mockResolvedValue(null);
    const createFeedbackSpy = vi.spyOn(repo, 'createInterviewFeedback');

    await expect(
      submitInterviewFeedback(
        mockCtxOrgA,
        interview1Id,
        submitFeedbackSchema.parse({
          interviewerId: '00000000-0000-0000-0000-000000000000',
          recommendation: 'hire',
          rating: 4,
          feedback: 'Nonexistent interviewer',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    expect(createFeedbackSpy).not.toHaveBeenCalled();
  });

  it('nonexistent interview -> DENY with NotFoundError', async () => {
    vi.spyOn(repo, 'findInterviewById').mockResolvedValue(null);
    vi.spyOn(repo, 'findUserById').mockResolvedValue(interviewerA);
    const createFeedbackSpy = vi.spyOn(repo, 'createInterviewFeedback');

    await expect(
      submitInterviewFeedback(
        mockCtxOrgA,
        '00000000-0000-0000-0000-000000000000',
        submitFeedbackSchema.parse({
          interviewerId: interviewerA.id,
          recommendation: 'hire',
          rating: 4,
          feedback: 'Feedback for non-existent interview',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    expect(createFeedbackSpy).not.toHaveBeenCalled();
  });

  it('cross-tenant interviewer -> DENY via tenant isolation', async () => {
    vi.spyOn(repo, 'findInterviewById').mockResolvedValue(interview1);
    // User exists in orgB, but queries in orgA return null
    vi.spyOn(repo, 'findUserById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgB && id === interviewerOrgB.id) return interviewerOrgB;
      return null;
    });

    await expect(
      submitInterviewFeedback(
        mockCtxOrgA,
        interview1Id,
        submitFeedbackSchema.parse({
          interviewerId: interviewerOrgB.id,
          recommendation: 'hire',
          rating: 4,
          feedback: 'Cross-tenant feedback attempt',
        }),
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('update cannot bypass -> DENY with PlatformValidationError', async () => {
    vi.spyOn(repo, 'findInterviewFeedbackById').mockResolvedValue(existingFeedback1);
    vi.spyOn(repo, 'findInterviewById').mockResolvedValue(interview1);
    vi.spyOn(repo, 'findUserById').mockImplementation(async (_ctx, id) => {
      if (id === interviewerA.id) return interviewerA;
      if (id === interviewerB.id) return interviewerB;
      if (id === interviewerX.id) return interviewerX;
      return null;
    });
    const updateFeedbackSpy = vi.spyOn(repo, 'updateInterviewFeedback');

    // Attempting to change interviewerId to an unassigned user
    await expect(
      updateInterviewFeedback(
        mockCtxOrgA,
        existingFeedback1.id,
        updateFeedbackSchema.parse({
          interviewerId: interviewerX.id,
        }),
      ),
    ).rejects.toThrow(PlatformValidationError);

    // Attempting to update with nonexistent interviewer
    await expect(
      updateInterviewFeedback(
        mockCtxOrgA,
        existingFeedback1.id,
        updateFeedbackSchema.parse({
          interviewerId: '00000000-0000-0000-0000-000000000000',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    // Attempting to update nonexistent feedback
    vi.spyOn(repo, 'findInterviewFeedbackById').mockResolvedValue(null);
    await expect(
      updateInterviewFeedback(
        mockCtxOrgA,
        '00000000-0000-0000-0000-000000000000',
        updateFeedbackSchema.parse({
          feedback: 'Updated notes',
        }),
      ),
    ).rejects.toThrow(NotFoundError);

    expect(updateFeedbackSpy).not.toHaveBeenCalled();
  });

  it('valid existing feedback remains valid -> ALLOW', async () => {
    vi.spyOn(repo, 'findInterviewFeedbackById').mockResolvedValue(existingFeedback1);
    vi.spyOn(repo, 'findInterviewById').mockResolvedValue(interview1);
    vi.spyOn(repo, 'findUserById').mockImplementation(async (_ctx, id) => {
      if (id === interviewerA.id) return interviewerA;
      if (id === interviewerB.id) return interviewerB;
      return null;
    });

    const updateFeedbackSpy = vi.spyOn(repo, 'updateInterviewFeedback').mockImplementation(async (_ctx, _id, input) => ({
      ...existingFeedback1,
      interviewerId: input.interviewerId ?? existingFeedback1.interviewerId,
      recommendation: input.recommendation ?? existingFeedback1.recommendation,
      rating: input.rating !== undefined ? input.rating : existingFeedback1.rating,
      feedback: input.feedback ?? existingFeedback1.feedback,
      strengths: input.strengths !== undefined ? input.strengths : existingFeedback1.strengths,
      areasForImprovement: input.areasForImprovement !== undefined ? input.areasForImprovement : existingFeedback1.areasForImprovement,
    }));

    // Update non-relational fields (notes, rating) keeping assigned interviewer
    const updatedContent = await updateInterviewFeedback(
      mockCtxOrgA,
      existingFeedback1.id,
      updateFeedbackSchema.parse({
        feedback: 'Updated evaluation comments after panel review',
        rating: 5,
      }),
    );
    expect(updatedContent.feedback).toBe('Updated evaluation comments after panel review');
    expect(updatedContent.rating).toBe(5);
    expect(updatedContent.interviewerId).toBe(interviewerA.id);
    expect(updateFeedbackSpy).toHaveBeenCalledTimes(1);

    // Update to interviewer B (who is also assigned)
    const updatedInterviewer = await updateInterviewFeedback(
      mockCtxOrgA,
      existingFeedback1.id,
      updateFeedbackSchema.parse({
        interviewerId: interviewerB.id,
      }),
    );
    expect(updatedInterviewer.interviewerId).toBe(interviewerB.id);
    expect(updateFeedbackSpy).toHaveBeenCalledTimes(2);
  });
});

describe('Recruitment Workflow — Decision & State Machine', () => {
  const orgA = 'org-tenant-a';
  const orgB = 'org-tenant-b';

  const mockCtxOrgA = {
    organizationId: orgA,
    principal: { id: 'user-hr-1', type: 'user' as const, roles: ['hr'] },
    requestId: 'req-state-a',
  } as unknown as RequestContext;

  const mockCtxOrgB = {
    organizationId: orgB,
    principal: { id: 'user-hr-2', type: 'user' as const, roles: ['hr'] },
    requestId: 'req-state-b',
  } as unknown as RequestContext;

  const mockRequisitionA: JobRequisition = {
    id: '11111111-2222-4333-a444-555555555555',
    organizationId: orgA,
    requisitionNumber: 'REQ-SM-001',
    title: 'Senior Engineer',
    departmentId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    positionId: null,
    openingsCount: 1,
    employmentType: 'full_time',
    location: 'Remote',
    description: 'Dev role',
    requirements: 'TypeScript, Node',
    status: 'draft',
    targetHireDate: null,
    closedAt: null,
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockCandidateA: Candidate = {
    id: '22222222-3333-4444-a555-666666666666',
    organizationId: orgA,
    requisitionId: mockRequisitionA.id,
    firstName: 'Charlie',
    lastName: 'Brown',
    fullName: 'Charlie Brown',
    email: 'charlie@example.com',
    phone: '+1234567890',
    resumeUrl: null,
    source: 'direct',
    status: 'applied',
    screeningNotes: null,
    rejectionReason: null,
    createdBy: 'user-hr-1',
    resumeFileName: null,
    resumeMimeType: null,
    resumeObjectKey: null,
    resumeSize: null,
    resumeUploadedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockInterviewA: Interview = {
    id: '33333333-4444-4555-a666-777777777777',
    organizationId: orgA,
    candidateId: mockCandidateA.id,
    requisitionId: mockRequisitionA.id,
    stage: 'technical',
    round: 1,
    interviewType: 'video',
    scheduledAt: new Date().toISOString(),
    durationMinutes: 60,
    locationOrLink: 'https://meet.example.com/interview',
    status: 'scheduled',
    notes: 'Initial technical interview',
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockOfferA: JobOffer = {
    id: '44444444-5555-4666-a777-888888888888',
    organizationId: orgA,
    candidateId: mockCandidateA.id,
    requisitionId: mockRequisitionA.id,
    positionId: null,
    designationId: null,
    offeredSalary: '100000',
    currency: 'USD',
    offerDate: '2026-10-01',
    validUntil: '2026-10-15',
    expectedJoiningDate: '2026-11-01',
    status: 'draft',
    notes: 'Standard offer',
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockJoiningA: CandidateJoining = {
    id: '55555555-6666-4777-a888-999999999999',
    organizationId: orgA,
    candidateId: mockCandidateA.id,
    offerId: mockOfferA.id,
    status: 'pending',
    expectedJoiningDate: '2026-11-01',
    actualJoiningDate: null,
    notes: null,
    employeeId: null,
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. valid transition
  it('1. valid transition -> permits allowed transitions for all recruitment entities', async () => {
    // Requisition: draft -> open
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(mockRequisitionA);
    const updateReqSpy = vi.spyOn(repo, 'updateRequisitionStatus').mockImplementation(async (_ctx, id, status) => ({
      ...mockRequisitionA,
      id,
      status: status as RequisitionStatus,
    }));
    const reqOpen = await updateRequisitionStatus(mockCtxOrgA, mockRequisitionA.id, 'open');
    expect(reqOpen.status).toBe('open');
    expect(updateReqSpy).toHaveBeenCalledWith(mockCtxOrgA, mockRequisitionA.id, 'open');

    // Candidate: applied -> screening
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(mockCandidateA);
    const updateCandSpy = vi.spyOn(repo, 'updateCandidateStatus').mockImplementation(async (_ctx, id, status) => ({
      ...mockCandidateA,
      id,
      status: status as CandidateStatus,
    }));
    const candScreening = await updateCandidateStatus(mockCtxOrgA, mockCandidateA.id, { status: 'screening' });
    expect(candScreening.status).toBe('screening');
    expect(updateCandSpy).toHaveBeenCalled();

    // Interview: scheduled -> completed
    vi.spyOn(repo, 'findInterviewById').mockResolvedValue(mockInterviewA);
    const updateIntSpy = vi.spyOn(repo, 'updateInterviewStatus').mockImplementation(async (_ctx, id, status) => ({
      ...mockInterviewA,
      id,
      status: status as InterviewStatus,
    }));
    const intCompleted = await updateInterviewStatus(mockCtxOrgA, mockInterviewA.id, 'completed');
    expect(intCompleted.status).toBe('completed');
    expect(updateIntSpy).toHaveBeenCalledWith(mockCtxOrgA, mockInterviewA.id, 'completed');

    // Offer: draft -> sent
    vi.spyOn(repo, 'findOfferById').mockResolvedValue(mockOfferA);
    const updateOfferSpy = vi.spyOn(repo, 'updateOfferStatus').mockImplementation(async (_ctx, id, status) => ({
      ...mockOfferA,
      id,
      status: status as OfferStatus,
    }));
    const offerSent = await updateOfferStatus(mockCtxOrgA, mockOfferA.id, 'sent');
    expect(offerSent.status).toBe('sent');
    expect(updateOfferSpy).toHaveBeenCalledWith(mockCtxOrgA, mockOfferA.id, 'sent');

    // Joining: pending -> confirmed
    vi.spyOn(repo, 'findJoiningById').mockResolvedValue(mockJoiningA);
    const updateJoiningSpy = vi.spyOn(repo, 'updateJoiningStatus').mockImplementation(async (_ctx, id, status) => ({
      ...mockJoiningA,
      id,
      status: status as JoiningStatus,
    }));
    const joiningConfirmed = await updateJoiningStatus(mockCtxOrgA, mockJoiningA.id, { status: 'confirmed' });
    expect(joiningConfirmed.status).toBe('confirmed');
    expect(updateJoiningSpy).toHaveBeenCalled();
  });

  // 2. invalid transition
  it('2. invalid transition -> rejects illegal jumps or backward transitions with PlatformValidationError (422)', async () => {
    // Requisition: draft -> filled (illegal jump)
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(mockRequisitionA);
    await expect(
      updateRequisitionStatus(mockCtxOrgA, mockRequisitionA.id, 'filled'),
    ).rejects.toThrow(PlatformValidationError);

    // Candidate: applied -> selected (cannot skip screening/interview)
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(mockCandidateA);
    await expect(
      updateCandidateStatus(mockCtxOrgA, mockCandidateA.id, { status: 'selected' }),
    ).rejects.toThrow(PlatformValidationError);

    // Candidate: screening -> applied (backward transition)
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue({
      ...mockCandidateA,
      status: 'screening',
    });
    await expect(
      updateCandidateStatus(mockCtxOrgA, mockCandidateA.id, { status: 'applied' }),
    ).rejects.toThrow(PlatformValidationError);

    // Interview: completed -> scheduled (backward transition)
    vi.spyOn(repo, 'findInterviewById').mockResolvedValue({
      ...mockInterviewA,
      status: 'completed',
    });
    await expect(
      updateInterviewStatus(mockCtxOrgA, mockInterviewA.id, 'scheduled'),
    ).rejects.toThrow(PlatformValidationError);

    // Offer: draft -> accepted (must be sent before accepted)
    vi.spyOn(repo, 'findOfferById').mockResolvedValue(mockOfferA);
    await expect(
      updateOfferStatus(mockCtxOrgA, mockOfferA.id, 'accepted'),
    ).rejects.toThrow(PlatformValidationError);

    // Joining: joined -> pending (backward transition)
    vi.spyOn(repo, 'findJoiningById').mockResolvedValue({
      ...mockJoiningA,
      status: 'joined',
    });
    await expect(
      updateJoiningStatus(mockCtxOrgA, mockJoiningA.id, { status: 'pending' }),
    ).rejects.toThrow(PlatformValidationError);
  });

  // 3. terminal state transition
  it('3. terminal state transition -> strictly rejects attempts to transition out of terminal states', async () => {
    // Candidate in terminal state 'rejected'
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue({
      ...mockCandidateA,
      status: 'rejected',
    });
    await expect(
      updateCandidateStatus(mockCtxOrgA, mockCandidateA.id, { status: 'screening' }),
    ).rejects.toThrow(PlatformValidationError);

    // Candidate in terminal state 'withdrawn'
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue({
      ...mockCandidateA,
      status: 'withdrawn',
    });
    await expect(
      updateCandidateStatus(mockCtxOrgA, mockCandidateA.id, { status: 'interview' }),
    ).rejects.toThrow(PlatformValidationError);

    // Interview in terminal state 'completed'
    vi.spyOn(repo, 'findInterviewById').mockResolvedValue({
      ...mockInterviewA,
      status: 'completed',
    });
    await expect(
      updateInterviewStatus(mockCtxOrgA, mockInterviewA.id, 'cancelled'),
    ).rejects.toThrow(PlatformValidationError);

    // Interview in terminal state 'cancelled'
    vi.spyOn(repo, 'findInterviewById').mockResolvedValue({
      ...mockInterviewA,
      status: 'cancelled',
    });
    await expect(
      updateInterviewStatus(mockCtxOrgA, mockInterviewA.id, 'scheduled'),
    ).rejects.toThrow(PlatformValidationError);

    // Requisition in terminal state 'closed'
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue({
      ...mockRequisitionA,
      status: 'closed',
    });
    await expect(
      updateRequisitionStatus(mockCtxOrgA, mockRequisitionA.id, 'open'),
    ).rejects.toThrow(PlatformValidationError);

    // Offer in terminal state 'accepted'
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(mockCandidateA);
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(mockRequisitionA);
    vi.spyOn(repo, 'findOfferById').mockResolvedValue({
      ...mockOfferA,
      status: 'accepted',
    });
    await expect(
      updateOfferStatus(mockCtxOrgA, mockOfferA.id, 'draft'),
    ).rejects.toThrow(PlatformValidationError);

    // Joining in terminal state 'joined'
    vi.spyOn(repo, 'findJoiningById').mockResolvedValue({
      ...mockJoiningA,
      status: 'joined',
    });
    await expect(
      updateJoiningStatus(mockCtxOrgA, mockJoiningA.id, { status: 'confirmed' }),
    ).rejects.toThrow(PlatformValidationError);
  });

  // 4. decision from valid interview state
  it('4. decision from valid interview state -> succeeds when interview is completed and candidate is in interview state', async () => {
    const completedInterview: Interview = {
      ...mockInterviewA,
      status: 'completed',
    };
    const interviewCandidate: Candidate = {
      ...mockCandidateA,
      status: 'interview',
    };

    vi.spyOn(repo, 'findInterviewById').mockResolvedValue(completedInterview);
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(interviewCandidate);
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(mockRequisitionA);

    const recordDecisionSpy = vi.spyOn(repo, 'recordInterviewDecision').mockResolvedValue({
      ...interviewCandidate,
      status: 'selected',
    });

    const result = await recordInterviewDecision(mockCtxOrgA, completedInterview.id, {
      decision: 'accepted',
      notes: 'Strong performance',
    });

    expect(result.status).toBe('selected');
    expect(recordDecisionSpy).toHaveBeenCalledTimes(1);
    expect(recordDecisionSpy).toHaveBeenCalledWith(
      mockCtxOrgA,
      completedInterview.id,
      expect.objectContaining({ decision: 'accepted' }),
    );
  });

  // 5. decision from invalid interview state
  it('5. decision from invalid interview state -> rejects decision when interview is not completed', async () => {
    const interviewCandidate: Candidate = {
      ...mockCandidateA,
      status: 'interview',
    };
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(interviewCandidate);
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(mockRequisitionA);

    // Scheduled interview (not yet completed)
    vi.spyOn(repo, 'findInterviewById').mockResolvedValue({
      ...mockInterviewA,
      status: 'scheduled',
    });
    await expect(
      recordInterviewDecision(mockCtxOrgA, mockInterviewA.id, { decision: 'accepted' }),
    ).rejects.toThrow(PlatformValidationError);

    // Cancelled interview
    vi.spyOn(repo, 'findInterviewById').mockResolvedValue({
      ...mockInterviewA,
      status: 'cancelled',
    });
    await expect(
      recordInterviewDecision(mockCtxOrgA, mockInterviewA.id, { decision: 'accepted' }),
    ).rejects.toThrow(PlatformValidationError);

    // No show interview
    vi.spyOn(repo, 'findInterviewById').mockResolvedValue({
      ...mockInterviewA,
      status: 'no_show',
    });
    await expect(
      recordInterviewDecision(mockCtxOrgA, mockInterviewA.id, { decision: 'rejected' }),
    ).rejects.toThrow(PlatformValidationError);
  });

  // 6. accepted decision
  it('6. accepted decision -> transitions candidate to selected and preserves existing workflow', async () => {
    const completedInterview: Interview = {
      ...mockInterviewA,
      status: 'completed',
    };
    const interviewCandidate: Candidate = {
      ...mockCandidateA,
      status: 'interview',
    };

    vi.spyOn(repo, 'findInterviewById').mockResolvedValue(completedInterview);
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(interviewCandidate);
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(mockRequisitionA);

    vi.spyOn(repo, 'recordInterviewDecision').mockResolvedValue({
      ...interviewCandidate,
      status: 'selected',
    });

    const result = await recordInterviewDecision(mockCtxOrgA, completedInterview.id, {
      decision: 'accepted',
      notes: 'Recommended for offer',
    });

    expect(result.status).toBe('selected');
  });

  // 7. rejected decision
  it('7. rejected decision -> transitions candidate to rejected with reason', async () => {
    const completedInterview: Interview = {
      ...mockInterviewA,
      status: 'completed',
    };
    const interviewCandidate: Candidate = {
      ...mockCandidateA,
      status: 'interview',
    };

    vi.spyOn(repo, 'findInterviewById').mockResolvedValue(completedInterview);
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(interviewCandidate);
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(mockRequisitionA);

    vi.spyOn(repo, 'recordInterviewDecision').mockResolvedValue({
      ...interviewCandidate,
      status: 'rejected',
      rejectionReason: 'Did not meet requirements',
    });

    const result = await recordInterviewDecision(mockCtxOrgA, completedInterview.id, {
      decision: 'rejected',
      rejectionReason: 'Did not meet requirements',
      notes: 'Feedback shared with candidate',
    });

    expect(result.status).toBe('rejected');
    expect(result.rejectionReason).toBe('Did not meet requirements');
  });

  // 8. invalid decision
  it('8. invalid decision -> rejects unknown decision values via validator and service', async () => {
    // Schema rejects invalid decision value
    const parseResult = interviewDecisionSchema.safeParse({
      decision: 'maybe',
    });
    expect(parseResult.success).toBe(false);

    // Service throws PlatformValidationError if called with invalid decision
    const completedInterview: Interview = {
      ...mockInterviewA,
      status: 'completed',
    };
    const interviewCandidate: Candidate = {
      ...mockCandidateA,
      status: 'interview',
    };

    vi.spyOn(repo, 'findInterviewById').mockResolvedValue(completedInterview);
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue(interviewCandidate);
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(mockRequisitionA);

    await expect(
      recordInterviewDecision(mockCtxOrgA, completedInterview.id, {
        decision: 'invalid' as unknown as 'accepted',
      }),
    ).rejects.toThrow(PlatformValidationError);
  });

  // 9. repeated decision
  it('9. repeated decision -> rejects decision if candidate is already selected or rejected', async () => {
    const completedInterview: Interview = {
      ...mockInterviewA,
      status: 'completed',
    };

    vi.spyOn(repo, 'findInterviewById').mockResolvedValue(completedInterview);
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(mockRequisitionA);

    // Candidate already selected
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue({
      ...mockCandidateA,
      status: 'selected',
    });
    await expect(
      recordInterviewDecision(mockCtxOrgA, completedInterview.id, { decision: 'accepted' }),
    ).rejects.toThrow(PlatformValidationError);

    // Candidate already rejected
    vi.spyOn(repo, 'findCandidateById').mockResolvedValue({
      ...mockCandidateA,
      status: 'rejected',
    });
    await expect(
      recordInterviewDecision(mockCtxOrgA, completedInterview.id, { decision: 'rejected' }),
    ).rejects.toThrow(PlatformValidationError);
  });

  // 10. cross-tenant isolation
  it('10. cross-tenant isolation -> rejects decision and state updates across tenants', async () => {
    // Interview belongs to Org B, accessed via Org A context -> NotFoundError
    vi.spyOn(repo, 'findInterviewById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgB && id === mockInterviewA.id) {
        return { ...mockInterviewA, organizationId: orgB, status: 'completed' };
      }
      return null;
    });
    vi.spyOn(repo, 'findCandidateById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgB && id === mockCandidateA.id) {
        return { ...mockCandidateA, organizationId: orgB, status: 'interview' };
      }
      return null;
    });

    await expect(
      recordInterviewDecision(mockCtxOrgA, mockInterviewA.id, { decision: 'accepted' }),
    ).rejects.toThrow(NotFoundError);

    // Candidate belongs to Org B, accessed via Org A context -> NotFoundError
    await expect(
      updateCandidateStatus(mockCtxOrgA, mockCandidateA.id, { status: 'screening' }),
    ).rejects.toThrow(NotFoundError);

    // Requisition belongs to Org B, accessed via Org A context -> NotFoundError
    vi.spyOn(repo, 'findRequisitionById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgB && id === mockRequisitionA.id) {
        return { ...mockRequisitionA, organizationId: orgB, status: 'draft' };
      }
      return null;
    });
    await expect(
      updateRequisitionStatus(mockCtxOrgA, mockRequisitionA.id, 'open'),
    ).rejects.toThrow(NotFoundError);

    // Requisition belongs to Org B, accessed via Org B context -> succeeds
    const updateReqSpy = vi.spyOn(repo, 'updateRequisitionStatus').mockResolvedValue({
      ...mockRequisitionA,
      organizationId: orgB,
      status: 'open',
    });
    const orgBReq = await updateRequisitionStatus(mockCtxOrgB, mockRequisitionA.id, 'open');
    expect(orgBReq.status).toBe('open');
    expect(updateReqSpy).toHaveBeenCalled();
  });
});

describe('Recruitment — Public Application Link Lifecycle', () => {
  const orgA = 'org-tenant-a';
  const orgB = 'org-tenant-b';

  const mockCtxOrgA = {
    organizationId: orgA,
    principal: { id: 'user-hr-1', type: 'user' as const, roles: ['hr'] },
    requestId: 'req-link-a',
  } as unknown as RequestContext;

  const validRequisitionA: JobRequisition = {
    id: '11111111-2222-4333-a444-555555555555',
    organizationId: orgA,
    requisitionNumber: 'REQ-PAL-001',
    title: 'Senior Frontend Engineer',
    departmentId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    departmentName: 'Engineering',
    positionId: null,
    openingsCount: 2,
    employmentType: 'full_time',
    location: 'Remote',
    description: 'Build modern user experiences',
    requirements: 'React, TypeScript, CSS',
    status: 'open',
    targetHireDate: null,
    closedAt: null,
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const validLinkA: RecruitmentApplicationLink = {
    id: '22222222-3333-4444-a555-666666666666',
    organizationId: orgA,
    requisitionId: validRequisitionA.id,
    token: 'valid-secure-token-1234567890abcdef',
    status: 'active',
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const validApplyInput = {
    firstName: 'Alice',
    lastName: 'Walker',
    email: 'alice.walker@example.com',
    phone: '+1-555-0199',
    resumeBase64: Buffer.from('%PDF-1.4 test resume').toString('base64'),
    resumeFilename: 'resume.pdf',
    resumeMimeType: 'application/pdf',
  };

  const mockSubmission: CandidateResumeSubmission = {
    id: '33333333-4444-4555-a666-777777777777',
    organizationId: orgA,
    requisitionId: validRequisitionA.id,
    applicationLinkId: validLinkA.id,
    candidateId: null,
    firstName: 'Alice',
    lastName: 'Walker',
    email: 'alice.walker@example.com',
    phone: '+1-555-0199',
    resumeObjectKey: 'recruitment/resumes/orgA/resume.pdf',
    resumeFilename: 'resume.pdf',
    resumeMimeType: 'application/pdf',
    resumeFileSize: 1024,
    parsedData: {},
    status: 'submitted',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. active + valid requisition → ALLOW
  it('1. active + valid requisition -> ALLOW for viewing details and submitting application', async () => {
    vi.spyOn(repo, 'resolvePublicApplicationLink').mockResolvedValue({
      link: validLinkA,
      requisition: validRequisitionA,
    });
    const createSubSpy = vi.spyOn(repo, 'createResumeSubmissionPreAuth').mockResolvedValue(mockSubmission);

    // Create link for open requisition succeeds
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue(validRequisitionA);
    vi.spyOn(repo, 'createApplicationLink').mockResolvedValue(validLinkA);
    const createdLink = await createApplicationLink(
      mockCtxOrgA,
      createApplicationLinkSchema.parse({
        requisitionId: validRequisitionA.id,
        expiresAt: validLinkA.expiresAt,
      }),
    );
    expect(createdLink.token).toBe(validLinkA.token);

    // Resolve public link details
    const resolved = await resolvePublicApplicationLink(validLinkA.token);
    expect(resolved.token).toBe(validLinkA.token);
    expect(resolved.requisition.title).toBe(validRequisitionA.title);
    expect(resolved.requisition.requisitionNumber).toBe(validRequisitionA.requisitionNumber);

    // Submit public application
    const submitResult = await submitPublicApplication(validLinkA.token, validApplyInput);
    expect(submitResult.submissionId).toBe(mockSubmission.id);
    expect(submitResult.status).toBe('submitted');
    expect(submitResult.message).toBe('Application submitted successfully');
    expect(createSubSpy).toHaveBeenCalledTimes(1);
  });

  // 2. disabled link → DENY
  it('2. disabled link -> DENY with NotFoundError', async () => {
    // Updating link status to disabled succeeds on HR management side
    vi.spyOn(repo, 'findApplicationLinkById').mockResolvedValue(validLinkA);
    vi.spyOn(repo, 'updateApplicationLinkStatus').mockResolvedValue({
      ...validLinkA,
      status: 'disabled',
    });
    const disabledUpdated = await updateApplicationLinkStatus(mockCtxOrgA, validLinkA.id, {
      status: 'disabled',
    });
    expect(disabledUpdated.status).toBe('disabled');

    const disabledLink: RecruitmentApplicationLink = {
      ...validLinkA,
      status: 'disabled',
    };

    // Both when resolver returns null (fail closed) or returns disabled record
    vi.spyOn(repo, 'resolvePublicApplicationLink').mockResolvedValue({
      link: disabledLink,
      requisition: validRequisitionA,
    });

    await expect(
      resolvePublicApplicationLink(validLinkA.token),
    ).rejects.toThrow(NotFoundError);

    await expect(
      submitPublicApplication(validLinkA.token, validApplyInput),
    ).rejects.toThrow(NotFoundError);
  });

  // 3. expired link → DENY
  it('3. expired link -> DENY with NotFoundError', async () => {
    const expiredLink: RecruitmentApplicationLink = {
      ...validLinkA,
      expiresAt: new Date(Date.now() - 3600000).toISOString(),
    };

    vi.spyOn(repo, 'resolvePublicApplicationLink').mockResolvedValue({
      link: expiredLink,
      requisition: validRequisitionA,
    });

    await expect(
      resolvePublicApplicationLink(validLinkA.token),
    ).rejects.toThrow(NotFoundError);

    await expect(
      submitPublicApplication(validLinkA.token, validApplyInput),
    ).rejects.toThrow(NotFoundError);
  });

  // 4. closed requisition → DENY
  it('4. closed requisition -> DENY even if link is active and future expiry', async () => {
    // Attempting to create link on closed requisition throws PlatformValidationError
    vi.spyOn(repo, 'findRequisitionById').mockResolvedValue({
      ...validRequisitionA,
      status: 'closed',
    });
    await expect(
      createApplicationLink(
        mockCtxOrgA,
        createApplicationLinkSchema.parse({ requisitionId: validRequisitionA.id }),
      ),
    ).rejects.toThrow(PlatformValidationError);

    const closedRequisition: JobRequisition = {
      ...validRequisitionA,
      status: 'closed',
    };

    vi.spyOn(repo, 'resolvePublicApplicationLink').mockResolvedValue({
      link: validLinkA,
      requisition: closedRequisition,
    });

    await expect(
      resolvePublicApplicationLink(validLinkA.token),
    ).rejects.toThrow(NotFoundError);

    await expect(
      submitPublicApplication(validLinkA.token, validApplyInput),
    ).rejects.toThrow(NotFoundError);
  });

  // 5. invalid requisition → DENY
  it('5. invalid requisition -> DENY when requisition is draft, on_hold, filled, or cancelled', async () => {
    const nonOpenStatuses: Array<'draft' | 'on_hold' | 'filled' | 'cancelled'> = [
      'draft',
      'on_hold',
      'filled',
      'cancelled',
    ];

    for (const status of nonOpenStatuses) {
      const invalidReq: JobRequisition = {
        ...validRequisitionA,
        status,
      };

      vi.spyOn(repo, 'resolvePublicApplicationLink').mockResolvedValue({
        link: validLinkA,
        requisition: invalidReq,
      });

      await expect(
        resolvePublicApplicationLink(validLinkA.token),
      ).rejects.toThrow(NotFoundError);

      await expect(
        submitPublicApplication(validLinkA.token, validApplyInput),
      ).rejects.toThrow(NotFoundError);
    }
  });

  // 6. cross-tenant/public-link mismatch → DENY
  it('6. cross-tenant/public-link mismatch -> DENY when link and requisition organization or ID mismatch', async () => {
    // Tenant mismatch
    const mismatchedOrgReq: JobRequisition = {
      ...validRequisitionA,
      organizationId: orgB,
    };

    vi.spyOn(repo, 'resolvePublicApplicationLink').mockResolvedValue({
      link: validLinkA,
      requisition: mismatchedOrgReq,
    });

    await expect(
      resolvePublicApplicationLink(validLinkA.token),
    ).rejects.toThrow(NotFoundError);

    await expect(
      submitPublicApplication(validLinkA.token, validApplyInput),
    ).rejects.toThrow(NotFoundError);

    // Requisition ID mismatch
    const mismatchedIdReq: JobRequisition = {
      ...validRequisitionA,
      id: '99999999-9999-4999-a999-999999999999',
    };

    vi.spyOn(repo, 'resolvePublicApplicationLink').mockResolvedValue({
      link: validLinkA,
      requisition: mismatchedIdReq,
    });

    await expect(
      resolvePublicApplicationLink(validLinkA.token),
    ).rejects.toThrow(NotFoundError);

    await expect(
      submitPublicApplication(validLinkA.token, validApplyInput),
    ).rejects.toThrow(NotFoundError);
  });

  // 7. valid active link continues working
  it('7. valid active link continues working -> multiple applications accepted while open and active', async () => {
    vi.spyOn(repo, 'resolvePublicApplicationLink').mockResolvedValue({
      link: validLinkA,
      requisition: validRequisitionA,
    });
    const createSubSpy = vi.spyOn(repo, 'createResumeSubmissionPreAuth').mockResolvedValue(mockSubmission);

    const firstSubmit = await submitPublicApplication(validLinkA.token, validApplyInput);
    expect(firstSubmit.status).toBe('submitted');

    const secondSubmit = await submitPublicApplication(validLinkA.token, {
      ...validApplyInput,
      email: 'bob.builder@example.com',
      firstName: 'Bob',
    });
    expect(secondSubmit.status).toBe('submitted');
    expect(createSubSpy).toHaveBeenCalledTimes(2);

    // Also verify link with null expiresAt (no expiry limit) continues working
    const linkWithoutExpiry: RecruitmentApplicationLink = {
      ...validLinkA,
      expiresAt: null,
    };
    vi.spyOn(repo, 'resolvePublicApplicationLink').mockResolvedValue({
      link: linkWithoutExpiry,
      requisition: validRequisitionA,
    });

    const noExpiryResolved = await resolvePublicApplicationLink(linkWithoutExpiry.token);
    expect(noExpiryResolved.requisition.title).toBe(validRequisitionA.title);
  });
});

describe('Resume Submission -> Candidate Conversion (BUG 1)', () => {
  const orgId = 'org-test-uuid';
  const mockCtx = {
    organizationId: orgId,
    principal: { id: 'user-hr-1', type: 'user' as const, roles: ['hr'] },
    requestId: 'req-convert-1',
  } as unknown as RequestContext;

  const reqId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const subId = 'sub-1111-1111-1111-111111111111';
  const candId = 'cand-2222-2222-2222-222222222222';

  const mockSubmission: CandidateResumeSubmission = {
    id: subId,
    organizationId: orgId,
    requisitionId: reqId,
    requisitionTitle: 'Software Engineer',
    requisitionNumber: 'REQ-0001',
    applicationLinkId: null,
    firstName: 'Jane',
    lastName: 'Doe',
    fullName: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: '+1-555-0100',
    resumeObjectKey: 'recruitment/resumes/org-test-uuid/sub-1111/resume.pdf',
    resumeFilename: 'Jane_Doe_Resume.pdf',
    resumeMimeType: 'application/pdf',
    resumeFileSize: 102400,
    parsedData: { name: 'Jane Doe', email: 'jane.doe@example.com', skills: ['TypeScript', 'React'] },
    status: 'submitted',
    candidateId: null,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockConvertedCandidate: Candidate = {
    id: candId,
    organizationId: orgId,
    requisitionId: reqId,
    firstName: 'Jane',
    lastName: 'Doe',
    fullName: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: '+1-555-0100',
    resumeUrl: `/api/recruitment/resume-submissions/${subId}/resume`,
    resumeObjectKey: 'recruitment/resumes/org-test-uuid/sub-1111/resume.pdf',
    resumeFileName: 'Jane_Doe_Resume.pdf',
    resumeMimeType: 'application/pdf',
    resumeSize: 102400,
    resumeUploadedAt: new Date().toISOString(),
    source: 'career_site',
    status: 'screening',
    screeningNotes: 'Strong applicant',
    rejectionReason: null,
    createdBy: 'user-hr-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('valid submission converts successfully, candidate is created with resume metadata, and submission becomes converted', async () => {
    const updatedSub: CandidateResumeSubmission = {
      ...mockSubmission,
      status: 'converted',
      candidateId: candId,
      reviewedBy: 'user-hr-1',
      reviewedAt: new Date().toISOString(),
    };

    const convertSpy = vi.spyOn(repo, 'convertSubmissionToCandidate').mockResolvedValue({
      candidate: mockConvertedCandidate,
      submission: updatedSub,
    });

    const result = await convertResumeSubmissionToCandidate(
      mockCtx,
      subId,
      convertSubmissionSchema.parse({
        screeningNotes: 'Strong applicant',
      }),
    );

    expect(convertSpy).toHaveBeenCalledWith(mockCtx, subId, {
      screeningNotes: 'Strong applicant',
      source: 'career_site',
    });
    expect(result.candidate).toBeDefined();
    expect(result.candidate.id).toBe(candId);
    expect(result.candidateId).toBe(candId);
    expect(result.candidate.resumeObjectKey).toBe(mockSubmission.resumeObjectKey);
    expect(result.candidate.resumeFileName).toBe(mockSubmission.resumeFilename);
    expect(result.candidate.resumeMimeType).toBe(mockSubmission.resumeMimeType);
    expect(result.candidate.resumeSize).toBe(mockSubmission.resumeFileSize);
    expect(result.submission.status).toBe('converted');
    expect(result.submission.candidateId).toBe(candId);
  });

  it('duplicate conversion does not create another candidate (idempotent)', async () => {
    const alreadyConvertedSub: CandidateResumeSubmission = {
      ...mockSubmission,
      status: 'converted',
      candidateId: candId,
    };

    vi.spyOn(repo, 'convertSubmissionToCandidate').mockResolvedValue({
      candidate: mockConvertedCandidate,
      submission: alreadyConvertedSub,
    });

    const firstResult = await convertResumeSubmissionToCandidate(mockCtx, subId);
    const retryResult = await convertResumeSubmissionToCandidate(mockCtx, subId);

    expect(firstResult.candidate.id).toBe(candId);
    expect(retryResult.candidate.id).toBe(candId);
    expect(retryResult.submission.status).toBe('converted');
    expect(retryResult.candidateId).toBe(candId);
  });

  it('duplicate email for same requisition remains correctly rejected with ConflictError (409)', async () => {
    const duplicateError = new Error('Candidate with this email already exists for this job requisition');
    (duplicateError as Error & { code?: string }).code = 'DUPLICATE_CANDIDATE';

    vi.spyOn(repo, 'convertSubmissionToCandidate').mockRejectedValue(duplicateError);

    await expect(
      convertResumeSubmissionToCandidate(
        mockCtx,
        subId,
        convertSubmissionSchema.parse({ email: 'jane.doe@example.com' }),
      ),
    ).rejects.toThrow(ConflictError);
  });

  it('repository findCandidateById and findResumeSubmissionById query with tx when provided', async () => {
    const mockTx = {
      query: vi.fn(),
      one: vi.fn(),
      maybeOne: vi.fn().mockImplementation(async () => ({
        id: 'test-cand-id',
        organizationId: orgId,
        requisitionId: reqId,
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      })),
    };

    const cand = await repo.findCandidateById(mockCtx, 'test-cand-id', mockTx);
    expect(mockTx.maybeOne).toHaveBeenCalled();
    expect(cand?.id).toBe('test-cand-id');

    const sub = await repo.findResumeSubmissionById(mockCtx, 'test-sub-id', mockTx);
    expect(mockTx.maybeOne).toHaveBeenCalledTimes(2);
    expect(sub?.id).toBe('test-cand-id');
    expect(sub?.fullName).toBe('Jane Doe');
  });
});

describe('Resume Access & Signed URL (BUG 2)', () => {
  const orgA = 'org-test-uuid';
  const orgB = 'org-tenant-b';

  const mockCtxA = {
    organizationId: orgA,
    principal: { id: 'user-hr-1', type: 'user' as const, roles: ['hr'] },
    requestId: 'req-resume-1',
  } as unknown as RequestContext;

  const mockCtxB = {
    organizationId: orgB,
    principal: { id: 'user-hr-2', type: 'user' as const, roles: ['hr'] },
    requestId: 'req-resume-2',
  } as unknown as RequestContext;

  const subId = 'sub-1111-1111-1111-111111111111';
  const resumeObjectKey = `recruitment/resumes/${orgA}/${subId}/test-resume.pdf`;

  const mockSubmission: CandidateResumeSubmission = {
    id: subId,
    organizationId: orgA,
    requisitionId: 'req-1',
    applicationLinkId: null,
    firstName: 'Jane',
    lastName: 'Doe',
    fullName: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: null,
    resumeObjectKey,
    resumeFilename: 'test-resume.pdf',
    resumeMimeType: 'application/pdf',
    resumeFileSize: 1024,
    parsedData: {},
    status: 'submitted',
    candidateId: null,
    rejectionReason: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('/resume-url returns a valid signed URL and filename for an authorized submission', async () => {
    vi.spyOn(repo, 'findResumeSubmissionById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgA && id === subId) return mockSubmission;
      return null;
    });

    const storage = getStorageService();
    await storage.putObject(resumeObjectKey, Buffer.from('PDF file content'), 'application/pdf');

    const result = await getResumeSignedUrl(mockCtxA, subId);
    expect(result).toBeDefined();
    expect(result.url).toBeDefined();
    expect(result.url.length).toBeGreaterThan(0);
    expect(result.filename).toBe('test-resume.pdf');
  });

  it('resume file retrieval returns file buffer, mimeType, and filename', async () => {
    vi.spyOn(repo, 'findResumeSubmissionById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgA && id === subId) return mockSubmission;
      return null;
    });

    const storage = getStorageService();
    const fileContent = Buffer.from('Sample PDF content for test');
    await storage.putObject(resumeObjectKey, fileContent, 'application/pdf');

    const file = await getResumeFile(mockCtxA, subId);
    expect(file.buffer.toString()).toBe('Sample PDF content for test');
    expect(file.mimeType).toBe('application/pdf');
    expect(file.filename).toBe('test-resume.pdf');
  });

  it('enforces organization boundaries: cross-tenant submission access throws NotFoundError', async () => {
    vi.spyOn(repo, 'findResumeSubmissionById').mockImplementation(async (ctx, id) => {
      if (ctx.organizationId === orgA && id === subId) return mockSubmission;
      return null; // Tenant B cannot see Tenant A's submission
    });

    await expect(getResumeSignedUrl(mockCtxB, subId)).rejects.toThrow(NotFoundError);
    await expect(getResumeFile(mockCtxB, subId)).rejects.toThrow(NotFoundError);
  });
});
