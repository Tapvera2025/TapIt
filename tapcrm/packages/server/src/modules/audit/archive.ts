import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { globalAccess } from '@tapcrm/contracts';
import { AuthorizationError } from '@tapcrm/authz';
import { loadConfig } from '../../config.js';
import { db, platformDb, type Tx } from '../../platform/dal/db.js';
import type { RequestContext } from '../../platform/dal/context.js';
import { createJobContext } from '../../platform/dal/context.js';
import { sql } from '../../platform/dal/sql.js';
import { getStorageService } from '../../platform/storage/index.js';
import { isAuditEntryHeld, type LegalHold } from './legal-holds.js';
import type { Json, StoredChainEntry } from './chain.js';

const STREAMS = ['access', 'activity'] as const;
const BATCH_SIZE = 1_000;
const ARCHIVE_AFTER_MONTHS = 12;
const RETAIN_YEARS = 7;
const RETENTION_JOB_NAME = 'audit.retention';

type Stream = (typeof STREAMS)[number];

export interface ArchivedAuditRow {
  organizationId: string;
  stream: Stream;
  sequence: string;
  occurredAt: Date;
  actorId: string | null;
  actorType: StoredChainEntry['actorType'];
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
  hashVersion: number;
  legalHold: boolean;
}

export interface ArchiveRow {
  id: string;
  organizationId: string;
  stream: Stream;
  sequenceStart: string;
  sequenceEnd: string;
  occurredStart: Date;
  occurredEnd: Date;
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

interface ArchiveEnvelope {
  version: 1;
  keyId: string;
  iv: string;
  authTag: string;
  plaintextSha256: string;
  ciphertext: string;
}

function archiveKey(keyId?: string): { key: Buffer; keyId: string } {
  const config = loadConfig();
  if (!config.AUDIT_ARCHIVE_ENCRYPTION_KEY || !config.AUDIT_ARCHIVE_KEY_ID) {
    throw new Error('Audit archive encryption key and key id are required.');
  }
  const requestedKeyId = keyId ?? config.AUDIT_ARCHIVE_KEY_ID;
  let encodedKey = requestedKeyId === config.AUDIT_ARCHIVE_KEY_ID
    ? config.AUDIT_ARCHIVE_ENCRYPTION_KEY
    : undefined;
  if (!encodedKey && config.AUDIT_ARCHIVE_KEYRING_JSON) {
    try {
      const keyring = JSON.parse(config.AUDIT_ARCHIVE_KEYRING_JSON) as Record<string, unknown>;
      encodedKey = typeof keyring[requestedKeyId] === 'string' ? keyring[requestedKeyId] : undefined;
    } catch {
      throw new Error('AUDIT_ARCHIVE_KEYRING_JSON must be valid JSON.');
    }
  }
  if (!encodedKey) throw new Error(`Audit archive encryption key ${requestedKeyId} is unavailable.`);
  const raw = Buffer.from(encodedKey, 'base64');
  if (raw.length !== 32) throw new Error('AUDIT_ARCHIVE_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return { key: raw, keyId: requestedKeyId };
}

function jobContext(organizationId: string): RequestContext {
  return createJobContext({
    organizationId,
    jobName: RETENTION_JOB_NAME,
    runId: 'retention',
    principal: {
      id: '00000000-0000-0000-0000-000000000000',
      organizationId,
      sessionVersion: 0,
      accountType: 'service',
      allowedActions: [],
      allowedResources: [],
      expiresAt: new Date(0),
    },
  });
}

function serialiseRow(row: ArchivedAuditRow): Record<string, unknown> {
  return {
    organizationId: row.organizationId,
    stream: row.stream,
    sequence: row.sequence,
    occurredAt: row.occurredAt.toISOString(),
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
    prevHash: row.prevHash?.toString('hex') ?? null,
    hash: row.hash.toString('hex'),
    hashVersion: row.hashVersion,
    legalHold: row.legalHold,
  };
}

export function encryptArchivePayload(rows: readonly ArchivedAuditRow[], key: Buffer, keyId: string): { body: Buffer; plaintextSha256: string } {
  if (key.length !== 32) throw new Error('Audit archive encryption key must be 32 bytes.');
  const plaintext = gzipSync(Buffer.from(JSON.stringify(rows.map(serialiseRow)), 'utf8'));
  const plaintextSha256 = createHash('sha256').update(plaintext).digest('hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: ArchiveEnvelope = {
    version: 1,
    keyId,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    plaintextSha256,
    ciphertext: ciphertext.toString('base64'),
  };
  return { body: Buffer.from(JSON.stringify(envelope), 'utf8'), plaintextSha256 };
}

export function decryptArchivePayload(body: Buffer, key: Buffer, keyId: string): ArchivedAuditRow[] {
  const envelope = JSON.parse(body.toString('utf8')) as ArchiveEnvelope;
  if (envelope.version !== 1) throw new Error('Unsupported audit archive format.');
  if (key.length !== 32) throw new Error('Audit archive encryption key must be 32 bytes.');
  if (envelope.keyId !== keyId) throw new Error(`Audit archive requires encryption key ${envelope.keyId}.`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
  const expected = createHash('sha256').update(plaintext).digest('hex');
  if (expected !== envelope.plaintextSha256) throw new Error('Audit archive plaintext checksum mismatch.');
  const rows = JSON.parse(gunzipSync(plaintext).toString('utf8')) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    organizationId: String(row['organizationId']), stream: row['stream'] as Stream, sequence: String(row['sequence']),
    occurredAt: new Date(String(row['occurredAt'])), actorId: row['actorId'] as string | null,
    actorType: row['actorType'] as StoredChainEntry['actorType'], action: String(row['action']),
    targetType: String(row['targetType']), targetId: row['targetId'] as string | null,
    before: row['before'] as Json, after: row['after'] as Json, reason: row['reason'] as string | null,
    sourceIp: row['sourceIp'] as string | null, requestId: row['requestId'] as string | null,
    prevHash: typeof row['prevHash'] === 'string' ? Buffer.from(row['prevHash'], 'hex') : null,
    hash: Buffer.from(String(row['hash']), 'hex'),
    hashVersion: Number(row['hashVersion'] ?? 1), legalHold: Boolean(row['legalHold'] ?? false),
  }));
}

function encryptRows(rows: readonly ArchivedAuditRow[]): { body: Buffer; keyId: string; plaintextSha256: string } {
  const { key, keyId } = archiveKey();
  const encrypted = encryptArchivePayload(rows, key, keyId);
  return { ...encrypted, keyId };
}

function decryptRows(body: Buffer): ArchivedAuditRow[] {
  const envelope = JSON.parse(body.toString('utf8')) as Partial<ArchiveEnvelope>;
  if (typeof envelope.keyId !== 'string' || envelope.keyId.length === 0) {
    throw new Error('Audit archive envelope is missing its encryption key id.');
  }
  const { key, keyId } = archiveKey(envelope.keyId);
  return decryptArchivePayload(body, key, keyId);
}

function selectAuditRows(stream: Stream, organizationId: string, cutoff: Date): ReturnType<typeof sql> {
  return sql`
    SELECT organization_id AS "organizationId", stream, sequence::text AS sequence,
           occurred_at AS "occurredAt", actor_id AS "actorId", actor_type AS "actorType",
           action, target_type AS "targetType", target_id AS "targetId",
           before_data AS before, after_data AS after, reason, host(source_ip) AS "sourceIp",
           request_id AS "requestId", hash_version AS "hashVersion", prev_hash AS "prevHash", hash, legal_hold AS "legalHold"
    FROM audit_entry ae
    WHERE ae.organization_id = ${organizationId}
      AND ae.stream = ${stream}
      AND ae.occurred_at < ${cutoff}
      AND NOT EXISTS (
        SELECT 1 FROM audit_archive aa
        WHERE aa.organization_id = ae.organization_id AND aa.stream = ae.stream
          AND aa.status IN ('archived', 'purged')
          AND ae.sequence BETWEEN aa.sequence_start AND aa.sequence_end
      )
    ORDER BY sequence ASC, occurred_at ASC
    LIMIT ${BATCH_SIZE}
  `;
}

async function recordArchive(tx: Tx, archive: {
  organizationId: string; stream: Stream; rows: readonly ArchivedAuditRow[]; objectKey: string;
  objectChecksum: string; objectSizeBytes: number; encryptionKeyId: string;
}): Promise<{ inserted: boolean }> {
  const first = archive.rows[0]!;
  const last = archive.rows[archive.rows.length - 1]!;
  const result = await tx.query<{ inserted: boolean }>(sql`
    INSERT INTO audit_archive (
      organization_id, stream, sequence_start, sequence_end, occurred_start, occurred_end,
      record_count, first_prev_hash, first_hash, last_hash, object_key, object_checksum, object_size_bytes,
      encryption_key_id, storage_verified_at
    ) VALUES (
      ${archive.organizationId}, ${archive.stream}, ${first.sequence}, ${last.sequence},
      ${first.occurredAt}, ${last.occurredAt}, ${archive.rows.length}, ${first.prevHash}, ${first.hash}, ${last.hash},
      ${archive.objectKey}, ${archive.objectChecksum}, ${archive.objectSizeBytes},
      ${archive.encryptionKeyId}, now()
    )
    ON CONFLICT (organization_id, stream, sequence_start, sequence_end) DO NOTHING
    RETURNING true AS inserted
  `);
  return { inserted: result.length > 0 };
}

async function deleteArchivedPrimaryRows(tx: Tx, ctx: { organizationId: string; requestId: string; sourceIp: string | null; principal: { id: string; accountType: string } }, stream: Stream, rows: readonly ArchivedAuditRow[], archiveId: string): Promise<number> {
  const sequences = rows.map((row) => row.sequence);
  const deleted = await tx.query<{ sequence: string }>(sql`
    DELETE FROM audit_entry ae
    WHERE ae.organization_id = ${ctx.organizationId} AND ae.stream = ${stream}
      AND ae.sequence = ANY(${sequences}::bigint[])
      AND NOT EXISTS (
        SELECT 1 FROM audit_legal_hold lh
        WHERE lh.organization_id = ae.organization_id AND lh.status = 'active'
          AND (
            (lh.hold_type IN ('user', 'client') AND (ae.actor_id = lh.target_id OR ae.target_id = lh.target_id))
            OR (lh.hold_type = 'date-range' AND ae.occurred_at >= lh.starts_at AND ae.occurred_at <= lh.ends_at)
          )
      )
    RETURNING ae.sequence::text AS sequence
  `);
  if (deleted.length > 0) {
    await tx.query(sql`
      INSERT INTO audit_outbox (organization_id, stream, payload)
      VALUES (${ctx.organizationId}, 'activity', ${JSON.stringify({
        action: 'audit.retention_deleted', actorId: ctx.principal.id, actorType: ctx.principal.accountType,
        targetType: 'auditArchive', targetId: archiveId,
        before: { stream, sequenceStart: rows[0]!.sequence, sequenceEnd: rows[rows.length - 1]!.sequence, deletedCount: deleted.length },
        after: null, reason: 'Retention deletion after successful archive.', requestId: ctx.requestId, sourceIp: ctx.sourceIp,
      })}::jsonb)
    `);
  }
  return deleted.length;
}

export async function archiveOrganizationBatch(organizationId: string, cutoff: Date): Promise<number> {
  let archived = 0;
  for (const stream of STREAMS) {
    const rows = await platformDb.transactionForOrganization(organizationId, 'audit-retention', 'select audit records for archival', (tx) => tx.query<ArchivedAuditRow>(selectAuditRows(stream, organizationId, cutoff)));
    if (rows.length === 0) continue;
    if (BigInt(rows[rows.length - 1]!.sequence) - BigInt(rows[0]!.sequence) + 1n !== BigInt(rows.length)) {
      throw new Error(`Cannot archive a non-contiguous ${stream} audit range.`);
    }
    const encrypted = encryptRows(rows);
    const objectKey = `audit/${stream}/${organizationId}/${rows[0]!.sequence}-${rows[rows.length - 1]!.sequence}.json.enc`;
    const storage = getStorageService();
    const uploaded = await storage.putObject({ bucket: 'worm', key: objectKey, body: encrypted.body, contentType: 'application/json', metadata: { 'encryption-key-id': encrypted.keyId, 'plaintext-sha256': encrypted.plaintextSha256 } });
    const head = await storage.headObject({ bucket: 'worm', key: objectKey });
    if (head.checksumSha256 && head.checksumSha256 !== uploaded.checksumSha256) throw new Error(`Archive object checksum verification failed for ${objectKey}.`);
    const persisted = await storage.getObject({ bucket: 'worm', key: objectKey });
    if (persisted.checksumSha256 !== uploaded.checksumSha256 || decryptRows(persisted.body).length !== rows.length) {
      throw new Error(`Archive object persistence verification failed for ${objectKey}.`);
    }
    await platformDb.transactionForOrganization(organizationId, 'audit-retention', 'record archive and remove archived primary rows', async (tx) => {
      const archive = await recordArchive(tx, { organizationId, stream, rows, objectKey, objectChecksum: uploaded.checksumSha256, objectSizeBytes: encrypted.body.length, encryptionKeyId: encrypted.keyId });
      if (!archive.inserted) return 0;
      const archiveRow = await tx.one<{ id: string }>(sql`SELECT id FROM audit_archive WHERE organization_id = ${organizationId} AND stream = ${stream} AND sequence_start = ${rows[0]!.sequence} AND sequence_end = ${rows[rows.length - 1]!.sequence}`);
      return deleteArchivedPrimaryRows(tx, { organizationId, requestId: `job:audit-retention:${Date.now()}`, sourceIp: null, principal: { id: '00000000-0000-0000-0000-000000000000', accountType: 'service' } }, stream, rows, archiveRow.id);
    });
    archived += rows.length;
  }
  return archived;
}

export interface ArchivedSearchQuery {
  readonly stream?: Stream;
  readonly actorId?: string;
  readonly targetId?: string;
  readonly action?: string;
  readonly from?: Date;
  readonly to?: Date;
}

export async function searchArchivedAuditEntries(ctx: RequestContext, query: ArchivedSearchQuery): Promise<ArchivedAuditRow[]> {
  const cacheKey = `audit:archive-search:${JSON.stringify({
    stream: query.stream ?? null,
    actorId: query.actorId ?? null,
    targetId: query.targetId ?? null,
    action: query.action ?? null,
    from: query.from?.toISOString() ?? null,
    to: query.to?.toISOString() ?? null,
  })}`;
  const cached = ctx.memo.get(cacheKey);
  if (Array.isArray(cached)) return cached as ArchivedAuditRow[];
  const archives = await db.query<ArchiveRow>(ctx, sql`
    SELECT id, organization_id AS "organizationId", stream,
           sequence_start::text AS "sequenceStart", sequence_end::text AS "sequenceEnd",
           occurred_start AS "occurredStart", occurred_end AS "occurredEnd",
           record_count AS "recordCount", first_prev_hash AS "firstPrevHash", first_hash AS "firstHash", last_hash AS "lastHash",
           object_key AS "objectKey", object_checksum AS "objectChecksum",
           object_size_bytes::text AS "objectSizeBytes", encryption_key_id AS "encryptionKeyId", status
    FROM audit_archive
    WHERE organization_id = ${ctx.organizationId} AND status = 'archived'
      ${query.stream ? sql`AND stream = ${query.stream}` : sql``}
      ${query.from ? sql`AND occurred_end >= ${query.from}` : sql``}
      ${query.to ? sql`AND occurred_start <= ${query.to}` : sql``}
    ORDER BY occurred_start DESC, sequence_start DESC
  `);
  const result: ArchivedAuditRow[] = [];
  for (const archive of archives) {
    const rows = await getArchivedObjectRows(archive);
    for (const row of rows) {
      if (query.actorId && row.actorId !== query.actorId) continue;
      if (query.targetId && row.targetId !== query.targetId) continue;
      if (query.action && row.action !== query.action) continue;
      if (query.from && row.occurredAt < query.from) continue;
      if (query.to && row.occurredAt > query.to) continue;
      result.push(row);
    }
  }
  ctx.memo.set(cacheKey, result);
  return result;
}

export async function loadArchivedAuditEntry(
  ctx: RequestContext,
  key: { stream: Stream; sequence: string; occurredAt: Date },
): Promise<ArchivedAuditRow | null> {
  const archives = await db.query<ArchiveRow>(ctx, sql`
    SELECT id, organization_id AS "organizationId", stream,
           sequence_start::text AS "sequenceStart", sequence_end::text AS "sequenceEnd",
           occurred_start AS "occurredStart", occurred_end AS "occurredEnd",
           record_count AS "recordCount", first_prev_hash AS "firstPrevHash", first_hash AS "firstHash", last_hash AS "lastHash",
           object_key AS "objectKey", object_checksum AS "objectChecksum",
           object_size_bytes::text AS "objectSizeBytes", encryption_key_id AS "encryptionKeyId", status
    FROM audit_archive
    WHERE organization_id = ${ctx.organizationId} AND status = 'archived'
      AND stream = ${key.stream} AND sequence_start <= ${key.sequence} AND sequence_end >= ${key.sequence}
  `);
  for (const archive of archives) {
    const row = (await getArchivedObjectRows(archive)).find((candidate) =>
      BigInt(candidate.sequence) === BigInt(key.sequence) && candidate.occurredAt.getTime() === key.occurredAt.getTime());
    if (row) return row;
  }
  return null;
}

async function purgePrimaryBatch(organizationId: string, cutoff: Date, stream: Stream): Promise<number> {
  return platformDb.transactionForOrganization(organizationId, 'audit-retention', 'purge retained audit records', async (tx) => {
    const rows = await tx.query<{ sequence: string }>(sql`
      SELECT ae.sequence::text AS sequence
      FROM audit_entry ae
      WHERE ae.organization_id = ${organizationId} AND ae.stream = ${stream}
        AND ae.occurred_at < ${cutoff}
        AND EXISTS (
          SELECT 1 FROM audit_archive aa
          WHERE aa.organization_id = ae.organization_id AND aa.stream = ae.stream
            AND aa.status IN ('archived', 'purged') AND ae.sequence BETWEEN aa.sequence_start AND aa.sequence_end
        )
        AND NOT EXISTS (
          SELECT 1 FROM audit_legal_hold lh
          WHERE lh.organization_id = ae.organization_id AND lh.status = 'active'
            AND ((lh.hold_type IN ('user', 'client') AND (ae.actor_id = lh.target_id OR ae.target_id = lh.target_id))
              OR (lh.hold_type = 'date-range' AND ae.occurred_at >= lh.starts_at AND ae.occurred_at <= lh.ends_at))
        )
      ORDER BY ae.sequence ASC
      LIMIT ${BATCH_SIZE}
    `);
    if (rows.length === 0) return 0;
    const deleted = await tx.query<{ sequence: string }>(sql`
      DELETE FROM audit_entry ae
      WHERE ae.organization_id = ${organizationId} AND ae.stream = ${stream}
        AND ae.sequence = ANY(${rows.map((row) => row.sequence)}::bigint[])
        AND NOT EXISTS (
          SELECT 1 FROM audit_legal_hold lh
          WHERE lh.organization_id = ae.organization_id AND lh.status = 'active'
            AND (
              (lh.hold_type IN ('user', 'client') AND (ae.actor_id = lh.target_id OR ae.target_id = lh.target_id))
              OR (lh.hold_type = 'date-range' AND ae.occurred_at >= lh.starts_at AND ae.occurred_at <= lh.ends_at)
            )
        )
      RETURNING ae.sequence::text AS sequence
    `);
    if (deleted.length > 0) {
      await tx.query(sql`
        INSERT INTO audit_outbox (organization_id, stream, payload)
        VALUES (${organizationId}, 'activity', ${JSON.stringify({
          action: 'audit.retention_deleted', actorId: null, actorType: 'service', targetType: 'auditEntry', targetId: null,
          before: { stream, sequenceStart: rows[0]!.sequence, sequenceEnd: rows[rows.length - 1]!.sequence, deletedCount: deleted.length },
          after: null, reason: 'Seven-year retention deletion after archive verification',
        })}::jsonb)
      `);
    }
    return deleted.length;
  });
}

async function purgeArchivedObjects(organizationId: string, cutoff: Date): Promise<number> {
  const context = jobContext(organizationId);
  const archives = await db.query<ArchiveRow>(context, sql`
    SELECT id, organization_id AS "organizationId", stream,
           sequence_start::text AS "sequenceStart", sequence_end::text AS "sequenceEnd",
           occurred_start AS "occurredStart", occurred_end AS "occurredEnd",
           record_count AS "recordCount", first_prev_hash AS "firstPrevHash", first_hash AS "firstHash", last_hash AS "lastHash",
           object_key AS "objectKey", object_checksum AS "objectChecksum",
           object_size_bytes::text AS "objectSizeBytes", encryption_key_id AS "encryptionKeyId", status
    FROM audit_archive
    WHERE organization_id = ${organizationId} AND status = 'archived' AND occurred_end < ${cutoff}
    ORDER BY occurred_end ASC
  `);
  let purged = 0;
  for (const archive of archives) {
    const rows = await getArchivedObjectRows(archive);
    const holds = await db.query<Pick<LegalHold, 'status' | 'holdType' | 'targetId' | 'startsAt' | 'endsAt'>>(context, sql`
      SELECT status, hold_type AS "holdType", target_id AS "targetId", starts_at AS "startsAt", ends_at AS "endsAt"
      FROM audit_legal_hold WHERE organization_id = ${organizationId} AND status = 'active'
    `);
    if (rows.some((row) => isAuditEntryHeld({ organizationId, actorId: row.actorId, targetId: row.targetId, occurredAt: row.occurredAt }, holds))) continue;
    await getStorageService().deleteObject({ bucket: 'worm', key: archive.objectKey });
    await platformDb.transactionForOrganization(organizationId, 'audit-retention', 'record archived audit purge', async (tx) => {
      await tx.query(sql`
        UPDATE audit_archive SET status = 'purged', purged_at = now()
        WHERE organization_id = ${organizationId} AND id = ${archive.id} AND status = 'archived'
      `);
      await tx.query(sql`
        INSERT INTO audit_outbox (organization_id, stream, payload)
        VALUES (${organizationId}, 'activity', ${JSON.stringify({
          action: 'audit.retention_archive_purged', actorId: null, actorType: 'service', targetType: 'auditArchive', targetId: archive.id,
          before: { stream: archive.stream, sequenceStart: archive.sequenceStart, sequenceEnd: archive.sequenceEnd, recordCount: archive.recordCount },
          after: null, reason: 'Seven-year retention archive purge',
        })}::jsonb)
      `);
    });
    purged += 1;
  }
  return purged;
}

export async function purgeOrganizationAudit(organizationId: string, cutoff: Date): Promise<number> {
  let deleted = 0;
  for (const stream of STREAMS) {
    for (;;) {
      const batch = await purgePrimaryBatch(organizationId, cutoff, stream);
      deleted += batch;
      if (batch < BATCH_SIZE) break;
    }
  }
  deleted += await purgeArchivedObjects(organizationId, cutoff);
  return deleted;
}

export async function runAuditRetention(): Promise<void> {
  const organizations = await platformDb.query<{ id: string }>('audit-retention', 'list organizations for audit retention', sql`SELECT id FROM organization WHERE status <> 'deleted' ORDER BY id`);
  const archiveCutoff = new Date(); archiveCutoff.setUTCMonth(archiveCutoff.getUTCMonth() - ARCHIVE_AFTER_MONTHS);
  for (const organization of organizations) {
    try {
      let archived = 0;
      for (;;) {
        const batch = await archiveOrganizationBatch(organization.id, archiveCutoff);
        archived += batch;
        if (batch === 0) break;
      }
      const purgeCutoff = new Date();
      purgeCutoff.setUTCFullYear(purgeCutoff.getUTCFullYear() - RETAIN_YEARS);
      const purged = await purgeOrganizationAudit(organization.id, purgeCutoff);
      await platformDb.transactionForOrganization(organization.id, 'audit-retention', 'record audit retention job run', (tx) => tx.query(sql`
        INSERT INTO job_run (organization_id, job_name, idempotency_key, started_at, finished_at, outcome, items_processed, error_count, details)
        VALUES (${organization.id}, ${RETENTION_JOB_NAME}, ${dailyRetentionKey()}, now(), now(), 'success', ${archived + purged}, 0,
                ${JSON.stringify({ archived, purged, archiveCutoff: archiveCutoff.toISOString(), purgeCutoff: purgeCutoff.toISOString() })}::jsonb)
        ON CONFLICT (organization_id, job_name, idempotency_key) WHERE idempotency_key IS NOT NULL
        DO UPDATE SET finished_at = EXCLUDED.finished_at, outcome = EXCLUDED.outcome,
                      items_processed = EXCLUDED.items_processed, details = EXCLUDED.details
      `));
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', msg: 'audit archive batch failed', organizationId: organization.id, error: error instanceof Error ? error.message : String(error) }));
      await platformDb.transactionForOrganization(organization.id, 'audit-retention', 'record failed audit retention job run', (tx) => tx.query(sql`
        INSERT INTO job_run (organization_id, job_name, idempotency_key, started_at, finished_at, outcome, items_processed, error_count, details)
        VALUES (${organization.id}, ${RETENTION_JOB_NAME}, ${dailyRetentionKey()}, now(), now(), 'failure', 0, 1, ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}::jsonb)
        ON CONFLICT (organization_id, job_name, idempotency_key) WHERE idempotency_key IS NOT NULL
        DO UPDATE SET finished_at = EXCLUDED.finished_at, outcome = EXCLUDED.outcome,
                      error_count = EXCLUDED.error_count, details = EXCLUDED.details
      `)).catch((recordError) => console.error(JSON.stringify({ level: 'error', msg: 'audit retention run report failed', organizationId: organization.id, error: String(recordError) })));
    }
  }
}

function dailyRetentionKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function getArchivedObjectRows(archive: ArchiveRow): Promise<ArchivedAuditRow[]> {
  const object = await getStorageService().getObject({ bucket: 'worm', key: archive.objectKey });
  if (archive.objectChecksum && object.checksumSha256 !== archive.objectChecksum) {
    throw new Error(`Archived object checksum mismatch for ${archive.objectKey}.`);
  }
  return decryptRows(object.body);
}

export async function assertArchiveRetentionViewer(ctx: RequestContext): Promise<void> {
  if (!globalAccess(ctx.principal)) throw new AuthorizationError('audit:view', 'not_allowed', 'Only Super Admin can manage archived audit retention.');
}
