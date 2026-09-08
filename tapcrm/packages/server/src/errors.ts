/** Common application error contract consumed by the single global handler. */
export class ApplicationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
