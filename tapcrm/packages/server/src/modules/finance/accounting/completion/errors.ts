export class AccountingCompletionError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = 'AccountingCompletionError';
    this.status = status;
  }
}
