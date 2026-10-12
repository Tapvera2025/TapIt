import { describe, expect, it } from 'vitest';
import {
  addBusinessMinutesSimple,
  addDays,
  addMinutesInZone,
  deriveTimezoneFromPhoneE164,
  deviceClockAt,
  fixedClock,
  instantAt,
  instantOfDeviceClock,
  isTimeZone,
  localDateOf,
  OPERATIONAL_TZ,
  systemClock,
  toDateOnly,
  toDeviceClockReading,
  toLocalTime,
  wholeSeconds,
} from './time.js';

const IST = 'Asia/Kolkata';

describe('T-1 — a day is a date in the organization timezone', () => {
  it('00:10 IST is already the next day, though UTC still says the day before (L19)', () => {
    // 18:40 UTC on the 24th is 00:10 IST on the 25th.
    expect(localDateOf(new Date('2026-09-24T18:40:00Z'), IST)).toBe('2026-09-25');
  });

  it('23:59:59 IST is still the same day', () => {
    expect(localDateOf(new Date('2026-09-24T18:29:59Z'), IST)).toBe('2026-09-24');
  });
});

describe('T-3 — a shift time becomes an instant with that date\'s zone rules', () => {
  it('20:00 on 26 September in IST is 14:30 UTC', () => {
    expect(instantAt(toDateOnly('2026-09-26'), toLocalTime('20:00'), IST).toISOString()).toBe(
      '2026-09-26T14:30:00.000Z',
    );
  });

  it('the same 09:00 moves with a daylight-saving change, so no boundary shifts', () => {
    const zone = 'America/New_York'; // clocks went forward on 8 March 2026
    expect(instantAt(toDateOnly('2026-03-06'), toLocalTime('09:00'), zone).toISOString()).toBe(
      '2026-03-06T14:00:00.000Z',
    );
    expect(instantAt(toDateOnly('2026-03-09'), toLocalTime('09:00'), zone).toISOString()).toBe(
      '2026-03-09T13:00:00.000Z',
    );
  });
});

describe('T-5 — time is injected, never read from the wall clock in a calculator', () => {
  it('a fixed clock always answers the same instant', () => {
    const clock = fixedClock('2026-09-25T04:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-09-25T04:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-09-25T04:00:00.000Z');
  });

  it('the system clock answers now', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
  });
});

describe('T-6 — instants are whole seconds', () => {
  it('drops the milliseconds', () => {
    expect(wholeSeconds(new Date('2026-09-25T10:00:00.999Z')).toISOString()).toBe(
      '2026-09-25T10:00:00.000Z',
    );
  });
});

describe('date and time values', () => {
  it('adds days across a month end', () => {
    expect(addDays(toDateOnly('2026-03-31'), 1)).toBe('2026-04-01');
    expect(addDays(toDateOnly('2026-03-01'), -1)).toBe('2026-02-28');
  });

  it('refuses a date that is not on the calendar, and a malformed time', () => {
    expect(() => toDateOnly('2026-02-30')).toThrow(/not a calendar date/);
    expect(() => toDateOnly('25-09-2026')).toThrow(/not a calendar date/);
    expect(() => toLocalTime('24:00')).toThrow(/not a time of day/);
    expect(() => toLocalTime('9:00')).toThrow(/not a time of day/);
  });

  it('knows a real timezone from a typo', () => {
    expect(isTimeZone(IST)).toBe(true);
    expect(isTimeZone('Asia/Kolkatta')).toBe(false);
  });
});

describe('device clock readings (§10.2, §10.3 step 3)', () => {
  it('keeps the seconds, and writes a reading one way', () => {
    expect(toDeviceClockReading('2026-09-22 09:02:11')).toBe('2026-09-22 09:02:11');
    expect(toDeviceClockReading('2026-09-22T09:02:11')).toBe('2026-09-22 09:02:11');
  });

  it.each([
    '2026-02-30 09:00:00', // no such date
    '2026-09-22 24:00:00',
    '2026-09-22 09:60:00',
    '2026-09-22 09:00:60',
    '2026-09-22 09:00', // no seconds
    '2026-09-22 09:00:00.5', // a fraction
    '2026-09-22 09:00:00+05:30', // a zone: a reading has none
    '22/09/2026 09:00:00',
  ])('refuses %s', (value) => {
    expect(() => toDeviceClockReading(value)).toThrow(RangeError);
  });

  it('reads the instant in the device zone, to the second, in zones off the hour', () => {
    const at = toDeviceClockReading('2026-09-22 09:02:11');
    expect(instantOfDeviceClock(at, IST)).toEqual({
      instant: new Date('2026-09-22T03:32:11Z'),
      ambiguous: false,
    });
    expect(instantOfDeviceClock(at, 'Asia/Kathmandu').instant.toISOString()).toBe(
      '2026-09-22T03:17:11.000Z',
    );
    expect(deviceClockAt(new Date('2026-09-22T03:32:11Z'), IST)).toBe(at);
  });

  it('takes a reading that happens twice the first time, and says so', () => {
    const twice = toDeviceClockReading('2026-11-01 01:30:05');
    expect(instantOfDeviceClock(twice, 'America/New_York')).toEqual({
      instant: new Date('2026-11-01T05:30:05Z'), // EDT, -04:00
      ambiguous: true,
    });
  });

  it('refuses a reading that never happens, rather than moving it', () => {
    const never = toDeviceClockReading('2026-03-08 02:30:05');
    expect(() => instantOfDeviceClock(never, 'America/New_York')).toThrow(
      /does not exist/,
    );
  });

  it('refuses an unknown zone', () => {
    expect(() =>
      instantOfDeviceClock(toDeviceClockReading('2026-09-22 09:00:00'), 'Mars/Olympus'),
    ).toThrow(RangeError);
  });
});

describe('Sales dual-clock — phone-country-code → timezone derivation (L8)', () => {
  it('maps Indian numbers to Asia/Kolkata', () => {
    expect(deriveTimezoneFromPhoneE164('+919876543210')).toBe('Asia/Kolkata');
  });

  it('maps UAE numbers to Asia/Dubai', () => {
    expect(deriveTimezoneFromPhoneE164('+971501234567')).toBe('Asia/Dubai');
  });

  it('maps UK numbers to Europe/London', () => {
    expect(deriveTimezoneFromPhoneE164('+447911123456')).toBe('Europe/London');
  });

  it('returns null for a multi-zone country code (US) so callers fall through', () => {
    expect(deriveTimezoneFromPhoneE164('+14155551234')).toBeNull();
  });

  it('returns null for a non-E.164 string', () => {
    expect(deriveTimezoneFromPhoneE164('9876543210')).toBeNull();
  });

  it('returns null for an unknown country prefix', () => {
    expect(deriveTimezoneFromPhoneE164('+9991234567')).toBeNull();
  });

  it('fixes the operational timezone at Asia/Kolkata (lock L7)', () => {
    expect(OPERATIONAL_TZ).toBe('Asia/Kolkata');
  });
});

describe('Sales dual-clock — plain minute arithmetic across DST', () => {
  it('adds minutes correctly in a non-DST zone', () => {
    const start = instantAt(toDateOnly('2026-10-05'), toLocalTime('10:00'), 'Asia/Kolkata');
    const end = addMinutesInZone(start, 10, 'Asia/Kolkata');
    // 10 real minutes always equal 10 minutes of UTC regardless of zone — the
    // guarantee is DST correctness, not that minutes vary by zone.
    expect(end.getTime() - start.getTime()).toBe(10 * 60 * 1000);
  });
});

describe('Sales dual-clock — business-minute SLA clock (addBusinessMinutesSimple)', () => {
  const IST = 'Asia/Kolkata';
  const noDay = (iso: string): Date =>
    instantAt(toDateOnly(iso.slice(0, 10)), toLocalTime(iso.slice(11, 16)), IST);

  it('adds within the same working day', () => {
    const start = noDay('2026-10-05T10:00');       // Monday 10:00
    const due = addBusinessMinutesSimple(start, 10, IST);
    expect(localDateOf(due, IST)).toBe('2026-10-05');
    expect(deviceClockAt(due, IST)).toContain('10:10:');
  });

  it('wraps past end-of-day into the next working day', () => {
    const start = noDay('2026-10-05T17:55');       // Monday 17:55; 5m until 18:00
    const due = addBusinessMinutesSimple(start, 10, IST);
    // 5m used today, 5m remaining tomorrow starting at 10:00 → 10:05 Tuesday.
    expect(localDateOf(due, IST)).toBe('2026-10-06');
    expect(deviceClockAt(due, IST)).toContain('10:05:');
  });

  it('skips Saturday and Sunday', () => {
    const start = noDay('2026-10-10T17:55');       // Saturday 17:55 — off entirely
    const due = addBusinessMinutesSimple(start, 10, IST);
    // Saturday is non-working; start advances to Monday 10:00; add 10m → 10:10.
    expect(localDateOf(due, IST)).toBe('2026-10-12'); // Monday
    expect(deviceClockAt(due, IST)).toContain('10:10:');
  });

  it('starts off-hours and advances to next working window', () => {
    const start = noDay('2026-10-05T07:00');       // Monday before working hours
    const due = addBusinessMinutesSimple(start, 30, IST);
    // Advance to 10:00 then add 30m → 10:30 same day.
    expect(deviceClockAt(due, IST)).toContain('10:30:');
  });

  it('respects custom working hours and days', () => {
    const start = noDay('2026-10-05T10:00');
    const due = addBusinessMinutesSimple(start, 60, IST, {
      workingDays: [1, 2, 3, 4, 5, 6],             // Mon–Sat
      dayStart: toLocalTime('09:00'),
      dayEnd: toLocalTime('13:00'),
    });
    expect(deviceClockAt(due, IST)).toContain('11:00:');
  });

  it('rejects negative minutes', () => {
    expect(() => addBusinessMinutesSimple(new Date(), -1, IST)).toThrow(RangeError);
  });
});
