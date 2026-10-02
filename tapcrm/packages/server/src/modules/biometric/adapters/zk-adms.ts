import {
  instantOfDeviceClock,
  toDeviceClockReading,
  utcOffsetMinutes,
  type DeviceClockReading,
} from '../../../platform/time.js';
import type { NormalizedPunch, RejectedLine, StatusKind, VerifyMode } from '../types.js';

/**
 * The ZKTeco ADMS adapter (attendance design §10.5): eSSL, Identix and other
 * ZKTeco-firmware terminals push `ATTLOG` lines to `/iclock/cdata`.
 *
 *   <PIN> <YYYY-MM-DD> <HH:mm:ss> <status> <verify> <workcode> <reserved…>
 *
 * Columns are separated by tabs on most firmware and by spaces on some, so
 * any run of whitespace separates them; the date and the time are two
 * columns. Extra columns are ignored. A line that cannot be read is returned
 * by number — never logged with its content — and costs only itself.
 *
 * The device's in/out key is kept as sent (`statusCode`) and mapped to a
 * `statusKind`, but a reader trusts it only when set to both-trusted (D37).
 */

const STATUS_KIND: Readonly<Record<string, StatusKind>> = {
  '0': 'in',
  '1': 'out',
  '2': 'break-start',
  '3': 'break-end',
  '4': 'in', // overtime in
  '5': 'out', // overtime out
};

const VERIFY_MODE: Readonly<Record<string, VerifyMode>> = {
  '0': 'password',
  '1': 'fingerprint',
  '2': 'card',
  '3': 'password',
  '4': 'card',
  '9': 'face',
  '15': 'face',
  '25': 'palm',
};

const PIN = /^[A-Za-z0-9]{1,32}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(\d{1,2}):(\d{2}):(\d{2})$/;

export interface AttlogParse {
  readonly punches: NormalizedPunch[];
  readonly rejected: RejectedLine[];
}

export function parseAttlog(body: string, deviceId: string, timezone: string): AttlogParse {
  const punches: NormalizedPunch[] = [];
  const rejected: RejectedLine[] = [];
  body.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === '') return;
    const number = index + 1;
    const cols = line.split(/\s+/);
    const [pin, date, time, status, verify] = cols;
    if (pin === undefined || !PIN.test(pin)) {
      rejected.push({ line: number, reason: 'unreadable PIN' });
      return;
    }
    const timeMatch = time === undefined ? null : TIME.exec(time);
    if (date === undefined || !DATE.test(date) || timeMatch === null) {
      rejected.push({ line: number, reason: 'unreadable time' });
      return;
    }
    let reading: DeviceClockReading;
    let occurredAt: Date;
    try {
      reading = toDeviceClockReading(
        `${date} ${timeMatch[1]!.padStart(2, '0')}:${timeMatch[2]}:${timeMatch[3]}`,
      );
      occurredAt = instantOfDeviceClock(reading, timezone).instant;
    } catch {
      rejected.push({ line: number, reason: 'time does not exist on the device clock' });
      return;
    }
    const statusCode = status !== undefined && /^\d{1,3}$/.test(status) ? status : null;
    punches.push({
      deviceId,
      pin,
      deviceLocalTime: reading,
      occurredAt,
      statusCode,
      statusKind: statusCode === null ? null : (STATUS_KIND[statusCode] ?? null),
      verifyMode:
        verify === undefined ? null : (VERIFY_MODE[verify] ?? (/^\d{1,3}$/.test(verify) ? 'other' : null)),
      readerKey: null,
      externalEventId: null,
      // Only the attendance columns are kept: PIN, time, status, verify, work code.
      raw: cols.slice(0, 6).join('\t').slice(0, 200),
    });
  });
  return { punches, rejected };
}

/**
 * The handshake `TimeZone` value (§10.5): whole-hour zones in hours, others in
 * minutes (`330` for IST) — the spelling ZKTeco firmware reads. `null` asks
 * the caller to omit the line (`handshake_timezone = 'omit'`).
 */
export function handshakeTimeZone(
  setting: string,
  deviceTimezone: string,
  at: Date,
): string | null {
  if (setting === 'omit') return null;
  if (setting !== 'derive') return setting;
  const offsetMinutes = utcOffsetMinutes(deviceTimezone, at);
  return offsetMinutes % 60 === 0 ? String(offsetMinutes / 60) : String(offsetMinutes);
}

/** The options block a registered, enabled device receives at handshake. */
export function handshakeOptions(input: {
  readonly serialNumber: string;
  readonly attlogStamp: string | null;
  readonly timeZone: string | null;
}): string {
  return [
    'GET OPTION FROM: ' + input.serialNumber,
    `ATTLOGStamp=${input.attlogStamp ?? 'None'}`,
    'OPERLOGStamp=9999',
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=60',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=TransData AttLog OpLog',
    ...(input.timeZone === null ? [] : [`TimeZone=${input.timeZone}`]),
    'Realtime=1',
    'Encrypt=0',
  ].join('\n');
}
