import { describe, expect, it } from 'vitest';
import { configureAuthz } from '@tapcrm/authz';
import type { Action, PermissionSet } from '@tapcrm/contracts';
import { activeLegalHoldPredicate, createLegalHold, isAuditEntryHeld, legalHoldAccountType, releaseLegalHold, type LegalHold } from './legal-holds.js';

/** Authz ports whose only policy is `held` (a power the Super Admin gave to this person's position). */
function grantOnly(held: readonly Action[]): void {
  configureAuthz({
    scope: {
      subordinateIds: async () => new Set(),
      teamIds: async () => new Set(),
      poolIds: async () => new Set(),
      poolMemberIds: async () => new Set(),
      teamMemberIds: async () => new Set(),
      departmentMemberIds: async () => new Set(),
      departmentId: async () => null,
    },
    policies: {
      resolveSet: async (): Promise<PermissionSet> => ({
        policies: Object.fromEntries(
          held.map((action) => [action, { action, allowed: true, scope: 'all-people', source: 'position' as const }]),
        ),
        cacheDeadline: new Date(Date.now() + 60_000),
        resolvedAt: new Date(),
      }),
    },
    audit: { sensitiveUse: () => undefined, superAdminBypass: () => undefined, segregationBlocked: () => undefined, defect: () => undefined },
    now: () => new Date(),
  });
}

const base = { organizationId: 'org', actorId: 'user-1', targetId: 'user-2', occurredAt: new Date('2026-09-24T12:00:00Z') };
const hold = (overrides: Partial<LegalHold>): Pick<LegalHold, 'status' | 'holdType' | 'targetId' | 'startsAt' | 'endsAt'> => ({
  status: 'active', holdType: 'user', targetId: 'user-1', startsAt: null, endsAt: null, ...overrides,
});

describe('legal hold matching', () => {
  const employeeContext = { principal: { accountType: 'employee' }, memo: new Map() } as unknown as Parameters<typeof createLegalHold>[0];

  it('maps the user hold type to the employee account model', () => {
    expect(legalHoldAccountType('user')).toBe('employee');
    expect(legalHoldAccountType('client')).toBe('client');
    expect(legalHoldAccountType('date-range')).toBeNull();
  });

  it('rejects hold creation and release without the legal hold power, before database access', async () => {
    grantOnly(['audit:view']);
    await expect(createLegalHold(employeeContext, {
      holdType: 'user', targetId: 'user-1', startsAt: null, endsAt: null, reason: 'case',
    })).rejects.toThrow('only the Super Admin can grant');
    await expect(releaseLegalHold(employeeContext, 'hold-1', null)).rejects.toThrow('only the Super Admin can grant');
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
