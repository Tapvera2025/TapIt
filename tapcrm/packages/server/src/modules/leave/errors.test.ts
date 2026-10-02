import { describe, expect, it } from 'vitest';
import {
  LEAVE_ERROR_CODES,
  LeaveConflictError,
  LeaveForbiddenError,
  LeaveNotFoundError,
  LeaveTypeNotFoundError,
  LeaveValidationError,
} from './errors.js';

describe('Leave error classes', () => {
  describe('LeaveNotFoundError', () => {
    it('has status 404 and code LEAVE_NOT_FOUND', () => {
      const error = new LeaveNotFoundError();
      expect(error.status).toBe(404);
      expect(error.code).toBe(LEAVE_ERROR_CODES.NOT_FOUND);
      expect(error.name).toBe('LeaveNotFoundError');
    });

    it('uses default message when none provided', () => {
      const error = new LeaveNotFoundError();
      expect(error.message).toBe('Leave request not found');
    });

    it('accepts custom message', () => {
      const error = new LeaveNotFoundError('Custom leave not found');
      expect(error.message).toBe('Custom leave not found');
    });
  });

  describe('LeaveTypeNotFoundError', () => {
    it('has status 404 and code LEAVE_TYPE_NOT_FOUND', () => {
      const error = new LeaveTypeNotFoundError();
      expect(error.status).toBe(404);
      expect(error.code).toBe(LEAVE_ERROR_CODES.TYPE_NOT_FOUND);
      expect(error.name).toBe('LeaveTypeNotFoundError');
    });

    it('uses default message when none provided', () => {
      const error = new LeaveTypeNotFoundError();
      expect(error.message).toBe('Leave type not found');
    });

    it('accepts custom message', () => {
      const error = new LeaveTypeNotFoundError('Custom type not found');
      expect(error.message).toBe('Custom type not found');
    });
  });

  describe('LeaveForbiddenError', () => {
    it('has status 403', () => {
      const error = new LeaveForbiddenError(LEAVE_ERROR_CODES.SELF_ACKNOWLEDGE, 'Cannot acknowledge own request');
      expect(error.status).toBe(403);
      expect(error.code).toBe(LEAVE_ERROR_CODES.SELF_ACKNOWLEDGE);
      expect(error.name).toBe('LeaveForbiddenError');
    });

    it('accepts different error codes', () => {
      const selfDecide = new LeaveForbiddenError(LEAVE_ERROR_CODES.SELF_DECIDE, 'Cannot decide own request');
      expect(selfDecide.code).toBe(LEAVE_ERROR_CODES.SELF_DECIDE);

      const forbidden = new LeaveForbiddenError(LEAVE_ERROR_CODES.FORBIDDEN, 'Access denied');
      expect(forbidden.code).toBe(LEAVE_ERROR_CODES.FORBIDDEN);
    });
  });

  describe('LeaveValidationError', () => {
    it('has status 422', () => {
      const error = new LeaveValidationError(LEAVE_ERROR_CODES.INVALID_DATES, 'From date must be before to date');
      expect(error.status).toBe(422);
      expect(error.code).toBe(LEAVE_ERROR_CODES.INVALID_DATES);
      expect(error.name).toBe('LeaveValidationError');
    });

    it('accepts error details', () => {
      const details = { fromDate: '2026-10-01', toDate: '2026-09-01' };
      const error = new LeaveValidationError(
        LEAVE_ERROR_CODES.INVALID_DATES,
        'From date must be before to date',
        details,
      );
      expect(error.details).toEqual(details);
    });

    it('supports different validation error codes', () => {
      const insufficientBalance = new LeaveValidationError(
        LEAVE_ERROR_CODES.INSUFFICIENT_BALANCE,
        'Insufficient leave balance',
      );
      expect(insufficientBalance.code).toBe(LEAVE_ERROR_CODES.INSUFFICIENT_BALANCE);

      const crossYear = new LeaveValidationError(
        LEAVE_ERROR_CODES.CROSS_YEAR,
        'Leave request cannot span multiple years',
      );
      expect(crossYear.code).toBe(LEAVE_ERROR_CODES.CROSS_YEAR);
    });
  });

  describe('LeaveConflictError', () => {
    it('has status 409', () => {
      const error = new LeaveConflictError(LEAVE_ERROR_CODES.OVERLAP, 'Leave request overlaps with existing request');
      expect(error.status).toBe(409);
      expect(error.code).toBe(LEAVE_ERROR_CODES.OVERLAP);
      expect(error.name).toBe('LeaveConflictError');
    });

    it('accepts error details', () => {
      const details = { conflictingRequestId: 'abc-123' };
      const error = new LeaveConflictError(
        LEAVE_ERROR_CODES.OVERLAP,
        'Overlapping leave request',
        details,
      );
      expect(error.details).toEqual(details);
    });
  });

  describe('LEAVE_ERROR_CODES constant', () => {
    it('exports all expected error codes', () => {
      expect(LEAVE_ERROR_CODES.NOT_FOUND).toBe('LEAVE_NOT_FOUND');
      expect(LEAVE_ERROR_CODES.TYPE_NOT_FOUND).toBe('LEAVE_TYPE_NOT_FOUND');
      expect(LEAVE_ERROR_CODES.FORBIDDEN).toBe('LEAVE_FORBIDDEN');
      expect(LEAVE_ERROR_CODES.SELF_ACKNOWLEDGE).toBe('LEAVE_SELF_ACKNOWLEDGE');
      expect(LEAVE_ERROR_CODES.SELF_DECIDE).toBe('LEAVE_SELF_DECIDE');
      expect(LEAVE_ERROR_CODES.OVERLAP).toBe('LEAVE_OVERLAP');
      expect(LEAVE_ERROR_CODES.INSUFFICIENT_BALANCE).toBe('LEAVE_INSUFFICIENT_BALANCE');
      expect(LEAVE_ERROR_CODES.INVALID_DATES).toBe('LEAVE_INVALID_DATES');
      expect(LEAVE_ERROR_CODES.CROSS_YEAR).toBe('LEAVE_CROSS_YEAR');
      expect(LEAVE_ERROR_CODES.INVALID_STATUS).toBe('LEAVE_INVALID_STATUS');
      expect(LEAVE_ERROR_CODES.INVALID_KIND).toBe('LEAVE_INVALID_KIND');
      expect(LEAVE_ERROR_CODES.ENFORCEMENT_NOT_ENABLED).toBe('LEAVE_ENFORCEMENT_NOT_ENABLED');
    });
  });
});
