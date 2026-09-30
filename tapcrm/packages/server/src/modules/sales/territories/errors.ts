import { ApplicationError } from '../../../errors.js';

export const TERRITORY_ERROR_CODES = {
  NOT_FOUND: 'TERRITORY_NOT_FOUND',
  TEAM_INVALID: 'TERRITORY_SALES_TEAM_INVALID',
  NAME_EXISTS: 'TERRITORY_NAME_EXISTS',
  VALIDATION_ERROR: 'TERRITORY_VALIDATION_ERROR',
} as const;

export class TerritoryNotFoundError extends ApplicationError {
  constructor() { super('Territory not found', 404, TERRITORY_ERROR_CODES.NOT_FOUND); }
}

export class TerritoryValidationError extends ApplicationError {
  constructor(code: string, message: string, details?: unknown) {
    super(message, 422, code, details);
  }
}

export class TerritoryConflictError extends ApplicationError {
  constructor(message: string) { super(message, 409, TERRITORY_ERROR_CODES.NAME_EXISTS); }
}
