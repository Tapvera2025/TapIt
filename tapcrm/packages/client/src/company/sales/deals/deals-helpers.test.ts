import { describe, expect, it } from 'vitest';
import {
  formatProbability,
  groupByStage,
  isStageTransitionAllowed,
  monthToRange,
  nextStageOptions,
} from './deals-helpers.js';
import type { Deal, DealStage } from './api.js';

function makeDeal(overrides: Partial<Deal> & { dealStage: DealStage }): Deal {
  const base: Deal = {
    id: '00000000-0000-0000-0000-000000000001',
    organizationId: 'org',
    dealNumber: '1',
    originatingLeadId: null,
    directEntryReason: null,
    contactId: 'c1',
    contactName: 'A',
    companyId: null,
    companyName: null,
    serviceRequested: null,
    title: 'Test',
    scopeSummary: null,
    originatingAgentId: 'u1',
    originatingAgentName: null,
    responsibleCloserId: 'u1',
    responsibleCloserName: null,
    closedById: null,
    currency: 'INR',
    expectedCloseAt: null,
    probabilityOverride: null,
    commercialsId: null,
    dealStage: 'discovery',
    approvalStatus: 'not_required',
    contractStatus: 'not_required',
    paymentStatus: 'unpaid',
    lifecycleStatus: 'open',
    lossReason: null,
    lostAt: null,
    wonAt: null,
    cancelledAt: null,
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  return { ...base, ...overrides };
}

describe('isStageTransitionAllowed', () => {
  it('allows the natural forward step by one', () => {
    expect(isStageTransitionAllowed('discovery', 'proposal')).toBe(true);
    expect(isStageTransitionAllowed('proposal', 'negotiation')).toBe(true);
    expect(isStageTransitionAllowed('negotiation', 'closing')).toBe(true);
  });

  it('forbids skipping forward', () => {
    expect(isStageTransitionAllowed('discovery', 'negotiation')).toBe(false);
    expect(isStageTransitionAllowed('discovery', 'closing')).toBe(false);
  });

  it('allows any backwards move among open stages', () => {
    expect(isStageTransitionAllowed('closing', 'discovery')).toBe(true);
    expect(isStageTransitionAllowed('negotiation', 'proposal')).toBe(true);
  });

  it('never routes through closed', () => {
    expect(isStageTransitionAllowed('closing', 'closed')).toBe(false);
    expect(isStageTransitionAllowed('closed', 'discovery')).toBe(false);
  });

  it('treats same-stage as a no-op allowed', () => {
    expect(isStageTransitionAllowed('discovery', 'discovery')).toBe(true);
  });
});

describe('nextStageOptions', () => {
  it('returns the forward step plus earlier stages', () => {
    expect(nextStageOptions('negotiation')).toEqual(['discovery', 'proposal', 'closing']);
  });

  it('returns an empty list for closed', () => {
    expect(nextStageOptions('closed')).toEqual([]);
  });
});

describe('groupByStage', () => {
  it('buckets open deals by stage in canonical order and ignores non-open', () => {
    const open = makeDeal({ id: 'a', dealStage: 'proposal' });
    const closed = makeDeal({ id: 'b', dealStage: 'closing', lifecycleStatus: 'won' });
    const other = makeDeal({ id: 'c', dealStage: 'discovery' });
    const groups = groupByStage([open, closed, other]);
    expect(groups.map((g) => g.stage)).toEqual(['discovery', 'proposal', 'negotiation', 'closing']);
    expect(groups[0]!.deals.map((d) => d.id)).toEqual(['c']);
    expect(groups[1]!.deals.map((d) => d.id)).toEqual(['a']);
    expect(groups[3]!.deals.map((d) => d.id)).toEqual([]);
  });
});

describe('monthToRange', () => {
  it('returns inclusive-from / exclusive-to ISO strings for a valid month', () => {
    const range = monthToRange('2026-10');
    expect(range).toEqual({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-11-01T00:00:00.000Z',
    });
  });

  it('rejects malformed input', () => {
    expect(monthToRange('not-a-month')).toBeNull();
    expect(monthToRange('2026-13')).toBeNull();
  });
});

describe('formatProbability', () => {
  it('uses override when present', () => {
    const deal = makeDeal({ dealStage: 'discovery', probabilityOverride: 42 });
    expect(formatProbability(deal)).toBe('42%');
  });

  it('falls back to stage defaults', () => {
    expect(formatProbability(makeDeal({ dealStage: 'discovery' }))).toBe('10%');
    expect(formatProbability(makeDeal({ dealStage: 'proposal' }))).toBe('25%');
    expect(formatProbability(makeDeal({ dealStage: 'closing' }))).toBe('75%');
  });

  it('is 100% for closed-won and 0% for closed-non-won', () => {
    expect(formatProbability(makeDeal({ dealStage: 'closed', lifecycleStatus: 'won' }))).toBe('100%');
    expect(formatProbability(makeDeal({ dealStage: 'closed', lifecycleStatus: 'lost' }))).toBe('0%');
  });
});
