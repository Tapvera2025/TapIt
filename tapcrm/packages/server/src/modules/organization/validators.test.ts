import { describe, expect, it } from 'vitest';
import {
  createDepartmentSchema,
  createPositionSchema,
  createTeamSchema,
} from './validators.js';

describe('generic organization validators', () => {
  it('accepts the PRD department kinds', () => {
    const result = createDepartmentSchema.safeParse({
      code: 'engineering',
      name: 'Engineering',
      kind: 'delivery',
    });

    expect(result.success).toBe(true);
  });

  it('rejects unsupported department kinds', () => {
    const result = createDepartmentSchema.safeParse({
      code: 'engineering',
      name: 'Engineering',
      kind: 'engineering',
    });
    expect(result.success).toBe(false);
  });

  it('allows a team to be created before a lead is assigned', () => {
    const result = createTeamSchema.safeParse({
      departmentId: '00000000-0000-0000-0000-000000000001',
      kind: 'sales-team',
      name: 'Platform Engineering',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.leadUserId).toBeNull();
  });

  it('rejects unsupported team kinds', () => {
    const result = createTeamSchema.safeParse({
      departmentId: '00000000-0000-0000-0000-000000000001',
      kind: 'functional',
      name: 'Platform Engineering',
    });
    expect(result.success).toBe(false);
  });

  it('requires a parent for custom positions', () => {
    const result = createPositionSchema.safeParse({
      departmentId: '00000000-0000-0000-0000-000000000001',
      code: 'engineering-head',
      name: 'Engineering Head',
      organizationalLevel: 90,
      parentPositionId: '00000000-0000-0000-0000-000000000002',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a custom position without a parent', () => {
    const result = createPositionSchema.safeParse({
      departmentId: '00000000-0000-0000-0000-000000000001',
      code: 'engineering-head',
      name: 'Engineering Head',
      organizationalLevel: 90,
      parentPositionId: null,
    });

    expect(result.success).toBe(false);
  });
});
