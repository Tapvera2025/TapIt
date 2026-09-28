import { describe, expect, it } from 'vitest';
import { auditEntryId, isPeopleAudit } from './repository.js';

describe('audit query identity and domain classification', () => {
  it('creates a stable opaque detail key from the composite audit key', () => {
    const occurredAt = new Date('2026-01-02T03:04:05.000Z');
    const first = auditEntryId({ stream: 'access', sequence: 7, occurredAt });
    const second = auditEntryId({ stream: 'access', sequence: 7, occurredAt: new Date(occurredAt) });
    expect(first).toBe(second);
    expect(first).not.toContain('2026');
  });

  it('classifies people audit events without exposing business events to HR', () => {
    expect(isPeopleAudit({ targetType: 'user', action: 'profile.updated' })).toBe(true);
    expect(isPeopleAudit({ targetType: 'invoice', action: 'billing.invoice_issued' })).toBe(false);
    expect(isPeopleAudit({ targetType: 'invoice', action: 'access.policy_read' })).toBe(true);
  });
});
