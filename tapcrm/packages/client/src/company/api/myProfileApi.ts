import { identityRequest } from '../../identity/api/authApi.js';
import { invalidatePeopleQueries, peopleRead } from './client.js';
import type { VerificationDocumentType } from './verificationApi.js';

/**
 * The employee's self-service profile (`/api/my-profile`) and HR's read of it.
 *
 * HR creates an employee with only the details the employee cannot give
 * themselves; the employee completes the rest after setting a password.
 */

export type ProfileSection =
  | 'personal'
  | 'address'
  | 'emergency'
  | 'education'
  | 'experience'
  | 'skills'
  | 'documents';

export interface ProfileCompletionItem {
  key: string;
  label: string;
  section: ProfileSection;
  state: 'done' | 'missing' | 'rejected';
  note: string | null;
}

export interface ProfileCompletion {
  percent: number;
  completedCount: number;
  totalCount: number;
  items: ProfileCompletionItem[];
}

export interface PersonalDetails {
  phone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
}

export interface QualificationEntry {
  id?: string;
  institution: string;
  degree: string;
  fieldOfStudy: string | null;
  passingYear: number | null;
  grade: string | null;
}

export interface ExperienceEntry {
  id?: string;
  companyName: string;
  jobTitle: string;
  startDate: string;
  endDate: string | null;
  description: string | null;
}

export type SkillProficiency = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface SkillEntry {
  id?: string;
  skillName: string;
  proficiency: SkillProficiency | null;
}

export interface ProfileDocument {
  id: string;
  documentType: VerificationDocumentType;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  uploadedAt: string;
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
  personal: PersonalDetails;
  noPriorExperience: boolean;
  qualifications: QualificationEntry[];
  experience: ExperienceEntry[];
  skills: SkillEntry[];
  documents: ProfileDocument[];
  requiredDocumentTypes: VerificationDocumentType[];
  verificationStatus: string | null;
  completion: ProfileCompletion;
}

export type MyProfile = { applicable: false } | ({ applicable: true } & EmployeeProfileDetails);

export interface ProfileCompletionSummary {
  userId: string;
  percent: number;
  completedCount: number;
  totalCount: number;
  pending: ProfileCompletionItem[];
}

export function getMyProfile(): Promise<MyProfile> {
  return identityRequest<MyProfile>('/api/my-profile');
}

function put(path: string, body: unknown): Promise<MyProfile> {
  return identityRequest<MyProfile>(path, { method: 'PUT', body: JSON.stringify(body) });
}

export function saveMyPersonalDetails(details: Partial<PersonalDetails>): Promise<MyProfile> {
  return put('/api/my-profile/personal', details);
}

export function saveMyEducation(qualifications: QualificationEntry[]): Promise<MyProfile> {
  return put('/api/my-profile/education', {
    qualifications: qualifications.map(({ id: _id, ...entry }) => entry),
  });
}

export function saveMyExperience(noPriorExperience: boolean, entries: ExperienceEntry[]): Promise<MyProfile> {
  return put('/api/my-profile/experience', {
    noPriorExperience,
    entries: entries.map(({ id: _id, ...entry }) => entry),
  });
}

export function saveMySkills(skills: SkillEntry[]): Promise<MyProfile> {
  return put('/api/my-profile/skills', { skills: skills.map(({ id: _id, ...entry }) => entry) });
}

export function uploadMyDocument(input: {
  documentType: VerificationDocumentType;
  fileName: string;
  mimeType: string;
  fileBase64: string;
}): Promise<MyProfile> {
  return identityRequest<MyProfile>('/api/my-profile/documents', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function removeMyDocument(documentId: string): Promise<MyProfile> {
  return identityRequest<MyProfile>(`/api/my-profile/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });
}

export function getMyDocumentDownloadUrl(
  documentId: string,
): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
  return identityRequest(`/api/my-profile/documents/${encodeURIComponent(documentId)}/download`);
}

/** HR: completion of every visible working employee. */
export function listProfileCompletion(): Promise<ProfileCompletionSummary[]> {
  return peopleRead<ProfileCompletionSummary[]>('/api/users?profileCompletion=true', { staleMs: 10_000 });
}

/** HR: one employee's full profile, as they filled it in. */
export function getEmployeeProfileDetails(userId: string): Promise<EmployeeProfileDetails> {
  return peopleRead<EmployeeProfileDetails>(`/api/users/${encodeURIComponent(userId)}/profile-details`, {
    staleMs: 0,
  });
}

/** Forget cached completion figures, e.g. after HR reviewed a document. */
export function forgetProfileCompletion(): void {
  invalidatePeopleQueries(['/api/users?profileCompletion']);
}
