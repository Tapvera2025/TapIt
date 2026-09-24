import { describe, expect, it } from 'vitest';
import { decryptArchivePayload, encryptArchivePayload, type ArchivedAuditRow } from './archive.js';

const row: ArchivedAuditRow = {
  organizationId: '11111111-1111-4111-8111-111111111111', stream: 'access', sequence: '1',
  occurredAt: new Date('2026-01-01T00:00:00Z'), actorId: null, actorType: 'system',
  action: 'access.view', targetType: 'user', targetId: null, before: null, after: { ok: true },
  reason: null, sourceIp: null, requestId: 'r1', prevHash: null, hash: Buffer.alloc(32, 1),
  hashVersion: 1, legalHold: false,
};

describe('encrypted audit archive payloads', () => {
  it('round-trips through the separately managed archive key and hides plaintext', () => {
    const key = Buffer.alloc(32, 9);
    const encrypted = encryptArchivePayload([row], key, 'audit-key-v1');
    expect(encrypted.body.toString('utf8')).not.toContain('access.view');
    expect(decryptArchivePayload(encrypted.body, key, 'audit-key-v1')[0]).toMatchObject({ sequence: '1', action: 'access.view' });
  });

  it('rejects an incorrect archive key identity', () => {
    const encrypted = encryptArchivePayload([row], Buffer.alloc(32, 9), 'audit-key-v1');
    expect(() => decryptArchivePayload(encrypted.body, Buffer.alloc(32, 8), 'different-key')).toThrow('requires encryption key');
  });
});
