/** Errors of the SEO crawler's outbound-request guard (ssrf-guard.ts, guarded-fetch.ts). */

export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(`SSRF guard blocked request: ${reason}`);
  }
}

/**
 * The host does not resolve. Still a guard refusal (nothing was sent), but the
 * crawler reports it as "address not found" rather than as a safety block.
 */
export class HostNotFoundError extends SsrfBlockedError {
  readonly hostname: string;
  constructor(hostname: string) {
    super(`DNS resolution failed for "${hostname}"`);
    this.hostname = hostname;
  }
}
