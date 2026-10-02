import type { ResolvedShift } from '@tapcrm/contracts';
import {
  createJobContext,
  systemPrincipal,
  type RequestContext,
} from '../../platform/dal/context.js';
import { db, type Tx } from '../../platform/dal/db.js';
import { organizationTimezone } from '../../platform/organization-time.js';
import type { OutboxEvent } from '../../platform/outbox/registry.js';
import {
  addDays,
  instantAt,
  localDateOf,
  systemClock,
  type Clock,
} from '../../platform/time.js';
import * as AccessFacade from '../access-management/facade.js';
import * as CalendarFacade from '../holidays/facade.js';
import * as IdentityFacade from '../identity/facade.js';
import * as ShiftsFacade from '../shifts/facade.js';
import { BIOMETRIC_EVENTS, recordEvent, type DeviceAlertOpened } from './events.js';
import * as punches from './punch-repository.js';

/**
 * Device health (§10.6, BI-7): silence while people are on shift, and clock
 * skew measured from realtime pushes. An alert opens once per kind and device,
 * is announced once after commit, and resolves when the cause is gone.
 */

export const SILENCE_MINUTES = 60;
/** Beyond this, the median skew opens an alert (BI-4). */
export const SKEW_ALERT_SECONDS = 3 * 60;
const SKEW_SAMPLES = 20;
/** A median of fewer samples is one bad push, not a clock. */
const SKEW_MIN_SAMPLES = 3;

async function openDeviceAlert(
  tx: Tx,
  organizationId: string,
  deviceId: string,
  kind: punches.AlertKind,
  detail: Record<string, unknown>,
  at: Date,
): Promise<boolean> {
  const alertId = await punches.openAlert(tx, organizationId, deviceId, kind, detail, at);
  if (alertId === null) return false;
  await recordEvent(tx, organizationId, BIOMETRIC_EVENTS.DEVICE_ALERT, { alertId });
  return true;
}

/** Any contact ends silence. */
export async function resolveSilence(tx: Tx, deviceId: string, at: Date): Promise<void> {
  await punches.resolveAlert(tx, deviceId, 'silent', at);
}

/* ------------------------------------------------------------------ *
 * Skew
 * ------------------------------------------------------------------ */

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/**
 * What a median skew says. Within three minutes: nothing. Close to a whole
 * number of half hours: the device's timezone is probably wrong
 * (`timezone-suspect`, "check the handshake TimeZone value"). Otherwise a
 * clock off by that much (`skew`); the administrator sets the offset.
 */
export function skewKindOf(medianSeconds: number): 'skew' | 'timezone-suspect' | null {
  const size = Math.abs(medianSeconds);
  if (size <= SKEW_ALERT_SECONDS) return null;
  const fromHalfHour = size % 1800;
  if (size >= 1500 && (fromHalfHour <= 300 || fromHalfHour >= 1500))
    return 'timezone-suspect';
  return 'skew';
}

/**
 * One realtime sample: when the punch arrived minus its corrected instant. A
 * device whose offset is set right measures near zero, and its alert resolves.
 */
export async function recordSkewSample(
  tx: Tx,
  organizationId: string,
  device: { readonly id: string; readonly skewSamples: readonly number[] },
  sampleSeconds: number,
  at: Date,
): Promise<void> {
  const samples = [...device.skewSamples, sampleSeconds].slice(-SKEW_SAMPLES);
  const median = medianOf(samples);
  await punches.saveSkew(tx, device.id, samples, median, at);
  const kind = skewKindOf(median);
  for (const candidate of ['skew', 'timezone-suspect'] as const) {
    if (candidate !== kind) await punches.resolveAlert(tx, device.id, candidate, at);
    else if (samples.length >= SKEW_MIN_SAMPLES)
      await openDeviceAlert(
        tx,
        organizationId,
        device.id,
        candidate,
        { medianSeconds: median, samples: samples.length },
        at,
      );
  }
}

/* ------------------------------------------------------------------ *
 * Silence
 * ------------------------------------------------------------------ */

function shiftIsOpen(shift: ResolvedShift, now: Date): boolean {
  if (shift.kind !== 'fixed' || shift.start === null || shift.end === null) return false;
  const start = instantAt(shift.date, shift.start, shift.timezone);
  const end = instantAt(
    shift.isOvernight ? addDays(shift.date, 1) : shift.date,
    shift.end,
    shift.timezone,
  );
  return start <= now && now < end;
}

/** Whether anyone the device's PINs name is inside a working shift now (last night's included). */
async function someoneOnShift(
  tx: Tx,
  device: punches.WatchedDevice,
  now: Date,
  timezone: string,
): Promise<boolean> {
  const today = localDateOf(now, timezone);
  const yesterday = addDays(today, -1);
  for (const userId of await punches.peopleMappedTo(tx, device, today)) {
    const shifts = await ShiftsFacade.resolveRange(tx, userId, yesterday, today);
    const days = await CalendarFacade.dayTypeRange(tx, userId, yesterday, today);
    const working = new Set(
      days.filter((day) => day.type === 'working').map((day) => day.date),
    );
    if (shifts.some((shift) => working.has(shift.date) && shiftIsOpen(shift, now)))
      return true;
  }
  return false;
}

/**
 * Every 15 minutes: an enabled device unheard for 60 minutes while someone it
 * serves is on shift opens one `silent` alert; one heard from again resolves it.
 */
export async function checkDeviceHealth(
  ctx: RequestContext,
  clock: Clock = systemClock,
): Promise<number> {
  const now = clock.now();
  return db.transaction(ctx, async (tx) => {
    const timezone = await organizationTimezone(tx);
    let opened = 0;
    for (const device of await punches.enabledDevices(tx)) {
      const quietFor =
        device.lastSeenAt === null
          ? Infinity
          : now.getTime() - device.lastSeenAt.getTime();
      if (quietFor < SILENCE_MINUTES * 60_000) {
        await punches.resolveAlert(tx, device.id, 'silent', now);
        continue;
      }
      if (!(await someoneOnShift(tx, device, now, timezone))) continue;
      const detail = { lastSeenAt: device.lastSeenAt?.toISOString() ?? null };
      if (await openDeviceAlert(tx, ctx.organizationId, device.id, 'silent', detail, now))
        opened += 1;
    }
    return opened;
  });
}

/* ------------------------------------------------------------------ *
 * Telling people
 * ------------------------------------------------------------------ */

const HINTS: Record<punches.AlertKind, string> = {
  silent:
    'The device has not been heard from while people are on shift. Check its power and network.',
  skew: 'The device clock is off. Set its clock offset on the device page; it applies to new punches.',
  'timezone-suspect':
    'The device time is off by about a whole half hour. Check the handshake TimeZone value.',
  'biometric-data-received':
    'The device sent biometric data. It was discarded unread; check the device settings.',
  'new-source-ip': 'The device connected from an address it has not used before.',
};

export interface AlertMailer {
  send(
    to: string,
    alert: Parameters<typeof IdentityFacade.sendBiometricDeviceAlert>[1],
  ): Promise<void>;
}

const platformMailer: AlertMailer = { send: IdentityFacade.sendBiometricDeviceAlert };

/**
 * `biometric.device-alert`, after commit: everyone who manages devices for
 * the whole organization — by effective `biometric:manage`, never by role
 * name — is emailed once. A redelivered event finds the alert already
 * announced, or resolved, and sends nothing.
 */
export async function notifyDeviceAlert(
  event: OutboxEvent,
  mailer: AlertMailer = platformMailer,
  clock: Clock = systemClock,
): Promise<number> {
  const { alertId } = event.payload as DeviceAlertOpened;
  const ctx = createJobContext({
    organizationId: event.organizationId,
    principal: systemPrincipal(event.organizationId),
    jobName: BIOMETRIC_EVENTS.DEVICE_ALERT,
    runId: event.id,
  });
  const alert = await db.transaction(ctx, (tx) => punches.alertNotice(tx, alertId));
  if (alert === null || alert.notifiedAt !== null || alert.resolvedAt !== null) return 0;
  const recipients = (
    await AccessFacade.capabilityHolders(ctx, 'biometric:manage')
  ).filter(
    (holder) =>
      holder.email !== null && (holder.scope === null || holder.scope === 'all-people'),
  );
  for (const recipient of recipients) {
    await mailer.send(recipient.email!, {
      deviceName: alert.deviceName,
      serialNumber: alert.serialNumber,
      kind: alert.kind,
      openedAt: alert.openedAt,
      hint: HINTS[alert.kind],
    });
  }
  await db.transaction(ctx, (tx) => punches.markAlertNotified(tx, alertId, clock.now()));
  return recipients.length;
}
