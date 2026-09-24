import { describe, expect, it } from 'vitest';
import { chainPayload, computeHash, normalizePayload, type AuditEntryInput, type StoredChainEntry } from './chain.js';
import { dailyKey, verifyAuditEntries } from './integrity.js';

const ORG = '11111111-1111-4111-8111-111111111111';

function chain(stream: 'access' | 'activity', count: number): StoredChainEntry[] {
  const result: StoredChainEntry[] = [];
  let previous: Buffer | null = null;
  for (let index = 1; index <= count; index += 1) {
    const input: AuditEntryInput = normalizePayload({
      action: `${stream}.event.${index}`,
      actorType: 'system',
      targetType: 'user',
      after: { index },
    });
    const position = {
      organizationId: ORG,
      stream,
      sequence: BigInt(index),
      occurredAt: new Date(Date.UTC(2026, 8, 24, 10, 0, index)),
    };
    const hash = computeHash(previous, chainPayload(position, input));
    result.push({ ...position, ...input, prevHash: previous, hash });
    previous = hash;
  }
  return result;
}

describe('audit integrity verification', () => {
  it('uses one UTC idempotency key per daily verification run', () => {
    expect(dailyKey(new Date('2026-09-24T23:59:00.000Z'))).toBe('2026-09-24');
  });

  it.each(['access', 'activity'] as const)('accepts a valid %s stream', (stream) => {
    expect(verifyAuditEntries(stream, chain(stream, 3))).toEqual([]);
  });

  it('reports modified entries, deleted entries, broken predecessors, and bad hashes', () => {
    const modified = chain('access', 4);
    modified[1] = { ...modified[1]!, action: 'tampered' };
    expect(verifyAuditEntries('access', modified).map((item) => item.reason)).toContain('hash-mismatch');

    const deleted = chain('activity', 4);
    deleted.splice(1, 1);
    expect(verifyAuditEntries('activity', deleted).map((item) => item.reason)).toEqual(
      expect.arrayContaining(['sequence-gap', 'prev-hash-mismatch']),
    );

    const badPrevious = chain('access', 3);
    badPrevious[2] = { ...badPrevious[2]!, prevHash: Buffer.alloc(32, 7) };
    expect(verifyAuditEntries('access', badPrevious).map((item) => item.reason)).toContain('prev-hash-mismatch');
  });
});
