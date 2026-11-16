import type { VerificationDocumentType } from '../verification/facade.js';

/**
 * How complete an employee's self-service profile is.
 *
 * HR creates an employee with only what the employee cannot give themselves
 * (name, work email, phone, placement, shift, joining date). The employee
 * fills in the rest after setting a password. Every item below counts the
 * same, so "12 of 18" reads the same to the employee and to HR.
 *
 * A document counts as done once uploaded, while HR reviews it. A rejected
 * document counts as missing again until a new copy is uploaded. Approving
 * documents stays HR's job in the Verify screen, and is separate from this.
 *
 * Pure: the callers load the facts, this only judges them.
 */

export type ProfileSection =
  | 'personal'
  | 'address'
  | 'emergency'
  | 'education'
  | 'experience'
  | 'skills'
  | 'documents';

export type ProfileItemState = 'done' | 'missing' | 'rejected';

export interface ProfileCompletionItem {
  /** Stable key: a field group (`dateOfBirth`, `address`) or `document:<TYPE>`. */
  readonly key: string;
  readonly label: string;
  readonly section: ProfileSection;
  readonly state: ProfileItemState;
  /** Why HR rejected the document, when it was. */
  readonly note: string | null;
}

export interface ProfileCompletion {
  /** 0–100, rounded down: 100 only when nothing is left. */
  readonly percent: number;
  readonly completedCount: number;
  readonly totalCount: number;
  readonly items: readonly ProfileCompletionItem[];
}

export interface ProfileFacts {
  readonly phone: string | null;
  readonly dateOfBirth: string | null;
  readonly gender: string | null;
  readonly addressLine1: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly postalCode: string | null;
  readonly emergencyContactName: string | null;
  readonly emergencyContactPhone: string | null;
  readonly emergencyContactRelation: string | null;
  readonly hasNoPriorExperience: boolean;
}

export interface ProfileCompletionInput {
  /** Null when the employee has no profile row yet. */
  readonly profile: ProfileFacts | null;
  readonly qualificationCount: number;
  readonly experienceCount: number;
  readonly skillCount: number;
  /** The employee's current (not archived) documents. */
  readonly documents: readonly {
    readonly documentType: VerificationDocumentType;
    readonly status: 'PENDING' | 'APPROVED' | 'REJECTED';
    readonly rejectionReason: string | null;
  }[];
  /** From the verification module: fewer for someone with no prior experience. */
  readonly requiredDocuments: readonly VerificationDocumentType[];
}

export const DOCUMENT_LABELS: Readonly<Record<VerificationDocumentType, string>> = {
  AADHAAR: 'Aadhaar card',
  PAN: 'PAN card',
  VOTER_ID: 'Voter ID card',
  OFFER_LETTER: 'Signed offer letter',
  PAYSLIP_1: 'Payslip (month 1)',
  PAYSLIP_2: 'Payslip (month 2)',
  PAYSLIP_3: 'Payslip (month 3)',
  EXPERIENCE_LETTER: 'Experience / relieving letter',
  MARKSHEET: 'Degree / marksheet',
  PASSPORT_PHOTO: 'Passport-size photo',
};

const filled = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

function item(
  key: string,
  label: string,
  section: ProfileSection,
  done: boolean,
): ProfileCompletionItem {
  return { key, label, section, state: done ? 'done' : 'missing', note: null };
}

export function computeProfileCompletion(input: ProfileCompletionInput): ProfileCompletion {
  const p = input.profile;
  const items: ProfileCompletionItem[] = [
    item('dateOfBirth', 'Date of birth', 'personal', filled(p?.dateOfBirth)),
    item('gender', 'Gender', 'personal', filled(p?.gender)),
    item('phone', 'Phone number', 'personal', filled(p?.phone)),
    item(
      'address',
      'Address',
      'address',
      filled(p?.addressLine1) && filled(p?.city) && filled(p?.state) && filled(p?.postalCode),
    ),
    item(
      'emergencyContact',
      'Emergency contact',
      'emergency',
      filled(p?.emergencyContactName) &&
        filled(p?.emergencyContactPhone) &&
        filled(p?.emergencyContactRelation),
    ),
    item('education', 'Education', 'education', input.qualificationCount > 0),
    item(
      'experience',
      'Work experience',
      'experience',
      input.experienceCount > 0 || p?.hasNoPriorExperience === true,
    ),
    item('skills', 'Skills', 'skills', input.skillCount > 0),
  ];

  for (const type of input.requiredDocuments) {
    const copies = input.documents.filter((doc) => doc.documentType === type);
    const usable = copies.some((doc) => doc.status !== 'REJECTED');
    const rejected = copies.find((doc) => doc.status === 'REJECTED');
    items.push({
      key: `document:${type}`,
      label: DOCUMENT_LABELS[type],
      section: 'documents',
      state: usable ? 'done' : rejected ? 'rejected' : 'missing',
      note: !usable && rejected ? rejected.rejectionReason : null,
    });
  }

  const completedCount = items.filter((entry) => entry.state === 'done').length;
  const totalCount = items.length;
  return {
    percent: totalCount === 0 ? 100 : Math.floor((completedCount * 100) / totalCount),
    completedCount,
    totalCount,
    items,
  };
}
