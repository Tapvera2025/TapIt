import { describe, expect, it } from 'vitest';
import { instantOfDeviceClock, toDeviceClockReading } from '../../platform/time.js';
import { eventOf, meaningOf, plausibilityOf, readPunch } from './reading.js';
import type { DeviceReadingSettings, NormalizedPunch } from './types.js';

const reading = toDeviceClockReading('2026-09-22 09:02:11');
const punch = (overrides: Partial<NormalizedPunch> = {}): NormalizedPunch => ({
  deviceId: 'device-1',
  pin: '0042',
  deviceLocalTime: reading,
  occurredAt: instantOfDeviceClock(reading, 'Asia/Kolkata').instant,
  statusCode: '1',
  statusKind: 'out',
  verifyMode: 'fingerprint',
  readerKey: null,
  externalEventId: null,
  raw: '0042\t2026-09-22 09:02:11\t1\t1',
  ...overrides,
});
const device = (
  overrides: Partial<DeviceReadingSettings> = {},
): DeviceReadingSettings => ({
  timezone: 'Asia/Kolkata',
  clockOffsetSeconds: 0,
  readerDirection: 'undirected',
  readers: new Map(),
  dryRun: false,
  ...overrides,
});

describe('reading a punch once, as it arrives (D37)', () => {
  it('a device five minutes fast is corrected by its offset, and the offset is kept', () => {
    const read = readPunch(punch(), device({ clockOffsetSeconds: -300 }));
    expect(read.occurredAt.toISOString()).toBe('2026-09-22T03:32:11.000Z');
    expect(read.correctedAt.toISOString()).toBe('2026-09-22T03:27:11.000Z');
    expect(read.appliedOffsetSeconds).toBe(-300);
  });

  it('a reader row decides the direction; without one the device does', () => {
    const readers = new Map([['2', 'exit' as const]]);
    expect(
      readPunch(punch({ readerKey: '2' }), device({ readers })).directionAtReceipt,
    ).toBe('exit');
    expect(
      readPunch(punch({ readerKey: '9' }), device({ readers })).directionAtReceipt,
    ).toBe('undirected');
    expect(readPunch(punch(), device({ readerDirection: 'entry' })).meaning).toBe('in');
  });

  it('keeps the mode the device was in', () => {
    expect(readPunch(punch(), device({ dryRun: true })).dryRunAtReceipt).toBe(true);
  });

  it.each([
    ['entry', 'out', 'in'],
    ['exit', 'in', 'out'],
    ['both-trusted', 'out', 'out'],
    ['both-trusted', null, 'scan'],
    ['alternating', 'in', 'scan'],
    ['undirected', 'in', 'scan'],
  ] as const)('%s reader with key %s means %s', (direction, key, meaning) => {
    expect(meaningOf(direction, key)).toBe(meaning);
  });

  it('a directed meaning is confirmed; a scan is assumed', () => {
    expect(eventOf({ meaning: 'in' })).toEqual({ kind: 'in', evidence: 'confirmed' });
    expect(eventOf({ meaning: 'scan' })).toEqual({ kind: 'scan', evidence: 'assumed' });
  });
});

describe('plausibility (§10.3 step 5)', () => {
  const now = new Date('2026-09-22T10:00:00Z');
  it('allows five minutes ahead, refuses more', () => {
    expect(plausibilityOf(new Date('2026-09-22T10:05:00Z'), now, 72)).toBe('plausible');
    expect(plausibilityOf(new Date('2026-09-22T10:05:01Z'), now, 72)).toBe('future');
  });
  it('holds what is older than the backfill window', () => {
    expect(plausibilityOf(new Date('2026-09-19T10:00:00Z'), now, 72)).toBe('plausible');
    expect(plausibilityOf(new Date('2026-09-19T09:59:59Z'), now, 72)).toBe('backdated');
  });
});
