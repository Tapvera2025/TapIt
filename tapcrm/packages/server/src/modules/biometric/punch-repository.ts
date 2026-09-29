import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { PunchReading } from './reading.js';
import type {
  NormalizedPunch,
  PunchMeaning,
  PunchStatus,
  ReaderDirection,
} from './types.js';

/**
 * SQL for receiving and processing punches (§10.3). Runs in the caller's
 * tenant transaction; RLS keeps every statement inside the organization.
 */

/* ------------------------------------------------------------------ *
 * Receipt
 * ------------------------------------------------------------------ */

export interface ReceivingDevice {
  id: string;
  status: 'pending' | 'enabled' | 'disabled';
  dryRun: boolean;
  timezone: string;
  clockOffsetSeconds: number;
  readerDirection: ReaderDirection;
  skewSamples: number[];
}

/** The device and its settings, locked: a receipt reads them once (D37) and moves its cursor. */
export async function lockDeviceForReceipt(
  tx: Tx,
  deviceId: string,
): Promise<ReceivingDevice | null> {
  return tx.maybeOne<ReceivingDevice>(sql`
    SELECT id, status, dry_run, timezone, clock_offset_seconds, reader_direction, skew_samples
    FROM biometric_device WHERE id = ${deviceId}
    FOR UPDATE
  `);
}

export async function readerDirections(
  tx: Tx,
  deviceId: string,
): Promise<Map<string, ReaderDirection>> {
  const rows = await tx.query<{ readerKey: string; direction: ReaderDirection }>(sql`
    SELECT reader_key, direction FROM biometric_reader WHERE device_id = ${deviceId}
  `);
  return new Map(rows.map((row) => [row.readerKey, row.direction]));
}

/**
 * Stores the punches with their reading, one statement. A resend — the same
 * source identity (§10.3 step 4) — is skipped by the unique indexes and keeps
 * its first reading. Returns the ids of the rows this call created.
 */
export async function insertPunches(
  tx: Tx,
  organizationId: string,
  punches: readonly { punch: NormalizedPunch; reading: PunchReading }[],
  receivedAt: Date,
): Promise<string[]> {
  if (punches.length === 0) return [];
  const values = punches.map(
    ({ punch, reading }) => sql`(
      ${organizationId}, ${punch.deviceId}, ${punch.pin}, ${punch.deviceLocalTime}::timestamp,
      ${reading.occurredAt}, ${reading.correctedAt}, ${reading.appliedOffsetSeconds}, ${receivedAt},
      ${punch.statusCode}, ${punch.verifyMode}, ${punch.readerKey}, ${punch.externalEventId},
      ${punch.raw}, ${reading.directionAtReceipt}, ${reading.meaning}, ${reading.dryRunAtReceipt}
    )`,
  );
  const rows = await tx.query<{ id: string }>(sql`
    INSERT INTO biometric_punch (organization_id, device_id, pin, device_local_time, occurred_at,
                                 corrected_at, applied_offset_seconds, received_at, status_code,
                                 verify_mode, reader_key, external_event_id, raw_line,
                                 direction_at_receipt, meaning, dry_run_at_receipt)
    VALUES ${sql.join(values)}
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  return rows.map((row) => row.id);
}

/** Any contact is contact (BI-7); a push also moves the device's cursor, in the same transaction. */
export async function recordContact(
  tx: Tx,
  deviceId: string,
  at: Date,
  push: { attlogStamp: string | null } | null,
): Promise<void> {
  await tx.query(sql`
    UPDATE biometric_device
    SET last_seen_at = ${at},
        last_push_at = CASE WHEN ${push !== null} THEN ${at}::timestamptz ELSE last_push_at END,
        attlog_stamp = coalesce(${push?.attlogStamp ?? null}, attlog_stamp)
    WHERE id = ${deviceId}
  `);
}

export async function saveSkew(
  tx: Tx,
  deviceId: string,
  samples: readonly number[],
  median: number,
  at: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE biometric_device
    SET skew_samples = ${[...samples]}::integer[], last_skew_seconds = ${median}, last_skew_at = ${at}
    WHERE id = ${deviceId}
  `);
}

/* ------------------------------------------------------------------ *
 * Processing
 * ------------------------------------------------------------------ */

export interface StoredPunch {
  id: string;
  organizationId: string;
  deviceId: string;
  connectorId: string;
  backfillHours: number;
  pin: string;
  occurredAt: Date;
  correctedAt: Date;
  receivedAt: Date;
  readerKey: string | null;
  externalEventId: string | null;
  rawLine: string;
  directionAtReceipt: ReaderDirection;
  meaning: PunchMeaning;
  dryRunAtReceipt: boolean;
  status: PunchStatus;
  userId: string | null;
  duplicateOf: string | null;
  attendanceEventId: string | null;
  processingGeneration: number;
}

export async function findPunch(
  tx: Tx,
  punchId: string,
  options: { forUpdate?: boolean } = {},
): Promise<StoredPunch | null> {
  return tx.maybeOne<StoredPunch>(sql`
    SELECT p.id, p.organization_id, p.device_id, d.connector_id, d.backfill_hours, p.pin,
           p.occurred_at, p.corrected_at, p.received_at, p.reader_key, p.external_event_id,
           p.raw_line, p.direction_at_receipt, p.meaning, p.dry_run_at_receipt, p.status,
           p.user_id, p.duplicate_of, p.attendance_event_id, p.processing_generation
    FROM biometric_punch p JOIN biometric_device d ON d.id = p.device_id
    WHERE p.id = ${punchId}
    ${options.forUpdate === true ? sql`FOR UPDATE OF p` : sql``}
  `);
}

/**
 * Names the person before anything links to the punch: every link carries the
 * person (D34). A waiting punch being replayed is back in processing.
 */
export async function setPerson(
  tx: Tx,
  punchId: string,
  userId: string,
  mappingId: string,
): Promise<void> {
  await tx.query(sql`
    UPDATE biometric_punch
    SET status = 'received', status_reason = NULL, user_id = ${userId}, pin_mapping_id = ${mappingId}
    WHERE id = ${punchId}
  `);
}

export interface PunchOutcome {
  readonly status: Exclude<PunchStatus, 'received'>;
  readonly reason: string | null;
  readonly duplicateOf?: string | null;
  readonly attendanceEventId?: string | null;
  /** Unmapped and held punches have no person; a refused one keeps whoever it resolved to. */
  readonly clearPerson?: boolean;
}

/** The processing fields only; the trigger refuses anything else. */
export async function finishPunch(
  tx: Tx,
  punchId: string,
  outcome: PunchOutcome,
  at: Date,
  replayed: boolean,
): Promise<void> {
  const clear = outcome.clearPerson === true;
  await tx.query(sql`
    UPDATE biometric_punch
    SET status = ${outcome.status},
        status_reason = ${outcome.reason},
        duplicate_of = ${outcome.duplicateOf ?? null},
        attendance_event_id = coalesce(${outcome.attendanceEventId ?? null}::uuid, attendance_event_id),
        user_id = CASE WHEN ${clear} THEN NULL ELSE user_id END,
        pin_mapping_id = CASE WHEN ${clear} THEN NULL ELSE pin_mapping_id END,
        processed_at = ${at},
        replay_count = replay_count + ${replayed ? 1 : 0},
        processing_generation = processing_generation + ${replayed ? 1 : 0}
    WHERE id = ${punchId}
  `);
}

export interface BurstMember {
  id: string;
  organizationId: string;
  userId: string;
  meaning: PunchMeaning;
  dryRun: boolean;
  correctedAt: Date;
  readerKey: string | null;
  externalEventId: string | null;
  rawLine: string;
  deviceId: string;
  pin: string;
  status: PunchStatus;
  duplicateOf: string | null;
  attendanceEventId: string | null;
}

/**
 * The person's placed punches with this meaning and mode within 60 seconds of
 * `from`..`to`, locked in id order. Only punches with a person that were
 * applied, duplicated or dry-run take part (§10.3 step 7).
 */
export async function burstNeighbours(
  tx: Tx,
  key: { userId: string; meaning: PunchMeaning; dryRun: boolean; excludeId: string },
  from: Date,
  to: Date,
): Promise<BurstMember[]> {
  return tx.query<BurstMember>(sql`
    SELECT p.id, p.organization_id, p.user_id, p.meaning, p.dry_run_at_receipt AS dry_run,
           p.corrected_at, p.reader_key, p.external_event_id, p.raw_line, p.device_id, p.pin,
           p.status, p.duplicate_of, p.attendance_event_id
    FROM biometric_punch p
    WHERE p.user_id = ${key.userId} AND p.meaning = ${key.meaning}
      AND p.dry_run_at_receipt = ${key.dryRun}
      AND p.status IN ('applied', 'duplicate', 'dry-run')
      AND p.id <> ${key.excludeId}
      AND p.corrected_at BETWEEN ${from}::timestamptz - interval '60 seconds'
                             AND ${to}::timestamptz + interval '60 seconds'
    ORDER BY p.id
    FOR UPDATE OF p
  `);
}

/** A former head, or a duplicate of one, now points at the burst's head. */
export async function linkToHead(
  tx: Tx,
  punchId: string,
  headId: string,
  at: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE biometric_punch SET status = 'duplicate', duplicate_of = ${headId}, processed_at = ${at}
    WHERE id = ${punchId}
  `);
}

/* ------------------------------------------------------------------ *
 * Recovery
 * ------------------------------------------------------------------ */

/** Received punches nobody has processed, oldest first, a page at a time. */
export async function strandedPunches(
  tx: Tx,
  receivedBefore: Date,
  after: string | null,
  limit: number,
): Promise<{ id: string; processingGeneration: number }[]> {
  return tx.query<{ id: string; processingGeneration: number }>(sql`
    SELECT id, processing_generation FROM biometric_punch
    WHERE status = 'received' AND received_at < ${receivedBefore}
      AND (${after}::uuid IS NULL OR id > ${after}::uuid)
    ORDER BY id
    LIMIT ${limit}
  `);
}

export interface ReplayRequestRow {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  punchIds: string[] | null;
  deviceId: string | null;
  pin: string | null;
  userId: string | null;
  fromDate: DateOnly;
  toDate: DateOnly;
  releaseHold: boolean;
  lastPunchId: string | null;
}

const REPLAY_COLUMNS = sql`
  id, status, punch_ids, device_id, pin, user_id, from_date::text AS from_date,
  to_date::text AS to_date, release_hold, last_punch_id
`;

/** Claims a request for a run: pending or already running (a run that died resumes at its cursor). */
export async function startReplay(
  tx: Tx,
  requestId: string,
): Promise<ReplayRequestRow | null> {
  return tx.maybeOne<ReplayRequestRow>(sql`
    UPDATE biometric_replay_request SET status = 'running'
    WHERE id = ${requestId} AND status IN ('pending', 'running')
    RETURNING ${REPLAY_COLUMNS}
  `);
}

/** The next page of the request's selection: waiting punches only, in id order after the cursor. */
export async function replayPage(
  tx: Tx,
  request: ReplayRequestRow,
  after: string | null,
  timezone: string,
  limit: number,
): Promise<string[]> {
  const localDate = sql`(p.corrected_at AT TIME ZONE ${timezone})::date`;
  const rows = await tx.query<{ id: string }>(sql`
    SELECT p.id FROM biometric_punch p
    WHERE p.status IN ('unmapped', 'held', 'rejected')
      AND ${localDate} BETWEEN ${request.fromDate}::date AND ${request.toDate}::date
      AND (${request.punchIds}::uuid[] IS NULL OR p.id = ANY(${request.punchIds}::uuid[]))
      AND (${request.deviceId}::uuid IS NULL OR p.device_id = ${request.deviceId})
      AND (${request.pin}::text IS NULL OR p.pin = ${request.pin})
      AND (${request.userId}::uuid IS NULL OR p.user_id = ${request.userId})
      AND (${after}::uuid IS NULL OR p.id > ${after}::uuid)
    ORDER BY p.id
    LIMIT ${limit}
  `);
  return rows.map((row) => row.id);
}

export async function recordReplayProgress(
  tx: Tx,
  requestId: string,
  lastPunchId: string,
  processed: number,
): Promise<void> {
  await tx.query(sql`
    UPDATE biometric_replay_request
    SET last_punch_id = ${lastPunchId}, processed_count = processed_count + ${processed}
    WHERE id = ${requestId}
  `);
}

export async function finishReplay(
  tx: Tx,
  requestId: string,
  status: 'done' | 'failed',
  at: Date,
  error: string | null,
): Promise<void> {
  await tx.query(sql`
    UPDATE biometric_replay_request
    SET status = ${status}, finished_at = ${at}, last_error = ${error}
    WHERE id = ${requestId} AND status IN ('pending', 'running')
  `);
}

/** Requests still open a while after they were made: their jobs may have been lost. */
export async function openReplayRequests(
  tx: Tx,
  createdBefore: Date,
  after: string | null,
  limit: number,
): Promise<{ id: string }[]> {
  return tx.query<{ id: string }>(sql`
    SELECT id FROM biometric_replay_request
    WHERE status IN ('pending', 'running') AND created_at < ${createdBefore}
      AND (${after}::uuid IS NULL OR id > ${after}::uuid)
    ORDER BY id
    LIMIT ${limit}
  `);
}

/* ------------------------------------------------------------------ *
 * Health and alerts
 * ------------------------------------------------------------------ */

export interface WatchedDevice {
  id: string;
  connectorId: string;
  name: string;
  lastSeenAt: Date | null;
}

export async function enabledDevices(tx: Tx): Promise<WatchedDevice[]> {
  return tx.query<WatchedDevice>(sql`
    SELECT id, connector_id, name, last_seen_at FROM biometric_device
    WHERE status = 'enabled' ORDER BY id
  `);
}

/** The people a device's PINs name on `date`: its own rows and its connector's. */
export async function peopleMappedTo(
  tx: Tx,
  device: { id: string; connectorId: string },
  date: DateOnly,
): Promise<string[]> {
  const rows = await tx.query<{ userId: string }>(sql`
    SELECT DISTINCT user_id FROM biometric_pin_mapping
    WHERE connector_id = ${device.connectorId}
      AND (device_id IS NULL OR device_id = ${device.id})
      AND effective_from <= ${date}::date
      AND (effective_to IS NULL OR effective_to > ${date}::date)
    ORDER BY user_id
  `);
  return rows.map((row) => row.userId);
}

export type AlertKind =
  'silent' | 'skew' | 'timezone-suspect' | 'biometric-data-received' | 'new-source-ip';

/** Opens the alert unless one of its kind is already open; returns the new alert's id. */
export async function openAlert(
  tx: Tx,
  organizationId: string,
  deviceId: string,
  kind: AlertKind,
  detail: Record<string, unknown>,
  at: Date,
): Promise<string | null> {
  const row = await tx.maybeOne<{ id: string }>(sql`
    INSERT INTO biometric_alert (organization_id, device_id, kind, detail, opened_at)
    VALUES (${organizationId}, ${deviceId}, ${kind}, ${JSON.stringify(detail)}::jsonb, ${at})
    ON CONFLICT (organization_id, device_id, kind) WHERE resolved_at IS NULL DO NOTHING
    RETURNING id
  `);
  return row?.id ?? null;
}

export async function resolveAlert(
  tx: Tx,
  deviceId: string,
  kind: AlertKind,
  at: Date,
): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(sql`
    UPDATE biometric_alert SET resolved_at = ${at}
    WHERE device_id = ${deviceId} AND kind = ${kind} AND resolved_at IS NULL
    RETURNING id
  `);
  return rows.length > 0;
}

export interface AlertNotice {
  id: string;
  kind: AlertKind;
  openedAt: Date;
  notifiedAt: Date | null;
  resolvedAt: Date | null;
  deviceName: string;
  serialNumber: string;
}

export async function alertNotice(tx: Tx, alertId: string): Promise<AlertNotice | null> {
  return tx.maybeOne<AlertNotice>(sql`
    SELECT a.id, a.kind, a.opened_at, a.notified_at, a.resolved_at, d.name AS device_name, d.serial_number
    FROM biometric_alert a JOIN biometric_device d ON d.id = a.device_id
    WHERE a.id = ${alertId}
  `);
}

export async function markAlertNotified(
  tx: Tx,
  alertId: string,
  at: Date,
): Promise<void> {
  await tx.query(sql`
    UPDATE biometric_alert SET notified_at = ${at} WHERE id = ${alertId} AND notified_at IS NULL
  `);
}
