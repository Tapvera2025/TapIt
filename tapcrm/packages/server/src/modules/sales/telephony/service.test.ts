import { describe, expect, it } from 'vitest';
import type { DateOnly } from '@tapcrm/contracts';
import { fillDays, resolveRange } from './service.js';
import { syncWindow, SYNC_OVERLAP_MS } from './sync.js';
import { callListQuerySchema, createConnectionSchema, overviewQuerySchema } from './validators.js';

describe('call analytics ranges', () => {
  it('defaults to the last 30 days ending today in the company timezone', () => {
    // 20:00 UTC on 31 Oct is already 1 Nov in India.
    const range = resolveRange({}, 'Asia/Kolkata', new Date('2026-10-31T20:00:00Z'));
    expect(range).toEqual({ from: '2026-10-03', to: '2026-11-01' });
  });

  it('keeps an explicit range and rejects a backwards one', () => {
    expect(resolveRange({ from: '2026-10-01', to: '2026-10-07' }, 'UTC')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(() => resolveRange({ from: '2026-10-07', to: '2026-10-01' }, 'UTC')).toThrow(/on or before/);
  });

  it('fills quiet days with zeros so the chart has every day', () => {
    const days = fillDays('2026-10-01' as DateOnly, '2026-10-04' as DateOnly, [
      { day: '2026-10-02', inbound: 3, outbound: 1, answered: 3, missed: 1, talkSeconds: 600 },
    ]);
    expect(days.map((day) => [day.day, day.inbound])).toEqual([
      ['2026-10-01', 0],
      ['2026-10-02', 3],
      ['2026-10-03', 0],
      ['2026-10-04', 0],
    ]);
  });
});

describe('sync window', () => {
  const now = new Date('2026-11-04T10:00:00Z');

  it('backfills on the first sync, capped at JustCall’s three months', () => {
    expect(syncWindow({ syncedThrough: null, backfillDays: 30, provider: 'aircall' }, now).from.toISOString()).toBe('2026-10-05T10:00:00.000Z');
    expect(syncWindow({ syncedThrough: null, backfillDays: 365, provider: 'justcall' }, now).from.toISOString()).toBe('2026-08-06T10:00:00.000Z');
  });

  it('re-reads the overlap after the high-water mark', () => {
    const mark = new Date('2026-11-04T09:00:00Z');
    const window = syncWindow({ syncedThrough: mark, backfillDays: 30, provider: 'justcall' }, now);
    expect(window.from.getTime()).toBe(mark.getTime() - SYNC_OVERLAP_MS);
    expect(window.to).toEqual(now);
  });
});

describe('telephony validators', () => {
  it('requires the right fields per platform and trims pasted keys', () => {
    const parsed = createConnectionSchema.parse({
      credentials: { provider: 'justcall', apiKey: '  abcdefgh1234 ', apiSecret: 'secret1234567' },
    });
    expect(parsed.credentials).toEqual({ provider: 'justcall', apiKey: 'abcdefgh1234', apiSecret: 'secret1234567' });
    expect(parsed.backfillDays).toBe(30);
    expect(() => createConnectionSchema.parse({ credentials: { provider: 'aircall', apiKey: 'abcdefgh1234' } })).toThrow();
    expect(() => createConnectionSchema.parse({ credentials: { provider: 'justcall', apiKey: 'short', apiSecret: 'secret1234567' } })).toThrow(/too short/);
  });

  it('bounds date ranges and page sizes', () => {
    expect(() => overviewQuerySchema.parse({ from: '2025-01-01', to: '2026-11-01' })).toThrow(/at most a year/);
    expect(() => overviewQuerySchema.parse({ from: '2026-13-01' })).toThrow();
    expect(callListQuerySchema.parse({ unmatched: 'true', pageSize: '25' })).toMatchObject({ unmatched: true, pageSize: 25, page: 1 });
    expect(() => callListQuerySchema.parse({ pageSize: '1000' })).toThrow();
  });
});
