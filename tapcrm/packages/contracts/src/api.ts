import type { ApiErrorBody } from './errors.js';

/** TECH.md §8.1 — `{ success, data, meta?, message? }`. */
export interface ApiSuccess<T> {
  readonly success: true;
  readonly data: T;
  readonly meta?: ResponseMeta;
  readonly message?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

export interface ResponseMeta {
  readonly page?: number;
  readonly limit?: number;
  /** Row count. Named explicitly so it is never mistaken for a monetary total (CI-21). */
  readonly totalCount?: number;
  /** Cursor pagination is mandatory on audit_* and message (TECH.md §8.1). */
  readonly cursor?: string | null;
  readonly requestId?: string;
}

/** Default 50, maximum 200 (TECH.md §8.1). */
export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 200;

export interface PageQuery {
  readonly page?: number;
  readonly limit?: number;
  readonly sort?: string;
}

/**
 * Keyset pagination. TECH.md §18 requires it for list endpoints:
 * "Keyset pagination, never OFFSET" — OFFSET at 500k leads is a table scan
 * dressed as a query.
 */
export interface CursorQuery {
  readonly cursor?: string | null;
  readonly limit?: number;
}

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UNAVAILABLE: 503,
} as const;

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
