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
});
