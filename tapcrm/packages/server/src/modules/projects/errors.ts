import { ApplicationError } from '../../errors.js';

export const PROJECT_ERROR_CODES = {
  NOT_FOUND: 'PROJECT_NOT_FOUND',
  CLIENT_NOT_FOUND: 'PROJECT_CLIENT_NOT_FOUND',
  VALIDATION_FAILED: 'PROJECT_VALIDATION_FAILED',
  ASSIGNEE_NOT_FOUND: 'PROJECT_ASSIGNEE_NOT_FOUND',
  DISCUSSION_GROUP_EXISTS: 'PROJECT_DISCUSSION_GROUP_EXISTS',
} as const;

export class ProjectNotFoundError extends ApplicationError {
  constructor() {
    super('Project not found', 404, PROJECT_ERROR_CODES.NOT_FOUND);
  }
}

export class ProjectClientNotFoundError extends ApplicationError {
  constructor() {
    super('Client not found', 404, PROJECT_ERROR_CODES.CLIENT_NOT_FOUND);
  }
}

export class ProjectValidationError extends ApplicationError {
  constructor(message: string, details?: unknown) {
    super(message, 422, PROJECT_ERROR_CODES.VALIDATION_FAILED, details);
  }
}

export class ProjectDiscussionGroupExistsError extends ApplicationError {
  constructor() {
    super('This project already has a discussion group', 409, PROJECT_ERROR_CODES.DISCUSSION_GROUP_EXISTS);
  }
}
