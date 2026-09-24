import { describe, expect, it } from 'vitest';
import { activeLegalHoldPredicate, createLegalHold, isAuditEntryHeld, legalHoldAccountType, releaseLegalHold, type LegalHold } from './legal-holds.js';

const base = { organizationId: 'org', actorId: 'user-1', targetId: 'user-2', occurredAt: new Date('2026-09-24T12:00:00Z') };
const hold = (overrides: Partial<LegalHold>): Pick<LegalHold, 'status' | 'holdType' | 'targetId' | 'startsAt' | 'endsAt'> => ({
  status: 'active', holdType: 'user', targetId: 'user-1', startsAt: null, endsAt: null, ...overrides,
});

describe('legal hold matching', () => {
  const employeeContext = { principal: { accountType: 'employee' } } as Parameters<typeof createLegalHold>[0];

  it('maps the user hold type to the employee account model', () => {
    expect(legalHoldAccountType('user')).toBe('employee');
    expect(legalHoldAccountType('client')).toBe('client');
    expect(legalHoldAccountType('date-range')).toBeNull();
  });

  it('rejects non-Super Admin hold creation and release before database access', async () => {
    await expect(createLegalHold(employeeContext, {
      holdType: 'user', targetId: 'user-1', startsAt: null, endsAt: null, reason: 'case',
    })).rejects.toThrow('Only Super Admin');
    await expect(releaseLegalHold(employeeContext, 'hold-1', null)).rejects.toThrow('Only Super Admin');
  });

  it('matches user and client holds against actor or target', () => {
    expect(isAuditEntryHeld(base, [hold({})])).toBe(true);
    expect(isAuditEntryHeld({ ...base, actorId: 'other' }, [hold({ targetId: 'user-2', holdType: 'client' })])).toBe(true);
  });

  it('matches inclusive date ranges and ignores released holds', () => {
    expect(isAuditEntryHeld(base, [hold({ holdType: 'date-range', targetId: null, startsAt: new Date('2026-09-24T12:00:00Z'), endsAt: new Date('2026-09-24T12:00:00Z') })])).toBe(true);
    expect(isAuditEntryHeld(base, [hold({ status: 'released' })])).toBe(false);
  });

  it('keeps an entry held when any overlapping active hold remains', () => {
    expect(isAuditEntryHeld(base, [hold({ status: 'released' }), hold({ targetId: 'user-2', holdType: 'client' })])).toBe(true);
  });

  it('exposes an active-only tenant-scoped predicate for future retention', () => {
    const predicate = activeLegalHoldPredicate();
    expect(predicate.sql).toContain("lh.status = 'active'");
    expect(predicate.sql).toContain('lh.organization_id = ae.organization_id');
  });
});
