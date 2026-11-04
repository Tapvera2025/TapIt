export class ReceivablesValidationError extends Error {
  readonly statusCode = 422;
  readonly code = 'RECEIVABLES_VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'ReceivablesValidationError';
  }
}

export class ReceivablesNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'RECEIVABLES_NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'ReceivablesNotFoundError';
  }
}
