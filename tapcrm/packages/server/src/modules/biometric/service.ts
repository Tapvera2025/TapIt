import { visibilityFilter } from '@tapcrm/authz';
import type {
  BiometricDeviceChange,
  BiometricDeviceDto,
  BiometricDeviceList,
  BiometricMappingDto,
  BiometricMappingResult,
  BiometricPunchDto,
  BiometricPunchPage,
  BiometricReplayAccepted,
  BiometricAlertKind,
  DateOnly,
} from '@tapcrm/contracts';
import type { RequestContext } from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { organizationTimezone } from '../../platform/organization-time.js';
import { daysBetween, isTimeZone, systemClock, type Clock } from '../../platform/time.js';
import {
  BIOMETRIC_ERROR_CODES,
  BiometricConflictError,
  BiometricNotFoundError,
  BiometricValidationError,
} from './errors.js';
import { BIOMETRIC_EVENTS, recordEvent } from './events.js';
import { overrideWarnings, resolvePin, scopeConflicts } from './mapping.js';
import { assertTenantWide } from './policy.js';
import * as repo from './repository.js';
import type { PinMapping } from './types.js';
import {
  REPLAY_MAX_DAYS,
  type CreateDeviceBody,
  type DeviceQuery,
  type MappingBody,
  type PatchDeviceBody,
  type PunchQuery,
  type ReplayBody,
} from './validators.js';

/**
 * Biometric administration (§10.8): the device registry, PIN mappings, the
 * punch stream and replay requests. Every operation is tenant-wide (see
 * `policy.ts`); ids in a body are found inside the tenant before anything is
 * written.
 */

/**
 * Live application needs the machine surface (5c, G2) and a dated employment
 * history in place of the account-status shim. Until then a device can be
 * registered, configured and compared in dry-run, but not switched live.
 */
const LIVE_APPLICATION_AVAILABLE = false;

const REPLAYABLE_LOOKBACK_DAYS = 30;

/* ------------------------------------------------------------------ *
 * Devices
 * ------------------------------------------------------------------ */

function toDeviceDto(
  row: repo.DeviceRow,
  readers: readonly repo.ReaderRow[],
  alerts: readonly repo.AlertRow[],
): BiometricDeviceDto {
  return {
    id: row.id,
    serialNumber: row.serialNumber,
    name: row.name,
    locationLabel: row.locationLabel,
    connector: { id: row.connectorId, kind: row.connectorKind, name: row.connectorName },
    status: row.status,
    dryRun: row.dryRun,
    timezone: row.timezone,
    handshakeTimezone: row.handshakeTimezone,
    clockOffsetSeconds: row.clockOffsetSeconds,
    readerDirection: row.readerDirection,
    trustStatusKeys: row.trustStatusKeys,
    readers: readers
      .filter((reader) => reader.deviceId === row.id)
      .map(({ readerKey, label, direction }) => ({ readerKey, label, direction })),
    ipAllowlist: row.ipAllowlist,
    backfillHours: row.backfillHours,
    stampMode: row.stampMode,
    firmware: row.firmware,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    lastSkewSeconds: row.lastSkewSeconds,
    openAlerts: alerts
      .filter((alert) => alert.deviceId === row.id)
      .map((alert) => ({
        kind: alert.kind as BiometricAlertKind,
        openedAt: alert.openedAt.toISOString(),
      })),
  };
}

async function devicesWithDetail(
  tx: Tx,
  rows: readonly repo.DeviceRow[],
): Promise<BiometricDeviceDto[]> {
  const ids = rows.map((row) => row.id);
  const [readers, alerts] = [
    await repo.readersOf(tx, ids),
    await repo.openAlertsOf(tx, ids),
  ];
  return rows.map((row) => toDeviceDto(row, readers, alerts));
}

/** GET /api/biometric/devices — the registry, a page at a time, by serial. */
export async function listDevices(
  ctx: RequestContext,
  query: DeviceQuery,
): Promise<BiometricDeviceList> {
  await assertTenantWide(ctx);
  const visibility = await visibilityFilter(ctx, 'biometric:manage', 'biometricDevice');
  return db.transaction(ctx, async (tx) => {
    const rows = await repo.listDevices(
      tx,
      visibility,
      query.limit + 1,
      query.after ?? null,
    );
    const page = rows.slice(0, query.limit);
    return {
      devices: await devicesWithDetail(tx, page),
      next: rows.length > query.limit ? page[page.length - 1]!.serialNumber : null,
    };
  });
}

function assertTimezone(zone: string): void {
  if (!isTimeZone(zone))
    throw new BiometricValidationError(
      BIOMETRIC_ERROR_CODES.TIMEZONE_INVALID,
      `"${zone}" is not an IANA timezone.`,
    );
}

/**
 * POST /api/biometric/devices — registers a device on a connector: the one
 * named, else the tenant's active ADMS connector, else a new one. The device
 * starts pending and in dry-run (BI-5).
 */
export async function createDevice(
  ctx: RequestContext,
  body: CreateDeviceBody,
): Promise<BiometricDeviceDto> {
  await assertTenantWide(ctx);
  return db.transaction(ctx, async (tx) => {
    const timezone = body.timezone ?? (await organizationTimezone(tx));
    assertTimezone(timezone);
    if ((await repo.findDeviceBySerial(tx, body.serialNumber)) !== null)
      throw new BiometricConflictError(
        BIOMETRIC_ERROR_CODES.SERIAL_TAKEN,
        `A device with serial ${body.serialNumber} is already registered.`,
      );

    let connectorId: string;
    if (body.connectorId !== undefined) {
      const connector = await repo.findConnector(tx, body.connectorId);
      if (connector === null)
        throw new BiometricNotFoundError(
          BIOMETRIC_ERROR_CODES.CONNECTOR_NOT_FOUND,
          'There is no such connector.',
        );
      if (connector.kind !== body.adapter || connector.status !== 'active')
        throw new BiometricValidationError(
          BIOMETRIC_ERROR_CODES.CONNECTOR_KIND_MISMATCH,
          `That connector is not an active ${body.adapter} connector.`,
        );
      connectorId = connector.id;
    } else {
      connectorId =
        (await repo.findActiveConnector(tx, body.adapter))?.id ??
        (await repo.insertConnector(tx, {
          organizationId: ctx.organizationId,
          kind: body.adapter,
          vendor: 'zkteco',
          name: 'ZKTeco ADMS',
          createdBy: ctx.principal.id,
        }));
    }

    const id = await repo.insertDevice(tx, {
      organizationId: ctx.organizationId,
      connectorId,
      serialNumber: body.serialNumber,
      name: body.name,
      locationLabel: body.locationLabel,
      timezone,
      createdBy: ctx.principal.id,
    });
    const [device] = await devicesWithDetail(tx, [(await repo.findDevice(tx, id))!]);
    return device!;
  });
}

/**
 * PATCH /api/biometric/devices/:serial. A change reaches only the punches
 * that arrive after it (D37): nothing already received is read again, so the
 * answer says when the device was last heard from.
 */
export async function changeDevice(
  ctx: RequestContext,
  serialNumber: string,
  body: PatchDeviceBody,
): Promise<BiometricDeviceChange> {
  if (body.dryRun === false && !LIVE_APPLICATION_AVAILABLE)
    throw new BiometricConflictError(
      BIOMETRIC_ERROR_CODES.LIVE_NOT_AVAILABLE,
      'A device stays in dry-run until the device connection and employment history are in place.',
    );
  if (body.timezone !== undefined) assertTimezone(body.timezone);
  return db.transaction(ctx, async (tx) => {
    const current = await repo.findDeviceBySerial(tx, serialNumber, { forUpdate: true });
    if (current === null)
      throw new BiometricNotFoundError(
        BIOMETRIC_ERROR_CODES.DEVICE_NOT_FOUND,
        'There is no such device.',
      );
    const direction = body.readerDirection ?? current.readerDirection;
    const trusted = body.trustStatusKeys ?? current.trustStatusKeys;
    const trustedReaders = (body.readers ?? []).some(
      (r) => r.direction === 'both-trusted',
    );
    if ((direction === 'both-trusted' || trustedReaders) && !trusted)
      throw new BiometricValidationError(
        BIOMETRIC_ERROR_CODES.TRUSTED_KEYS_REQUIRED,
        'A both-trusted reader reads the device’s status keys; turn trustStatusKeys on first.',
      );

    const { readers, ...changes } = body;
    await repo.updateDevice(tx, current.id, changes);
    if (readers !== undefined)
      await repo.replaceReaders(tx, ctx.organizationId, current.id, readers);
    const [device] = await devicesWithDetail(tx, [
      (await repo.findDevice(tx, current.id))!,
    ]);
    return { device: device!, lastSeenAt: current.lastSeenAt?.toISOString() ?? null };
  });
}

/* ------------------------------------------------------------------ *
 * PIN mappings
 * ------------------------------------------------------------------ */

const toMappingDto = (row: PinMapping): BiometricMappingDto => ({ ...row });

/**
 * PUT /api/biometric/mapping — who a PIN names, from a date (BI-2, G15).
 *
 * The same scope, PIN, person and start date revise that row's end; anything
 * else is a new row. A PIN already held in the scope for a shared day is
 * refused, naming the holder. Nothing already applied moves: punches of the
 * PIN that the new rows would give to someone else are opened for review
 * (forward-only), and unmapped punches of the last 30 days the mapping now
 * covers are counted, ready to replay (BI-3).
 */
export async function putMapping(
  ctx: RequestContext,
  body: MappingBody,
  clock: Clock = systemClock,
): Promise<BiometricMappingResult> {
  await assertTenantWide(ctx);
  if (body.effectiveTo !== null && body.effectiveTo <= body.effectiveFrom)
    throw new BiometricValidationError(
      BIOMETRIC_ERROR_CODES.RANGE_INVALID,
      'effectiveTo is exclusive and must come after effectiveFrom.',
    );
  return db.transaction(ctx, async (tx) => {
    const connector = await repo.findConnector(tx, body.connectorId);
    if (connector === null)
      throw new BiometricNotFoundError(
        BIOMETRIC_ERROR_CODES.CONNECTOR_NOT_FOUND,
        'There is no such connector.',
      );
    if (body.deviceId !== null) {
      const device = await repo.findDevice(tx, body.deviceId);
      if (device === null || device.connectorId !== connector.id)
        throw new BiometricValidationError(
          BIOMETRIC_ERROR_CODES.DEVICE_NOT_FOUND,
          'That device is not on this connector.',
        );
    }
    if (!(await repo.personExists(tx, body.userId)))
      throw new BiometricNotFoundError(
        BIOMETRIC_ERROR_CODES.PERSON_NOT_FOUND,
        'There is no such person.',
      );

    await repo.lockPin(tx, connector.id, body.pin);
    const before = await repo.mappingsOfPin(tx, connector.id, body.pin);
    const revised = before.find(
      (row) =>
        row.deviceId === body.deviceId &&
        row.userId === body.userId &&
        row.effectiveFrom === body.effectiveFrom,
    );
    const proposed = { ...body, connectorId: connector.id, id: revised?.id };
    const conflicts = scopeConflicts(before, proposed);
    if (conflicts.length > 0)
      throw new BiometricConflictError(
        BIOMETRIC_ERROR_CODES.PIN_HELD,
        `PIN ${body.pin} is already held in this scope for part of that period.`,
        { holders: conflicts.map(toMappingDto) },
      );

    let id: string;
    let changed: { from: DateOnly; to: DateOnly | null } | null;
    if (revised !== undefined) {
      id = revised.id;
      changed = changedSlice(revised.effectiveTo, body.effectiveTo);
      if (changed !== null) await repo.setMappingEnd(tx, id, body.effectiveTo);
    } else {
      id = await repo.insertMapping(tx, {
        organizationId: ctx.organizationId,
        connectorId: connector.id,
        deviceId: body.deviceId,
        pin: body.pin,
        userId: body.userId,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo,
        createdBy: ctx.principal.id,
      });
      changed = { from: body.effectiveFrom, to: body.effectiveTo };
    }
    const after = await repo.mappingsOfPin(tx, connector.id, body.pin);
    const timezone = await organizationTimezone(tx);
    const scope = { connectorId: connector.id, deviceId: body.deviceId, pin: body.pin };

    let needsReview = 0;
    const owned =
      changed === null
        ? []
        : await repo.ownedPunchesInPeriod(tx, scope, changed, timezone);
    for (const punch of owned) {
      const owner = resolvePin(
        after,
        { connectorId: connector.id, deviceId: punch.deviceId, pin: body.pin },
        punch.localDate,
      );
      if (owner?.userId === punch.userId) continue;
      needsReview += 1;
      await repo.openReview(tx, ctx.organizationId, punch.id, 'mapping-changed', {
        mappingId: id,
        ownerNow: punch.userId,
        mappingNames: owner?.userId ?? null,
      });
    }

    const since = new Date(clock.now().getTime() - REPLAYABLE_LOOKBACK_DAYS * 86_400_000);
    const mapping = after.find((row) => row.id === id)!;
    return {
      mapping: toMappingDto(mapping),
      history: after.map(toMappingDto),
      warnings: overrideWarnings(after),
      replayable: await repo.countUnmappedInPeriod(
        tx,
        scope,
        { from: mapping.effectiveFrom, to: mapping.effectiveTo },
        since,
        timezone,
      ),
      needsReview,
    };
  });
}

/** The days an end-date change moved in or out of a mapping; null when it moved nothing. */
function changedSlice(
  oldEnd: DateOnly | null,
  newEnd: DateOnly | null,
): { from: DateOnly; to: DateOnly | null } | null {
  if (oldEnd === newEnd) return null;
  if (oldEnd === null) return { from: newEnd!, to: null };
  if (newEnd === null) return { from: oldEnd, to: null };
  return oldEnd < newEnd ? { from: oldEnd, to: newEnd } : { from: newEnd, to: oldEnd };
}

/* ------------------------------------------------------------------ *
 * The punch stream and replay
 * ------------------------------------------------------------------ */

function toPunchDto(row: repo.PunchRow): BiometricPunchDto {
  return {
    ...row,
    occurredAt: row.occurredAt.toISOString(),
    correctedAt: row.correctedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
  };
}

function encodeCursor(row: repo.PunchRow): string {
  return `${row.receivedAt.toISOString()}_${row.id}`;
}

function decodeCursor(value: string): { receivedAt: Date; id: string } {
  const [at, id] = value.split('_');
  const receivedAt = new Date(at ?? '');
  if (
    id === undefined ||
    Number.isNaN(receivedAt.getTime()) ||
    !/^[0-9a-f-]{36}$/.test(id)
  )
    throw new BiometricValidationError(
      BIOMETRIC_ERROR_CODES.RANGE_INVALID,
      'That page cursor is not one this list gave out.',
    );
  return { receivedAt, id };
}

/** GET /api/biometric/punches — every punch with its status, reason and reading (BI-8). */
export async function listPunches(
  ctx: RequestContext,
  query: PunchQuery,
): Promise<BiometricPunchPage> {
  await assertTenantWide(ctx);
  const visibility = await visibilityFilter(ctx, 'biometric:manage', 'biometricDevice');
  const after = query.after === undefined ? null : decodeCursor(query.after);
  return db.transaction(ctx, async (tx) => {
    const rows = await repo.listPunches(
      tx,
      visibility,
      {
        status: query.status,
        deviceId: query.deviceId,
        pin: query.pin,
        userId: query.userId,
      },
      query.limit + 1,
      after,
    );
    const page = rows.slice(0, query.limit);
    return {
      punches: page.map(toPunchDto),
      next: rows.length > query.limit ? encodeCursor(page[page.length - 1]!) : null,
    };
  });
}

/**
 * POST /api/biometric/punches/replay — records a bounded replay of waiting
 * punches (unmapped, held, rejected) and says how many it selected. Applied
 * punches are never selected. The request is its own generation: its job,
 * queued after commit, works through it and keeps the reading each punch
 * arrived with (`replay.ts`).
 */
export async function requestReplay(
  ctx: RequestContext,
  body: ReplayBody,
): Promise<BiometricReplayAccepted> {
  await assertTenantWide(ctx);
  const span = daysBetween(body.from, body.to);
  if (span < 0 || span > REPLAY_MAX_DAYS)
    throw new BiometricValidationError(
      BIOMETRIC_ERROR_CODES.RANGE_INVALID,
      `A replay covers at most ${REPLAY_MAX_DAYS} days, and its end cannot come before its start.`,
    );
  return db.transaction(ctx, async (tx) => {
    if (
      body.deviceId !== undefined &&
      (await repo.findDevice(tx, body.deviceId)) === null
    )
      throw new BiometricNotFoundError(
        BIOMETRIC_ERROR_CODES.DEVICE_NOT_FOUND,
        'There is no such device.',
      );
    if (body.userId !== undefined && !(await repo.personExists(tx, body.userId)))
      throw new BiometricNotFoundError(
        BIOMETRIC_ERROR_CODES.PERSON_NOT_FOUND,
        'There is no such person.',
      );
    const timezone = await organizationTimezone(tx);
    const selected = await repo.countReplaySelection(tx, body, timezone);
    if (selected === 0)
      throw new BiometricValidationError(
        BIOMETRIC_ERROR_CODES.NOTHING_TO_REPLAY,
        'Nothing in that selection is waiting to be replayed.',
      );
    const requestId = await repo.insertReplayRequest(tx, {
      ...body,
      organizationId: ctx.organizationId,
      requestedBy: ctx.principal.id,
      selectedCount: selected,
    });
    await recordEvent(tx, ctx.organizationId, BIOMETRIC_EVENTS.REPLAY_REQUESTED, {
      requestId,
    });
    return { requestId, selected };
  });
}
