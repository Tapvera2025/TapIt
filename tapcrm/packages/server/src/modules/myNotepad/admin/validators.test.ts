import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  employeeHistoryParamsSchema,
  listEmployeeNotesFilterSchema,
  userIdParamSchema,
} from './validators.js';

describe('Admin Employee Notes Validators', () => {
  describe('listEmployeeNotesFilterSchema', () => {
    it('applies default pagination values', () => {
      const parsed = listEmployeeNotesFilterSchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.limit).toBe(50);
      expect(parsed.department).toBeUndefined();
      expect(parsed.search).toBeUndefined();
    });

    it('coerces string page and limit to numbers', () => {
      const parsed = listEmployeeNotesFilterSchema.parse({
        page: '2',
        limit: '25',
      });
      expect(parsed.page).toBe(2);
      expect(parsed.limit).toBe(25);
    });

    it('trims department and search strings', () => {
      const parsed = listEmployeeNotesFilterSchema.parse({
        department: '  Engineering  ',
        search: '  Alice  ',
      });
      expect(parsed.department).toBe('Engineering');
      expect(parsed.search).toBe('Alice');
    });

    it('rejects limit exceeding PAGE_LIMIT_MAX (200)', () => {
      expect(() =>
        listEmployeeNotesFilterSchema.parse({ limit: 201 }),
      ).toThrow();
    });

    it('rejects zero or negative page and limit', () => {
      expect(() => listEmployeeNotesFilterSchema.parse({ page: 0 })).toThrow();
      expect(() => listEmployeeNotesFilterSchema.parse({ page: -1 })).toThrow();
      expect(() => listEmployeeNotesFilterSchema.parse({ limit: 0 })).toThrow();
      expect(() => listEmployeeNotesFilterSchema.parse({ limit: -5 })).toThrow();
    });
  });

  describe('userIdParamSchema', () => {
    it('accepts valid UUID', () => {
      const validUuid = randomUUID();
      const parsed = userIdParamSchema.parse({ userId: validUuid });
      expect(parsed.userId).toBe(validUuid);
    });

    it('rejects invalid UUID string', () => {
      expect(() => userIdParamSchema.parse({ userId: 'not-a-uuid' })).toThrow(
        'Invalid user ID',
      );
    });
  });

  describe('employeeHistoryParamsSchema', () => {
    it('accepts valid user and history UUIDs', () => {
      const userId = randomUUID();
      const historyId = randomUUID();
      const parsed = employeeHistoryParamsSchema.parse({ userId, historyId });
      expect(parsed.userId).toBe(userId);
      expect(parsed.historyId).toBe(historyId);
    });

    it('rejects invalid history UUID', () => {
      expect(() =>
        employeeHistoryParamsSchema.parse({
          userId: randomUUID(),
          historyId: 'invalid-id',
        }),
      ).toThrow('Invalid history ID');
    });
  });
});
