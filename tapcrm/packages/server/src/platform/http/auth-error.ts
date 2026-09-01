export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials');

    this.name = 'InvalidCredentialsError';
  }
}

export class InvalidSessionError extends Error {
  constructor() {
    super('Invalid session');

    this.name = 'InvalidSessionError';
  }
}

export class MfaRequiredError extends Error {
  constructor(message = 'Multi-factor authentication is required') {
    super(message);

    this.name = 'MfaRequiredError';
  }
}

export class RequestValidationError extends Error {
  readonly issues: readonly unknown[];

  constructor(issues: readonly unknown[]) {
    super('Request validation failed');

    this.name = 'RequestValidationError';

    this.issues = issues;
  }
}
