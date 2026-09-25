import { describe, expect, it } from 'vitest';
import { TASK_ERROR_CODES, TaskValidationError } from './errors.js';
import { assertValidTransition } from './service.js';
import type { TaskStatus } from './types.js';

describe('Task service state machine', () => {
  it('allows valid transitions from pending', () => {
    expect(() => assertValidTransition('pending', 'in_progress')).not.toThrow();
    expect(() => assertValidTransition('pending', 'completed')).not.toThrow();
    expect(() => assertValidTransition('pending', 'cancelled')).not.toThrow();
  });

  it('allows valid transitions from in_progress', () => {
    expect(() => assertValidTransition('in_progress', 'completed')).not.toThrow();
    expect(() => assertValidTransition('in_progress', 'pending')).not.toThrow();
    expect(() => assertValidTransition('in_progress', 'cancelled')).not.toThrow();
  });

  it('allows reopening from completed to in_progress or pending', () => {
    expect(() => assertValidTransition('completed', 'in_progress')).not.toThrow();
    expect(() => assertValidTransition('completed', 'pending')).not.toThrow();
  });

  it('rejects direct transition from completed to cancelled', () => {
    expect(() => assertValidTransition('completed', 'cancelled')).toThrow(
      TaskValidationError,
    );
    try {
      assertValidTransition('completed', 'cancelled');
    } catch (err) {
      const error = err as TaskValidationError;
      expect(error.code).toBe(TASK_ERROR_CODES.TASK_INVALID_TRANSITION);
      expect(error.status).toBe(422);
    }
  });

  it('allows reopening from cancelled to pending or in_progress', () => {
    expect(() => assertValidTransition('cancelled', 'pending')).not.toThrow();
    expect(() => assertValidTransition('cancelled', 'in_progress')).not.toThrow();
  });

  it('rejects direct transition from cancelled to completed', () => {
    expect(() => assertValidTransition('cancelled', 'completed')).toThrow(
      TaskValidationError,
    );
  });

  it('treats identical transition as no-op', () => {
    const statuses: TaskStatus[] = [
      'pending',
      'in_progress',
      'completed',
      'cancelled',
    ];
    for (const status of statuses) {
      expect(() => assertValidTransition(status, status)).not.toThrow();
    }
  });
});
