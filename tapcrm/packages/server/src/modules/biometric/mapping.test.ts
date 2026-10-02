import { describe, expect, it } from 'vitest';
import { toDateOnly } from '../../platform/time.js';
import {
  overrideWarnings,
  periodsOverlap,
  resolvePin,
  scopeConflicts,
} from './mapping.js';
import type { PinMapping } from './types.js';

const d = toDateOnly;
const row = (overrides: Partial<PinMapping>): PinMapping => ({
  id: 'mapping',
  connectorId: 'zk',
  deviceId: null,
  pin: '001',
  userId: 'alice',
  effectiveFrom: d('2026-01-01'),
  effectiveTo: null,
  ...overrides,
});
const at = { connectorId: 'zk', deviceId: 'front', pin: '001' };

describe('PIN → person (§10.3 step 6)', () => {
  it('a device’s own row overrides the connector-wide row for that device only', () => {
    const mappings = [
      row({ id: 'wide', userId: 'alice' }),
      row({ id: 'front-only', deviceId: 'front', userId: 'bob' }),
    ];
    expect(resolvePin(mappings, at, d('2026-09-22'))?.userId).toBe('bob');
    expect(
      resolvePin(mappings, { ...at, deviceId: 'back' }, d('2026-09-22'))?.userId,
    ).toBe('alice');
  });

  it('a PIN passed on at midnight names each person on their own date', () => {
    const mappings = [
      row({ id: 'alice', userId: 'alice', effectiveTo: d('2026-09-28') }),
      row({ id: 'bob', userId: 'bob', effectiveFrom: d('2026-09-28') }),
    ];
    expect(resolvePin(mappings, at, d('2026-09-27'))?.userId).toBe('alice');
    expect(resolvePin(mappings, at, d('2026-09-28'))?.userId).toBe('bob');
  });

  it('leading zeros are part of the PIN, and another connector’s rows do not count', () => {
    const mappings = [row({ pin: '1' }), row({ connectorId: 'hik' })];
    expect(resolvePin(mappings, at, d('2026-09-22'))).toBeNull();
  });
});

describe('scopes and periods', () => {
  it('periods are end-exclusive', () => {
    const until = row({ effectiveTo: d('2026-09-28') });
    expect(periodsOverlap(until, row({ effectiveFrom: d('2026-09-28') }))).toBe(false);
    expect(periodsOverlap(until, row({ effectiveFrom: d('2026-09-27') }))).toBe(true);
  });

  it('the same PIN in the same scope over a shared day conflicts; another scope does not', () => {
    const existing = [row({ id: 'wide' }), row({ id: 'front', deviceId: 'front' })];
    const proposed = {
      ...row({ userId: 'carol', effectiveFrom: d('2026-06-01') }),
      id: 'new',
    };
    expect(scopeConflicts(existing, proposed).map((r) => r.id)).toEqual(['wide']);
    expect(scopeConflicts(existing, { ...proposed, deviceId: 'back' })).toEqual([]);
  });

  it('warns when a device row and the connector row name different people', () => {
    expect(
      overrideWarnings([
        row({ id: 'wide' }),
        row({ id: 'front', deviceId: 'front', userId: 'bob' }),
      ]),
    ).toEqual([
      {
        pin: '001',
        deviceId: 'front',
        deviceRowUserId: 'bob',
        connectorRowUserId: 'alice',
      },
    ]);
  });
});
