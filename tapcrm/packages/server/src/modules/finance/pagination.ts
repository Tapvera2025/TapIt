import type { RequestContext } from '../../platform/dal/context.js';
import { db } from '../../platform/dal/db.js';
import type { SqlQuery } from '../../platform/dal/sql.js';

export interface PaginationInput {
  page: number;
  pageSize: number;
  offset: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export function parsePagination(query: Record<string, unknown>): PaginationInput {
  const rawPage = typeof query['page'] === 'string' ? Number(query['page']) : 1;
  const rawPageSize = typeof query['pageSize'] === 'string' ? Number(query['pageSize']) : 25;
  const pageSize = Number.isInteger(rawPageSize) ? Math.min(Math.max(rawPageSize, 1), 100) : 25;
  const page = Number.isInteger(rawPage) ? Math.max(rawPage, 1) : 1;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export async function paginate<T>(ctx: RequestContext, itemsQuery: SqlQuery, countQuery: SqlQuery, input: PaginationInput): Promise<PaginatedResult<T>> {
  const [items, count] = await Promise.all([
    db.query<T>(ctx, itemsQuery),
    db.one<{ total: string }>(ctx, countQuery),
  ]);
  const total = Number(count.total);
  return {
    items,
    pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) },
  };
}
