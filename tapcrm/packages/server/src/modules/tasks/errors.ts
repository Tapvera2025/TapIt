import { ApplicationError } from '../../errors.js';

export const TASK_ERROR_CODES = {
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_VALIDATION_ERROR: 'TASK_VALIDATION_ERROR',
  TASK_INVALID_TRANSITION: 'TASK_INVALID_TRANSITION',
  TASK_ASSIGNEE_NOT_FOUND: 'TASK_ASSIGNEE_NOT_FOUND',
  TASK_ASSIGNEE_CROSS_TENANT: 'TASK_ASSIGNEE_CROSS_TENANT',
  TASK_DATE_RANGE_INVALID: 'TASK_DATE_RANGE_INVALID',
} as const;

export class TaskValidationError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 422, code, details);
    this.name = 'TaskValidationError';
  }
}

export class TaskNotFoundError extends ApplicationError {
  constructor(
    code: string = TASK_ERROR_CODES.TASK_NOT_FOUND,
    message = 'Task not found',
  ) {
    super(message, 404, code);
    this.name = 'TaskNotFoundError';
  }
}

export class TaskConflictError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 409, code, details);
    this.name = 'TaskConflictError';
  }
}
