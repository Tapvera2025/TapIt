import { globalAccess } from '@tapcrm/contracts';
import { AuthorizationError } from '@tapcrm/authz';
import { db, platformDb, type Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import {
  verifyChain,
  type AuditActorType,
  type Json,
  type StoredChainEntry,
} from './chain.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { getArchivedObjectRows, type ArchiveRow } from './archive.js';

const STREAMS = ['access', 'activity'] as const;
const JOB_NAME = 'audit.chain-verification';
const PAGE_SIZE = 1_000;

export type AuditStream = (typeof STREAMS)[number];

export interface IntegrityFailure {
  readonly stream: AuditStream;
  readonly reason: string;
  readonly sequence: string;
  readonly occurredAt: string | null;
}

export interface StreamIntegrityReport {
  readonly stream: AuditStream;
  readonly entriesChecked: number;
  readonly failures: readonly IntegrityFailure[];
}

export interface IntegrityReport {
  readonly organizationId: string;
  readonly checkedAt: string;
  readonly outcome: 'success' | 'failure';
  readonly entriesChecked: number;
  readonly errorCount: number;
  readonly streams: readonly StreamIntegrityReport[];
  readonly retention?: {
    readonly lastRunAt: string | null;
    readonly lastOutcome: string | null;
    readonly archivedRanges: number;
    readonly archivedEntries: number;
  };
}

interface StoredAuditRow {
  organizationId: string;
  stream: AuditStream;
  sequence: string;
  occurredAt: Date;
  actorId: string | null;
  actorType: AuditActorType;
  action: string;
  targetType: string;
  targetId: string | null;
  before: Json;
  after: Json;
  reason: string | null;
  sourceIp: string | null;
  requestId: string | null;
  prevHash: Buffer | null;
  hash: Buffer;
}

interface StreamStateRow {
  nextSequence: string;
  lastHash: Buffer | null;
}

interface ArchivedBoundaryRow {
  id: string;
  organizationId: string;
  stream: AuditStream;
  sequenceStart: string;
  sequenceEnd: string;
  recordCount: number;
  firstPrevHash: Buffer | null;
  firstHash: Buffer;
  lastHash: Buffer;
  objectKey: string;
  objectChecksum: string;
  objectSizeBytes: string;
  encryptionKeyId: string;
  status: 'archived' | 'purged';
}

function failure(
  stream: AuditStream,
  reason: string,
  sequence: bigint,
  occurredAt: Date | null,
): IntegrityFailure {
  return {
    stream,
    reason,
    sequence: sequence.toString(),
    occurredAt: occurredAt?.toISOString() ?? null,
  };
}

function toStoredEntry(row: StoredAuditRow): StoredChainEntry {
  return {
    organizationId: row.organizationId,
    stream: row.stream,
    sequence: BigInt(row.sequence),
    occurredAt: row.occurredAt,
    actorId: row.actorId,
    actorType: row.actorType,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    before: row.before,
    after: row.after,
    reason: row.reason,
    sourceIp: row.sourceIp,
    requestId: row.requestId,
    prevHash: row.prevHash,
    hash: row.hash,
  };
}

export function verifyAuditEntries(
  stream: AuditStream,
  entries: readonly StoredChainEntry[],
  expectedSequence = 1n,
  expectedPrevHash: Buffer | null = null,
): IntegrityFailure[] {
  return verifyChain(entries, {
    sequence: expectedSequence,
    prevHash: expectedPrevHash,
  }).map((item) => {
    const row = entries.find((entry) => entry.sequence === item.sequence);
    return failure(stream, item.reason, item.sequence, row?.occurredAt ?? null);
  });
}

async function verifyStream(
  tx: Tx,
  organizationId: string,
  stream: AuditStream,
): Promise<StreamIntegrityReport> {
  let lastSequence: bigint | null = null;
  let lastOccurredAt: Date | null = null;
  let previousHash: Buffer | null = null;
  let entriesChecked = 0;
  const failures: IntegrityFailure[] = [];

  const archived = await tx.query<ArchivedBoundaryRow>(sql`
    SELECT id, organization_id AS "organizationId", stream,
           sequence_start::text AS "sequenceStart", sequence_end::text AS "sequenceEnd",
           record_count AS "recordCount", first_prev_hash AS "firstPrevHash", first_hash AS "firstHash", last_hash AS "lastHash",
           object_key AS "objectKey", object_checksum AS "objectChecksum", object_size_bytes::text AS "objectSizeBytes",
           encryption_key_id AS "encryptionKeyId", status
    FROM audit_archive
    WHERE organization_id = ${organizationId} AND stream = ${stream}
      AND status IN ('archived', 'purged')
    ORDER BY sequence_start ASC
  `);
  let expectedSequence = 1n;
  let expectedPrevHash: Buffer | null = null;
  for (const archive of archived) {
    const start = BigInt(archive.sequenceStart);
    const end = BigInt(archive.sequenceEnd);
    if (start !== expectedSequence) failures.push(failure(stream, 'sequence-gap', start, null));
    const linked = (archive.firstPrevHash === null && expectedPrevHash === null) ||
      (archive.firstPrevHash !== null && expectedPrevHash !== null && archive.firstPrevHash.equals(expectedPrevHash));
    if (!linked) failures.push(failure(stream, 'prev-hash-mismatch', start, null));
    entriesChecked += archive.recordCount;
    if (archive.status === 'archived') {
      try {
        const rows = await getArchivedObjectRows(archive as ArchiveRow);
        if (rows.length !== archive.recordCount) failures.push(failure(stream, 'archive-record-count-mismatch', start, null));
        const archivedEntries: StoredChainEntry[] = rows.map((row) => ({
          organizationId: row.organizationId, stream: row.stream, sequence: BigInt(row.sequence), occurredAt: row.occurredAt,
          actorId: row.actorId, actorType: row.actorType, action: row.action, targetType: row.targetType, targetId: row.targetId,
          before: row.before, after: row.after, reason: row.reason, sourceIp: row.sourceIp, requestId: row.requestId,
          prevHash: row.prevHash, hash: row.hash,
        }));
        failures.push(...verifyAuditEntries(stream, archivedEntries, start, archive.firstPrevHash));
        const first = archivedEntries[0];
        const last = archivedEntries[archivedEntries.length - 1];
        if (first && !first.hash.equals(archive.firstHash)) failures.push(failure(stream, 'archive-first-hash-mismatch', start, first.occurredAt));
        if (last && !last.hash.equals(archive.lastHash)) failures.push(failure(stream, 'archive-last-hash-mismatch', BigInt(archive.sequenceEnd), last.occurredAt));
      } catch (error) {
        failures.push(failure(stream, `archive-object-invalid: ${error instanceof Error ? error.message : 'verification failed'}`, start, null));
      }
    }
    expectedSequence = end + 1n;
    expectedPrevHash = archive.lastHash;
  }

  while (true) {
    const rows: StoredAuditRow[] = await tx.query<StoredAuditRow>(
      sql`
        SELECT organization_id AS "organizationId", stream, sequence::text AS sequence,
               occurred_at AS "occurredAt", actor_id AS "actorId", actor_type AS "actorType",
               action, target_type AS "targetType", target_id AS "targetId",
               before_data AS before, after_data AS after, reason, host(source_ip) AS "sourceIp",
               request_id AS "requestId", prev_hash AS "prevHash", hash
        FROM audit_entry
        WHERE organization_id = ${organizationId}
          AND stream = ${stream}
          ${lastSequence === null
            ? sql``
            : sql`AND (sequence > ${lastSequence} OR (sequence = ${lastSequence} AND occurred_at > ${lastOccurredAt}))`}
        ORDER BY sequence ASC, occurred_at ASC
        LIMIT ${PAGE_SIZE}
      `,
    );
    if (rows.length === 0) break;

    const entries: StoredChainEntry[] = rows.map(toStoredEntry);
    failures.push(...verifyAuditEntries(
      stream,
      entries,
      lastSequence === null ? expectedSequence : lastSequence + 1n,
      lastSequence === null ? expectedPrevHash : previousHash,
    ));
    entriesChecked += entries.length;
    const last: StoredChainEntry = entries[entries.length - 1]!;
    lastSequence = last.sequence;
    lastOccurredAt = last.occurredAt;
    previousHash = last.hash;
    if (rows.length < PAGE_SIZE) break;
  }

  const state = await tx.maybeOne<StreamStateRow>(
    sql`
      SELECT next_sequence::text AS "nextSequence", last_hash AS "lastHash"
      FROM audit_stream_state
      WHERE organization_id = ${organizationId} AND stream = ${stream}
    `,
  );
  const expectedNext = BigInt(state?.nextSequence ?? '1');
  const actualNext = lastSequence === null ? expectedSequence : lastSequence + 1n;
  if (expectedNext !== actualNext) {
    failures.push(failure(stream, 'stream-state-mismatch', actualNext, lastOccurredAt));
  }
  const stateHash = state?.lastHash ?? null;
  const actualLastHash = lastSequence === null ? expectedPrevHash : previousHash;
  if ((stateHash === null) !== (actualLastHash === null) ||
      (stateHash !== null && actualLastHash !== null && !stateHash.equals(actualLastHash))) {
    failures.push(failure(stream, 'stream-state-hash-mismatch', actualNext - 1n, lastOccurredAt));
  }

  return { stream, entriesChecked, failures };
}

export async function verifyOrganizationAudit(organizationId: string): Promise<IntegrityReport> {
  const checkedAt = new Date().toISOString();
  return platformDb.transactionForOrganization(
    organizationId,
    'audit-chain-verification',
    'verify audit hash chains',
    async (tx) => {
      const streams = await Promise.all(STREAMS.map((stream) => verifyStream(tx, organizationId, stream)));
      const entriesChecked = streams.reduce((total, report) => total + report.entriesChecked, 0);
      const errorCount = streams.reduce((total, report) => total + report.failures.length, 0);
      return {
        organizationId,
        checkedAt,
        outcome: errorCount === 0 ? 'success' : 'failure',
        entriesChecked,
        errorCount,
        streams,
      };
    },
  );
}

async function recordReport(
  tx: Tx,
  organizationId: string,
  idempotencyKey: string,
  report: IntegrityReport,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO job_run (
      organization_id, job_name, idempotency_key, started_at, finished_at,
      outcome, items_processed, error_count, details
    ) VALUES (
      ${organizationId}, ${JOB_NAME}, ${idempotencyKey}, ${report.checkedAt}, now(),
      ${report.outcome}, ${report.entriesChecked}, ${report.errorCount}, ${JSON.stringify(report)}::jsonb
    )
    ON CONFLICT (organization_id, job_name, idempotency_key) WHERE idempotency_key IS NOT NULL
    DO UPDATE SET started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at,
                  outcome = EXCLUDED.outcome, items_processed = EXCLUDED.items_processed,
                  error_count = EXCLUDED.error_count, details = EXCLUDED.details
  `);
}

export function dailyKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function runDailyAuditIntegrityVerification(now = new Date()): Promise<void> {
  const organizations = await platformDb.query<{ id: string }>(
    'audit-chain-verification',
    'list organizations for daily audit-chain verification',
    sql`SELECT id FROM organization WHERE status <> 'deleted' ORDER BY id`,
  );
  const idempotencyKey = dailyKey(now);
  for (const organization of organizations) {
    try {
      const report = await verifyOrganizationAudit(organization.id);
      await platformDb.transactionForOrganization(
        organization.id,
        'audit-chain-verification',
        'record daily audit-chain verification report',
        (tx) => recordReport(tx, organization.id, idempotencyKey, report),
      );
      if (report.outcome === 'failure') {
        console.error(JSON.stringify({ level: 'error', msg: 'audit integrity failure', ...report }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        msg: 'audit integrity verification failed to complete',
        organizationId: organization.id,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}

export async function getLatestAuditIntegrityReport(ctx: RequestContext): Promise<IntegrityReport | null> {
  if (!globalAccess(ctx.principal)) {
    throw new AuthorizationError('audit:view', 'not_allowed', 'Only Super Admin can view audit integrity status.');
  }
  const row = await db.maybeOne<{ details: IntegrityReport; retentionLastRunAt: Date | null; retentionLastOutcome: string | null; archivedRanges: number; archivedEntries: number }>(ctx, sql`
      SELECT (
               SELECT details FROM job_run
               WHERE organization_id = ${ctx.organizationId} AND job_name = ${JOB_NAME}
               ORDER BY finished_at DESC NULLS LAST, started_at DESC
               LIMIT 1
             ) AS details,
             (SELECT finished_at FROM job_run WHERE organization_id = ${ctx.organizationId} AND job_name = 'audit.retention' ORDER BY finished_at DESC NULLS LAST LIMIT 1) AS "retentionLastRunAt",
             (SELECT outcome FROM job_run WHERE organization_id = ${ctx.organizationId} AND job_name = 'audit.retention' ORDER BY finished_at DESC NULLS LAST LIMIT 1) AS "retentionLastOutcome",
             (SELECT count(*)::int FROM audit_archive WHERE organization_id = ${ctx.organizationId} AND status = 'archived') AS "archivedRanges",
             (SELECT COALESCE(sum(record_count), 0)::int FROM audit_archive WHERE organization_id = ${ctx.organizationId} AND status = 'archived') AS "archivedEntries"
    `);
  if (!row?.details) return null;
  return {
    ...row.details,
    retention: {
      lastRunAt: row.retentionLastRunAt?.toISOString() ?? null,
      lastOutcome: row.retentionLastOutcome,
      archivedRanges: row.archivedRanges,
      archivedEntries: row.archivedEntries,
    },
  };
}
