import type { SqlFragment } from '@tapcrm/authz';
import type { DateOnly } from '@tapcrm/contracts';
import type { Tx } from '../../platform/dal/db.js';
import { sql } from '../../platform/dal/sql.js';
import type { PinMapping, PunchStatus, ReaderDirection } from './types.js';

/**
 * SQL for biometric administration (§10.4, §10.8). Every statement runs in the
 * caller's tenant transaction, so RLS scopes it to the organization; ids that
 * arrive in a body are found through these queries before anything is written.
 */

/* ------------------------------------------------------------------ *
 * Connectors and devices
 * ------------------------------------------------------------------ */

export interface ConnectorRow {
  id: string;
  kind: string;
  name: string;
  status: 'active' | 'disabled';
}

export async function findConnector(tx: Tx, id: string): Promise<ConnectorRow | null> {
  return tx.maybeOne<ConnectorRow>(sql`
    SELECT id, kind, name, status FROM biometric_connector WHERE id = ${id}
  `);
}

/** The tenant's first active connector of a kind: devices share one unless told otherwise. */
export async function findActiveConnector(
  tx: Tx,
  kind: string,
): Promise<ConnectorRow | null> {
  return tx.maybeOne<ConnectorRow>(sql`
    SELECT id, kind, name, status FROM biometric_connector
    WHERE kind = ${kind} AND status = 'active'
    ORDER BY created_at, id LIMIT 1
  `);
}

export async function insertConnector(
  tx: Tx,
  row: {
    organizationId: string;
    kind: string;
    vendor: string;
    name: string;
    createdBy: string;
  },
): Promise<string> {
  const inserted = await tx.one<{ id: string }>(sql`
    INSERT INTO biometric_connector (organization_id, kind, vendor, name, created_by)
    VALUES (${row.organizationId}, ${row.kind}, ${row.vendor}, ${row.name}, ${row.createdBy})
    RETURNING id
  `);
  return inserted.id;
}

export interface DeviceRow {
  id: string;
  serialNumber: string;
  name: string;
  locationLabel: string | null;
  connectorId: string;
  connectorKind: string;
  connectorName: string;
  status: 'pending' | 'enabled' | 'disabled';
  dryRun: boolean;
  timezone: string;
  handshakeTimezone: string;
  clockOffsetSeconds: number;
  readerDirection: ReaderDirection;
  trustStatusKeys: boolean;
  ipAllowlist: string[];
  backfillHours: number;
  stampMode: 'resend-all' | 'resume';
  firmware: string | null;
  lastSeenAt: Date | null;
  lastSkewSeconds: number | null;
}

const DEVICE_COLUMNS = sql`
  d.id, d.serial_number, d.name, d.location_label, d.connector_id,
  c.kind AS connector_kind, c.name AS connector_name, d.status, d.dry_run, d.timezone,
  d.handshake_timezone, d.clock_offset_seconds, d.reader_direction, d.trust_status_keys,
  ARRAY(SELECT abbrev(a) FROM unnest(coalesce(d.ip_allowlist, '{}'::inet[])) AS a) AS ip_allowlist,
  d.backfill_hours, d.stamp_mode, d.firmware, d.last_seen_at, d.last_skew_seconds
`;

export async function listDevices(
  tx: Tx,
  visibility: SqlFragment,
  limit: number,
  after: string | null,
): Promise<DeviceRow[]> {
  return tx.query<DeviceRow>(sql`
    SELECT ${DEVICE_COLUMNS}
    FROM biometric_device d JOIN biometric_connector c ON c.id = d.connector_id
    WHERE ${visibility} AND (${after}::text IS NULL OR d.serial_number > ${after})
    ORDER BY d.serial_number
    LIMIT ${limit}
  `);
}

export async function findDeviceBySerial(
  tx: Tx,
  serialNumber: string,
  options: { forUpdate?: boolean } = {},
): Promise<DeviceRow | null> {
  return tx.maybeOne<DeviceRow>(sql`
    SELECT ${DEVICE_COLUMNS}
    FROM biometric_device d JOIN biometric_connector c ON c.id = d.connector_id
    WHERE d.serial_number = ${serialNumber}
    ${options.forUpdate === true ? sql`FOR UPDATE OF d` : sql``}
  `);
}

export async function findDevice(tx: Tx, id: string): Promise<DeviceRow | null> {
  return tx.maybeOne<DeviceRow>(sql`
    SELECT ${DEVICE_COLUMNS}
    FROM biometric_device d JOIN biometric_connector c ON c.id = d.connector_id
    WHERE d.id = ${id}
  `);
}

export async function insertDevice(
  tx: Tx,
  row: {
    organizationId: string;
    connectorId: string;
    serialNumber: string;
    name: string;
    locationLabel: string | null;
    timezone: string;
    createdBy: string;
  },
): Promise<string> {
  // A new device is pending and in dry-run by the table's defaults (BI-5).
  const inserted = await tx.one<{ id: string }>(sql`
    INSERT INTO biometric_device (organization_id, connector_id, serial_number, name, location_label,
                                  timezone, created_by)
    VALUES (${row.organizationId}, ${row.connectorId}, ${row.serialNumber}, ${row.name},
            ${row.locationLabel}, ${row.timezone}, ${row.createdBy})
    RETURNING id
  `);
  return inserted.id;
}

export interface DeviceChanges {
  name?: string | undefined;
  locationLabel?: string | null | undefined;
  status?: 'enabled' | 'disabled' | undefined;
  dryRun?: boolean | undefined;
  timezone?: string | undefined;
  handshakeTimezone?: string | undefined;
  clockOffsetSeconds?: number | undefined;
  readerDirection?: ReaderDirection | undefined;
  trustStatusKeys?: boolean | undefined;
  ipAllowlist?: string[] | undefined;
  backfillHours?: number | undefined;
  stampMode?: 'resend-all' | 'resume' | undefined;
}

const DEVICE_CHANGE_COLUMNS: Record<keyof DeviceChanges, string> = {
  name: 'name',
  locationLabel: 'location_label',
  status: 'status',
  dryRun: 'dry_run',
  timezone: 'timezone',
  handshakeTimezone: 'handshake_timezone',
  clockOffsetSeconds: 'clock_offset_seconds',
  readerDirection: 'reader_direction',
  trustStatusKeys: 'trust_status_keys',
  ipAllowlist: 'ip_allowlist',
  backfillHours: 'backfill_hours',
  stampMode: 'stamp_mode',
};

export async function updateDevice(
  tx: Tx,
  id: string,
  changes: DeviceChanges,
): Promise<void> {
  const assignments = (Object.keys(changes) as (keyof DeviceChanges)[])
    .filter((key) => changes[key] !== undefined)
    .map((key) =>
      key === 'ipAllowlist'
        ? sql`ip_allowlist = ${changes.ipAllowlist}::inet[]`
        : sql`${sql.raw(DEVICE_CHANGE_COLUMNS[key])} = ${changes[key]}`,
    );
  if (assignments.length === 0) return;
  await tx.query(
    sql`UPDATE biometric_device SET ${sql.join(assignments)} WHERE id = ${id}`,
  );
}

export interface ReaderRow {
  deviceId: string;
  readerKey: string;
  label: string;
  direction: ReaderDirection;
}

export async function readersOf(
  tx: Tx,
  deviceIds: readonly string[],
): Promise<ReaderRow[]> {
  if (deviceIds.length === 0) return [];
  return tx.query<ReaderRow>(sql`
    SELECT device_id, reader_key, label, direction FROM biometric_reader
    WHERE device_id = ANY(${[...deviceIds]}::uuid[])
    ORDER BY device_id, reader_key
  `);
}

/** A device's readers are replaced as a set; punches already read keep their reading (D37). */
export async function replaceReaders(
  tx: Tx,
  organizationId: string,
  deviceId: string,
  readers: readonly { readerKey: string; label: string; direction: ReaderDirection }[],
): Promise<void> {
  await tx.query(sql`DELETE FROM biometric_reader WHERE device_id = ${deviceId}`);
  for (const reader of readers) {
    await tx.query(sql`
      INSERT INTO biometric_reader (organization_id, device_id, reader_key, label, direction)
      VALUES (${organizationId}, ${deviceId}, ${reader.readerKey}, ${reader.label}, ${reader.direction})
    `);
  }
}

export interface AlertRow {
  deviceId: string;
  kind: string;
  openedAt: Date;
}

export async function openAlertsOf(
  tx: Tx,
  deviceIds: readonly string[],
): Promise<AlertRow[]> {
  if (deviceIds.length === 0) return [];
  return tx.query<AlertRow>(sql`
    SELECT device_id, kind, opened_at FROM biometric_alert
    WHERE device_id = ANY(${[...deviceIds]}::uuid[]) AND resolved_at IS NULL
    ORDER BY opened_at
  `);
}

/* ------------------------------------------------------------------ *
 * PIN mappings
 * ------------------------------------------------------------------ */

/**
 * Serializes every writer of one connector's PIN — connector-wide or for one
 * device — and, in 5b, the punch that resolves it. Taken before any person lock.
 */
export async function lockPin(tx: Tx, connectorId: string, pin: string): Promise<void> {
  await tx.query(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended('biometric-pin:' || current_organization_id()::text || ':' || ${connectorId} || ':' || ${pin}, 0))
  `);
}

const MAPPING_COLUMNS = sql`
  id, connector_id, device_id, pin, user_id,
  effective_from::text AS effective_from, effective_to::text AS effective_to
`;

export async function mappingsOfPin(
  tx: Tx,
  connectorId: string,
  pin: string,
): Promise<PinMapping[]> {
  return tx.query<PinMapping>(sql`
    SELECT ${MAPPING_COLUMNS} FROM biometric_pin_mapping
    WHERE connector_id = ${connectorId} AND pin = ${pin}
    ORDER BY effective_from, device_id NULLS FIRST, id
  `);
}

export async function insertMapping(
  tx: Tx,
  row: Omit<PinMapping, 'id'> & { organizationId: string; createdBy: string },
): Promise<string> {
  const inserted = await tx.one<{ id: string }>(sql`
    INSERT INTO biometric_pin_mapping (organization_id, connector_id, device_id, pin, user_id,
                                       effective_from, effective_to, created_by)
    VALUES (${row.organizationId}, ${row.connectorId}, ${row.deviceId}, ${row.pin}, ${row.userId},
            ${row.effectiveFrom}, ${row.effectiveTo}, ${row.createdBy})
    RETURNING id
  `);
  return inserted.id;
}

export async function setMappingEnd(
  tx: Tx,
  id: string,
  effectiveTo: DateOnly | null,
): Promise<void> {
  await tx.query(
    sql`UPDATE biometric_pin_mapping SET effective_to = ${effectiveTo} WHERE id = ${id}`,
  );
}

export async function personExists(tx: Tx, userId: string): Promise<boolean> {
  const row = await tx.maybeOne<{ id: string }>(
    sql`SELECT id FROM app_user WHERE id = ${userId}`,
  );
  return row !== null;
}

/** Punches of this connector's PIN whose own date — in the organization's zone — is in `[from, to)`. */
function pinPunchesInPeriod(
  scope: { connectorId: string; deviceId: string | null; pin: string },
  period: { from: DateOnly; to: DateOnly | null },
  timezone: string,
): SqlFragment {
  const localDate = sql`(p.corrected_at AT TIME ZONE ${timezone})::date`;
  return sql`
    p.pin = ${scope.pin}
    AND p.device_id IN (SELECT id FROM biometric_device WHERE connector_id = ${scope.connectorId})
    AND (${scope.deviceId}::uuid IS NULL OR p.device_id = ${scope.deviceId})
    AND ${localDate} >= ${period.from}::date
    AND (${period.to}::date IS NULL OR ${localDate} < ${period.to}::date)
  `;
}

/** BI-3: unmapped punches since `since` that a mapping over `period` now covers. */
export async function countUnmappedInPeriod(
  tx: Tx,
  scope: { connectorId: string; deviceId: string | null; pin: string },
  period: { from: DateOnly; to: DateOnly | null },
  since: Date,
  timezone: string,
): Promise<number> {
  const row = await tx.one<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM biometric_punch p
    WHERE p.status = 'unmapped' AND p.received_at >= ${since}
      AND ${pinPunchesInPeriod(scope, period, timezone)}
  `);
  return row.count;
}

export interface OwnedPunchRow {
  id: string;
  deviceId: string;
  userId: string;
  localDate: DateOnly;
}

/** Punches of the PIN in the period that already belong to someone: applied, or in a burst. */
export async function ownedPunchesInPeriod(
  tx: Tx,
  scope: { connectorId: string; deviceId: string | null; pin: string },
  period: { from: DateOnly; to: DateOnly | null },
  timezone: string,
): Promise<OwnedPunchRow[]> {
  return tx.query<OwnedPunchRow>(sql`
    SELECT p.id, p.device_id, p.user_id,
           ((p.corrected_at AT TIME ZONE ${timezone})::date)::text AS local_date
    FROM biometric_punch p
    WHERE p.user_id IS NOT NULL AND p.status IN ('applied', 'duplicate', 'dry-run')
      AND ${pinPunchesInPeriod(scope, period, timezone)}
  `);
}

export type ReviewKind =
  | 'protected-head'
  | 'mapping-changed'
  | 'not-employed'
  | 'other-person'
  | 'not-a-device-event';

/** Opens one review item per punch and kind; an open one is not opened twice. */
export async function openReview(
  tx: Tx,
  organizationId: string,
  punchId: string,
  kind: ReviewKind,
  detail: Record<string, unknown>,
): Promise<void> {
  await tx.query(sql`
    INSERT INTO biometric_review_item (organization_id, punch_id, kind, detail)
    VALUES (${organizationId}, ${punchId}, ${kind}, ${JSON.stringify(detail)}::jsonb)
    ON CONFLICT DO NOTHING
  `);
}

/* ------------------------------------------------------------------ *
 * The punch stream and replay requests
 * ------------------------------------------------------------------ */

export interface PunchRow {
  id: string;
  deviceId: string;
  serialNumber: string;
  pin: string;
  deviceLocalTime: string | null;
  occurredAt: Date;
  correctedAt: Date;
  appliedOffsetSeconds: number;
  receivedAt: Date;
  readerKey: string | null;
  statusCode: string | null;
  verifyMode: string | null;
  rawLine: string;
  directionAtReceipt: ReaderDirection;
  meaning: 'in' | 'out' | 'break-start' | 'break-end' | 'scan';
  dryRunAtReceipt: boolean;
  status: PunchStatus;
  statusReason: string | null;
  userId: string | null;
  duplicateOf: string | null;
  attendanceEventId: string | null;
}

export interface PunchFilter {
  status?: PunchStatus | undefined;
  deviceId?: string | undefined;
  pin?: string | undefined;
  userId?: string | undefined;
}

/** Newest first, keyed on (received_at, id) so a page never skips or repeats a row. */
export async function listPunches(
  tx: Tx,
  visibility: SqlFragment,
  filter: PunchFilter,
  limit: number,
  after: { receivedAt: Date; id: string } | null,
): Promise<PunchRow[]> {
  return tx.query<PunchRow>(sql`
    SELECT p.id, p.device_id, d.serial_number, p.pin,
           to_char(p.device_local_time, 'YYYY-MM-DD HH24:MI:SS') AS device_local_time,
           p.occurred_at, p.corrected_at, p.applied_offset_seconds, p.received_at, p.reader_key,
           p.status_code, p.verify_mode, p.raw_line, p.direction_at_receipt, p.meaning,
           p.dry_run_at_receipt, p.status, p.status_reason, p.user_id, p.duplicate_of,
           p.attendance_event_id
    FROM biometric_punch p JOIN biometric_device d ON d.id = p.device_id
    WHERE ${visibility}
      AND (${filter.status ?? null}::text IS NULL OR p.status = ${filter.status ?? null})
      AND (${filter.deviceId ?? null}::uuid IS NULL OR p.device_id = ${filter.deviceId ?? null})
      AND (${filter.pin ?? null}::text IS NULL OR p.pin = ${filter.pin ?? null})
      AND (${filter.userId ?? null}::uuid IS NULL OR p.user_id = ${filter.userId ?? null})
      AND (${after?.receivedAt ?? null}::timestamptz IS NULL
           OR (p.received_at, p.id) < (${after?.receivedAt ?? null}::timestamptz, ${after?.id ?? null}::uuid))
    ORDER BY p.received_at DESC, p.id DESC
    LIMIT ${limit}
  `);
}

export interface ReplaySelection {
  from: DateOnly;
  to: DateOnly;
  punchIds?: readonly string[] | undefined;
  deviceId?: string | undefined;
  pin?: string | undefined;
  userId?: string | undefined;
}

/** What a replay would pick up: waiting punches only — applied ones are never replayed. */
export async function countReplaySelection(
  tx: Tx,
  selection: ReplaySelection,
  timezone: string,
): Promise<number> {
  const localDate = sql`(p.corrected_at AT TIME ZONE ${timezone})::date`;
  const row = await tx.one<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM biometric_punch p
    WHERE p.status IN ('unmapped', 'held', 'rejected')
      AND ${localDate} BETWEEN ${selection.from}::date AND ${selection.to}::date
      AND (${selection.punchIds === undefined ? null : [...selection.punchIds]}::uuid[] IS NULL
           OR p.id = ANY(${selection.punchIds === undefined ? null : [...selection.punchIds]}::uuid[]))
      AND (${selection.deviceId ?? null}::uuid IS NULL OR p.device_id = ${selection.deviceId ?? null})
      AND (${selection.pin ?? null}::text IS NULL OR p.pin = ${selection.pin ?? null})
      AND (${selection.userId ?? null}::uuid IS NULL OR p.user_id = ${selection.userId ?? null})
  `);
  return row.count;
}

export async function insertReplayRequest(
  tx: Tx,
  row: ReplaySelection & {
    organizationId: string;
    requestedBy: string;
    reason: string;
    releaseHold: boolean;
    selectedCount: number;
  },
): Promise<string> {
  const inserted = await tx.one<{ id: string }>(sql`
    INSERT INTO biometric_replay_request (organization_id, requested_by, reason, punch_ids, device_id, pin,
                                          user_id, from_date, to_date, release_hold, selected_count)
    VALUES (${row.organizationId}, ${row.requestedBy}, ${row.reason},
            ${row.punchIds === undefined ? null : [...row.punchIds]}::uuid[], ${row.deviceId ?? null},
            ${row.pin ?? null}, ${row.userId ?? null}, ${row.from}, ${row.to}, ${row.releaseHold},
            ${row.selectedCount})
    RETURNING id
  `);
  return inserted.id;
}
