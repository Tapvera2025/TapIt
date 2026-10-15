import { describe, expect, it } from 'vitest';
import {
  cancelAfterWinSchema,
  createDealSchema,
  markLostSchema,
  overrideProbabilitySchema,
  updateDealStageSchema,
} from './validators.js';

describe('createDealSchema', () => {
  it('requires either an originating lead or a direct-entry reason', () => {
    const neither = createDealSchema.safeParse({
      contactId: '11111111-1111-7111-8111-111111111111',
      title: 'Website redesign',
    });
    expect(neither.success).toBe(false);
  });
  it('accepts a lead-sourced deal', () => {
    const parsed = createDealSchema.parse({
      originatingLeadId: '22222222-2222-7222-8222-222222222222',
      contactId: '11111111-1111-7111-8111-111111111111',
      title: 'Website redesign',
    });
    expect(parsed.currency).toBe('INR');
  });
  it('accepts a direct-entry deal with a reason', () => {
    expect(() => createDealSchema.parse({
      directEntryReason: 'Imported from the old CRM — origin lost',
      contactId: '11111111-1111-7111-8111-111111111111',
      title: 'Website redesign',
    })).not.toThrow();
  });
});

describe('updateDealStageSchema', () => {
  it('accepts a valid stage', () => {
    expect(updateDealStageSchema.parse({ dealStage: 'proposal' }).dealStage).toBe('proposal');
  });
  it('rejects unknown stages', () => {
    expect(updateDealStageSchema.safeParse({ dealStage: 'done' }).success).toBe(false);
  });
});

describe('overrideProbabilitySchema', () => {
  it('requires an integer in range + a reason', () => {
    expect(overrideProbabilitySchema.parse({ probability: 50, reason: 'competitor still in play' }).probability).toBe(50);
  });
  it('rejects out-of-range probability', () => {
    expect(overrideProbabilitySchema.safeParse({ probability: 150, reason: 'reasonable text' }).success).toBe(false);
  });
  it('rejects a short reason', () => {
    expect(overrideProbabilitySchema.safeParse({ probability: 50, reason: 'x' }).success).toBe(false);
  });
});

describe('markLostSchema', () => {
  it('accepts a structured loss reason', () => {
    expect(markLostSchema.parse({ reason: 'competitor' }).reason).toBe('competitor');
  });
  it('rejects free-form reasons', () => {
    expect(markLostSchema.safeParse({ reason: 'they ghosted us' }).success).toBe(false);
  });
});

describe('cancelAfterWinSchema', () => {
  it('requires a reason of at least 5 characters', () => {
    expect(cancelAfterWinSchema.safeParse({ reason: 'oops' }).success).toBe(false);
    expect(cancelAfterWinSchema.safeParse({ reason: 'client formally withdrew after the project kickoff' }).success).toBe(true);
  });
});
