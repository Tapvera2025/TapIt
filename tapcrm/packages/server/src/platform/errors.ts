export class PlatformAuthenticationError extends Error {
  constructor(message = 'Platform authentication failed') {
    super(message);
    this.name = 'PlatformAuthenticationError';
  }
}

export class PlatformForbiddenError extends Error {
  constructor(message = 'Platform access forbidden') {
    super(message);
    this.name = 'PlatformForbiddenError';
  }
}

export class PlatformNotFoundError extends Error {
  constructor(message = 'Platform resource not found') {
    super(message);
    this.name = 'PlatformNotFoundError';
  }
}

export class PlatformConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformConflictError';
  }
}

export class PlatformValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformValidationError';
  }
}
