import { describe, expect, it } from 'vitest';
import { createEmployeeSchema } from './validators.js';

const valid = {
  email: 'employee@example.com',
  fullName: 'Example Employee',
  password: 'Long-enough-password-123!',
  confirmPassword: 'Long-enough-password-123!',
  departmentId: '00000000-0000-0000-0000-000000000001',
  positionId: '00000000-0000-0000-0000-000000000002',
};

describe('employee creation validation', () => {
  it('requires matching initial password confirmation', () => {
    expect(createEmployeeSchema.safeParse(valid).success).toBe(true);
    expect(createEmployeeSchema.safeParse({ ...valid, confirmPassword: 'different-password-123!' }).success).toBe(false);
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
