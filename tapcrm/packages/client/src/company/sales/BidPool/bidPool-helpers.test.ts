import { describe, expect, it } from 'vitest';
import {
  classifyClaimError,
  describeAging,
  PassCooldown,
  prependCard,
  removeCard,
} from './bidPool-helpers.js';

describe('describeAging', () => {
  const now = new Date('2024-01-01T00:00:00Z');
  it('is fresh with > 7 minutes remaining', () => {
    const r = describeAging(new Date(now.getTime() + 9 * 60_000).toISOString(), now);
    expect(r.severity).toBe('fresh');
  });
  it('is warming between 3 and 7 minutes', () => {
    const r = describeAging(new Date(now.getTime() + 5 * 60_000).toISOString(), now);
    expect(r.severity).toBe('warming');
  });
  it('is hot between 0 and 3 minutes', () => {
    const r = describeAging(new Date(now.getTime() + 2 * 60_000).toISOString(), now);
    expect(r.severity).toBe('hot');
  });
  it('is expired at or past the deadline', () => {
    const r = describeAging(new Date(now.getTime() - 1).toISOString(), now);
    expect(r.severity).toBe('expired');
  });
  it('formats remaining time as m:ss', () => {
    const r = describeAging(new Date(now.getTime() + 125_000).toISOString(), now);
    expect(r.label).toBe('2:05');
  });
});

describe('PassCooldown', () => {
  it('hides a passed card for 5 minutes then releases it', () => {
    const cooldown = new PassCooldown();
    const t0 = 1_000_000;
    cooldown.passUntil('lead-1', t0);
    expect(cooldown.isCoolingDown('lead-1', t0 + 60_000)).toBe(true);
    expect(cooldown.isCoolingDown('lead-1', t0 + 5 * 60_000 + 1)).toBe(false);
  });
  it('does not report cooling for cards that were never passed', () => {
    const cooldown = new PassCooldown();
    expect(cooldown.isCoolingDown('lead-1')).toBe(false);
  });
});

describe('prependCard / removeCard', () => {
  it('prepend puts the new card first and dedupes', () => {
    const cards = [{ leadId: 'a' }, { leadId: 'b' }];
    const next = prependCard(cards, { leadId: 'a' });
    expect(next.map((c) => c.leadId)).toEqual(['a', 'b']);
  });
  it('remove drops a specific card by id', () => {
    expect(removeCard([{ leadId: 'a' }, { leadId: 'b' }], 'a')).toEqual([{ leadId: 'b' }]);
  });
});

describe('classifyClaimError', () => {
  it('maps 409 ALREADY_CLAIMED to already_claimed', () => {
    expect(classifyClaimError(409, { code: 'ALREADY_CLAIMED' })).toBe('already_claimed');
  });
  it('maps 422 NOT_ELIGIBLE to not_eligible', () => {
    expect(classifyClaimError(422, { code: 'NOT_ELIGIBLE' })).toBe('not_eligible');
  });
  it('falls back to other for unknown errors', () => {
    expect(classifyClaimError(500, { code: 'INTERNAL_ERROR' })).toBe('other');
    expect(classifyClaimError(404, {})).toBe('other');
  });
});
