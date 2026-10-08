import { describe, expect, it } from 'vitest';
import { createEmployeeSchema, updateEmployeeSchema } from './validators.js';

const valid = {
  email: 'employee@example.com',
  fullName: 'Example Employee',
  password: 'Long-enough-password-123!',
  confirmPassword: 'Long-enough-password-123!',
  departmentId: '00000000-0000-0000-0000-000000000001',
  positionId: '00000000-0000-0000-0000-000000000002',
};

describe('employee creation validation', () => {
  it('requires matching initial password confirmation when password is provided', () => {
    expect(createEmployeeSchema.safeParse(valid).success).toBe(true);
    expect(createEmployeeSchema.safeParse({ ...valid, confirmPassword: 'different-password-123!' }).success).toBe(false);
  });

  it('accepts employee creation without password (employee password setup link flow)', () => {
    const { password: _p, confirmPassword: _cp, ...withoutPassword } = valid;
    const parsed = createEmployeeSchema.safeParse(withoutPassword);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.password).toBeUndefined();
      expect(parsed.data.confirmPassword).toBeUndefined();
    }
  });

  it('rejects passwords shorter than the existing identity policy', () => {
    expect(createEmployeeSchema.safeParse({ ...valid, password: 'short', confirmPassword: 'short' }).success).toBe(false);
  });

  // ED-3
  it('accepts a well-formed uppercase employee ID', () => {
    const parsed = createEmployeeSchema.safeParse({ ...valid, employeeId: 'EMP-00042' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.employeeId).toBe('EMP-00042');
  });

  it('upper-cases a lowercase employee ID before enforcing the format', () => {
    const parsed = createEmployeeSchema.safeParse({ ...valid, employeeId: 'emp-042' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.employeeId).toBe('EMP-042');
  });

  it('rejects an employee ID with disallowed characters', () => {
    expect(createEmployeeSchema.safeParse({ ...valid, employeeId: 'EMP 042' }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...valid, employeeId: 'EMP/042' }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...valid, employeeId: '' }).success).toBe(false);
  });

  it('rejects an employee ID that does not start with an alphanumeric', () => {
    expect(createEmployeeSchema.safeParse({ ...valid, employeeId: '-EMP1' }).success).toBe(false);
  });

  it('treats employeeId as optional (the service will auto-allocate)', () => {
    const parsed = createEmployeeSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.employeeId).toBeUndefined();
  });
});

describe('employment dates', () => {
  it('a joining date is optional at creation, and must be a real date', () => {
    expect(
      createEmployeeSchema.safeParse({ ...valid, joiningDate: '2026-10-05' }).success,
    ).toBe(true);
    expect(
      createEmployeeSchema.safeParse({ ...valid, joiningDate: '2026-02-30' }).success,
    ).toBe(false);
  });

  it('an update says exactly what it changes', () => {
    expect(updateEmployeeSchema.parse({ leavingDate: '2026-10-10' })).toEqual({
      leavingDate: '2026-10-10',
    });
    expect(updateEmployeeSchema.parse({ joiningDate: null })).toEqual({
      joiningDate: null,
    });
    expect(updateEmployeeSchema.parse({ fullName: '  Someone Else ', employeeId: 'emp-7' })).toEqual({
      fullName: 'Someone Else',
      employeeId: 'EMP-7',
    });
    expect(updateEmployeeSchema.safeParse({}).success).toBe(false);
    // Placement is a separate, Super Admin step.
    expect(updateEmployeeSchema.safeParse({ positionId: '00000000-0000-0000-0000-000000000001' }).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });
});

describe('extended employee onboarding fields', () => {
  it('accepts personal info, shiftId, qualifications, and skills', () => {
    const extended = {
      ...valid,
      phone: '+91 9876543210',
      personalInfo: {
        dateOfBirth: '1995-05-15',
        gender: 'Female',
        addressLine1: '123 Tech Park',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
        emergencyContactName: 'Jane Doe',
        emergencyContactPhone: '+91 9876543211',
        emergencyContactRelation: 'Spouse',
      },
      shiftId: '00000000-0000-0000-0000-000000000009',
      qualifications: [
        {
          institution: 'National Institute of Technology',
          degree: 'B.Tech',
          fieldOfStudy: 'Computer Science',
          passingYear: 2017,
          grade: 'A',
        },
      ],
      skills: [
        { skillName: 'TypeScript', proficiency: 'expert' as const },
        { skillName: 'PostgreSQL', proficiency: 'advanced' as const },
      ],
    };

    const parsed = createEmployeeSchema.safeParse(extended);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phone).toBe('+91 9876543210');
      expect(parsed.data.personalInfo?.city).toBe('Bengaluru');
      expect(parsed.data.qualifications?.[0]?.degree).toBe('B.Tech');
      expect(parsed.data.skills?.[0]?.skillName).toBe('TypeScript');
    }
  });

  it('rejects invalid qualification passing year', () => {
    const invalidYear = {
      ...valid,
      qualifications: [
        {
          institution: 'Test College',
          degree: 'B.Sc',
          passingYear: 1899,
        },
      ],
    };
    expect(createEmployeeSchema.safeParse(invalidYear).success).toBe(false);
  });
});
