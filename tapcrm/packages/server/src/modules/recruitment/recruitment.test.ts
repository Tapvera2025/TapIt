import { describe, expect, it } from 'vitest';
import type { RequestContext } from '../../platform/dal/context.js';
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
} from './validators.js';
import { uploadCandidateResume, parseCandidateResume } from './service.js';
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
