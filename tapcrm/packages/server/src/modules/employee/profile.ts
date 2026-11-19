import { visibilityFilter } from '@tapcrm/authz';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { IdentityNotFoundError, IdentityValidationError } from '../identity/facade.js';
import {
  getEmployeeVerification,
  getVerificationDocumentDownloadUrl,
  listCurrentDocumentsForEmployees,
  requiredVerificationDocuments,
  uploadVerificationDocument,
  withdrawPendingVerificationDocument,
  type EmployeeVerificationDocumentRecord,
  type VerificationDocumentType,
} from '../verification/facade.js';
import {
  computeProfileCompletion,
  type ProfileCompletion,
  type ProfileCompletionItem,
} from './profile-completion.js';
import {
  countProfileEntries,
  findPersonalDetails,
  listExperience,
  listPersonalDetails,
  listProfileSubjects,
  listQualifications,
  listSkills,
  replaceExperience,
  replaceQualifications,
  replaceSkills,
  savePersonalDetails,
  setNoPriorExperience,
  type ExperienceRow,
  type PersonalDetailFields,
  type PersonalDetails,
  type QualificationRow,
  type SkillRow,
} from './profile-repository.js';
import type {
  ExperienceInput,
  OwnDocumentUploadInput,
  PersonalDetailsInput,
  QualificationsInput,
  SkillsInput,
} from './profile-validators.js';
import { findEmployeeProfile } from './repository.js';

/**
 * The employee's self-service profile.
 *
 * HR creates the account with only what the employee cannot give themselves;
 * the employee completes the rest after setting a password, at their own pace.
 * The same view (and the same completion figure) is what HR sees.
 */

export interface ProfileDocument {
  id: string;
  documentType: VerificationDocumentType;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  uploadedAt: string;
  /** True when the employee uploaded it themselves (they may remove it while pending). */
  uploadedBySelf: boolean;
}

export interface EmployeeProfileDetails {
  work: {
    userId: string;
    fullName: string;
    email: string | null;
    employeeId: string | null;
    departmentName: string | null;
    positionName: string | null;
    teamName: string | null;
    designationName: string | null;
    specialization: string | null;
    reportsToName: string | null;
    joinedOn: string | null;
  };
  personal: Omit<PersonalDetails, 'hasNoPriorExperience'>;
  noPriorExperience: boolean;
  qualifications: QualificationRow[];
  experience: ExperienceRow[];
  skills: SkillRow[];
  documents: ProfileDocument[];
  requiredDocumentTypes: VerificationDocumentType[];
  verificationStatus: string | null;
  completion: ProfileCompletion;
}

export type MyProfileResponse = { applicable: false } | ({ applicable: true } & EmployeeProfileDetails);

export interface ProfileCompletionSummary {
  userId: string;
  percent: number;
  completedCount: number;
  totalCount: number;
  /** What is still to do; done items are left out to keep the list small. */
  pending: ProfileCompletionItem[];
}

const EMPTY_PERSONAL: Omit<PersonalDetails, 'hasNoPriorExperience'> = {
  phone: null,
  dateOfBirth: null,
  gender: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  emergencyContactRelation: null,
};

function toDocument(doc: EmployeeVerificationDocumentRecord, userId: string): ProfileDocument {
  return {
    id: doc.id,
    documentType: doc.documentType,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    mimeType: doc.mimeType,
    status: doc.status,
    rejectionReason: doc.rejectionReason,
    uploadedAt: new Date(doc.uploadedAt).toISOString(),
    uploadedBySelf: doc.uploadedBy === userId,
  };
}

/** Everything one person's profile shows, with its completion. */
async function loadProfileDetails(
  tx: Tx,
  organizationId: string,
  userId: string,
): Promise<EmployeeProfileDetails> {
  const work = await findEmployeeProfile(tx, organizationId, userId);
  if (work === null || work.accountType !== 'employee') {
    throw new IdentityNotFoundError('IDENTITY_NOT_FOUND', 'Employee not found');
  }
  // One connection per transaction: these run one after another.
  const personalRow = await findPersonalDetails(tx, organizationId, userId);
  const qualifications = await listQualifications(tx, organizationId, userId);
  const experience = await listExperience(tx, organizationId, userId);
  const skills = await listSkills(tx, organizationId, userId);
  const documents = await listCurrentDocumentsForEmployees(tx, organizationId, [userId]);
  const noPriorExperience = personalRow?.hasNoPriorExperience ?? false;
  const requiredDocuments = requiredVerificationDocuments(noPriorExperience);
  const { hasNoPriorExperience: _flag, ...personal } = personalRow ?? {
    ...EMPTY_PERSONAL,
    hasNoPriorExperience: false,
  };

  return {
    work: {
      userId: work.id,
      fullName: work.fullName,
      email: work.email,
      employeeId: work.employeeId,
      departmentName: work.departmentName,
      positionName: work.positionName,
      teamName: work.teamName,
      designationName: work.designationName,
      specialization: work.specialization,
      reportsToName: work.reportsToName,
      joinedOn: work.joinedOn,
    },
    personal,
    noPriorExperience,
    qualifications,
    experience,
    skills,
    documents: documents.map((doc) => toDocument(doc, userId)),
    requiredDocumentTypes: [...requiredDocuments],
    verificationStatus: null,
    completion: computeProfileCompletion({
      profile: personalRow,
      qualificationCount: qualifications.length,
      experienceCount: experience.length,
      skillCount: skills.length,
      documents,
      requiredDocuments,
    }),
  };
}

function requireEmployee(ctx: RequestContext): void {
  if (ctx.principal.accountType !== 'employee') {
    throw new IdentityValidationError(
      'IDENTITY_NOT_AN_EMPLOYEE',
      'Only an employee account has a profile to complete',
    );
  }
}

async function withVerificationStatus(
  ctx: RequestContext,
  userId: string,
  details: EmployeeProfileDetails,
): Promise<EmployeeProfileDetails> {
  const verification = await getEmployeeVerification(ctx, userId);
  return { ...details, verificationStatus: verification.verification?.status ?? null };
}

/** GET /api/my-profile — the signed-in employee's own profile. */
export async function getMyProfile(ctx: RequestContext): Promise<MyProfileResponse> {
  // Super Admin, client and service accounts have no employee profile; the
  // client simply shows nothing for them.
  if (ctx.principal.accountType !== 'employee') return { applicable: false };
  const details = await db.transaction(ctx, (tx) =>
    loadProfileDetails(tx, ctx.organizationId, ctx.principal.id),
  );
  return { applicable: true, ...(await withVerificationStatus(ctx, ctx.principal.id, details)) };
}

async function afterOwnChange(ctx: RequestContext): Promise<MyProfileResponse> {
  return getMyProfile(ctx);
}

/** PUT /api/my-profile/personal — personal details, address and emergency contact. */
export async function updateMyPersonalDetails(
  ctx: RequestContext,
  input: PersonalDetailsInput,
): Promise<MyProfileResponse> {
  requireEmployee(ctx);
  if (input.dateOfBirth) {
    const today = new Date().toISOString().slice(0, 10);
    if (input.dateOfBirth >= today || input.dateOfBirth < '1900-01-01') {
      throw new IdentityValidationError(
        'IDENTITY_DATE_OF_BIRTH_INVALID',
        'Enter a real date of birth in the past',
      );
    }
  }
  await db.transaction(ctx, async (tx) => {
    const current = await findPersonalDetails(tx, ctx.organizationId, ctx.principal.id);
    const base: PersonalDetailFields = current
      ? (({ hasNoPriorExperience: _flag, ...rest }) => rest)(current)
      : { ...EMPTY_PERSONAL };
    const next: PersonalDetailFields = { ...base };
    for (const key of Object.keys(EMPTY_PERSONAL) as (keyof PersonalDetailFields)[]) {
      const value = input[key];
      if (value !== undefined) (next as Record<string, unknown>)[key] = value;
    }
    await savePersonalDetails(tx, ctx.organizationId, ctx.principal.id, next);
  });
  return afterOwnChange(ctx);
}

/** PUT /api/my-profile/education — replaces the whole education list. */
export async function updateMyQualifications(
  ctx: RequestContext,
  input: QualificationsInput,
): Promise<MyProfileResponse> {
  requireEmployee(ctx);
  await db.transaction(ctx, (tx) =>
    replaceQualifications(
      tx,
      ctx.organizationId,
      ctx.principal.id,
      input.qualifications.map((q) => ({
        institution: q.institution,
        degree: q.degree,
        fieldOfStudy: q.fieldOfStudy ?? undefined,
        passingYear: q.passingYear ?? undefined,
        grade: q.grade ?? undefined,
      })),
    ),
  );
  return afterOwnChange(ctx);
}

/** PUT /api/my-profile/experience — previous jobs, or "this is my first job". */
export async function updateMyExperience(
  ctx: RequestContext,
  input: ExperienceInput,
): Promise<MyProfileResponse> {
  requireEmployee(ctx);
  await db.transaction(ctx, async (tx) => {
    await setNoPriorExperience(tx, ctx.organizationId, ctx.principal.id, input.noPriorExperience);
    await replaceExperience(
      tx,
      ctx.organizationId,
      ctx.principal.id,
      input.entries.map((entry) => ({
        companyName: entry.companyName,
        jobTitle: entry.jobTitle,
        startDate: entry.startDate,
        endDate: entry.endDate ?? null,
        description: entry.description ?? null,
      })),
    );
  });
  return afterOwnChange(ctx);
}

/** PUT /api/my-profile/skills — replaces the whole skill list. */
export async function updateMySkills(ctx: RequestContext, input: SkillsInput): Promise<MyProfileResponse> {
  requireEmployee(ctx);
  // The table keeps one row per skill name, so "React" and "react" are one skill.
  const seen = new Set<string>();
  const skills = input.skills.filter((skill) => {
    const key = skill.skillName.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  await db.transaction(ctx, (tx) =>
    replaceSkills(
      tx,
      ctx.organizationId,
      ctx.principal.id,
      skills.map((skill) => ({ skillName: skill.skillName, proficiency: skill.proficiency ?? undefined })),
    ),
  );
  return afterOwnChange(ctx);
}

/**
 * POST /api/my-profile/documents — the employee uploads one of their own
 * documents into the same verification record HR reviews. A new copy replaces
 * one that is pending or rejected; an approved one is HR's to change. Degree
 * certificates may be several, so those are added rather than replaced.
 */
export async function uploadMyDocument(
  ctx: RequestContext,
  input: OwnDocumentUploadInput,
): Promise<MyProfileResponse> {
  requireEmployee(ctx);
  const userId = ctx.principal.id;
  const verification = await getEmployeeVerification(ctx, userId);
  if (verification.verification?.status === 'VERIFIED') {
    throw new IdentityValidationError(
      'IDENTITY_DOCUMENTS_ALREADY_VERIFIED',
      'Your documents are already verified. Ask HR if something needs to change.',
    );
  }
  const current = (verification.verification?.documents ?? []).filter(
    (doc) => doc.documentType === input.documentType,
  );
  const addsAnother = input.documentType === 'MARKSHEET';
  if (!addsAnother && current.some((doc) => doc.status === 'APPROVED')) {
    throw new IdentityValidationError(
      'IDENTITY_DOCUMENT_ALREADY_APPROVED',
      'HR has already approved this document. Ask HR if it needs to change.',
    );
  }
  await uploadVerificationDocument(ctx, userId, { ...input, replace: !addsAnother });
  return afterOwnChange(ctx);
}

/** DELETE /api/my-profile/documents/:docId — take back a document HR has not reviewed. */
export async function removeMyDocument(ctx: RequestContext, documentId: string): Promise<MyProfileResponse> {
  requireEmployee(ctx);
  await withdrawPendingVerificationDocument(ctx, ctx.principal.id, documentId);
  return afterOwnChange(ctx);
}

/** GET /api/my-profile/documents/:docId/download */
export async function downloadMyDocument(ctx: RequestContext, documentId: string) {
  requireEmployee(ctx);
  return getVerificationDocumentDownloadUrl(ctx, ctx.principal.id, documentId);
}

/** GET /api/users/:id/profile-details — HR's read of the same profile. */
export async function getEmployeeProfileDetails(
  ctx: RequestContext,
  userId: string,
): Promise<EmployeeProfileDetails> {
  const details = await db.transaction(ctx, (tx) => loadProfileDetails(tx, ctx.organizationId, userId));
  return withVerificationStatus(ctx, userId, details);
}

/**
 * GET /api/users?profileCompletion=true — how complete each visible working
 * employee's profile is, and what is still missing.
 */
export async function listProfileCompletion(ctx: RequestContext): Promise<ProfileCompletionSummary[]> {
  const visibility = await visibilityFilter(ctx, 'users:view', 'user');
  return db.transaction(ctx, async (tx) => {
    const subjects = await listProfileSubjects(tx, ctx.organizationId, visibility);
    const ids = subjects.map((subject) => subject.id);
    if (ids.length === 0) return [];
    const personal = await listPersonalDetails(tx, ctx.organizationId, ids);
    const counts = await countProfileEntries(tx, ctx.organizationId, ids);
    const documents = await listCurrentDocumentsForEmployees(tx, ctx.organizationId, ids);
    const personalById = new Map(personal.map((row) => [row.userId, row]));
    const documentsById = new Map<string, EmployeeVerificationDocumentRecord[]>();
    for (const doc of documents) {
      const list = documentsById.get(doc.employeeId) ?? [];
      list.push(doc);
      documentsById.set(doc.employeeId, list);
    }
    return ids.map((id) => {
      const profile = personalById.get(id) ?? null;
      const count = counts.get(id) ?? { qualifications: 0, experience: 0, skills: 0 };
      const completion = computeProfileCompletion({
        profile,
        qualificationCount: count.qualifications,
        experienceCount: count.experience,
        skillCount: count.skills,
        documents: documentsById.get(id) ?? [],
        requiredDocuments: requiredVerificationDocuments(profile?.hasNoPriorExperience ?? false),
      });
      return {
        userId: id,
        percent: completion.percent,
        completedCount: completion.completedCount,
        totalCount: completion.totalCount,
        pending: completion.items.filter((entry) => entry.state !== 'done'),
      };
    });
  });
}
