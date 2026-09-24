import { globalAccess } from '@tapcrm/contracts';
import { AuthorizationError } from '@tapcrm/authz';
import { ApplicationError } from '../../errors.js';
import { db } from '../../platform/dal/db.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { sql } from '../../platform/dal/sql.js';
import { consumeRateLimit } from '../../platform/security/rate-limit.js';
import { listAuditEntries, type AuditEntryResource, type AuditQuery } from './repository.js';

export const AUDIT_EXPORT_LIMIT = 5;
export const AUDIT_EXPORT_WINDOW_SECONDS = 60 * 60;

export type AuditExportFormat = 'csv' | 'json';

export interface AuditExportInput {
  readonly format: AuditExportFormat;
  readonly stream?: AuditQuery['stream'] | undefined;
  readonly actorId?: string | undefined;
  readonly targetId?: string | undefined;
  readonly action?: string | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

export function assertAuditExporter(ctx: RequestContext): void {
  if (!globalAccess(ctx.principal)) {
    throw new AuthorizationError('audit:export', 'not_allowed', 'Only Super Admin can export audit data.');
  }
}

export async function assertExportRateLimit(ctx: RequestContext): Promise<void> {
  const result = await consumeRateLimit(`audit-export:${ctx.organizationId}:${ctx.principal.id}`, AUDIT_EXPORT_LIMIT, AUDIT_EXPORT_WINDOW_SECONDS);
  if (!result.allowed) {
    throw new ApplicationError(
      'Audit export rate limit exceeded. Try again later.',
      429,
      'RATE_LIMITED',
      { retryAfterSeconds: result.retryAfterSeconds },
    );
  }
}

function serializable(entry: AuditEntryResource): Record<string, unknown> {
  return {
    id: entry.id,
    organizationId: entry.organizationId,
    stream: entry.stream,
    sequence: entry.sequence,
    occurredAt: entry.occurredAt.toISOString(),
    actorId: entry.actorId,
    actorType: entry.actorType,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    beforeData: entry.beforeData,
    afterData: entry.afterData,
    reason: entry.reason,
    sourceIp: entry.sourceIp,
    requestId: entry.requestId,
    hashVersion: entry.hashVersion,
    prevHash: entry.prevHash,
    hash: entry.hash,
    legalHold: entry.legalHold,
  };
}

function csvValue(value: unknown): string {
  const text = typeof value === 'string' ? value : value === null || value === undefined ? '' : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export const AUDIT_EXPORT_COLUMNS = [
  'id', 'organizationId', 'stream', 'sequence', 'occurredAt', 'actorId', 'actorType',
  'action', 'targetType', 'targetId', 'beforeData', 'afterData', 'reason', 'sourceIp',
  'requestId', 'hashVersion', 'prevHash', 'hash', 'legalHold',
] as const;

export function csvHeader(): string {
  return `${AUDIT_EXPORT_COLUMNS.join(',')}\n`;
}

export function csvRow(entry: AuditEntryResource): string {
  const row = serializable(entry);
  return `${AUDIT_EXPORT_COLUMNS.map((column) => csvValue(row[column])).join(',')}\n`;
}

function filterSummary(input: AuditExportInput): Record<string, unknown> {
  return {
    ...(input.stream ? { stream: input.stream } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.targetId ? { targetId: input.targetId } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(input.from ? { from: input.from.toISOString() } : {}),
    ...(input.to ? { to: input.to.toISOString() } : {}),
    format: input.format,
  };
}

async function recordExportEvent(
  ctx: RequestContext,
  input: AuditExportInput,
  result: { status: 'completed' | 'failed'; resultCount: number; error?: string },
): Promise<void> {
  await db.query(ctx, sql`
    INSERT INTO audit_outbox (organization_id, stream, payload)
    VALUES (${ctx.organizationId}, 'access', ${JSON.stringify({
      action: 'audit.exported',
      actorId: ctx.principal.id,
      actorType: ctx.principal.accountType,
      targetType: 'auditExport',
      targetId: null,
      before: null,
      after: { ...filterSummary(input), status: result.status, resultCount: result.resultCount, ...(result.error ? { error: result.error } : {}) },
      reason: result.status === 'completed' ? 'Audit export completed.' : 'Audit export failed.',
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
    })}::jsonb)
  `);
}

export async function streamAuditExport(
  ctx: RequestContext,
  input: AuditExportInput,
  write: (chunk: string) => void,
): Promise<number> {
  assertAuditExporter(ctx);
  await assertExportRateLimit(ctx);

  const query: AuditQuery = {
    ...(input.stream ? { stream: input.stream } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.targetId ? { targetId: input.targetId } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
    limit: 100,
  };
  let cursor: string | undefined;
  let resultCount = 0;
  let started = false;
  try {
    if (input.format === 'csv') write(csvHeader());
    else write('[\n');
    for (;;) {
      const page = await listAuditEntries(ctx, { ...query, ...(cursor ? { cursor } : {}) });
      for (const entry of page.entries) {
        if (input.format === 'csv') write(csvRow(entry));
        else write(`${started ? ',\n' : ''}${JSON.stringify(serializable(entry))}`);
        started = true;
        resultCount += 1;
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    if (input.format === 'json') write('\n]\n');
    await recordExportEvent(ctx, input, { status: 'completed', resultCount });
    return resultCount;
  } catch (error) {
    await recordExportEvent(ctx, input, {
      status: 'failed',
      resultCount,
      error: error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
    }).catch(() => undefined);
    throw error;
  }
}
