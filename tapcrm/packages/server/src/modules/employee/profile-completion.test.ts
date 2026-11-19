import { describe, expect, it } from 'vitest';
import { computeProfileCompletion, type ProfileFacts } from './profile-completion.js';

const ALL_DOCUMENTS = [
  'AADHAAR',
  'PAN',
  'VOTER_ID',
  'OFFER_LETTER',
  'PAYSLIP_1',
  'PAYSLIP_2',
  'PAYSLIP_3',
  'EXPERIENCE_LETTER',
  'MARKSHEET',
  'PASSPORT_PHOTO',
] as const;

const FRESHER_DOCUMENTS = ['AADHAAR', 'PAN', 'VOTER_ID', 'OFFER_LETTER', 'MARKSHEET', 'PASSPORT_PHOTO'] as const;

const fullProfile: ProfileFacts = {
  phone: '+91 9876543210',
  dateOfBirth: '1998-04-12',
  gender: 'female',
  addressLine1: '12 MG Road',
  city: 'Kolkata',
  state: 'West Bengal',
  postalCode: '700001',
  emergencyContactName: 'Ravi Kumar',
  emergencyContactPhone: '+91 9123456780',
  emergencyContactRelation: 'Father',
  hasNoPriorExperience: false,
};

describe('computeProfileCompletion', () => {
  it('starts at 0% for a brand-new employee with no profile', () => {
    const result = computeProfileCompletion({
      profile: null,
      qualificationCount: 0,
      experienceCount: 0,
      skillCount: 0,
      documents: [],
      requiredDocuments: ALL_DOCUMENTS,
    });
    expect(result.totalCount).toBe(18);
    expect(result.completedCount).toBe(0);
    expect(result.percent).toBe(0);
  });

  it('counts the phone HR entered at creation', () => {
    const result = computeProfileCompletion({
      profile: { ...emptyProfile(), phone: '+91 9876543210' },
      qualificationCount: 0,
      experienceCount: 0,
      skillCount: 0,
      documents: [],
      requiredDocuments: ALL_DOCUMENTS,
    });
    expect(result.completedCount).toBe(1);
    expect(result.items.find((i) => i.key === 'phone')?.state).toBe('done');
  });

  it('reaches 100% only when every item is done', () => {
    const result = computeProfileCompletion({
      profile: fullProfile,
      qualificationCount: 1,
      experienceCount: 1,
      skillCount: 2,
      documents: ALL_DOCUMENTS.map((documentType) => ({ documentType, status: 'PENDING' as const, rejectionReason: null })),
      requiredDocuments: ALL_DOCUMENTS,
    });
    expect(result.percent).toBe(100);
    expect(result.items.every((i) => i.state === 'done')).toBe(true);
  });

  it('rounds down so 17 of 18 is not shown as 100%', () => {
    const result = computeProfileCompletion({
      profile: fullProfile,
      qualificationCount: 1,
      experienceCount: 1,
      skillCount: 1,
      documents: ALL_DOCUMENTS.filter((t) => t !== 'PAN').map((documentType) => ({
        documentType,
        status: 'APPROVED' as const,
        rejectionReason: null,
      })),
      requiredDocuments: ALL_DOCUMENTS,
    });
    expect(result.completedCount).toBe(17);
    expect(result.percent).toBe(94);
  });

  it('treats a fresher as having completed work experience without entries', () => {
    const result = computeProfileCompletion({
      profile: { ...fullProfile, hasNoPriorExperience: true },
      qualificationCount: 1,
      experienceCount: 0,
      skillCount: 1,
      documents: FRESHER_DOCUMENTS.map((documentType) => ({ documentType, status: 'PENDING' as const, rejectionReason: null })),
      requiredDocuments: FRESHER_DOCUMENTS,
    });
    expect(result.totalCount).toBe(14);
    expect(result.percent).toBe(100);
  });

  it('counts a rejected document as not done and carries the reason', () => {
    const result = computeProfileCompletion({
      profile: fullProfile,
      qualificationCount: 1,
      experienceCount: 1,
      skillCount: 1,
      documents: [{ documentType: 'PAN', status: 'REJECTED', rejectionReason: 'Blurred photo' }],
      requiredDocuments: ['PAN'],
    });
    const pan = result.items.find((i) => i.key === 'document:PAN');
    expect(pan?.state).toBe('rejected');
    expect(pan?.note).toBe('Blurred photo');
  });

  it('counts a document as done when a newer copy replaced a rejected one', () => {
    const result = computeProfileCompletion({
      profile: fullProfile,
      qualificationCount: 1,
      experienceCount: 1,
      skillCount: 1,
      documents: [
        { documentType: 'MARKSHEET', status: 'REJECTED', rejectionReason: 'Wrong file' },
        { documentType: 'MARKSHEET', status: 'PENDING', rejectionReason: null },
      ],
      requiredDocuments: ['MARKSHEET'],
    });
    expect(result.items.find((i) => i.key === 'document:MARKSHEET')?.state).toBe('done');
  });

  it('needs every address field before the address counts', () => {
    const result = computeProfileCompletion({
      profile: { ...fullProfile, postalCode: '  ' },
      qualificationCount: 1,
      experienceCount: 1,
      skillCount: 1,
      documents: [],
      requiredDocuments: [],
    });
    expect(result.items.find((i) => i.key === 'address')?.state).toBe('missing');
  });
});

function emptyProfile(): ProfileFacts {
  return {
    phone: null,
    dateOfBirth: null,
    gender: null,
    addressLine1: null,
    city: null,
    state: null,
    postalCode: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContactRelation: null,
    hasNoPriorExperience: false,
  };
}
