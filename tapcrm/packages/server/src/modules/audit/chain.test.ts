import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  chainPayload,
  computeHash,
  normalizePayload,
  verifyChain,
  type AuditEntryInput,
  type StoredChainEntry,
} from './chain.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

describe('canonicalize', () => {
  it('sorts keys at every depth so key order never changes the hash', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalize({ a: { c: 3, d: 2 }, b: 1 }),
    );
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('keeps array order, distinguishes null from a missing key, and formats dates in UTC', () => {
    expect(canonicalize([2, 1])).toBe('[2,1]');
    expect(canonicalize({ a: null })).toBe('{"a":null}');
    expect(canonicalize({ a: undefined })).toBe('{}');
    expect(canonicalize(new Date('2026-09-21T10:00:00.123Z'))).toBe('"2026-09-21T10:00:00.123Z"');
  });

  it('refuses values it cannot serialise deterministically', () => {
    expect(() => canonicalize(Number.NaN)).toThrow();
    expect(() => canonicalize(() => 1)).toThrow();
  });
});

describe('normalizePayload', () => {
  it('maps a well-formed payload straight through', () => {
    const entry = normalizePayload({
      action: 'employee.created',
      actorId: USER,
      actorType: 'super-admin',
      targetType: 'user',
      targetId: USER,
      before: { status: 'a' },
      after: { status: 'b' },
      sourceIp: '203.0.113.7',
      requestId: 'req-1',
    });
    expect(entry).toMatchObject({
      action: 'employee.created',
      actorId: USER,
      actorType: 'super-admin',
      targetType: 'user',
      before: { status: 'a' },
      after: { status: 'b' },
      sourceIp: '203.0.113.7',
      reason: null,
    });
  });

  it('keeps fields the table has no column for under after._context', () => {
    const entry = normalizePayload({
      action: 'identity.login',
      actorType: 'employee',
      targetType: 'user',
      kind: 'sensitive-use',
      metadata: { device: 'x' },
    });
    expect(entry.after).toEqual({ _context: { kind: 'sensitive-use', metadata: { device: 'x' } } });
  });

  it('preserves a non-object `after` value alongside the context', () => {
    const entry = normalizePayload({ action: 'a', targetType: 't', after: 5, extra: true });
    expect(entry.after).toEqual({ value: 5, _context: { extra: true } });
  });

  it('never throws: repairs unstorable fields and records what it repaired', () => {
    const entry = normalizePayload({
      actorId: 'not-a-uuid',
      actorType: 'wizard',
      targetId: 42,
      sourceIp: 'nope',
    });
    expect(entry).toMatchObject({
      actorId: null,
      actorType: 'system',
      action: 'unknown',
      targetType: 'unknown',
      targetId: null,
      sourceIp: null,
    });
    expect(entry.after).toEqual({
      _context: {
        _invalid: { actorId: 'not-a-uuid', actorType: 'wizard', targetId: 42, sourceIp: 'nope', action: null },
      },
    });
  });

  it.each([null, undefined, 'a string', 7, []])('survives a non-object payload: %j', (payload) => {
    const entry = normalizePayload(payload);
    expect(entry.action).toBe('unknown');
    expect(entry.actorType).toBe('system');
  });

  it('accepts IPv6 and IPv4-mapped addresses', () => {
    expect(normalizePayload({ sourceIp: '::ffff:10.0.0.1' }).sourceIp).toBe('::ffff:10.0.0.1');
    expect(normalizePayload({ sourceIp: '2001:db8::1' }).sourceIp).toBe('2001:db8::1');
  });
});

function buildChain(count: number): StoredChainEntry[] {
  const out: StoredChainEntry[] = [];
  let prevHash: Buffer | null = null;
  for (let i = 1; i <= count; i += 1) {
    const input: AuditEntryInput = normalizePayload({
      action: `test.action.${i}`,
      actorId: USER,
      actorType: 'employee',
      targetType: 'thing',
      after: { i },
    });
    const position = {
      organizationId: ORG,
      stream: 'activity' as const,
      sequence: BigInt(i),
      occurredAt: new Date(Date.UTC(2026, 8, 21, 10, 0, i)),
    };
    const hash = computeHash(prevHash, chainPayload(position, input));
    out.push({ ...position, ...input, prevHash, hash });
    prevHash = hash;
  }
  return out;
}

describe('hash chain', () => {
  it('chains from nothing, then from the previous hash', () => {
    const [first, second] = buildChain(2) as [StoredChainEntry, StoredChainEntry];
    expect(first.prevHash).toBeNull();
    expect(second.prevHash?.equals(first.hash)).toBe(true);
    expect(first.hash).toHaveLength(32);
  });

  it('is deterministic', () => {
    expect(buildChain(3).map((e) => e.hash.toString('hex'))).toEqual(
      buildChain(3).map((e) => e.hash.toString('hex')),
    );
  });

  it('verifies an intact chain', () => {
    expect(verifyChain(buildChain(5))).toEqual([]);
  });

  it('detects a modified entry (AC-13)', () => {
    const chain = buildChain(4);
    chain[1] = { ...(chain[1] as StoredChainEntry), action: 'tampered' };
    expect(verifyChain(chain)).toContainEqual({ sequence: 2n, reason: 'hash-mismatch' });
  });

  it('detects a deleted entry', () => {
    const chain = buildChain(4);
    chain.splice(1, 1);
    const reasons = verifyChain(chain).map((b) => b.reason);
    expect(reasons).toContain('sequence-gap');
    expect(reasons).toContain('prev-hash-mismatch');
  });

  it('detects a rewritten entry even when its own hash is recomputed', () => {
    const chain = buildChain(4);
    const target = chain[1] as StoredChainEntry;
    const forged = { ...target, action: 'forged' };
    const rehashed = computeHash(forged.prevHash, chainPayload(forged, forged));
    chain[1] = { ...forged, hash: rehashed };
    // Its own hash now matches, but the next entry still points at the old one.
    expect(verifyChain(chain)).toEqual([{ sequence: 3n, reason: 'prev-hash-mismatch' }]);
  });

  it('verifies a window that starts mid-chain', () => {
    const chain = buildChain(5);
    const window = chain.slice(2);
    expect(
      verifyChain(window, { sequence: 3n, prevHash: (chain[1] as StoredChainEntry).hash }),
    ).toEqual([]);
  });
});
