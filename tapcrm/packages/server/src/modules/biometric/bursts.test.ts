import { describe, expect, it } from 'vitest';
import { groupBursts, reconcile, type BurstPunch } from './bursts.js';

let counter = 0;
const punch = (time: string, overrides: Partial<BurstPunch> = {}): BurstPunch => {
  counter += 1;
  return {
    id: `p${counter}`,
    organizationId: 'org',
    userId: 'x',
    meaning: 'in',
    dryRun: false,
    correctedAt: new Date(`2026-09-22T${time}+05:30`),
    readerKey: null,
    externalEventId: null,
    rawLine: `line ${time}`,
    deviceId: 'A',
    pin: '001',
    ...overrides,
  };
};
const heads = (punches: BurstPunch[]) =>
  groupBursts(punches).map((burst) => burst.head.id);

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

describe('duplicate bursts (BI-6, 26 September review)', () => {
  it('two devices, one arrival: one burst, and the earlier punch leads in either order', () => {
    const a = punch('09:00:10', { deviceId: 'A' });
    const b = punch('09:00:20', { deviceId: 'B', pin: '777' });
    expect(heads([a, b])).toEqual([a.id]);
    expect(heads([b, a])).toEqual([a.id]);
  });

  it('different meanings both survive', () => {
    const came = punch('09:00:10');
    const left = punch('09:00:20', { deviceId: 'B', meaning: 'out' });
    expect(heads([came, left])).toEqual([came.id, left.id]);
  });

  it('a PIN passed on at midnight: two people, never one burst', () => {
    const alice = punch('23:59:40', { userId: 'alice' });
    const bob = punch('23:59:59', { userId: 'bob' });
    expect(heads([alice, bob])).toHaveLength(2);
  });

  it('another organization or the other mode stays apart', () => {
    const live = punch('09:00:10');
    expect(heads([live, punch('09:00:20', { organizationId: 'other' })])).toHaveLength(2);
    expect(heads([live, punch('09:00:20', { dryRun: true })])).toHaveLength(2);
  });

  it('a chain across devices, readers, connectors and PINs is one burst', () => {
    const chain = [
      punch('09:00:00', { deviceId: 'A', pin: '001' }),
      punch('09:00:55', { deviceId: 'B', pin: '9', readerKey: '2' }),
      punch('09:01:50', { deviceId: 'C', pin: '0001' }),
    ];
    expect(heads(chain)).toEqual([chain[0]!.id]);
    expect(heads([chain[0]!, chain[2]!])).toHaveLength(2); // 110 s apart without the middle
  });

  it('every arrival order gives the same bursts', () => {
    const set = [
      punch('09:00:00', { deviceId: 'B' }),
      punch('09:00:00', { deviceId: 'A' }),
      punch('09:00:59'),
      punch('09:02:30'),
    ];
    const expected = groupBursts(set).map((burst) => burst.members.map((m) => m.id));
    for (const order of permutations(set))
      expect(groupBursts(order).map((burst) => burst.members.map((m) => m.id))).toEqual(
        expected,
      );
  });

  it('equal seconds are ordered by provenance, never by arrival', () => {
    const second = punch('09:00:00', { readerKey: '2' });
    const first = punch('09:00:00', { readerKey: '1' });
    expect(heads([second, first])).toEqual([first.id]);
    const noKey = punch('09:00:00');
    expect(heads([first, noKey])).toEqual([noKey.id]); // missing values first
  });
});

describe('reconciling an arriving punch', () => {
  it('a late, earlier punch displaces the head of the burst it joins', () => {
    const head = punch('09:00:40');
    const duplicate = punch('09:01:10');
    const earlier = punch('09:00:10', { deviceId: 'B' });
    const result = reconcile([head, duplicate], earlier);
    expect(result.burst.head.id).toBe(earlier.id);
    expect(result.displacedHeads.map((p) => p.id)).toEqual([head.id]);
  });

  it('a bridging punch joins two bursts and displaces the later head only', () => {
    const left = punch('09:00:00');
    const right = punch('09:01:40');
    const bridge = punch('09:00:50', { deviceId: 'B' });
    const result = reconcile([left, right], bridge);
    expect(result.burst.members.map((p) => p.id)).toEqual([left.id, bridge.id, right.id]);
    expect(result.displacedHeads.map((p) => p.id)).toEqual([right.id]);
  });

  it('a later duplicate displaces nothing', () => {
    const head = punch('09:00:00');
    const result = reconcile([head], punch('09:00:30'));
    expect(result.burst.head.id).toBe(head.id);
    expect(result.displacedHeads).toEqual([]);
  });
});
