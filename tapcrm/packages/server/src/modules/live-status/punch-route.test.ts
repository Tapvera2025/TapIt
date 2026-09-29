import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fixedClock } from '../../platform/time.js';

// `vi.hoisted` runs before `vi.mock` so the spy can be shared.
const { appendEventMock } = vi.hoisted(() => ({
  appendEventMock: vi.fn(async () => ({
    eventId: 'evt-1',
    workDate: '2026-10-05',
    reason: 'midpoint',
    replayed: false,
  })),
}));

vi.mock('../attendance/facade.js', () => ({
  appendEvent: appendEventMock,
}));

vi.mock('../../platform/dal/db.js', () => ({
  db: {
    transaction: async <T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>) => fn({}),
  },
}));

import { punch } from './punch-route.js';

const ctx = { organizationId: 'org', principal: { id: 'user-1' } } as never;
const UUID = 'a3b1c1a0-1111-4222-8333-444444444444';

beforeEach(() => {
  appendEventMock.mockClear();
});

describe('punch stub — thin pass-through to appendEvent', () => {
  it('validates body: rejects an unknown kind', async () => {
    await expect(
      punch(ctx, { kind: 'nap', clientEventId: UUID }),
    ).rejects.toThrow();
    expect(appendEventMock).not.toHaveBeenCalled();
  });

  it('clientTime never controls occurred_at — the injected clock does', async () => {
    const past = new Date('2026-10-05T04:00:00Z');
    const clock = fixedClock('2026-10-05T09:00:00Z');
    await punch(
      ctx,
      { kind: 'in', clientEventId: UUID, clientTime: past.toISOString() },
      clock,
    );
    const call = (appendEventMock.mock.calls[0]! as unknown as unknown[])[1];
    expect((call as { at: Date }).at.toISOString()).toBe('2026-10-05T09:00:00.000Z');
    expect((call as { clientTime: Date }).clientTime.toISOString()).toBe(past.toISOString());
  });

  it('milliseconds are removed by wholeSeconds (T-6)', async () => {
    const clock = fixedClock('2026-10-05T09:00:00.789Z');
    await punch(ctx, { kind: 'in', clientEventId: UUID }, clock);
    const at = ((appendEventMock.mock.calls[0]! as unknown as unknown[])[1] as { at: Date }).at;
    expect(at.getUTCMilliseconds()).toBe(0);
    expect(at.toISOString()).toBe('2026-10-05T09:00:00.000Z');
  });

  it('clientEventId survives unchanged', async () => {
    const clock = fixedClock('2026-10-05T09:00:00Z');
    await punch(ctx, { kind: 'in', clientEventId: UUID }, clock);
    const call = (appendEventMock.mock.calls[0]! as unknown as unknown[])[1] as { clientEventId: string };
    expect(call.clientEventId).toBe(UUID);
  });

  it('location reaches the attendance layer when supplied', async () => {
    const clock = fixedClock('2026-10-05T09:00:00Z');
    const loc = { lat: 12.9, lng: 77.6, accuracyM: 30 };
    await punch(ctx, { kind: 'in', clientEventId: UUID, location: loc }, clock);
    const call = (appendEventMock.mock.calls[0]! as unknown as unknown[])[1] as { location: typeof loc };
    expect(call.location).toEqual(loc);
  });

  it('missing location becomes null (non-geofenced case)', async () => {
    const clock = fixedClock('2026-10-05T09:00:00Z');
    await punch(ctx, { kind: 'in', clientEventId: UUID }, clock);
    const call = (appendEventMock.mock.calls[0]! as unknown as unknown[])[1] as { location: null };
    expect(call.location).toBeNull();
  });
});
