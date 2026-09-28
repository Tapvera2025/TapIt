import { globalAccess, type Scope } from '@tapcrm/contracts';
import { effectivePolicy, MATCH_NOTHING, type Resource } from '@tapcrm/authz';
import { AuthorizationError } from '@tapcrm/authz';
import { PlatformValidationError } from '../../platform/errors.js';
import { db } from '../../platform/dal/db.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { sql } from '../../platform/dal/sql.js';

const PEOPLE_TARGET_TYPES = ['user', 'employee', 'roleChangeRequest', 'role_change_request'] as const;

export interface AuditEntryResource extends Resource {
  readonly type: 'auditEntry';
  readonly id: string;
  readonly organizationId: string;
  readonly stream: 'access' | 'activity';
  readonly sequence: string;
  readonly occurredAt: Date;
  readonly actorId: string | null;
  readonly actorType: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly beforeData: unknown;
  readonly afterData: unknown;
  readonly reason: string | null;
  readonly sourceIp: string | null;
  readonly requestId: string | null;
  readonly hashVersion: number;
  readonly prevHash: string | null;
  readonly hash: string;
  readonly legalHold: boolean;
}

interface AuditRow {
  readonly organizationId: string;
  readonly stream: 'access' | 'activity';
  readonly sequence: string;
  readonly occurredAt: Date;
  readonly actorId: string | null;
  readonly actorType: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly beforeData: unknown;
  readonly afterData: unknown;
  readonly reason: string | null;
  readonly sourceIp: string | null;
  readonly requestId: string | null;
  readonly hashVersion: number;
  readonly legalHold: boolean;
  prevHash: Buffer | null;
  hash: Buffer;
}

export interface AuditQuery {
  readonly stream?: 'access' | 'activity';
  readonly actorId?: string;
  readonly targetId?: string;
  readonly action?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly organizationId?: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface AuditPage {
  readonly entries: AuditEntryResource[];
  readonly nextCursor: string | null;
}

export function isPeopleAudit(row: Pick<AuditRow, 'targetType' | 'action'>): boolean {
  return PEOPLE_TARGET_TYPES.includes(row.targetType as (typeof PEOPLE_TARGET_TYPES)[number]) ||
    row.action.startsWith('access.') ||
    row.action.startsWith('employee.') ||
    row.action.startsWith('identity.');
}

export function auditEntryId(row: Pick<AuditRow, 'stream' | 'sequence' | 'occurredAt'> | { stream: AuditRow['stream']; sequence: number | bigint | string; occurredAt: Date }): string {
  return Buffer.from(JSON.stringify({
    stream: row.stream,
    sequence: String(row.sequence),
    occurredAt: row.occurredAt.toISOString(),
  }), 'utf8').toString('base64url');
}

function decodeAuditEntryId(id: string): { stream: 'access' | 'activity'; sequence: string; occurredAt: Date } | null {
  try {
    const value = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as Record<string, unknown>;
    if ((value['stream'] !== 'access' && value['stream'] !== 'activity') ||
        (typeof value['sequence'] !== 'string' || !/^\d+$/.test(value['sequence'])) ||
        typeof value['occurredAt'] !== 'string') return null;
    const occurredAt = new Date(value['occurredAt']);
    return Number.isNaN(occurredAt.getTime()) ? null : {
      stream: value['stream'],
      sequence: value['sequence'],
      occurredAt,
    };
  } catch {
    return null;
  }
}

function toResource(row: AuditRow): AuditEntryResource {
  return {
    ...row,
    type: 'auditEntry',
    id: auditEntryId(row),
    prevHash: row.prevHash?.toString('hex') ?? null,
    hash: row.hash.toString('hex'),
  };
}

async function isHrViewer(ctx: RequestContext): Promise<boolean> {
  const row = await db.maybeOne<{ accountType: string; departmentCode: string | null }>(ctx, sql`
    SELECT u.account_type, d.code AS department_code
    FROM app_user u
    LEFT JOIN department d
      ON d.organization_id = u.organization_id AND d.id = u.department_id
    WHERE u.organization_id = ${ctx.organizationId} AND u.id = ${ctx.principal.id}
  `);
  return row?.accountType === 'employee' && row.departmentCode?.toUpperCase() === 'HR';
}

export async function assertAuditViewer(ctx: RequestContext): Promise<'super-admin' | 'hr'> {
  const policy = await effectivePolicy(ctx, 'audit:view');
  if (!globalAccess(ctx.principal) && !policy?.allowed) {
    throw new AuthorizationError('audit:view', 'not_allowed', 'Audit access is not available to this account.');
  }
  if (globalAccess(ctx.principal)) return 'super-admin';
  if (!(await isHrViewer(ctx))) {
    throw new AuthorizationError('audit:view', 'not_allowed', 'Only HR can view the people audit stream.');
  }
  return 'hr';
}

function rowSelect() {
  return sql.raw(`
    SELECT organization_id AS "organizationId", stream, sequence,
           occurred_at AS "occurredAt", actor_id AS "actorId", actor_type AS "actorType",
           action, target_type AS "targetType", target_id AS "targetId",
           before_data AS "beforeData", after_data AS "afterData", reason,
           host(source_ip) AS "sourceIp", request_id AS "requestId",
           hash_version AS "hashVersion", prev_hash AS "prevHash", hash, legal_hold AS "legalHold"
    FROM audit_entry ae
  `);
}

export async function listAuditEntries(ctx: RequestContext, query: AuditQuery): Promise<AuditPage> {
  const viewer = await assertAuditViewer(ctx);
  if (query.organizationId !== undefined && query.organizationId !== ctx.organizationId) {
    throw new AuthorizationError('audit:view', 'out_of_scope', 'Audit queries cannot cross organization boundaries.');
  }
  const cursor = query.cursor ? decodeAuditEntryId(query.cursor) : null;
  if (query.cursor && cursor === null) throw new PlatformValidationError('Invalid audit cursor.');

  const filters = [
    sql`ae.organization_id = ${ctx.organizationId}`,
    query.stream ? sql`ae.stream = ${query.stream}` : sql`TRUE`,
    query.actorId ? sql`ae.actor_id = ${query.actorId}` : sql`TRUE`,
    query.targetId ? sql`ae.target_id = ${query.targetId}` : sql`TRUE`,
    query.action ? sql`ae.action = ${query.action}` : sql`TRUE`,
    query.from ? sql`ae.occurred_at >= ${query.from}` : sql`TRUE`,
    query.to ? sql`ae.occurred_at <= ${query.to}` : sql`TRUE`,
    viewer === 'hr'
      ? sql`(ae.target_type = ANY(${[...PEOPLE_TARGET_TYPES]}::text[]) OR ae.action LIKE 'access.%' OR ae.action LIKE 'employee.%' OR ae.action LIKE 'identity.%')`
      : sql`TRUE`,
    cursor
      ? sql`(ae.occurred_at < ${cursor.occurredAt} OR (ae.occurred_at = ${cursor.occurredAt} AND (ae.sequence < ${cursor.sequence} OR (ae.sequence = ${cursor.sequence} AND ae.stream < ${cursor.stream}))))`
      : sql`TRUE`,
  ];
  const where = sql.join(filters, ' AND ');
  const rows = await db.query<AuditRow>(ctx, sql`
    ${rowSelect()}
    WHERE ${where}
    ORDER BY ae.occurred_at DESC, ae.sequence DESC, ae.stream DESC
    LIMIT ${query.limit + 1}
  `);
  const archivedRows = await import('./archive.js').then(({ searchArchivedAuditEntries }) => searchArchivedAuditEntries(ctx, {
    ...(query.stream ? { stream: query.stream } : {}),
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.targetId ? { targetId: query.targetId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
  })).then((rows) => rows.map((row): AuditRow => ({
    organizationId: row.organizationId,
    stream: row.stream,
    sequence: row.sequence,
    occurredAt: row.occurredAt,
    actorId: row.actorId,
    actorType: row.actorType,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    beforeData: row.before,
    afterData: row.after,
    reason: row.reason,
    sourceIp: row.sourceIp,
    requestId: row.requestId,
    hashVersion: row.hashVersion,
    prevHash: row.prevHash,
    hash: row.hash,
    legalHold: row.legalHold,
  })));
  const merged = [...rows, ...archivedRows]
    .filter((row) => !cursor || row.occurredAt < cursor.occurredAt ||
      (row.occurredAt.getTime() === cursor.occurredAt.getTime() &&
        (BigInt(row.sequence) < BigInt(cursor.sequence) ||
          (BigInt(row.sequence) === BigInt(cursor.sequence) && row.stream < cursor.stream))))
    .sort((left, right) => {
      const byTime = right.occurredAt.getTime() - left.occurredAt.getTime();
      if (byTime !== 0) return byTime;
      const rightSequence = BigInt(right.sequence);
      const leftSequence = BigInt(left.sequence);
      if (rightSequence !== leftSequence) return rightSequence > leftSequence ? 1 : -1;
      return right.stream.localeCompare(left.stream);
    });
  const unique = [...new Map(merged.map((row) => [`${row.stream}:${row.sequence}:${row.occurredAt.toISOString()}`, row])).values()];
  const visible = viewer === 'hr' ? unique.filter(isPeopleAudit) : unique;
  const hasNext = visible.length > query.limit;
  const pageRows = hasNext ? visible.slice(0, query.limit) : visible;
  return {
    entries: pageRows.map(toResource),
    nextCursor: hasNext ? auditEntryId(pageRows[pageRows.length - 1]!) : null,
  };
}

export async function loadAuditEntryResource(ctx: RequestContext, id: string): Promise<AuditEntryResource | null> {
  const viewer = await assertAuditViewer(ctx).catch(() => null);
  if (viewer === null) return null;
  const key = decodeAuditEntryId(id);
  if (key === null) return null;
  const row = await db.maybeOne<AuditRow>(ctx, sql`
    ${rowSelect()}
    WHERE ae.organization_id = ${ctx.organizationId}
      AND ae.stream = ${key.stream}
      AND ae.sequence = ${key.sequence}
      AND ae.occurred_at = ${key.occurredAt}
  `);
  if (row) return viewer === 'hr' && !isPeopleAudit(row) ? null : toResource(row);
  const archived = await import('./archive.js').then(({ loadArchivedAuditEntry }) => loadArchivedAuditEntry(ctx, key));
  if (!archived || (viewer === 'hr' && !isPeopleAudit(archived))) return null;
  return toResource({
    organizationId: archived.organizationId,
    stream: archived.stream,
    sequence: archived.sequence,
    occurredAt: archived.occurredAt,
    actorId: archived.actorId,
    actorType: archived.actorType,
    action: archived.action,
    targetType: archived.targetType,
    targetId: archived.targetId,
    beforeData: archived.before,
    afterData: archived.after,
    reason: archived.reason,
    sourceIp: archived.sourceIp,
    requestId: archived.requestId,
    hashVersion: archived.hashVersion,
    prevHash: archived.prevHash,
    hash: archived.hash,
    legalHold: archived.legalHold,
  });
}

export function auditPeopleFilter(_scope: Scope) {
  return {
    ...MATCH_NOTHING,
    sql: `(ae.target_type = ANY($1::text[]) OR ae.action LIKE 'access.%' OR ae.action LIKE 'employee.%' OR ae.action LIKE 'identity.%')`,
    parameters: [[...PEOPLE_TARGET_TYPES]],
  };
}
