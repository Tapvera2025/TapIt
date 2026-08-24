import {
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  type ApiSuccess,
  type ResponseMeta,
} from '@tapcrm/contracts';

/** TECH.md §8.1 — `{ success, data, meta?, message? }`. */
export function success<T>(data: T, meta?: ResponseMeta, message?: string): ApiSuccess<T> {
  return {
    success: true,
    data,
    ...(meta ? { meta } : {}),
    ...(message ? { message } : {}),
  };
}

/** Clamps pagination. Default 50, maximum 200 — an unbounded list is a DoS. */
export function pagination(query: Record<string, unknown>): { limit: number; page: number } {
  const rawLimit = Number(query['limit']);
  const rawPage = Number(query['page']);

  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), PAGE_LIMIT_MAX)
      : PAGE_LIMIT_DEFAULT;

  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  return { limit, page };
}
